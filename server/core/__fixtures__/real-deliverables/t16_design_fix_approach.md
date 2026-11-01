# Win+D 一瞬消失(170〜289ms)を120ms以内に抑える修正方針設計

対象不具合: Win+D 押下直後、フェンスが Progman/WorkerW の後ろへ一瞬(実測170〜289ms)隠れて戻る。
既存の遅延再送出(30/100/250/500ms、t10設計・t11実装済み)は Win+D 中の2秒以上の消失は解消したが、最初の一瞬は残っている。

入力: `_ai-records/windd-fence/t15_research_root_cause.md` / `src/Fence.App/Infrastructure/Win32/DesktopZOrderService.cs` / `src/Fence.App/Infrastructure/Win32/DesktopWindowHelper.cs` / `src/Fence.App/Infrastructure/Win32/NativeMethods.cs` / ARCHITECTURE.md / PLAN.md

本書はコード変更を行わない設計のみの成果物(制約どおり)。`dotnet build` 等の実行確認は行っていない(未確認)。

---

## 1. 前提(t15調査の要点の再掲)

- Win+D は Explorer の「デスクトップを表示」機能であり、内部的には**開いている各トップレベル窓を1つずつ最小化する**(いわゆる ToggleDesktop)。この「最小化の連鎖」が進む間、Zオーダーは単発ではなく**バースト(複数段)で揺れる**。
- 現状の検知トリガーは `EVENT_SYSTEM_FOREGROUND` のみ(`DesktopZOrderService.cs` L46-50)。この1本のフックは「最終的にデスクトップ層がフォアグラウンドになった」タイミング付近で1回発火するだけで、**バースト中の個々の揺れ**には反応しない。
- 既存の遅延再送出(30/100/250/500ms)は、このバーストが「どこかのタイミングで収まる」ことに賭けた**時間ベースの当て直し**であり、バースト自体の実際の継続時間とは無関係に固定されている。実測で最長289msの隠れが残っているのは、バーストの収まり方がこの固定間隔(特に最初の30ms)と噛み合わない瞬間があるため。
- `DesktopWindowHelper.SinkToBottom` 自体は呼ばれるたびに `ResolveDesktopLayerInsertAfter()` で**その時点の正しい挿入位置を毎回再計算**している(L43-67)。つまり「どこに沈めるか」は常に最新で正しい。問題は「**いつ沈め直すか**」が疎(FOREGROUND 1発 + 固定4回)であること。

→ 的を絞るべきは「検知のタイミング密度を、バーストの実体(個々の窓の最小化)に揃えること」。

---

## 2. 比較した案

### 案A: 遅延再送出の間隔を詰める(例: 10/20/40/60/90/120ms)だけ

- 実装コストは最小(配列の数値変更のみ)。
- しかし本質的に**当てずっぽうの時間ベース**のままで、根本原因(バーストの実際の継続時間・揺れのタイミング)に対応していない。t15調査が指摘する「シェル側の再配置が完了するまでの数フレーム」は環境(CPU負荷・開いている窓の数)によって変動するため、固定間隔を詰めても「たまたま間に合わない」ケースが残る可能性がある。実測の最初の1回が約2秒だった事実(ウォームアップ中)からも、このバーストの長さが環境依存でブレることが分かる。
- **既存動作を壊すリスクは最小だが、120ms以内を安定して保証する根拠が弱い。** 不採用(が、後述の採用案と矛盾しないので間隔はそのまま維持)。

### 案B: Win+D 発生をより早く検知する — WinEventフックの対象を広げる(本書の採用案)

- `EVENT_SYSTEM_FOREGROUND` に加えて、**`EVENT_SYSTEM_MINIMIZESTART`(0x0016)・`EVENT_SYSTEM_MINIMIZEEND`(0x0017)** を新たにフックする。
- Win+D のバーストの実体は「開いている各窓が順に最小化される」ことそのものなので、この2イベントは**バーストの発生源に直接ついた信号**であり、FOREGROUND 1発よりずっと密に(開いている窓の数だけ)発火する。各イベントで即座に `SinkAll()` を呼べば、固定遅延を待たずバーストの進行に合わせてリアルタイムに沈め直しが入る。
- OSが発火するイベントを使うだけなので、独自ポーリングよりコストが低く、既存の「WinEventフック1本+2秒安全網」という設計思想(ARCHITECTURE.mdが前提とする「WPF標準APIで出来ない部分だけP/Invoke」の方針)にも合致する。
- 既存の `_hook`・`_safetyTimer`・`Suspended`・`Register`/`Unregister`・遅延再送出バーストは**一切変更不要**(そのまま併存させる安全網として残す)。

### 案C: 短い間隔の監視(ポーリング)に置き換える/追加する

- トリガー発生後、例えば15ms間隔で「フェンスが実際にデスクトップ層より前にあるか」を都度確認し、ズレていたら即沈め直す、という常時監視寄りの方式。
- 案Bが実際のOS通知に紐づいているのに対し、こちらは「確認した状態」に基づくので理屈上はさらに確実。だが新規の繰り返しタイマー・Zオーダー確認コード(`EnumWindows`等)が常時または長めの期間動くことになり、既存コードベースの「必要な時だけ動く」(`_resinkTimer`は遅延初期化、`Start()`では作らない、など)という最小主義から外れ、変更範囲・CPU使用の両方で案Bより重い。
- 案Bで目標(120ms以内)に届かない場合の**次の手**として設計メモに残すが、本書では採用しない(constraint: 最小限の変更で安全なものを選ぶ、に対して過剰)。

### 案D: そもそも隠れない配置にする(WorkerWへの再親化 `SetParent`)

- `DesktopWindowHelper.cs` のクラスコメント(L14-21)に明記されている通り、**過去に実際に試して不可視化の問題を起こした**実績がある。理由は「WPFの`HwndSource`を`WS_POPUP`のまま`WS_CHILD`の親子関係に押し込むと、スタイルと座標系の不整合が起き、実機のシェル構成によって描画が壊れる」という具体的な失敗原因が記録されている。
- 本調査(t15)および今回の設計作業では、この失敗原因(`WS_POPUP`/`WS_CHILD`不整合、座標系の不一致)が**解消されたと言える新しい根拠を何も得ていない**。WorkerWの構成(Progmanの子か別プロセスのWorkerWか)はOSビルドやシェル拡張の有無で変わりうる環境依存の内部実装であり、再現性のある解決策として保証できない。
- 制約「採用するならその再発を避けられる根拠を示すこと」を満たせないため、**不採用**。現状のコメントの通り、「通常のトップレベル窓をHWND系で沈め続ける」方式(Rainmeterの"on desktop"モード等と同種)を維持する。

---

## 3. 採用案の詳細設計(案B: WinEventフックの対象拡張)

### 3.1 変更方針の全体像

- `DesktopZOrderService.cs` のみを変更。`DesktopWindowHelper.cs`(沈める先の計算ロジック)は無変更 — 「何を直すか」ではなく「いつ検知するか」だけを直す問題なので、変更はこのファイルに閉じる。
- `NativeMethods.cs` に `EVENT_SYSTEM_MINIMIZESTART` / `EVENT_SYSTEM_MINIMIZEEND` の2定数を追加するだけ(既存の `EVENT_SYSTEM_FOREGROUND` のそばに追記)。
- 既存の `_hook`(FOREGROUND用)はそのまま残し、**新しいフック `_minimizeHook` をもう1本追加**する(1本のフックの範囲を広げて `EVENT_SYSTEM_FOREGROUND`〜`EVENT_SYSTEM_MINIMIZEEND` を一括指定する方式は採らない — その範囲には `MENUSTART`/`MOVESIZESTART` 等、本題と無関係なシステムイベントが多数挟まり、不要な `SinkAll()` 呼び出しが増えるため、的を絞った2本構成にする)。
- 既存の `_safetyTimer`(2秒周期)、`Register`/`Unregister`、`Suspended`(Peek中の抑制)、遅延再送出バースト(30/100/250/500ms)は**完全に無変更**。これらはそのまま安全網として機能し続ける。

### 3.2 `NativeMethods.cs` への追加

既存の `// ---- Peek hotkey ----` の直前、`EVENT_SYSTEM_FOREGROUND` が定義されている行(現 L230 付近)のそばに追記:

```csharp
public const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
public const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
public const uint EVENT_SYSTEM_MINIMIZEEND = 0x0017;
public const uint WINEVENT_OUTOFCONTEXT = 0x0000;
public const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
```

(既存の `WinEventDelegate` / `SetWinEventHook` / `UnhookWinEvent` の宣言は型そのものを再利用するので変更不要。)

### 3.3 `DesktopZOrderService.cs` への追加

フィールド追加(`_hook`/`_hookProc` のそばに1本追加):

```csharp
private static IntPtr _hook;
private static IntPtr _minimizeHook;
private static NativeMethods.WinEventDelegate? _hookProc; // keep alive - GC root
```

`Start()`: 既存の `_hook` 登録のすぐ下に、同じ `_hookProc` を使って2本目のフックを登録する。

```csharp
public static void Start()
{
    if (_started) return;
    _started = true;

    _hookProc = OnForegroundChanged;
    _hook = NativeMethods.SetWinEventHook(
        NativeMethods.EVENT_SYSTEM_FOREGROUND, NativeMethods.EVENT_SYSTEM_FOREGROUND,
        IntPtr.Zero, _hookProc, 0, 0,
        NativeMethods.WINEVENT_OUTOFCONTEXT | NativeMethods.WINEVENT_SKIPOWNPROCESS);

    // Win+D (Explorerの「デスクトップを表示」) は開いている各トップレベル窓を
    // 順に最小化することで実現されており、Zオーダーのバーストはこの最小化の連鎖
    // そのもの。EVENT_SYSTEM_FOREGROUND 1発だけでは、このバーストの最初の揺れに
    // 追いつけない区間が生まれる(t15調査)。MINIMIZESTART/MINIMIZEEND は最小化
    // される窓の数だけ発火するので、バーストの進行に合わせてより密に再沈めできる。
    _minimizeHook = NativeMethods.SetWinEventHook(
        NativeMethods.EVENT_SYSTEM_MINIMIZESTART, NativeMethods.EVENT_SYSTEM_MINIMIZEEND,
        IntPtr.Zero, _hookProc, 0, 0,
        NativeMethods.WINEVENT_OUTOFCONTEXT | NativeMethods.WINEVENT_SKIPOWNPROCESS);

    _safetyTimer = new System.Threading.Timer(_ => SinkAll(), null,
        TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));
}
```

`Stop()`: `_hook` の解除のすぐ下に `_minimizeHook` の解除を追加。

```csharp
public static void Stop()
{
    if (!_started) return;
    _started = false;

    if (_hook != IntPtr.Zero)
    {
        NativeMethods.UnhookWinEvent(_hook);
        _hook = IntPtr.Zero;
    }
    if (_minimizeHook != IntPtr.Zero)
    {
        NativeMethods.UnhookWinEvent(_minimizeHook);
        _minimizeHook = IntPtr.Zero;
    }
    _hookProc = null;

    _safetyTimer?.Dispose();
    _safetyTimer = null;

    lock (Lock)
    {
        _resinkTimer?.Dispose();
        _resinkTimer = null;
    }
}
```

`OnForegroundChanged`(2種類のイベントを受けるため条件分岐を1つ追加。メソッド名は既存のまま変更しない — 呼ばれ方の意味が「フォアグラウンド変更時」から「Zオーダーに関係しそうなイベント発生時」に広がるので、XMLコメントのみ更新する):

現状:
```csharp
private static void OnForegroundChanged(
    IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
    int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
{
    lock (Lock)
    {
        if (RegisteredHwnds.Contains(hwnd)) return;
    }

    SinkAll();
    ScheduleDelayedResink();
}
```

変更後:
```csharp
private static void OnForegroundChanged(
    IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
    int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
{
    // RegisteredHwnds.Contains(hwnd) によるスキップは、EVENT_SYSTEM_FOREGROUND で
    // 「クリックされたのが自分自身のフェンスだった」場合のみ意味がある(既存挙動)。
    // MINIMIZESTART/MINIMIZEEND の hwnd は最小化される"他の"窓なので、この判定は
    // 素通りしてよい(フェンス自身が最小化されることは通常ないが、万一そうなっても
    // 再沈め自体は無害)。
    if (eventType == NativeMethods.EVENT_SYSTEM_FOREGROUND)
    {
        lock (Lock)
        {
            if (RegisteredHwnds.Contains(hwnd)) return;
        }
    }

    SinkAll();
    ScheduleDelayedResink();
}
```

- `SinkAll()`・`ScheduleDelayedResink()`・`ResinkTick()`・遅延配列 `ResinkDelaysMs` は無変更。既存の「即時SinkAll + 30/100/250/500ms追い打ち」のロジックはそのまま、呼ばれる**回数と頻度が増える**だけ。
- `Suspended`(Peek中の抑制)は `SinkAll()` 冒頭のガードでそのまま効くので、Peek中にMINIMIZESTART/ENDが来ても何も壊れない(既存の安全策を再利用、変更不要)。

### 3.4 既存動作を壊さないことの確認

- **最背面固定**: `SinkToBottom` の中身(どこに挿入するか)は無変更。トリガーの数が増えるだけで、挿入先の計算ロジックには触れていない。
- **ドラッグ・クリック**: フェンスのドラッグ中・クリック時に `WS_EX_TOOLWINDOW` の通常窓として振る舞う部分(`MakeToolWindow`等)は一切触れていない。`RegisteredHwnds.Contains(hwnd)` によるフェンス自身クリック時のスキップ判定も、FOREGROUND側では維持している。
- **通常操作でのノイズ増加**: 他アプリの最小化ボタンを押した場合もMINIMIZESTART/ENDが飛ぶため、その都度 `SinkAll()` が1回余分に走る。`SinkAll()` は「登録済み各フェンスへ `SetWindowPos`」のみで、既存のFOREGROUND変更(ウィンドウ切り替えのたびに毎回発生)と同程度の軽さであり、新たな負荷増とは言えない(既存の設計がすでに「頻繁な軽い呼び出し」を許容している)。
- **Peek**: `Suspended` フラグはイベント種別に関係なく`SinkAll()`より前段で効くため、Peek中の挙動(最前面に一時的に上げる)への干渉はない。

### 3.5 想定される効き目

- 現状: 検知のトリガーは実質1発(FOREGROUND)+固定4回の時間当てずっぽう。
- 変更後: Win+Dで最小化される窓の数(通常1〜数個)だけMINIMIZESTART/ENDが追加発火し、バーストの実際の進行に沿って `SinkAll()` が割り込む。FOREGROUND発火までの「空白区間」そのものが縮むため、t15調査が指摘した「最初のSinkAllとバーストの収まりの間のズレ」が小さくなることが期待される。
- 完全な保証(「必ず120ms以内」)はOS内部のスケジューリング次第で理論上は言い切れないが、イベント駆動化によって固定遅延方式より確実に反応が早まる方向の変更であり、実測(反映後の自動確認)で検証する。

### 3.6 この案で目標に届かない場合のエスカレーション(次の工程向けメモ、今回は実装しない)

案Bを実装してもなお120ms以内に収まらない場合は、案C(短い間隔の状態確認ポーリングを、トリガー発生後の短い期間だけ動かす)を次点として検討する。その際も案Dの再親化には戻らない(3.の通り、不可視化の再発リスクを払拭できる新情報が無いため)。

---

## 4. 変更差分のまとめ

1. `NativeMethods.cs`: `EVENT_SYSTEM_MINIMIZESTART` / `EVENT_SYSTEM_MINIMIZEEND` の2定数を追加。
2. `DesktopZOrderService.cs`:
   - フィールド `_minimizeHook` を追加。
   - `Start()` に2本目の `SetWinEventHook` 登録を追加。
   - `Stop()` に `_minimizeHook` の解除を追加。
   - `OnForegroundChanged` に `eventType == EVENT_SYSTEM_FOREGROUND` の分岐を1つ追加(それ以外のイベントでは`RegisteredHwnds`判定をスキップしてそのまま`SinkAll()`+`ScheduleDelayedResink()`)。
3. `DesktopWindowHelper.cs`: 無変更。
4. 既存の遅延再送出配列・2秒安全網・`Suspended`・`Register`/`Unregister`: 無変更。

確認状況: 設計確定(コード変更なし・ビルド確認なし)。次工程でコード実装し、実機で3回計測(自動確認)して120ms以内を確認する。

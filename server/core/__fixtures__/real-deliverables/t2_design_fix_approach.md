# Win+D フェンス消失バグ 修正方針設計

対象不具合: Win+D でデスクトップ層(Progman)が最前面に上がると、`HWND_BOTTOM` に固定されているフェンスがその後ろに回り込み、見えなくなる。
入力: `_ai-records/windd-fence/t1_research_current_zorder_code.md` / `src/Fence.App/Infrastructure/Win32/DesktopWindowHelper.cs` / `src/Fence.App/Infrastructure/Win32/DesktopZOrderService.cs` / `src/Fence.App/Infrastructure/Win32/NativeMethods.cs` / 既存の `research/zorder-mechanism.md` / `research/zorder-diagnostic-findings.md`

本書はコード変更を行わない設計のみの成果物である。ビルド確認は未実施(未確認)。

---

## 1. 前提(変えないもの・変えるものの線引き)

### 変えない(明記)

- `DesktopZOrderService.cs` は**ファイル自体を変更しない**。すなわち以下はすべて現状のまま:
  - `Peek`/`Suspended`(L29〜32, L93): `SinkAll()` が `Suspended == true` のとき何もしない挙動
  - `Register`/`Unregister`(L65〜74): 登録管理のロジック
  - `_safetyTimer`(2秒タイマー、L45〜46)の存在・周期
  - `_hook`/`OnForegroundChanged`(`EVENT_SYSTEM_FOREGROUND` フック、L39〜43, L76〜89)
  - `SinkAll()` が登録済み全HWNDに対して `DesktopWindowHelper.SinkToBottom(hwnd)` を呼ぶループ構造そのもの(L91〜100)

  → 変更は `SinkToBottom` が**内部で何をするか**だけに閉じる。呼び出し側(`SinkAll`/`Register`/`PinAboveDesktop`)は現状のシグネチャ `SinkToBottom(IntPtr hwnd)` を変更なしで呼び続けられる。

- `ZOrderDiagnosticService.cs` は**読み取り専用のまま**。`SetWindowPos` 等、状態を変える呼び出しを追加しない。変更は `WriteFact1` の判定条件に1つのフィルタ(表示中かどうか)を足すのみ。

### 変える

- `DesktopWindowHelper.cs` の `SinkToBottom(IntPtr hwnd)` の内部実装。
- `NativeMethods.cs` に `GetWindow` と `GW_HWNDPREV` の定義を追加(現状両方とも不存在。t1調査で確認済み)。
- `ZOrderDiagnosticService.cs` の `WriteFact1` 内の `iconLayerNumbers` 抽出条件。

---

## 2. SinkToBottom の修正方針

### 2.1 現状(問題のコード)

```csharp
public static void SinkToBottom(IntPtr hwnd)
{
    NativeMethods.SetWindowPos(hwnd, NativeMethods.HWND_BOTTOM, 0, 0, 0, 0,
        NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE);
}
```

`HWND_BOTTOM` は「Z-order全体の最下段」を意味し、デスクトップ層(Progman/WorkerW)そのものがどこにあるかに関係なく、常にその最下段へ送る。Win+D でデスクトップ層が全窓より前に上がると、フェンスは最下段(=デスクトップ層より後ろ)に取り残される。これが不具合の直接原因(t1調査・`research/zorder-mechanism.md` Z-1 で確認済み)。

### 2.2 修正後の方針

`SinkToBottom` という**メソッド名・公開シグネチャ `SinkToBottom(IntPtr hwnd)` は変えない**(呼び出し元 `PinAboveDesktop`・`DesktopZOrderService.Register`・`DesktopZOrderService.SinkAll` の3箇所を触らずに済ませるため)。内部実装のみを、「常に `HWND_BOTTOM`」から「**今いちばん前にある、表示中のデスクトップ層のひとつ前**」に差し替える。

```csharp
public static void SinkToBottom(IntPtr hwnd)
{
    IntPtr insertAfter = ResolveDesktopLayerInsertAfter();
    NativeMethods.SetWindowPos(hwnd, insertAfter, 0, 0, 0, 0,
        NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE);
}

/// <summary>
/// Picks the hWndInsertAfter that places a fence immediately above the
/// frontmost *visible* desktop-layer window (Progman or the WorkerW currently
/// hosting the desktop), instead of always HWND_BOTTOM. Normally that layer is
/// at the very back, so this still lands a fence right above the icons and
/// below every real window. After Win+D the desktop layer itself jumps to the
/// front, and this makes the fence follow it there instead of being left
/// behind at HWND_BOTTOM (which is what made fences disappear - see
/// _ai-records/windd-fence/t1_research_current_zorder_code.md).
/// </summary>
private static IntPtr ResolveDesktopLayerInsertAfter()
{
    IntPtr desktopLayer = FindFrontmostVisibleDesktopLayerWindow();
    if (desktopLayer == IntPtr.Zero)
        return NativeMethods.HWND_BOTTOM; // fallback: couldn't find it, keep old behavior

    IntPtr windowAbove = NativeMethods.GetWindow(desktopLayer, NativeMethods.GW_HWNDPREV);
    return windowAbove != IntPtr.Zero ? windowAbove : NativeMethods.HWND_TOP;
}

/// <summary>
/// Walks the top-level window stack front-to-back (same EnumWindows ordering
/// ZOrderDiagnosticService relies on) and returns the first visible Progman or
/// WorkerW found - i.e. whichever desktop-layer window is currently frontmost.
/// Returns IntPtr.Zero if none is visible.
/// </summary>
private static IntPtr FindFrontmostVisibleDesktopLayerWindow()
{
    IntPtr found = IntPtr.Zero;

    NativeMethods.EnumWindows((hwnd, _) =>
    {
        var classNameBuilder = new System.Text.StringBuilder(256);
        NativeMethods.GetClassName(hwnd, classNameBuilder, classNameBuilder.Capacity);
        string className = classNameBuilder.ToString();

        if ((className == "Progman" || className == "WorkerW") && NativeMethods.IsWindowVisible(hwnd))
        {
            found = hwnd;
            return false; // stop - EnumWindows walks front-to-back, first match wins
        }
        return true;
    }, IntPtr.Zero);

    return found;
}
```

(ファイル先頭の `using` に `System.Text` を追加するか、上記のように完全修飾 `System.Text.StringBuilder` を使うかは実装時の判断。既存ファイルの `using` は `System` / `System.Windows` / `System.Windows.Interop` のみなので、`ZOrderDiagnosticService.cs` が `using System.Text;` を持つのと同じ流儀に合わせ、`using System.Text;` を追加するのが既存の書き方に近い。)

### 2.3 なぜ `GetWindow(target, GW_HWNDPREV)` なのか(hWndInsertAfter の決め方)

Win32 `GetWindow` の仕様(確認済み・公式ドキュメントの定義どおり):

- `GW_HWNDPREV`: 指定した窓より**前(上)**にある窓を返す。
- `GW_HWNDNEXT`: 指定した窓より**後ろ(下)**にある窓を返す。

`SetWindowPos` の `hWndInsertAfter` は「指定した窓の**直後(=その窓のひとつ後ろ)**に置く」という意味。したがって、デスクトップ層 `target` のひとつ前にあった窓を `W = GetWindow(target, GW_HWNDPREV)` として求め、`hWndInsertAfter = W` を指定すれば、フェンスは「`W` の直後」= 「`W` の直前の位置にあった `target` の直前」に挿入される。つまりフェンスは **`W` より後ろ・`target` より前** というちょうど1段分の隙間に収まる。これはフェンスが他のどの窓も飛び越えないことを意味する(`W` と `target` の間に元から他の窓は存在しない。両者は `GetWindow` で互いに隣接していると確認した窓同士である)。

この式は依頼文に明記された方式(「GetWindow(target, GW_HWNDPREV)の結果をhWndInsertAfterに渡す方式」)そのままであり、本設計独自の追加解釈は行っていない。

### 2.4 デスクトップ層候補の列挙方法: EnumWindows を選ぶ理由

検討した2方式:

1. **EnumWindows で前から順に探す(採用)**: 1回の列挙で Progman・WorkerW のどちらが先に現れるかを自然に判定できる。`ZOrderDiagnosticService.cs` が既に同じ「`EnumWindows` は前面から順」という前提で実装されている(クラスコメント「Walks the current top-level window stack via EnumWindows (front-to-back)」)ため、同じ前提をもう一箇所で使うだけで、新しい仮定を持ち込まない。
2. **FindWindow/FindWindowEx で "Progman" と "WorkerW" を別々に引く**: `FindWindow` はクラス名ひとつしか指定できないため、Progman用とWorkerW用で最低2回呼ぶ必要があり、さらに複数存在する WorkerW のうち「表示中でいちばん前」のものを選ぶには、結局どちらが前かを比較するための追加の `GetWindow`/`EnumWindows` 探索が要る。1回の `EnumWindows` 列挙で済む(1)より手数が増え、かつ可視判定も別途必要になる。

→ **EnumWindows を採用**。`FindWindow`/`FindWindowEx` は使わない。

### 2.5 対象が見つからない場合のフォールバック

| ケース | 対応 |
| --- | --- |
| 表示中の Progman/WorkerW が1つも見つからない(`FindFrontmostVisibleDesktopLayerWindow` が `IntPtr.Zero`) | `NativeMethods.HWND_BOTTOM` を使う(**従来どおりの挙動に完全フォールバック**) |
| 見つかった `target` に `GW_HWNDPREV` が無い(`target` がすでに Z-order 全体の最前面 = 戻り値 `IntPtr.Zero`。Win+D で他の通常窓がすべて最小化され、Progman の前に何も無い場合など) | `NativeMethods.HWND_TOP` を使う |

2つ目のフォールバックが「他アプリの窓より前に出てはいけない」という制約を破らないことの説明:
`HWND_TOP` は「topmost(常に最前面)フラグが付いた窓の帯」の**下**、「通常窓の帯」の**先頭**に置く指定であり、`WS_EX_TOPMOST` を持つ窓を飛び越えることはない(Win32の仕様上の性質)。かつ、このフォールバックに入るのは `GetWindow(target, GW_HWNDPREV)` が「`target` の前に何も無い」と返したとき、つまりその瞬間に隠すべき通常窓が実在しないときに限られる。したがって `HWND_TOP` へ送っても、実在する他アプリの窓を覆い隠すことはない。

---

## 3. 「他アプリの窓より前に出てはいけない」という制約の遵守(通常時)

- 通常時(Win+D していない間)は、デスクトップ層(Progman/WorkerW)は普段どおり Z-order の最下段付近にある。`FindFrontmostVisibleDesktopLayerWindow` はそれを `target` として見つけ、`GetWindow(target, GW_HWNDPREV)` は「target の直前にあった、最下段に近い窓(多くの場合、既存の登録済みフェンス自身か、最背面寄りの何らかの窓)」を返す。フェンスはそのすぐ後ろに挿入される → **結果として従来どおり「ふつうの窓より後ろ」という見え方が保たれる**(依頼文の「通常時は今までと同じ見え方を保つ」要件)。
- Win+D でデスクトップ層が最前面に上がったときだけ、`target` 自体が前に出ているので、フェンスも同じ場所(そのひとつ前)に追従する。これは「デスクトップ層のひとつ前」という**相対位置**を毎回計算し直しているためで、絶対位置(`HWND_BOTTOM`)に固定していた従来方式との違いがこの修正の核心。
- `SinkToBottom` は `SinkAll`(フォアグラウンド変更イベント発火時・2秒タイマーごと)と `Register`/`PinAboveDesktop` から**従来と同じ頻度・同じ箇所で**呼ばれ続ける。呼ばれるたびに `target` を再計算するため、Win+D 直後の次回の再同期(イベントまたは最大2秒後のタイマー)で自動的に追従する。これは「フック・タイマーの仕組みは変えない」という制約と両立する(呼び出し頻度・契機は無変更、呼び出し先の中身だけが変わる)。

---

## 4. NativeMethods.cs への追加

t1調査で「`GetWindow`、`GW_HWNDPREV`、`GW_HWNDNEXT` は現状 `NativeMethods.cs` に存在しない」と確認済み。今回必要なのは `GW_HWNDPREV` のみ(`GW_HWNDNEXT` は使わないため追加しない — 変更を最小限にする方針に合わせる)。

追加位置: 既存の `// ---- Z-order sink (keeps fences pinned just above the desktop) ----` セクション(現 L197〜200、`HWND_BOTTOM`/`HWND_TOP` の定義がある場所)の直後に、同じセクション内として追記するのが既存の構成(機能ごとにコメント区切りでグルーピングする書き方)に最も合う。

```csharp
// ---- Z-order sink (keeps fences pinned just above the desktop) ----
public static readonly IntPtr HWND_BOTTOM = new(1);
public static readonly IntPtr HWND_TOP = new(0);

public const uint GW_HWNDPREV = 3;

[DllImport("user32.dll", SetLastError = true)]
public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
```

既存の `SetWindowPos` 等と同じ `[DllImport("user32.dll", SetLastError = true)]` の書式に合わせた。戻り値は `IntPtr`(ハンドルまたは `IntPtr.Zero`)で、`bool` への `MarshalAs` は不要(既存の `FindWindow`/`GetAncestor` と同じ戻り値パターン)。

---

## 5. ZOrderDiagnosticService「事実1」の判定ロジック変更方針

### 5.1 現状(t1調査で確認済みの問題)

```csharp
List<int> iconLayerNumbers = entries
    .Where(e => !e.IsGageFence && (e.ClassName == "Progman" || e.ClassName == "WorkerW"))
    .Select(e => e.Number)
    .ToList();
```

非表示の WorkerW(多くの環境で複数存在し、実際に描画されているのは1つだけ)も対象に含めてしまい、「Gageの枠と前後関係を比べるべきデスクトップ層」が実際には見えていない窓まで含めて広がってしまう。

### 5.2 変更方針

既存の `WindowEntry.Visible`(`IsWindowVisible` の結果。既存フィールドで追加不要)を使い、条件に1つ `&& e.Visible` を足すだけにする。

```csharp
List<int> iconLayerNumbers = entries
    .Where(e => !e.IsGageFence && (e.ClassName == "Progman" || e.ClassName == "WorkerW") && e.Visible)
    .Select(e => e.Number)
    .ToList();
```

- `WriteFact1` の他の部分(`fenceNumbers` の算出、各分岐の文言「Gageの枠はすべて、デスクトップのアイコン層(Progman/WorkerW)より前/後ろにある」等)は**一切変更しない**。判定対象の母集合を絞るフィルタを1つ足すだけ。
- `WriteFact2`・`Classify`・`EnumerateTopLevelWindows`・ログ出力の書式は変更しない。
- 診断は引き続き読み取り専用(`SetWindowPos` 等を一切呼ばない)のまま。

### 5.3 この変更が今回のバグ修正の確認に使える理由

修正後、Win+D 直後に Progman が表示中で最前面に来ている間、非表示 WorkerW を除外したこの事実1が「フェンスはすべてデスクトップ層より前にある」(=正しく追従できている)と出るか、「後ろにある」(=まだ消えている)と出るかで、`SinkToBottom` の修正が実機で効いているかを事実ベースで確認できる。ただし本設計書はその実機確認自体を行わない(次工程の作業)。

---

## 6. 未確認事項(本設計の範囲外として引き継ぐ)

- `dotnet build` によるビルド確認は本設計書の作成時点では未実施(承認手段がないため)。実装後、型・引数・`using` の目視確認に加え、可能であればビルド確認を行うこと。
- 実機で Win+D 後にフェンスが見えるか、通常時に他の窓を隠さないかの確認は、本設計書では行わない(依頼文の指示どおり、実機確認はユーザーが行う。手順は別途 `_ai-records/windd-fence/` 配下の短い記録に書く想定)。
- マルチモニタ構成で WorkerW が複数(モニタごと)存在する場合の挙動は、`FindFrontmostVisibleDesktopLayerWindow` が「表示中のものを前から順に見て最初の1つ」を選ぶ設計のため、理論上は対応できるはずだが、実機での複数モニタ検証は未確認。
- Explorer再起動(`TaskbarCreated`)直後に Progman/WorkerW のハンドルが再生成された場合でも、本設計は毎回 `EnumWindows` で生きているハンドルを探し直すため追従できるはずだが、これも実機未確認。

---

確認状況: 設計確定(コード変更なし・ビルド確認なし)

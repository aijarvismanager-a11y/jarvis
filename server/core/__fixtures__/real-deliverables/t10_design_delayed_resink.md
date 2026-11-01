# DesktopZOrderService 遅延再送出(delayed resink)設計

対象: `src/Fence.App/Infrastructure/Win32/DesktopZOrderService.cs` のみ。
`DesktopWindowHelper.cs`・2秒安全網タイマー・WinEventフック登録・Peek(Suspended)機構・Register/Unregister は変更しない(t9調査の制約を継承)。

## 1. 問題のおさらい

`OnForegroundChanged` は `SinkAll()` を1回だけ即時に呼ぶ。Win+D直後はProgman/WorkerWがまだ前面に上がりきっていない過渡状態で、その1回の`SinkAll()`の後にProgmanがさらに浮上してフェンスを覆う。次の補正(2秒タイマー)まで待つか別の通知で戻るまでの約0.15〜0.3秒、フェンスが消える。

## 2. 方針

`OnForegroundChanged` の即時 `SinkAll()` に加えて、同じイベントを起点に **30ms / 100ms / 250ms / 500ms 後** にも `SinkAll()` を追加実行する「追い打ち」を1系列だけ予約する。Progmanの浮上が収まりきるまでの間に複数回当て直すことで、どのタイミングで浮上が完了しても必ずフェンスが前に入り直す。

- 遅延実行は `System.Threading.Timer` を使う(UIスレッドは介さない。既存の `_safetyTimer` と同じ仕組みなのでコードベースの書き方に合わせやすい)。
- 連続して通知が来た場合、予約は常に1つに収束させる(新しい通知が来たら先頭の30msからやり直す)。
- `Stop()` 後、または `Suspended` 中にタイマーが発火した場合は何もしない。

## 3. 追加するフィールド

```csharp
// 既存フィールド群のそば(_safetyTimer の下)に追加
private static readonly int[] ResinkDelaysMs = { 30, 100, 250, 500 };
private static System.Threading.Timer? _resinkTimer;
private static int _resinkStep; // 次に発火させる ResinkDelaysMs のインデックス。Lock配下でのみ読み書き。
```

- `ResinkDelaysMs` は仕様で指定された4点をそのまま並べた「イベント発生時刻からの絶対オフセット」。`Timer.Change` には直前ステップとの差分(相対待ち時間)を渡す。
- `_resinkTimer` は使い回す(発火ごとに `new Timer` を作らない)。`Register`/`Unregister` と同様、状態は `Lock` で保護する既存の方針に合わせる。
- `_resinkStep` は「今から何番目の遅延を次に待つか」を表す。スケジュールを1つにまとめる(まとめ直す)ために使う。

## 4. `OnForegroundChanged` の変更

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
}
```

変更後:

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

`RegisteredHwnds.Contains(hwnd)` で早期returnするケース(自分自身のフェンスがフォアグラウンドになった場合)は、遅延再送出も予約しない。これは現状の「即時SinkAllをスキップする」判断をそのまま遅延分にも延長しているだけで、挙動の一貫性を保つ。

## 5. `ScheduleDelayedResink` / `ResinkTick` の新設

```csharp
/// <summary>
/// After a foreground-change event, Progman/WorkerW can still be mid-rise when
/// the immediate SinkAll() above runs - it then finishes rising and covers the
/// fence again before the next correction. This schedules a short burst of
/// extra SinkAll() calls (ResinkDelaysMs) so the fence gets re-sunk again once
/// the desktop layer has actually settled at the front. A new foreground event
/// collapses onto the same pending burst instead of stacking another one.
/// </summary>
private static void ScheduleDelayedResink()
{
    lock (Lock)
    {
        if (!_started) return;

        _resinkStep = 0;
        _resinkTimer ??= new System.Threading.Timer(ResinkTick, null, Timeout.Infinite, Timeout.Infinite);
        _resinkTimer.Change(ResinkDelaysMs[0], Timeout.Infinite);
    }
}

private static void ResinkTick(object? state)
{
    int step;
    lock (Lock)
    {
        if (!_started) return;
        step = _resinkStep;
        if (step >= ResinkDelaysMs.Length) return;
    }

    if (!Suspended) SinkAll();

    lock (Lock)
    {
        if (!_started || _resinkTimer == null) return;

        _resinkStep = step + 1;
        if (_resinkStep < ResinkDelaysMs.Length)
        {
            int due = ResinkDelaysMs[_resinkStep] - ResinkDelaysMs[step];
            _resinkTimer.Change(due, Timeout.Infinite);
        }
        // 最後のステップまで終えたら Change しない = タイマーは次の
        // ScheduleDelayedResink() まで眠ったまま(Infinite, Infinite)。
    }
}
```

### 挙動の説明

- `ScheduleDelayedResink()` は「予約を1つにまとめる」ための入口。呼ばれるたびに `_resinkStep = 0` にリセットし、同じ `_resinkTimer` の due time を先頭(30ms)に上書きする。`Timer` インスタンスは1個しか存在しないので、連続通知が来ても古い予約が並走することはなく、常に最新の通知を起点にした1系列だけが生きる。
- `ResinkTick` は自分の `step` を見て、`SinkAll()` を1回呼んだ後、次のステップがあれば「現在ステップとの差分」を `Change` して次回発火を仕込む。4ステップ(30/100/250/500ms)を終えたら `Change` を呼ばないので、タイマーは次の `ScheduleDelayedResink()` 呼び出しまで何もしない。
- `Suspended` 中は `SinkAll()` の呼び出しだけをスキップする(既存の `SinkAll()` 冒頭の `if (Suspended) return;` と同じ判断をここでも先に見ているが、`SinkAll()` 自身にもガードがあるため二重防御であり害はない)。ステップのカウントは進める: Peek中に発火が重なっても、Peek終了後に古い続きが余計に発火して悪さをする心配がない(すでに `_resinkStep` が進んでいるので、次に`ScheduleDelayedResink`が呼ばれるまで再開しない)。
- `Stop()` 後は `_started` が `false` になっているため、`ScheduleDelayedResink()` は何もせず即return、`ResinkTick` も先頭の `_started` チェックで即return する。`Timer.Change` を `Stop()` 後に呼ぶ経路が存在しないため `ObjectDisposedException` の心配もない(`Stop()` 側で `_resinkTimer` を破棄するのはステップ6参照)。

## 6. `Stop()` の変更

現状:

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
    _hookProc = null;

    _safetyTimer?.Dispose();
    _safetyTimer = null;
}
```

変更後(`_safetyTimer` の破棄のすぐ下に追加するだけ):

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

`_started = false` を先に立ててから `Dispose()` するので、Dispose呼び出し中に別スレッドで走っていた `ResinkTick` がたまたま `_started` チェックを通過済みであっても、その後 `lock (Lock)` ブロックに入る時点で `_resinkTimer` の `Change` 呼び出しは `_resinkTimer == null` チェックで止まる(nullを先に代入してから他コードがアクセスするのは全て同じ`Lock`配下なので競合しない)。`Timer.Dispose()` は進行中のコールバックを待たないが、`ResinkTick` 内の `Change` 呼び出しは全て `Lock` を取ってから `_resinkTimer` の非nullを確認しているため、破棄後に破棄済みオブジェクトへ `Change` することはない。

## 7. Start() は変更しない

`_resinkTimer` は `Start()` では生成しない(遅延初期化)。`ScheduleDelayedResink()` 内で `??=` によって初回だけ生成する。これは `_safetyTimer` ほど常時稼働するものではなく、フォアグラウンド変更が起きたときだけ要るものなので、`Start()`/`Stop()` のライフサイクルを汚さずに済む。`Stop()` → `Start()` で再起動されたときも、`_resinkTimer` が前回 `Stop()` で `null` に戻っているので次回 `ScheduleDelayedResink()` が新しい `Timer` を作り直し、古い `Timer` を参照し続ける心配はない。

## 8. 変更差分のまとめ(変更対象ファイルは1つだけ)

`DesktopZOrderService.cs` への変更点:
1. フィールド追加: `ResinkDelaysMs`, `_resinkTimer`, `_resinkStep`。
2. `OnForegroundChanged` 末尾に `ScheduleDelayedResink();` を1行追加。
3. 新規メソッド `ScheduleDelayedResink()` / `ResinkTick(object? state)` を追加。
4. `Stop()` に `_resinkTimer` の破棄を追加。

`SinkAll()` 自体、`Register`/`Unregister`、WinEventフック登録、2秒安全網タイマー、`Suspended` プロパティの定義は無変更。`DesktopWindowHelper.cs` も無変更。

## 9. 想定される効き目の確認方法(次工程向けメモ)

t9調査にあった計測方法(Win+D押下後、フェンスがProgmanの後ろに隠れている時間の実測)をそのまま流用できる。実装後、同じ3回計測で「隠れている時間がほぼ0(最後のSinkAllから次のSinkAllまでの最大ギャップである250ms以内に収束)」になっていることを確認するのが実機検証のゴールになる。

確認状況: 確定

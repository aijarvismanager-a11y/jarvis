# t12: 遅延再送出(delayed resink)の実装コードレビュー

対象: `src/Fence.App/Infrastructure/Win32/DesktopZOrderService.cs` 設計: `t10_design_delayed_resink.md` 実装: `t11_code_delayed_resink.md`

## 1. レビュー目的と観点

`coding_resink` 工程において実装された `DesktopZOrderService.cs` の変更内容について、以下の設計要件・安全要件を満たしているかを検証・レビューする。

1. **設計通りの実装か**: 設計書どおりの遅延スケジュール（30ms / 100ms / 250ms / 500ms）およびメソッド構成になっているか。
2. **UIスレッドをブロックしていないか**: `System.Threading.Timer` を利用してバックグラウンドのタイパースレッドで非同期に処理されており、UIスレッドがブロックされない構造になっているか。
3. **Stop()後やSuspended中の安全性の確保**: `Stop()` 時にタイマーが正しく破棄され、`Suspended` 中に `SinkAll()` が不適切に動作しないガードが備わっているか。
4. **連続通知時の予約の単一化**: 連続でフォアグラウンド変更通知が来た際に、古い予約が並走せず `_resinkStep = 0` と `_resinkTimer.Change()` により常に最新の1系列へ収束するようになっているか。
5. **他コンポーネント・既存機構の無改修**: 2秒安全網タイマー、WinEventフック、Peek/Register/Unregister、`DesktopWindowHelper.cs` が一切無改修で保たれているか。

## 2. 実装コードの検証結果

### ① 設計との整合性

- 追加されたフィールド群（`ResinkDelaysMs`、`_resinkTimer`、`_resinkStep`）の配置およびスコープ・修飾子は設計通り。
- `OnForegroundChanged` からの `ScheduleDelayedResink()` 呼び出し、および `RegisteredHwnds.Contains(hwnd)` の早期return時に対象外とする制御が正しく引き継がれている。
- インポート文への `using System.Threading;` の追加（`Timeout.Infinite` 参照のため）も最小限の修正として適切。

### ② UIスレッドのブロック防止

- `System.Threading.Timer` を使用しており、WPFのUIスレッドをブロックしない。
- `ResinkTick` 内での `SinkAll()` はウィンドウの Z-order 操作（`SetWindowPos`）のみを行うため、UIスレッドをフリーズさせる危険性がない。

### ③ Stop() 後および Suspended 中の安全確保

- `Stop()` 内において `lock (Lock)` 配下で `_resinkTimer?.Dispose()` と `_resinkTimer = null` が安全に実行される。
- `_started = false` が先に設定され、コールバック内やスケジュール処理の冒頭で `_started` チェックが行われているため、破棄後に未処理のタイマーが暴走・クラッシュするリスクはない。
- `Suspended` プロパティが `true` の場合（Peek中など）、`ResinkTick` 内の `if (!Suspended) SinkAll();` により再送出がスキップされる。また、その間もステップのカウントが進むため、Peek解除後に古い遅延処理が予期せず噴き出す不具合が防止されている。

### ④ 連続通知時の予約の単一化（Collapse）

- `ScheduleDelayedResink()` が呼ばれるたびに `_resinkStep = 0` にリセットされ、既存の `_resinkTimer` に対して `Change(ResinkDelaysMs[0], Timeout.Infinite)` が適用されるため、複数の遅延スケジュールが重複・蓄積せず、最新のイベント起点に一本化される。

### ⑤ 既存機構の無改修確認

以下の要素は設計通り一切変更されていないことを確認した：

- `DesktopWindowHelper.cs`（デスクトップ層の検出・挿入先ロジック）
- 2秒安全網タイマー（`_safetyTimer`）の定義とライフサイクル
- WinEventフックの登録・解除（`SetWinEventHook` / `UnhookWinEvent`）
- `Register` / `Unregister` および `Suspended` プロパティの仕様

## 3. 総合評価

実装は設計書（`t10_design_delayed_resink.md`）の意図を正確かつ過不足なく反映しており、コードの可読性、スレッド安全性、既存アーキテクチャとの調和のいずれの観点からも問題なしと判定する。余計な変更や副作用はなく、「変更は最小限にする」というルールを完全に遵守している。

確認状況: 確定

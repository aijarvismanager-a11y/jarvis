I will now generate the research document `_ai-records/windd-fence/t9_research_resink_timing.md` detailing the timing analysis and constraints for implementing delayed re-sinking in `DesktopZOrderService.cs`.

遅延再送出のタイミングと制

# DesktopZOrderService 遅延再送出タイミングの調査結果

## 1. 概要

本調査は、Win+D押下直後にフェンスが数百度（約0.15〜0.3秒）消えてしまう不具合に対し、`DesktopZOrderService.cs` における `OnForegroundChanged` 発生時の `SinkAll()` 呼び出しに、短い遅れを伴う追加の `SinkAll()` 予約（遅延再送出）を導入するために必要な現状のコード構造、ライフサイクル、および制約事項を静的に確認したものである。

## 2. 現状コードの確認事項

### (1) `DesktopZOrderService.cs` の構造とライフサイクル

- **開始・停止**: `Start()` で `_hook` の登録および `_safetyTimer`（2秒周期）の生成が行われ、`Stop()` でそれらの破棄（`UnhookWinEvent`, `_safetyTimer?.Dispose()`）が確実に行われる。
- **イベントハンドラ**: `OnForegroundChanged` は `EVENT_SYSTEM_FOREGROUND` フックのコールバックであり、自プロセス（フェンス自身）のウィンドウがフォアグラウンドになった場合を除き、直ちに `SinkAll()` を呼び出す。
- **排他制御・サスペンド**: `Lock` オブジェクトによるスレッドセーフな `RegisteredHwnds` の管理、および `Suspended` プロパティ（Peek時等に有効化）による `SinkAll()` の早期リターン機構が備わっている。

### (2) 直前の修正内容との関係

- `DesktopWindowHelper.SinkToBottom` は、常時 `HWND_BOTTOM` を指定するのではなく、前面にある表示中のデスクトップ層（Progman / WorkerW）を検出し、その直前（`GW_HWNDPREV`）にフェンスを挿入する仕様へ改修済みである。
- しかし、Win+D を押した瞬間のフォアグラウンド変更通知を受けた時点では、デスクトップ層がまだ完全に前面に上がりきっていない過渡状態であるため、1回目の `SinkAll()` 直後にデスクトップ層がさらに上に浮上し、フェンスがその背後に隠れてしまう。その後、2秒タイマーの周期までフェンスが隠れたままになるか、別の通知によって戻されるまでの間（0.15〜0.3秒間）消失現象が発生している。

## 3. 遅延再送出（Resink）実装における制約と要件

1. **複数回の遅延呼び出しと重複排除（デバウンス/予約のまとめ）**:
  - 連続してフォアグラウンド通知が来た場合や短時間に複数回イベントが発生した際、古いタイマーやスケジュールされた予約を破棄・上書きし、新たな遅延予約に1つにまとめる必要がある（処理の過剰な蓄積を防ぐ）。
2. **UIスレッドのブロック防止**:
  - 遅延処理には `System.Threading.Timer` または `Task.Delay` を使用し、UIスレッドを止めない非同期的な実行とする。
3. **ライフサイクル・状態の考慮**:
  - `Stop()` 呼び出し後や、`Suspended` が `true` の間（Peek中など）は、遅延タイマーが発火しても `SinkAll()` を実行しない（または予約自体をキャンセル・無視する）。
4. **最小限の変更原則**:
  - 既存の2秒の安全網タイマー、WinEventフックの登録、Peek(Suspended)機構、Register/Unregister等の基本構造は一切変更せず、`OnForegroundChanged` 周辺のトリガー制御のみに絞って拡張する。

確認状況: 確定

# 現状Z-order関連コードの調査・確認結果

## 1. 概要

本調査は、Gageの「Win+D（デスクトップを表示）を押すとフェンスが消える」不具合に対する修正方針の前提として、関連する既存コードおよび既往の調査内容を静的に確認したものである。対象ファイル（`DesktopWindowHelper.cs`, `DesktopZOrderService.cs`, `NativeMethods.cs`, `ZOrderDiagnosticService.cs`）および既存の研究記録（`research/zorder-mechanism.md`, `research/zorder-diagnostic-findings.md`）を読み合わせ、事実関係を整理した。

## 2. 各ファイルのコード確認事項

### (1) `DesktopWindowHelper.cs`

- **ピン留め時・登録**: `PinAboveDesktop` メソッドにおいて、ウィンドウのスタイルをツールウィンドウ（`MakeToolWindow(hwnd)`）へ変更した上で、`SinkToBottom(hwnd)` を呼び出し、最後に `DesktopZOrderService.Register(hwnd)` で登録している。
- **最背面への常時固定**: `SinkToBottom(IntPtr hwnd)` は `NativeMethods.SetWindowPos` を用いて、`HWND_BOTTOM`（常に最背面）へ明示的に送信する実装になっている。

### (2) `DesktopZOrderService.cs`

- **再同期の契機**:
  1. `EVENT_SYSTEM_FOREGROUND` フック（`OnForegroundChanged`）が発火した際、対象ウィンドウが自プロセス（登録フェンス）でなければ `SinkAll()` を呼び出す。
  2. 2秒ごとの安全性タイマー（`_safetyTimer`）により、定期的に `SinkAll()` を呼び出す。
- **常時背面送り**: `SinkAll()` は登録されたすべてのフェンスの HWND に対して `DesktopWindowHelper.SinkToBottom(hwnd)` を実行する。これにより、Win+D 等でフォアグラウンドイベントが発生した際やタイマーの周期ごとに、フェンスが常に `HWND_BOTTOM`（最背面）へ押し下げられる構造になっている。

### (3) `NativeMethods.cs`

- **不足しているAPI定義**: 今回確認した範囲において、ウィンドウの相対的なZオーダー位置や関連ハンドルを取得するための `GetWindow` や、それに付随する定数（`GW_HWNDPREV`, `GW_HWNDNEXT`）、および `GetWindowText`（※ `ZOrderDiagnosticService.cs` 内ではローカルにDllImport定義されている）などは、`NativeMethods.cs` には存在しないことを確認した。

### (4) `ZOrderDiagnosticService.cs`

- **事実1（`WriteFact1`）の判定ロジック**: 現状のコードでは、`ClassName == "Progman"` または `ClassName == "WorkerW"` に一致するすべてのトップレベルウィンドウを対象に番号を取得している。これにより、画面上に描画されていない（非表示の）WorkerWなども含まれた状態で前後関係（`Max()` / `Min()`）を判定していることを確認した。

## 3. 既往の研究記録（`research/zorder-mechanism.md`, `research/zorder-diagnostic-findings.md`）との整合

- 既存の `research/zorder-mechanism.md` に記載されているとおり、`HWND_BOTTOM` による常時強制配置はWin+D実行時にデスクトップ層（Progman / WorkerW）がすべての通常ウィンドウの上にポップアップした際、フェンスがそれらの背後に回ってしまう挙動を引き起こす原因と一致している。
- `research/zorder-diagnostic-findings.md` の記述と照らし合わせ、ZOrderDiagnosticService の WriteFact1 が隠れた WorkerW を一律にカウントしてしまっている現状の仕様を再確認した。

確認状況: 確定

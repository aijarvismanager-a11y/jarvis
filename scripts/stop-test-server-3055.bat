@echo off
chcp 65001 >nul
rem 3055番で動いている確認用の server.js だけを止めます(ダブルクリックで実行)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort 3055 -State Listen -ErrorAction SilentlyContinue; if (-not $c) { Write-Host '3055番で動いているものはありません'; exit }; foreach ($x in $c) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $x.OwningProcess); if ($p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.js') { Stop-Process -Id $p.ProcessId; Write-Host ('止めました: PID ' + $p.ProcessId) } else { Write-Host 'server.js ではないため、何もしていません' } }"
echo.
pause

@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :install_node
goto :after_node

:install_node
echo Node.js が見つかりません。インストールします（少し時間がかかります）...
where winget >nul 2>nul
if errorlevel 1 goto :install_node_msi

winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
goto :recheck_node

:install_node_msi
echo winget が使えないため、公式インストーラーを直接ダウンロードします...
set "NODE_MSI=%TEMP%\node-lts-x64.msi"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.13.0/node-v22.13.0-x64.msi' -OutFile '%NODE_MSI%' } catch { exit 1 }"
if not exist "%NODE_MSI%" (
  echo ダウンロードに失敗しました。手動で https://nodejs.org からインストールしてから、もう一度アイコンをダブルクリックしてください。
  pause
  exit /b 1
)
echo インストール中です。確認画面が出た場合は「はい」を選んでください...
msiexec /i "%NODE_MSI%" /qb
del "%NODE_MSI%" >nul 2>nul

:recheck_node
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js のインストールを確認できませんでした。このウィンドウを閉じてPCを再起動し、もう一度アイコンをダブルクリックしてください。
  pause
  exit /b 1
)
echo Node.js のインストールが完了しました。

:after_node
if not exist node_modules (
  echo 依存パッケージをインストールしています（初回のみ、数分かかります）...
  call npm install
  if errorlevel 1 (
    echo インストールに失敗しました。インターネット接続を確認してから、もう一度アイコンをダブルクリックしてください。
    pause
    exit /b 1
  )
)

start "AI Orchestrator" cmd /k "npm run start"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

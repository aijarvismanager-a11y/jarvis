@echo off
rem All user-facing Japanese text lives in scripts\say.ps1, not here. cmd.exe's
rem batch parser garbles Japanese text mixed with other tokens on this class of
rem machine (reproduced with both UTF-8 and Shift-JIS encodings, chcp 65001 set
rem or not) -- keeping this file pure ASCII sidesteps the bug entirely.
setlocal
cd /d "%~dp0"

set "SAY=powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\say.ps1""

rem A ZIP distribution has no desktop shortcut yet (only this .bat) --
rem create one on first run, pointing back at this same script/icon, so
rem later launches don't require digging back into the extracted folder.
set "DESKTOP_LNK=%USERPROFILE%\Desktop\AI Orchestrator.lnk"
if not exist "%DESKTOP_LNK%" (
  %SAY% shortcut_creating
  powershell -NoProfile -Command "$s = New-Object -ComObject WScript.Shell; $lnk = $s.CreateShortcut('%DESKTOP_LNK%'); $lnk.TargetPath = '%~f0'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = '%~dp0public\app-icon.ico,0'; $lnk.Save()"
)

where node >nul 2>nul
if errorlevel 1 goto :install_node
goto :after_node

:install_node
%SAY% node_missing
where winget >nul 2>nul
if errorlevel 1 goto :install_node_msi

winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
goto :recheck_node

:install_node_msi
%SAY% winget_unavailable
set "NODE_MSI=%TEMP%\node-lts-x64.msi"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.13.0/node-v22.13.0-x64.msi' -OutFile '%NODE_MSI%' } catch { exit 1 }"
if not exist "%NODE_MSI%" (
  %SAY% download_failed
  pause
  exit /b 1
)
%SAY% installing_confirm
msiexec /i "%NODE_MSI%" /qb
del "%NODE_MSI%" >nul 2>nul

:recheck_node
where node >nul 2>nul
if errorlevel 1 (
  %SAY% node_verify_failed
  pause
  exit /b 1
)
%SAY% node_installed

:after_node
if not exist node_modules (
  %SAY% npm_installing
  call npm install
  if errorlevel 1 (
    %SAY% npm_install_failed
    pause
    exit /b 1
  )
)

start "AI Orchestrator" cmd /k "npm run start"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

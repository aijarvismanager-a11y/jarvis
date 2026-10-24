@echo off
rem Opens the desktop window (Electron). The server is started automatically when it is not running.
rem Pure ASCII on purpose: see start-ai-orchestrator.bat.
setlocal
cd /d "%~dp0"
if not exist node_modules (
  call npm install
)
start "" "node_modules\.bin\electron.cmd" electron\main.cjs

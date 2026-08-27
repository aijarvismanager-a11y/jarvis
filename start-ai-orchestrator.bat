@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
start "AI Orchestrator" cmd /k "npm run start"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

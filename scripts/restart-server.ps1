# Restarts the API server (port 4173 by default) so it runs the code that is on disk now.
#   npm run server:restart            stop the running one (and its children), start a fresh one
#   npm run server:restart -- -StopOnly   only stop it
# The screen is built first and served by the server itself (one process, one port: http://127.0.0.1:4173).
# The old process is killed together with its child processes (preview servers, claude, browsers),
# so nothing is left behind holding the port. Running missions resume on their own after the start.
param(
  [int]$Port = 4173,
  [switch]$StopOnly,
  # skip rebuilding the screen (it is built before every start so the page matches the server)
  [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# (vite's slow-build warning goes to stderr: that alone must not stop the restart, only the exit code does)
# Build first, while the old server is still up: a failed build must not leave the app down.
if (-not $StopOnly -and -not $NoBuild -and $Port -eq 4173) {
  Write-Host 'Building the screen...'
  Push-Location $root
  try { $ErrorActionPreference = 'Continue'; & npm run build 2>&1 | Out-Host; $ErrorActionPreference = 'Stop'; if ($LASTEXITCODE -ne 0) { throw 'The build failed; the running server was not touched. Fix the errors and run it again.' } } finally { Pop-Location }
}

$owners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($id in $owners) {
  Write-Host "Stopping the server on port $Port (PID $id)..."
  & taskkill /PID $id /T /F | Out-Null
}
if ($owners.Count -gt 0) {
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is still in use." }
  Write-Host 'Stopped.'
} else {
  Write-Host "No server was running on port $Port."
}
if ($StopOnly) { return }

# one log per port: a second server must not try to open the log another one is holding
$log = Join-Path $root $(if ($Port -eq 4173) { 'server.log' } else { "server-$Port.log" })
$env:PORT = "$Port"
$cmd = "npm run server > `"$log`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WorkingDirectory $root -WindowStyle Hidden | Out-Null

$ready = $false
for ($i = 0; $i -lt 40 -and -not $ready; $i++) {
  Start-Sleep -Milliseconds 500
  try { $ready = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/version" -TimeoutSec 2).StatusCode -eq 200 } catch { }
}
if (-not $ready) { throw "The server did not come up. See $log" }
Write-Host "Server is up on http://127.0.0.1:$Port (log: $log)"


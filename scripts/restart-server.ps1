# Restarts the API server (port 4173 by default) so it runs the code that is on disk now.
#   npm run server:restart            stop the running one (and its children), start a fresh one
#   npm run server:restart -- -StopOnly   only stop it
# The old process is killed together with its child processes (preview servers, claude, browsers),
# so nothing is left behind holding the port. Running missions resume on their own after the start.
param(
  [int]$Port = 4173,
  [switch]$StopOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

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

$log = Join-Path $root 'server.log'
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

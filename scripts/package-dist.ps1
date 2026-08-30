# Builds a distributable ZIP of AI Orchestrator for copying to another PC.
#
# Excludes this machine's personal data (real project workspaces, the
# current workflow.json) and ships a fresh install instead: only the
# sample-project demo, so a first-time user sees the same onboarding state
# this repo started from. node_modules/.git are excluded -- the bundled
# start-ai-orchestrator.bat installs Node.js (if missing) and runs
# `npm install` on first launch.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$releaseDir = Join-Path $root "dist-release"
$stageDir = Join-Path $releaseDir "ai-orchestrator"
$zipPath = Join-Path $releaseDir "ai-orchestrator.zip"

if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir | Out-Null

# Source files needed to run (everything else -- node_modules, .git,
# other projects' workspace data -- is intentionally left out).
$filesToCopy = @(
  "package.json", "package-lock.json",
  "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "tsconfig.server.json",
  "vite.config.ts", "postcss.config.js", "tailwind.config.js", "index.html",
  "start-ai-orchestrator.bat", "MANUAL.html"
)
foreach ($f in $filesToCopy) {
  if (Test-Path $f) { Copy-Item $f -Destination $stageDir }
}

$dirsToCopy = @("src", "server", "public")
foreach ($d in $dirsToCopy) {
  Copy-Item $d -Destination (Join-Path $stageDir $d) -Recurse
}

# Fresh workspace: only the built-in demo project, not this machine's
# real projects.
New-Item -ItemType Directory -Path (Join-Path $stageDir "workspace") | Out-Null
Copy-Item "workspace/sample-project" -Destination (Join-Path $stageDir "workspace/sample-project") -Recurse

# Fresh config: ai_services.json's defaults are generic and fine to ship,
# but workflow.json must not leak this machine's real project list --
# rebuild it with just the sample-project entry pulled from the live file.
New-Item -ItemType Directory -Path (Join-Path $stageDir "config") | Out-Null
Copy-Item "config/ai_services.json" -Destination (Join-Path $stageDir "config/ai_services.json")

# Read/write as UTF-8 explicitly -- Get-Content/Set-Content default to the
# system codepage on Windows PowerShell, which mangles the Japanese text.
$workflowJsonText = [System.IO.File]::ReadAllText((Join-Path $root "config/workflow.json"), [System.Text.Encoding]::UTF8)
$liveWorkflow = $workflowJsonText | ConvertFrom-Json
$sampleProject = $liveWorkflow.projects | Where-Object { $_.id -eq "sample-project" }
if (-not $sampleProject) { throw "sample-project not found in config/workflow.json -- can't build a clean default." }
$freshWorkflow = [ordered]@{
  current_project_id = "sample-project"
  projects = @($sampleProject)
}
$freshWorkflowText = $freshWorkflow | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText((Join-Path $stageDir "config/workflow.json"), $freshWorkflowText, [System.Text.UTF8Encoding]::new($false))

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $stageDir -DestinationPath $zipPath
Remove-Item $stageDir -Recurse -Force

Write-Host "Wrote $zipPath"

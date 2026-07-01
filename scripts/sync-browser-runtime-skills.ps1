# 将 build-in-skills/browser-runtime 同步到 orchestrator_skills 镜像目录。
# 权威源：apps/server/build-in-skills/browser-runtime/
# 用法（仓库根目录）：powershell -File scripts/sync-browser-runtime-skills.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Src = Join-Path $Root "apps/server/build-in-skills/browser-runtime"
$Dst = Join-Path $Root "apps/server/orchestrator_skills/browser-runtime"

if (-not (Test-Path $Src)) {
  Write-Error "Source not found: $Src"
}
New-Item -ItemType Directory -Force -Path $Dst | Out-Null
Copy-Item -Force (Join-Path $Src "*") $Dst
Write-Host "Synced browser-runtime: $Src -> $Dst"

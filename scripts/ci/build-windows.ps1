#Requires -Version 5.1
<#
.SYNOPSIS
  在 Windows 构建机上本地打包（比 GitLab CI 快：默认保留 .venv / node_modules）。

.DESCRIPTION
  远程 RDP 到 win-builder 后，在仓库根目录或任意位置执行：

    pwsh -NoProfile -File scripts/ci/build-windows.ps1 -Ref v0.1.17

  GitLab CI（win-builder shell executor）等价于在那台 Windows 上远程执行本脚本；
  保留 .venv / node_modules，比旧 CI 冷启动快很多。

  CI 触发方式：
    - 推 vX.Y.Z tag → build:windows 自动跑
    - 分支 Pipeline → build:windows:manual 网页点 Play

.PARAMETER Ref
  要构建的分支或 tag，默认 dev。

.PARAMETER UvPython
  64 位 Python 3.11 可执行文件路径。

.PARAMETER CleanNodeModules
  强制删除 node_modules 后重装（仅 lock 大改或依赖异常时使用）。

.PARAMETER CleanVenv
  强制删除 .venv 后重装 Python 依赖（仅 uv.lock 大改时使用）。

.PARAMETER SkipFeishu
  跳过飞书多维表格发布。

.PARAMETER Offline
  打离线安装包（build-offline-app.py 流程，需项目内脚本支持）。

.EXAMPLE
  pwsh -File scripts/ci/build-windows.ps1 -Ref v0.1.17

.PARAMETER SkipGitSync
  跳过 git fetch/checkout（GitLab CI 已 checkout 时使用）。

.EXAMPLE
  pwsh -File scripts/ci/build-windows.ps1 -Ref v0.1.17 -SkipGitSync
#>
param(
    [string]$Ref = "dev",
    [string]$RepoRoot = "",
    [string]$UvPython = "C:/Users/yaoji/AppData/Local/Programs/Python/Python311/python.exe",
    [switch]$CleanNodeModules,
    [switch]$CleanVenv,
    [switch]$SkipFeishu,
    [switch]$SkipGitSync,
    [switch]$Offline
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Timed([string]$Label, [scriptblock]$Block) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Step $Label
    & $Block
    $sw.Stop()
    Write-Host ("    完成 ({0:mm\:ss})" -f $sw.Elapsed) -ForegroundColor DarkGray
}

function Remove-DeepDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    Write-Host "    删除: $Path"
    $empty = Join-Path $env:TEMP "de-empty-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    try {
        robocopy $empty $Path /MIR /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -gt 7) {
            throw "robocopy failed with exit code $LASTEXITCODE"
        }
        Remove-Item -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue
    }
    finally {
        Remove-Item -LiteralPath $empty -Force -Recurse -ErrorAction SilentlyContinue
    }
}

function Set-BuildEnvironment {
    param([string]$PythonExe)

    $env:UV_PYTHON = $PythonExe
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    $env:NODE_OPTIONS = "--max-old-space-size=8192"
    $env:NPM_CONFIG_REGISTRY = "https://registry.npmmirror.com"
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirror/electron/"
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirror/electron-builder-binaries/"
    $env:UV_INDEX_URL = "https://npmmirror.com/mirror/pypi/simple"
    $env:UV_EXTRA_INDEX_URL = "https://pypi.org/simple"
    $env:PIP_INDEX_URL = "https://npmmirror.com/mirror/pypi/simple"
    $env:UV_HTTP_TIMEOUT = "300"
    $env:UV_HTTP_RETRIES = "5"
    if ($Ref -match '^v\d+\.\d+\.\d+') {
        $env:CI_COMMIT_TAG = $Ref
    }
}

function Sync-Source {
    param([string]$Root, [string]$TargetRef)

    Set-Location $Root
    git config core.longpaths true
    git fetch origin --tags --prune
    git checkout $TargetRef
    if ($TargetRef -notmatch '^v\d+\.\d+\.\d+') {
        git pull origin $TargetRef
    }
    Write-Host "    HEAD: $(git rev-parse --short HEAD) ($TargetRef)"
}

# ---------- 解析仓库根目录 ----------
if (-not $RepoRoot) {
    if ($env:CI_PROJECT_DIR) {
        $RepoRoot = $env:CI_PROJECT_DIR
    }
    else {
        $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
    }
}
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
    throw "未找到仓库根目录: $RepoRoot"
}

$total = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "Windows 本地打包" -ForegroundColor Green
Write-Host "  仓库: $RepoRoot"
Write-Host "  版本: $Ref"
Write-Host "  Python: $UvPython"

if (-not (Test-Path -LiteralPath $UvPython)) {
    throw "Python 不存在: $UvPython"
}
& $UvPython -c "import sys; assert sys.maxsize > 2**32" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "需要 64 位 Python: $UvPython"
}

Set-BuildEnvironment -PythonExe $UvPython

if ($SkipGitSync) {
    Write-Step "跳过 git sync（CI 已 checkout）"
    Set-Location $RepoRoot
    git config core.longpaths true
    Write-Host "    HEAD: $(git rev-parse --short HEAD) ($Ref)"
}
else {
    Invoke-Timed "同步代码 (git fetch/checkout)" {
        Sync-Source -Root $RepoRoot -TargetRef $Ref
    }
}

if ($CleanNodeModules) {
    Invoke-Timed "清理 node_modules" {
        foreach ($dir in @(
                (Join-Path $RepoRoot "node_modules"),
                (Join-Path $RepoRoot "apps\web\node_modules"),
                (Join-Path $RepoRoot "packages\ui\node_modules")
            )) {
            Remove-DeepDirectory -Path $dir
        }
    }
}

if ($CleanVenv) {
    Invoke-Timed "清理 .venv" {
        Remove-DeepDirectory -Path (Join-Path $RepoRoot ".venv")
    }
}

Invoke-Timed "pnpm install" {
    Set-Location $RepoRoot
    pnpm install --frozen-lockfile --config.node-linker=hoisted `
        --registry=https://registry.npmmirror.com
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
}

if ($Offline) {
    Invoke-Timed "Python 后端 + 离线 Electron 打包" {
        Set-Location $RepoRoot
        & $env:UV_PYTHON scripts/build-offline-app.py
        if ($LASTEXITCODE -ne 0) { throw "build-offline-app.py failed" }
    }
}
else {
    Invoke-Timed "Python 后端 (PyInstaller → backend.exe)" {
        Set-Location $RepoRoot
        & $env:UV_PYTHON scripts/build-server.py --app
        if ($LASTEXITCODE -ne 0) { throw "build-server.py failed" }
    }

    Invoke-Timed "Electron 客户端 (Vite + NSIS)" {
        Set-Location $RepoRoot
        pnpm build:client
        if ($LASTEXITCODE -ne 0) { throw "pnpm build:client failed" }
    }
}

$releaseDir = Join-Path $RepoRoot "apps\web\release"
$artifacts = @(
    Get-ChildItem -Path $releaseDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in ".exe", ".yml", ".blockmap" }
)
if (-not $artifacts) {
    throw "未找到产物，请检查 $releaseDir"
}

if (-not $SkipFeishu) {
    Invoke-Timed "飞书多维表格发布（失败不阻断）" {
        Set-Location $RepoRoot
        & $env:UV_PYTHON scripts/ci/publish-feishu.py
        if ($LASTEXITCODE -ne 0) {
            Write-Host "    飞书发布失败（已忽略）" -ForegroundColor Yellow
        }
    }
}

$total.Stop()
Write-Host ""
Write-Host "打包完成  总耗时 $($total.Elapsed.ToString('mm\:ss'))" -ForegroundColor Green
Write-Host "产物目录: $releaseDir"
foreach ($f in $artifacts | Sort-Object LastWriteTime -Descending) {
    $mb = [math]::Round($f.Length / 1MB, 1)
    Write-Host "  $($f.Name)  (${mb} MB)"
}

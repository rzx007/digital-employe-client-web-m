# Windows CI：启用 git 长路径，并用 robocopy 安全删除 pnpm 深层 node_modules。
# GitLab get_sources 阶段的 git clean 在 MAX_PATH 下会失败，需配合 GIT_CLEAN_FLAGS="" 使用。

$ErrorActionPreference = "Stop"

git config core.longpaths true

function Remove-DeepDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Write-Host "Removing deep directory: $Path"
    $empty = Join-Path $env:TEMP "de-empty-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    try {
        # robocopy /MIR 可删除超过 MAX_PATH 的目录树；退出码 0-7 视为成功
        robocopy $empty $Path /MIR /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -gt 7) {
            throw "robocopy failed with exit code $LASTEXITCODE"
        }
        Remove-Item -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $Path) {
            cmd /c "rmdir /s /q `"$Path`""
        }
    }
    finally {
        Remove-Item -LiteralPath $empty -Force -Recurse -ErrorAction SilentlyContinue
    }
}

$root = if ($env:CI_PROJECT_DIR) { $env:CI_PROJECT_DIR } else { (Get-Location).Path }
Set-Location $root

foreach ($dir in @(
        (Join-Path $root "node_modules"),
        (Join-Path $root "apps\web\node_modules"),
        (Join-Path $root "packages\ui\node_modules"),
        (Join-Path $root ".venv")
    )) {
    Remove-DeepDirectory -Path $dir
}

function Set-UvPythonFromSystem {
    $candidates = @(
        @("py", "-3.11"),
        @("py", "-3.12"),
        @("python3"),
        @("python")
    )
    foreach ($cmd in $candidates) {
        try {
            if ($cmd.Length -eq 1) {
                $exe = & $cmd[0] -c "import sys; print(sys.executable)" 2>$null
            }
            else {
                $exe = & $cmd[0] $cmd[1] -c "import sys; print(sys.executable)" 2>$null
            }
            if ($LASTEXITCODE -eq 0 -and $exe) {
                $env:UV_PYTHON = $exe.Trim()
                Write-Host "UV_PYTHON=$env:UV_PYTHON"
                if ($env:GITLAB_ENV) {
                    Add-Content -Path $env:GITLAB_ENV -Value "UV_PYTHON=$env:UV_PYTHON"
                }
                return
            }
        }
        catch {
            continue
        }
    }
    Write-Host "WARN: 未找到本机 Python 3.11+，请安装 64 位 Python 3.11"
}

Set-UvPythonFromSystem
Write-Host "Windows CI prepare complete."

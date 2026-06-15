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

function Test-Is64BitPython {
    param([Parameter(Mandatory = $true)][string]$Exe)

    if ($Exe -match 'Python311-32' -or $Exe -match '-32\\') {
        return $false
    }
    & $Exe -c "import sys; raise SystemExit(0 if sys.maxsize > 2**32 else 1)" 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Set-UvPythonFromSystem {
    if ($env:UV_PYTHON -and (Test-Is64BitPython $env:UV_PYTHON)) {
        Write-Host "UV_PYTHON=$env:UV_PYTHON"
        return
    }
    if ($env:UV_PYTHON) {
        Write-Host "WARN: 忽略无效 UV_PYTHON: $($env:UV_PYTHON)"
        Remove-Item Env:UV_PYTHON -ErrorAction SilentlyContinue
    }

    $candidates = @(
        @("py", "-3.11-64"),
        @("py", "-3.12-64"),
        @("py", "-3.11"),
        @("py", "-3.12")
    )
    foreach ($cmd in $candidates) {
        try {
            $exe = & $cmd[0] $cmd[1] -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Is64BitPython $exe.Trim())) {
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
    Write-Host "WARN: 未找到 64 位 Python 3.11+，请安装 Python 3.11 x64"
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

Set-UvPythonFromSystem
Write-Host "Windows CI prepare complete."

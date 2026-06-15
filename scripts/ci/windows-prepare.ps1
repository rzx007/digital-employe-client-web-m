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
        (Join-Path $root "packages\ui\node_modules")
    )) {
    Remove-DeepDirectory -Path $dir
}

Write-Host "Windows CI prepare complete."

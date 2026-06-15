#Requires -RunAsAdministrator
<#
.SYNOPSIS
  将 GitLab Runner 服务改为以 yaoji 用户运行（替代 systemprofile）。

.DESCRIPTION
  在 win-builder 上以管理员 PowerShell 执行一次：

    pwsh -NoProfile -File scripts/ci/setup-win-runner-yaoji.ps1 `
      -RunnerUser "yaoji" -RunnerPassword "你的Windows密码"

  完成后重启 Runner，CI job 将以 yaoji 身份执行：
  - 可使用 py 启动器、yaoji 的 PATH（node/pnpm/uv）
  - uv 缓存写入 C:\Users\yaoji\AppData\Local\uv-cache
  - 与 RDP 登录 yaoji 手动打包环境一致

  若 Runner 安装目录不同，用 -RunnerRoot 指定（默认 Desktop\gitlabrunner）。
#>
param(
    [string]$RunnerUser = "yaoji",
    [string]$RunnerPassword = "",
    [string]$RunnerRoot = "C:/Users/yaoji/Desktop/gitlabrunner",
    [string]$ServiceName = "gitlab-runner"
)

$ErrorActionPreference = "Stop"

if (-not $RunnerPassword) {
    $secure = Read-Host "请输入 Windows 用户 $RunnerUser 的密码" -AsSecureString
    $RunnerPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
}

$runnerExe = Join-Path $RunnerRoot "gitlab-runner.exe"
if (-not (Test-Path -LiteralPath $runnerExe)) {
    throw "未找到 gitlab-runner.exe: $runnerExe"
}

Write-Host "Runner 目录: $RunnerRoot"
Write-Host "运行账户: $RunnerUser"
Write-Host ""

Set-Location $RunnerRoot

Write-Host "==> 停止并卸载现有 Runner 服务..."
& $runnerExe stop 2>$null
& $runnerExe uninstall 2>$null

Write-Host "==> 以 $RunnerUser 安装 Runner 服务..."
& $runnerExe install --user ".\$RunnerUser" --password $RunnerPassword
if ($LASTEXITCODE -ne 0) {
    throw "gitlab-runner install 失败"
}

Write-Host "==> 启动 Runner..."
& $runnerExe start
if ($LASTEXITCODE -ne 0) {
    throw "gitlab-runner start 失败"
}

$cacheDir = "C:\Users\yaoji\AppData\Local\uv-cache"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
Write-Host "==> 已创建 uv 缓存目录: $cacheDir"

Write-Host ""
Write-Host "完成。请 push 分支触发 smoke:windows，日志中应出现:"
Write-Host "  CI user=yaoji"
Write-Host "而非 systemprofile。"

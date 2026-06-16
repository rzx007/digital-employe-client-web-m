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

  若不知道 yaoji 密码：不要跑本脚本。在管理员 PowerShell 执行：
    gitlab-runner uninstall && gitlab-runner install && gitlab-runner start
  并确保存在 C:\GitLab-Runner\localappdata（见 .gitlab-ci.yml 中 LOCALAPPDATA）。
#>
param(
    [string]$RunnerUser = "yaoji",
    [string]$RunnerPassword = "",
    [string]$RunnerRoot = "C:/Users/yaoji/Desktop/gitlabrunner",
    [string]$ServiceName = "gitlab-runner"
)

$ErrorActionPreference = "Stop"

function Grant-LogonAsService {
    param([Parameter(Mandatory)][string] $AccountName)

    $sid = (New-Object System.Security.Principal.NTAccount($AccountName)).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value

    $tempInf = Join-Path $env:TEMP "gitlab-runner-logon-as-service.inf"
    $tempSdb = Join-Path $env:TEMP "gitlab-runner-logon-as-service.sdb"

    secedit /export /cfg $tempInf /quiet | Out-Null
    if (-not (Test-Path -LiteralPath $tempInf)) {
        throw "secedit /export 失败，无法授予「作为服务登录」权限"
    }

    $lines = Get-Content -LiteralPath $tempInf -Encoding Unicode
    $found = $false
    $newLines = foreach ($line in $lines) {
        if ($line -match '^SeServiceLogonRight\s*=\s*(.*)$') {
            $found = $true
            $existing = $Matches[1].Trim()
            if ($existing -match [regex]::Escape($sid)) {
                $line
            }
            elseif ($existing -eq "") {
                "SeServiceLogonRight = *$sid"
            }
            else {
                "SeServiceLogonRight = $existing,*$sid"
            }
        }
        else {
            $line
        }
    }
    if (-not $found) {
        throw "secedit 导出中未找到 SeServiceLogonRight"
    }

    Set-Content -LiteralPath $tempInf -Value $newLines -Encoding Unicode
    secedit /configure /db $tempSdb /cfg $tempInf /areas USER_RIGHTS /quiet | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "secedit /configure 失败，请手动在 secpol.msc 中为 $AccountName 添加「作为服务登录」"
    }
    Write-Host "    已授予 $AccountName 「作为服务登录」权限"
}

function Get-RunnerServiceAccount {
    param([string] $User)

    if ($User -match '\\') {
        return $User
    }
    return "$env:COMPUTERNAME\$User"
}

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

$serviceAccount = Get-RunnerServiceAccount -User $RunnerUser

Write-Host "Runner 目录: $RunnerRoot"
Write-Host "运行账户: $serviceAccount"
Write-Host ""

Set-Location $RunnerRoot

Write-Host "==> 授予「作为服务登录」权限..."
Grant-LogonAsService -AccountName $serviceAccount

Write-Host "==> 停止并卸载现有 Runner 服务..."
& $runnerExe stop 2>$null
& $runnerExe uninstall 2>$null

Write-Host "==> 以 $serviceAccount 安装 Runner 服务..."
& $runnerExe install --user $serviceAccount --password $RunnerPassword
if ($LASTEXITCODE -ne 0) {
    throw "gitlab-runner install 失败"
}

Write-Host "==> 启动 Runner..."
& $runnerExe start
if ($LASTEXITCODE -ne 0) {
    throw @"
gitlab-runner start 失败（logon failure 常见原因）:
  1. Windows 密码不正确（区分大小写）
  2. yaoji 未加入「作为服务登录」—— 可手动: Win+R → secpol.msc → 本地策略 → 用户权限分配 → 作为服务登录 → 添加 yaoji
  3. 账户被禁用或密码已过期
  4. 服务已安装但密码错误: services.msc → gitlab-runner → 登录 → 重新输入密码后启动

若暂时无法改服务账户，可在 build-windows.ps1 中设置 LOCALAPPDATA 绕过 NSIS 的 systemprofile 问题。
"@
}

$cacheDir = "C:\Users\yaoji\AppData\Local\uv-cache"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
Write-Host "==> 已创建 uv 缓存目录: $cacheDir"

Write-Host ""
Write-Host "完成。请 push 分支触发 smoke:windows，日志中应出现:"
Write-Host "  CI user=yaoji"
Write-Host "而非 systemprofile。"

#Requires -Version 5.1
<#
.SYNOPSIS
  手动触发 bobandata.com 上的 Windows 品牌包 CI。

.EXAMPLE
  pwsh -File scripts/ci/trigger-branded-build.ps1 -BrandProject guowang

  $env:GITLAB_TRIGGER_TOKEN = "..."
  pwsh -File scripts/ci/trigger-branded-build.ps1 -BrandProject guowang -GitRef dev
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BrandProject,
    [string]$GitRef = "dev",
    [string]$AssetsRef = "main",
    [string]$CiGitlabUrl = "https://gitlab.bobandata.com",
    [string]$MainProjectId = "664",
    [string]$TriggerToken = "",
    [string]$AssetsRepo = "http://10.172.246.216:8929/boban-staff/packaging-assets.git"
)

$ErrorActionPreference = "Stop"
if (-not $TriggerToken) {
    $TriggerToken = $env:GITLAB_TRIGGER_TOKEN
}
if (-not $TriggerToken) {
    throw "请设置 -TriggerToken 或环境变量 GITLAB_TRIGGER_TOKEN"
}
if (-not $AssetsRepo -and $env:BRAND_ASSETS_REPO) {
    $AssetsRepo = $env:BRAND_ASSETS_REPO
}

$uri = "$CiGitlabUrl/api/v4/projects/$MainProjectId/trigger/pipeline"
$body = @{
    token                    = $TriggerToken
    ref                      = $GitRef
    "variables[BRAND_PROJECT]"      = $BrandProject
    "variables[BRAND_ASSETS_REPO]"  = $AssetsRepo
    "variables[BRAND_ASSETS_REF]"   = $AssetsRef
}

Write-Host "触发 $CiGitlabUrl build:windows:branded ..."
Write-Host "  BRAND_PROJECT=$BrandProject  ref=$GitRef  assets_ref=$AssetsRef"

$r = Invoke-RestMethod -Method Post -Uri $uri -Body $body
Write-Host "Pipeline #$($r.id) $($r.status)"
Write-Host $r.web_url

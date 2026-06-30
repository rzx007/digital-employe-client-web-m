#Requires -Version 5.1
<#
.SYNOPSIS
  从 packaging-assets 仓库拉取品牌项目资源，注入 apps/web 构建树（Windows 在线包）。

.DESCRIPTION
  1. 校验 projects/<BrandProject>/brand.json
  2. 拷贝到 apps/web/branding/active/（打进安装包 resources/branding/active）
  3. 拷贝 icon.ico / icon.png 到 apps/web/build/（NSIS 安装包图标）
  4. 生成 apps/web/electron-builder.branded.json5（productName + 安装包文件名）

.PARAMETER BrandProject
  资源库 projects/ 下的目录名，如 guowang。

.PARAMETER RepoRoot
  digital-employee-client 仓库根目录。

.PARAMETER AssetsDir
  本地已存在的 packaging-assets 检出路径；为空则 clone AssetsRepo。

.PARAMETER AssetsRepo
  packaging-assets Git 地址（CI 可用 CI_JOB_TOKEN 嵌入 URL）。

.PARAMETER AssetsRef
  资源库分支或 tag，默认 main。
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BrandProject,
    [string]$RepoRoot = "",
    [string]$AssetsDir = "",
    [string]$AssetsRepo = "",
    [string]$AssetsRef = "main"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    if ($RepoRoot -and (Test-Path (Join-Path $RepoRoot "apps\web\package.json"))) {
        return (Resolve-Path $RepoRoot).Path
    }
    $here = Split-Path -Parent $PSScriptRoot
    $root = Split-Path -Parent $here
    if (-not (Test-Path (Join-Path $root "apps\web\package.json"))) {
        throw "无法定位仓库根目录，请传 -RepoRoot"
    }
    return (Resolve-Path $root).Path
}

function Resolve-AssetsRepoUrl([string]$Repo) {
    if (-not $Repo) { return $Repo }
    if ($env:CI_JOB_TOKEN -and $Repo -notmatch '@') {
        if ($Repo -match '^(https?://)(.+)$') {
            return "$($Matches[1])gitlab-ci-token:$($env:CI_JOB_TOKEN)@$($Matches[2])"
        }
    }
    return $Repo
}

function Ensure-AssetsCheckout {
    param([string]$Dir, [string]$Repo, [string]$Ref)
    if ($Dir -and (Test-Path $Dir)) {
        Write-Host "    使用本地资源目录: $Dir"
        return (Resolve-Path $Dir).Path
    }
    if (-not $Repo) {
        throw "未指定 AssetsDir 且 AssetsRepo 为空"
    }
    $Repo = Resolve-AssetsRepoUrl $Repo
    $cloneRoot = Join-Path $env:TEMP "packaging-assets-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
    Write-Host "    clone $Repo ($Ref) -> $cloneRoot"
    git clone --depth 1 --branch $Ref $Repo $cloneRoot
    if ($LASTEXITCODE -ne 0) { throw "git clone packaging-assets 失败" }
    return $cloneRoot
}

function Copy-BrandTree {
    param([string]$Source, [string]$Dest)
    if (Test-Path $Dest) {
        Remove-Item -Recurse -Force $Dest
    }
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Dest -Recurse -Force
}

function Write-BrandedElectronConfig {
    param(
        [string]$WebRoot,
        [string]$ProductName,
        [string]$BrandSlug
    )
    $basePath = Join-Path $WebRoot "electron-builder.json5"
    $outPath = Join-Path $WebRoot "electron-builder.branded.json5"
    $base = Get-Content $basePath -Raw -Encoding UTF8
    # 简单替换：productName 与 Windows 安装包文件名（slug 避免中文路径问题）
    $safeName = $ProductName -replace '"', '\"'
    $base = $base -replace '"productName":\s*"[^"]*"', "`"productName`": `"$safeName`""
    $artifact = "BobanStaff-$BrandSlug-Windows-`${version}-Setup.`${ext}"
    $base = $base -replace '"artifactName":\s*"\$\{productName\}-Windows-\$\{version\}-Setup\.\$\{ext\}"', "`"artifactName`": `"$artifact`""
    Set-Content -Path $outPath -Value $base -Encoding UTF8 -NoNewline
    Write-Host "    已生成 electron-builder.branded.json5 (productName=$ProductName)"
}

$root = Resolve-RepoRoot
$webRoot = Join-Path $root "apps\web"
$assetsRoot = Ensure-AssetsCheckout -Dir $AssetsDir -Repo $AssetsRepo -Ref $AssetsRef
$brandSrc = Join-Path $assetsRoot "projects\$BrandProject"
$manifest = Join-Path $brandSrc "brand.json"

if (-not (Test-Path $manifest)) {
    throw "品牌项目不存在或缺少 brand.json: $brandSrc"
}

$meta = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = $meta.productName
if (-not $productName) {
    throw "brand.json 缺少 productName"
}

Write-Host "==> 注入品牌包: $BrandProject ($productName)" -ForegroundColor Cyan

$activeDir = Join-Path $webRoot "branding\active"
Copy-BrandTree -Source $brandSrc -Dest $activeDir
Write-Host "    branding/active <- $brandSrc"

$buildDir = Join-Path $webRoot "build"
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

foreach ($name in @("icon.ico", "icon.png", "icon.icns")) {
    $src = Join-Path $brandSrc $name
    if (-not (Test-Path $src)) {
        $src = Join-Path $brandSrc "build\$name"
    }
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $buildDir $name) -Force
        Write-Host "    build/$name <- $src"
    }
}

# logo 兜底：若无 icon.png，用 brand.json 指定的 logo
$logoName = $meta.logos.app
if ($logoName -and -not (Test-Path (Join-Path $buildDir "icon.png"))) {
    $logoSrc = Join-Path $brandSrc $logoName
    if (Test-Path $logoSrc) {
        Copy-Item $logoSrc (Join-Path $buildDir "icon.png") -Force
        Write-Host "    build/icon.png <- logo $logoName"
    }
}

if (-not (Test-Path (Join-Path $buildDir "icon.ico"))) {
    Write-Warning "未找到 icon.ico，安装包仍将使用默认 exe 图标"
}

Write-BrandedElectronConfig -WebRoot $webRoot -ProductName $productName -BrandSlug $BrandProject

# 供后续步骤读取
$stampPath = Join-Path $webRoot ".branded-build.json"
@{
    brandProject = $BrandProject
    productName  = $productName
    assetsCommit = try {
        git -C $assetsRoot rev-parse HEAD 2>$null
    } catch { "" }
} | ConvertTo-Json | Set-Content $stampPath -Encoding UTF8

Write-Host "    品牌注入完成" -ForegroundColor Green

<#
.SYNOPSIS
    adOmnia Linux build script (runs from Windows via Docker)
.DESCRIPTION
    Builds the Linux binary using Docker (cross-compile from Windows).
    Produces:
      build\bin\adOmnia                      ELF binary (standalone)
      build\bin\adOmnia-linux-amd64.tar.gz   binary + icons + .desktop + install.sh
.PARAMETER Version
    Version string embedded in the binary (default: dev)
.PARAMETER Compress
    Run UPX --best --lzma on the extracted binary before packaging (requires UPX in PATH)
.PARAMETER SkipIcons
    Skip icon generation step (faster rebuilds when icons are up to date)
.EXAMPLE
    .\scripts\build-linux.ps1
    .\scripts\build-linux.ps1 -Version "1.2.3"
    .\scripts\build-linux.ps1 -Compress
#>

[CmdletBinding()]
param(
    [string]$Version    = "dev",
    [switch]$Compress,
    [switch]$SkipIcons
)

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Image       = "adomnia-linux-builder"
$OutDir      = Join-Path $ProjectRoot "build\bin"
$Binary      = Join-Path $OutDir "adomnia"
$Tarball     = Join-Path $OutDir "adomnia-linux-amd64.tar.gz"

function Fail([string]$msg) {
    Write-Host ""
    Write-Host "ERR  $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  adOmnia Linux Build  v$Version" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# ---- Prerequisites -----------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker not found in PATH. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
$dockerVer = (& docker --version 2>$null)
Write-Host "OK   Docker: $dockerVer" -ForegroundColor Green

if ($Compress) {
    if (-not (Get-Command upx -ErrorAction SilentlyContinue)) {
        Fail "UPX not found in PATH (required by -Compress). Install: https://upx.github.io/"
    }
    $upxVer = (& upx --version 2>$null | Select-Object -First 1)
    Write-Host "OK   UPX: $upxVer" -ForegroundColor Green
}

# ---- [1] Icon generation -----------------------------------------------------
if (-not $SkipIcons) {
    $iconScript = Join-Path $PSScriptRoot "generate-icons.ps1"
    if (Test-Path $iconScript) {
        Write-Host ""
        Write-Host "==> [1] Generating icons..." -ForegroundColor Cyan
        & $iconScript
        if ($LASTEXITCODE -ne 0) {
            Write-Host "WARN Icon generation failed (ImageMagick missing?). Using existing icons." -ForegroundColor Yellow
        }
    } else {
        Write-Host "WARN generate-icons.ps1 not found  -  using existing icons." -ForegroundColor Yellow
    }
} else {
    Write-Host "SKIP Icon generation (-SkipIcons)" -ForegroundColor DarkGray
}

# ---- [2] Docker build --------------------------------------------------------
$stepTotal = if ($Compress) { 5 } else { 4 }
Write-Host ""
Write-Host "==> [2/$stepTotal] Building Docker image ($Image)..." -ForegroundColor Cyan

$dockerfilePath = Join-Path $ProjectRoot "Dockerfile.linux"
if (-not (Test-Path $dockerfilePath)) {
    $dockerfilePath = Join-Path $ProjectRoot "build\Dockerfile"
    if (-not (Test-Path $dockerfilePath)) {
        Fail "Dockerfile not found. Expected: Dockerfile.linux or build\Dockerfile"
    }
}

Push-Location $ProjectRoot
& docker build -f $dockerfilePath -t $Image .
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Docker build failed." }
Pop-Location

# ---- [3] Extract binary from container ---------------------------------------
Write-Host ""
Write-Host "==> [3/$stepTotal] Extracting binary from container..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$containerId = (& docker create $Image | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Fail "docker create failed." }

& docker cp "${containerId}:/app/build/bin/adomnia" $Binary
$copyOk = $LASTEXITCODE
& docker rm $containerId | Out-Null

if ($copyOk -ne 0) { Fail "Failed to copy binary from container." }

$sizeBinary = [math]::Round((Get-Item $Binary).Length / 1MB, 2)
Write-Host "OK   Binary: $sizeBinary MB  ->  $Binary" -ForegroundColor Green

# ---- [4] UPX compression (optional) -----------------------------------------
if ($Compress) {
    Write-Host ""
    Write-Host "==> [4/$stepTotal] Compressing with UPX --best --lzma..." -ForegroundColor Cyan
    $sizeBefore = $sizeBinary
    & upx --best --lzma $Binary
    if ($LASTEXITCODE -ne 0) { Fail "UPX compression failed." }
    $sizeAfter = [math]::Round((Get-Item $Binary).Length / 1MB, 2)
    $saved = [math]::Round((1 - $sizeAfter / $sizeBefore) * 100, 1)
    Write-Host ("OK   {0} MB  ->  {1} MB  (-{2}%)" -f $sizeBefore, $sizeAfter, $saved) -ForegroundColor Green
}

# ---- [last] Package tarball --------------------------------------------------
$packStep = if ($Compress) { 5 } else { 4 }
Write-Host ""
Write-Host "==> [$packStep/$stepTotal] Packaging tarball..." -ForegroundColor Cyan

$tmpDir = Join-Path $OutDir "linux-tmp"
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$tmpDir\icons" | Out-Null

Copy-Item $Binary "$tmpDir\adomnia" -Force

$linuxSizes = @(16, 24, 32, 48, 64, 128, 256, 512)
foreach ($sz in $linuxSizes) {
    $src = Join-Path $ProjectRoot "assets\icons\linux\adOmnia_${sz}x${sz}.png"
    if (Test-Path $src) {
        Copy-Item $src "$tmpDir\icons\adOmnia_${sz}x${sz}.png" -Force
    } else {
        Write-Host "WARN Missing icon: assets\icons\linux\adOmnia_${sz}x${sz}.png" -ForegroundColor Yellow
    }
}

$icon256 = Join-Path $ProjectRoot "assets\icons\linux\adOmnia_256x256.png"
if (Test-Path $icon256) { Copy-Item $icon256 "$tmpDir\adomnia.png" -Force }

$desktopFile = Join-Path $ProjectRoot "build\linux\adOmnia.desktop"
if (-not (Test-Path $desktopFile)) {
    $desktopFile = Join-Path $ProjectRoot "build\linux\adomnia.desktop"
}
$installFile = Join-Path $ProjectRoot "build\linux\install.sh"
if (Test-Path $desktopFile) {
    Copy-Item $desktopFile "$tmpDir\adomnia.desktop" -Force
} else {
    Fail "Linux desktop entry not found: build\linux\adOmnia.desktop"
}
if (Test-Path $installFile) { Copy-Item $installFile "$tmpDir\install.sh"      -Force }

& tar -czf $Tarball -C $tmpDir .
Remove-Item -Recurse -Force $tmpDir

$tarMB = [math]::Round((Get-Item $Tarball).Length / 1MB, 2)

# ---- Summary -----------------------------------------------------------------
Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  Linux Build Complete!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host ("  Binary (standalone)     {0} ({1} MB)" -f $Binary, $sizeBinary) -ForegroundColor Cyan
Write-Host ("  Tarball (distributable) {0} ({1} MB)" -f $Tarball, $tarMB) -ForegroundColor Cyan
Write-Host ""
Write-Host "  Install on Linux:" -ForegroundColor DarkGray
Write-Host "    tar -xzf adomnia-linux-amd64.tar.gz" -ForegroundColor DarkGray
Write-Host "    sudo ./install.sh" -ForegroundColor DarkGray
Write-Host ""

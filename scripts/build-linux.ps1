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
$Binary      = Join-Path $OutDir "adOmnia"
$Tarball     = Join-Path $OutDir "adOmnia-linux-amd64.tar.gz"

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
$dockerBin = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerBin) {
    Fail "Docker not found in PATH. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
Write-Host "OK   Docker: $(docker --version 2>$null)" -ForegroundColor Green

if ($Compress) {
    $upxBin = Get-Command upx -ErrorAction SilentlyContinue
    if (-not $upxBin) { Fail "UPX not found in PATH (required by -Compress). Install: https://upx.github.io/" }
    Write-Host "OK   UPX: $(upx --version 2>$null | Select-Object -First 1)" -ForegroundColor Green
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
        Write-Host "WARN generate-icons.ps1 not found — using existing icons." -ForegroundColor Yellow
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
cmd /c "docker build -f $dockerfilePath -t $Image . 2>&1"
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Docker build failed." }
Pop-Location

# ---- [3] Extract binary from container ---------------------------------------
Write-Host ""
Write-Host "==> [3/$stepTotal] Extracting binary from container..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$containerId = (cmd /c "docker create $Image 2>&1").Trim()
if ($LASTEXITCODE -ne 0) { Fail "docker create failed." }

cmd /c "docker cp ${containerId}:/app/build/bin/adOmnia $Binary 2>&1"
$copyOk = $LASTEXITCODE
cmd /c "docker rm $containerId > nul 2>&1"

if ($copyOk -ne 0) { Fail "Failed to copy binary from container." }

$sizeBinary = [math]::Round((Get-Item $Binary).Length / 1MB, 2)
Write-Host "OK   Binary: $sizeBinary MB  ->  $Binary" -ForegroundColor Green

# ---- [4] UPX compression (optional) -----------------------------------------
if ($Compress) {
    Write-Host ""
    Write-Host "==> [4/$stepTotal] Compressing with UPX --best --lzma..." -ForegroundColor Cyan
    $sizeBefore = $sizeBinary
    upx --best --lzma $Binary
    if ($LASTEXITCODE -ne 0) { Fail "UPX compression failed." }
    $sizeAfter = [math]::Round((Get-Item $Binary).Length / 1MB, 2)
    $saved = [math]::Round((1 - $sizeAfter / $sizeBefore) * 100, 1)
    Write-Host "OK   $sizeBefore MB  ->  $sizeAfter MB  (-$saved%)" -ForegroundColor Green
}

# ---- [last] Package tarball --------------------------------------------------
$packStep = if ($Compress) { 5 } else { 4 }
Write-Host ""
Write-Host "==> [$packStep/$stepTotal] Packaging tarball..." -ForegroundColor Cyan

$tmpDir = Join-Path $OutDir "linux-tmp"
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$tmpDir\icons" | Out-Null

Copy-Item $Binary "$tmpDir\adOmnia" -Force

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
if (Test-Path $icon256) { Copy-Item $icon256 "$tmpDir\adOmnia.png" -Force }

$desktopFile = Join-Path $ProjectRoot "build\linux\adOmnia.desktop"
$installFile = Join-Path $ProjectRoot "build\linux\install.sh"
if (Test-Path $desktopFile) { Copy-Item $desktopFile "$tmpDir\adOmnia.desktop" -Force }
if (Test-Path $installFile) { Copy-Item $installFile "$tmpDir\install.sh"      -Force }

tar -czf $Tarball -C $tmpDir .
Remove-Item -Recurse -Force $tmpDir

$tarMB = [math]::Round((Get-Item $Tarball).Length / 1MB, 2)

# ---- Summary -----------------------------------------------------------------
Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  Linux Build Complete!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Binary (standalone)     $Binary  ($sizeBinary MB)" -ForegroundColor Cyan
Write-Host "  Tarball (distributable) $Tarball  ($tarMB MB)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Install on Linux:" -ForegroundColor DarkGray
Write-Host "    tar -xzf adOmnia-linux-amd64.tar.gz" -ForegroundColor DarkGray
Write-Host "    sudo ./install.sh" -ForegroundColor DarkGray
Write-Host ""

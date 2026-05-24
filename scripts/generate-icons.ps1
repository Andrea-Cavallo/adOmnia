# scripts/generate-icons.ps1
# Generates all icon assets from the source PNG before any build step.
#
# ICON SOURCE — to update the app icon, replace this file:
#   assets\images\icon.png
#
# OUTPUTS:
#   build\appicon.png              Wails runtime icon (512x512)
#   build\windows\icon.ico         Windows .exe icon (16/24/32/48/64/128/256)
#   assets\icons\linux\*.png       Linux desktop icon sizes

param(
    [string]$SourceIcon = "assets\images\icon.png"
)

$ErrorActionPreference = "Stop"

# ── Locate ImageMagick ──────────────────────────────────────────────────────────
# On Windows, never use 'convert' — the OS ships its own convert.exe (filesystem).
# Always require 'magick' (ImageMagick 7+).
$magick = $null
if (Get-Command magick -ErrorAction SilentlyContinue) {
    $magick = "magick"
} else {
    Write-Host ""
    Write-Host "ERROR: 'magick' (ImageMagick) not found in PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install with one of:" -ForegroundColor Yellow
    Write-Host "  winget install ImageMagick.ImageMagick" -ForegroundColor Yellow
    Write-Host "  choco install imagemagick.app" -ForegroundColor Yellow
    Write-Host "  https://imagemagick.org/script/download.php#windows" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# ── Validate source ─────────────────────────────────────────────────────────────
if (-not (Test-Path $SourceIcon)) {
    Write-Host ""
    Write-Host "ERROR: Source icon not found: $SourceIcon" -ForegroundColor Red
    Write-Host "Place the production 1024x1024 PNG at: $SourceIcon" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$srcSize = [math]::Round((Get-Item $SourceIcon).Length / 1KB, 1)
Write-Host "    Source : $SourceIcon  ($srcSize KB)" -ForegroundColor DarkGray

# ── Step 1: Windows .ico ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Generating Windows icon ..." -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path "build\windows" | Out-Null

$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$tmpDir   = Join-Path $env:TEMP ("adomnia_icons_" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$tmpPngs = @()
foreach ($sz in $icoSizes) {
    $tmp = Join-Path $tmpDir "icon_${sz}.png"
    & $magick $SourceIcon -resize "${sz}x${sz}" -filter Lanczos $tmp
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: failed to resize source to ${sz}x${sz}" -ForegroundColor Red
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
        exit 1
    }
    $tmpPngs += $tmp
}

& $magick @tmpPngs "build\windows\icon.ico"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: .ico creation failed" -ForegroundColor Red
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    exit 1
}
Remove-Item -Recurse -Force $tmpDir

$icoKb = [math]::Round((Get-Item "build\windows\icon.ico").Length / 1KB, 1)
Write-Host "    build\windows\icon.ico  ($icoKb KB, sizes: $($icoSizes -join ', '))" -ForegroundColor Green

# ── Step 2: Wails runtime icon ──────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Applying executable icon (Wails appicon) ..." -ForegroundColor Cyan

& $magick $SourceIcon -resize "512x512" -filter Lanczos "build\appicon.png"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: build\appicon.png generation failed" -ForegroundColor Red
    exit 1
}
Write-Host "    build\appicon.png  (512x512)" -ForegroundColor Green

# ── Step 3: Linux icon sizes ────────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Generating Linux icons ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "assets\icons\linux" | Out-Null

$linuxSizes = @(16, 24, 32, 48, 64, 128, 256, 512)
foreach ($sz in $linuxSizes) {
    $out = "assets\icons\linux\adOmnia_${sz}x${sz}.png"
    & $magick $SourceIcon -resize "${sz}x${sz}" -filter Lanczos $out
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: failed to generate ${sz}x${sz} PNG" -ForegroundColor Red
        exit 1
    }
    Write-Host "    $out" -ForegroundColor Green
}

Write-Host ""
Write-Host "==> Icon generation complete." -ForegroundColor Green
Write-Host ""

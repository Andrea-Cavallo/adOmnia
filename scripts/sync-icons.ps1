<#
.SYNOPSIS
    Keeps the desktop icons in sync with the adOmnia mark.
.DESCRIPTION
    The source of truth is assets\images\adomnia-mark.svg. Generated icons
    (build\windows\icon.ico, build\appicon.png, Linux PNGs, theme artwork) are
    committed, so a build normally just uses them. When the mark is newer than
    the Windows icon, scripts\generate-concept-icons.mjs regenerates everything
    (needs Node.js and sharp, see docs\BRANDING.md). Without sharp the committed
    icons are kept and the build continues.
.PARAMETER Force
    Regenerate even when the icons look up to date.
#>
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Mark = Join-Path $ProjectRoot "assets\images\adomnia-mark.svg"
$WindowsIcon = Join-Path $ProjectRoot "build\windows\icon.ico"
$AppIcon = Join-Path $ProjectRoot "build\appicon.png"
$Generator = Join-Path $ProjectRoot "scripts\generate-concept-icons.mjs"

$missing = -not (Test-Path $WindowsIcon) -or -not (Test-Path $AppIcon)
$stale = (Test-Path $Mark) -and (Test-Path $WindowsIcon) -and
    ((Get-Item $Mark).LastWriteTimeUtc -gt (Get-Item $WindowsIcon).LastWriteTimeUtc)

if ($Force -or $missing -or $stale) {
    Write-Host "==> Regenerating icons from adomnia-mark.svg..." -ForegroundColor Cyan
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & node $Generator
    $generated = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $previousPreference
    if (-not $generated) {
        Write-Host "WARN Icon generation failed (install sharp: npm install --no-save sharp). Using committed icons." -ForegroundColor Yellow
    }
}

if (-not (Test-Path $WindowsIcon) -or -not (Test-Path $AppIcon)) {
    Write-Host "ERR Icons not found: $WindowsIcon, $AppIcon" -ForegroundColor Red
    exit 1
}
Write-Host "OK  Icons: $WindowsIcon" -ForegroundColor Green
exit 0

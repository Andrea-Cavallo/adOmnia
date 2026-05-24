<#
.SYNOPSIS
    adOmnia build script (PowerShell - native Windows)
.DESCRIPTION
    Builds adOmnia using Wails (embeds icon, manifest, Windows version info).
    Falls back to plain go build if Wails is not installed.
.PARAMETER Version
    Version string embedded in the binary (default: dev)
.PARAMETER Output
    Output binary path (default: .\adOmnia.exe)
.PARAMETER Clean
    Remove build artifacts before building
.PARAMETER GoOnly
    Skip Wails, use plain go build (no metadata embedding)
.EXAMPLE
    .\build.ps1
    .\build.ps1 -Version "1.2.3"
    .\build.ps1 -Clean
#>

[CmdletBinding()]
param(
    [switch]$Clean,
    [string]$Output   = "",
    [string]$Version  = "dev",
    [switch]$GoOnly
)

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$FrontendDir = Join-Path $ProjectRoot "frontend"
$WailsOutDir = Join-Path $ProjectRoot "build\bin"
$WailsOutExe = Join-Path $WailsOutDir "adOmnia.exe"

if ($Output -eq "") {
    $Output = Join-Path $ProjectRoot "adOmnia.exe"
}

# ---- Clean mode --------------------------------------------------------------
if ($Clean) {
    Write-Host "==> Cleaning build artifacts..." -ForegroundColor Cyan
    Remove-Item -Force (Join-Path $ProjectRoot "adOmnia.exe") -ErrorAction SilentlyContinue
    if (Test-Path $WailsOutDir)      { Remove-Item -Recurse -Force $WailsOutDir }
    if (Test-Path "$FrontendDir\dist") { Remove-Item -Recurse -Force "$FrontendDir\dist" }
    Write-Host "OK  Clean complete." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  adOmnia Build  v$Version" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# ---- Prerequisites -----------------------------------------------------------
$nodeBin = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeBin) { $nodeBin = Get-Command node.exe -ErrorAction SilentlyContinue }
if (-not $nodeBin) {
    Write-Host "ERR Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "OK  Node.js: $(node --version)" -ForegroundColor Green

$goBin = Get-Command go -ErrorAction SilentlyContinue
if (-not $goBin) { $goBin = Get-Command go.exe -ErrorAction SilentlyContinue }
if (-not $goBin) {
    Write-Host "ERR Go not found. Install from https://go.dev/dl/" -ForegroundColor Red
    exit 1
}
$goVer = (go version) -replace "go version go", ""
Write-Host "OK  Go: $goVer" -ForegroundColor Green

# ---- Locate Wails ------------------------------------------------------------
$wailsBin = $null

if (-not $GoOnly) {
    # 1. PATH
    $wailsCmd = Get-Command wails -ErrorAction SilentlyContinue
    if ($wailsCmd) { $wailsBin = $wailsCmd.Source }

    # 2. GOPATH/bin
    if (-not $wailsBin) {
        $gopath = (go env GOPATH 2>$null)
        if ($gopath) {
            $candidate = Join-Path $gopath "bin\wails.exe"
            if (Test-Path $candidate) { $wailsBin = $candidate }
        }
    }

    # 3. Common locations
    if (-not $wailsBin) {
        $extras = @(
            "$env:USERPROFILE\go\bin\wails.exe",
            "$env:USERPROFILE\Documents\Workspaces\GO-LANG-WORKSPACE\bin\wails.exe",
            "C:\Users\Andrea\Documents\Workspaces\GO-LANG-WORKSPACE\bin\wails.exe"
        )
        foreach ($c in $extras) {
            if (Test-Path $c) { $wailsBin = $c; break }
        }
    }

    if ($wailsBin) {
        $wailsVerRaw = & $wailsBin version 2>$null | Select-Object -First 1
        if (-not $wailsVerRaw) { $wailsVerRaw = "(ok)" }
        Write-Host "OK  Wails: $wailsVerRaw" -ForegroundColor Green
    } else {
        Write-Host "WARN Wails not found -- falling back to go build (no PE metadata)" -ForegroundColor Yellow
        Write-Host "     Install: go install github.com/wailsapp/wails/v2/cmd/wails@latest" -ForegroundColor Yellow
    }
}

Write-Host ""

# ---- Build info --------------------------------------------------------------
$gitCommit = try { git rev-parse --short HEAD 2>$null } catch { "unknown" }
$buildDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# ---- Wails build (recommended) -----------------------------------------------
if ($wailsBin -and (-not $GoOnly)) {
    Write-Host "--- Building with Wails (icon + manifest + Windows version info)..." -ForegroundColor Cyan
    Write-Host "==> Version:  $Version"
    Write-Host "==> Commit:   $gitCommit"
    Write-Host "==> Output:   $Output"
    Write-Host ""

    $ldflags = "-X main.Version=$Version -X main.BuildDate=$buildDate -X main.GitCommit=$gitCommit"

    Set-Location $ProjectRoot
    & $wailsBin build -ldflags $ldflags -clean

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERR Wails build failed." -ForegroundColor Red
        exit 1
    }

    if (Test-Path $WailsOutExe) {
        Copy-Item $WailsOutExe $Output -Force
        Write-Host "OK  Copied: $WailsOutExe -> $Output" -ForegroundColor Green
    } else {
        Write-Host "ERR Expected output not found at: $WailsOutExe" -ForegroundColor Red
        exit 1
    }

} else {
    # ---- Fallback: plain go build --------------------------------------------
    Write-Host "--- Building frontend..." -ForegroundColor Cyan
    Push-Location $FrontendDir

    if (-not (Test-Path "node_modules")) {
        Write-Host "==> Installing frontend dependencies..." -ForegroundColor Cyan
        npm install --silent
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERR npm install failed." -ForegroundColor Red
            Pop-Location; exit 1
        }
    }

    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERR Frontend build failed." -ForegroundColor Red
        Pop-Location; exit 1
    }
    if (-not (Test-Path "dist")) {
        Write-Host "ERR dist/ not found after build." -ForegroundColor Red
        Pop-Location; exit 1
    }
    Write-Host "OK  Frontend built." -ForegroundColor Green
    Pop-Location

    Write-Host ""
    Write-Host "--- Building Go binary (no PE metadata -- install Wails for full build)..." -ForegroundColor Yellow
    Write-Host "==> Version:  $Version"
    Write-Host "==> Commit:   $gitCommit"
    Write-Host "==> Output:   $Output"
    Write-Host ""

    $ldflags = "-s -w -X main.Version=$Version -X main.BuildDate=$buildDate -X main.GitCommit=$gitCommit -H windowsgui"

    Set-Location $ProjectRoot
    $env:CGO_ENABLED = "1"
    go build -ldflags $ldflags -o $Output .

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERR Go build failed." -ForegroundColor Red
        exit 1
    }
}

# ---- Summary -----------------------------------------------------------------
if (-not (Test-Path $Output)) {
    Write-Host "ERR Build failed -- $Output not found." -ForegroundColor Red
    exit 1
}

$sizeMB = [math]::Round((Get-Item $Output).Length / 1MB, 2)

Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  $Output  ($sizeMB MB)" -ForegroundColor Cyan

if ($wailsBin -and (-not $GoOnly)) {
    Write-Host ""
    Write-Host "  Metadata embedded (visible in File Properties):" -ForegroundColor Green
    Write-Host "    Author:     Andrea Cavallo" -ForegroundColor DarkGray
    Write-Host "    Copyright:  (C) 2026 Andrea Cavallo. All rights reserved." -ForegroundColor DarkGray
    Write-Host "    Product:    adOmnia" -ForegroundColor DarkGray
    Write-Host "    Version:    $Version" -ForegroundColor DarkGray
    Write-Host "    Manifest:   DPI-aware (per-monitor v2), Common Controls v6" -ForegroundColor DarkGray
    Write-Host "    Icon:       embedded from build/windows/icon.ico" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "  NOTE: No Windows metadata embedded." -ForegroundColor Yellow
    Write-Host "        Run without -GoOnly to use Wails for a full release build." -ForegroundColor Yellow
}
Write-Host ""

<#
.SYNOPSIS
    adOmnia build script (PowerShell - native Windows)
.DESCRIPTION
    Builds adOmnia using Wails (embeds icon, manifest, Windows version info).
    Falls back to plain go build if Wails is not installed.
.PARAMETER Version
    Version string embedded in the binary (default: dev)
.PARAMETER Output
    Output binary path (default: .\adomnia.exe)
.PARAMETER Clean
    Remove build artifacts before building
.PARAMETER GoOnly
    Skip Wails, use plain go build (no metadata embedding)
.PARAMETER Compress
    Run UPX compression on the output binary after build (requires UPX in PATH)
.EXAMPLE
    .\build.ps1
    .\build.ps1 -Version "1.2.3"
    .\build.ps1 -Clean
    .\build.ps1 -Compress
    .\build.ps1 -Version "1.2.3" -Compress
#>

[CmdletBinding()]
param(
    [switch]$Clean,
    [string]$Output   = "",
    [string]$Version  = "dev",
    [switch]$GoOnly,
    [switch]$Compress
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $ProjectRoot "frontend"
$WailsOutDir = Join-Path $ProjectRoot "bin"
$WailsOutExe = Join-Path $WailsOutDir "adomnia.exe"
$AppIcon = Join-Path $ProjectRoot "build\appicon.png"
$WindowsIcon = Join-Path $ProjectRoot "build\windows\icon.ico"
$SourceIcon = Join-Path $ProjectRoot "assets\images\icon.png"

if ($Output -eq "") {
    $Output = Join-Path $ProjectRoot "adomnia.exe"
}

$OutputParent = Split-Path -Parent $Output
if ($OutputParent -and -not (Test-Path $OutputParent)) {
    New-Item -ItemType Directory -Force -Path $OutputParent | Out-Null
}

# ---- Clean mode --------------------------------------------------------------
if ($Clean) {
    Write-Host "==> Cleaning build artifacts..." -ForegroundColor Cyan
    Remove-Item -Force (Join-Path $ProjectRoot "adomnia.exe") -ErrorAction SilentlyContinue
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
    $wailsCmd = Get-Command wails3 -ErrorAction SilentlyContinue
    if ($wailsCmd) { $wailsBin = $wailsCmd.Source }

    # 2. GOPATH/bin
    if (-not $wailsBin) {
        $gopath = (go env GOPATH 2>$null)
        if ($gopath) {
            $candidate = Join-Path $gopath "bin\wails3.exe"
            if (Test-Path $candidate) { $wailsBin = $candidate }
        }
    }

    # 3. Common locations
    if (-not $wailsBin) {
        $extras = @(
            "$env:USERPROFILE\go\bin\wails3.exe",
            "$env:USERPROFILE\Documents\Workspaces\GO-LANG-WORKSPACE\bin\wails3.exe",
            "C:\Users\Andrea\Documents\Workspaces\GO-LANG-WORKSPACE\bin\wails3.exe"
        )
        foreach ($c in $extras) {
            if (Test-Path $c) { $wailsBin = $c; break }
        }
    }

    if ($wailsBin) {
        # In Wails 3 beta, `version` writes to the native error stream. With
        # ErrorActionPreference=Stop that turns a successful probe into a
        # terminating PowerShell error, so do not execute it during discovery.
        $wailsBinDir = Split-Path -Parent $wailsBin
        if (($env:Path -split ';') -notcontains $wailsBinDir) {
            $env:Path = "$wailsBinDir;$env:Path"
        }
        Write-Host "OK  Wails 3: $wailsBin" -ForegroundColor Green
    } else {
        Write-Host "WARN Wails not found -- falling back to go build (no PE metadata)" -ForegroundColor Yellow
        Write-Host "     Install: go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.5" -ForegroundColor Yellow
    }
}

Write-Host ""

# ---- Icon assets -------------------------------------------------------------
$iconScript = Join-Path $ProjectRoot "scripts\generate-icons.ps1"
$iconsMissing = -not (Test-Path $AppIcon) -or -not (Test-Path $WindowsIcon)
$iconsStale = $false
if ((Test-Path $SourceIcon) -and (Test-Path $AppIcon) -and (Test-Path $WindowsIcon)) {
    $sourceTime = (Get-Item $SourceIcon).LastWriteTimeUtc
    $iconsStale = ((Get-Item $AppIcon).LastWriteTimeUtc -lt $sourceTime) -or ((Get-Item $WindowsIcon).LastWriteTimeUtc -lt $sourceTime)
}

if ($iconsMissing -or $iconsStale) {
    if (Test-Path $iconScript) {
        Write-Host "==> Preparing app icons..." -ForegroundColor Cyan
        & $iconScript -SourceIcon $SourceIcon
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERR Icon generation failed." -ForegroundColor Red
            exit 1
        }
    }
}

if (-not (Test-Path $WindowsIcon)) {
    Write-Host "ERR Windows icon not found at: $WindowsIcon" -ForegroundColor Red
    exit 1
}
Write-Host "OK  Windows icon: $WindowsIcon" -ForegroundColor Green
Write-Host ""

# ---- Build info --------------------------------------------------------------
$gitCommit = try { git rev-parse --short HEAD 2>$null } catch { "unknown" }
$buildDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# ---- Wails build (recommended) -----------------------------------------------
if ($wailsBin -and (-not $GoOnly)) {
    Write-Host "--- Building with Wails 3..." -ForegroundColor Cyan
    Write-Host "==> Version:  $Version"
    Write-Host "==> Commit:   $gitCommit"
    Write-Host "==> Output:   $Output"
    Write-Host ""

    Set-Location $ProjectRoot
    $previousVersion = $env:VERSION
    $previousBuildDate = $env:BUILD_DATE
    $previousGitCommit = $env:GIT_COMMIT
    $env:VERSION = $Version
    $env:BUILD_DATE = $buildDate
    $env:GIT_COMMIT = $gitCommit
    & $wailsBin task build
    $env:VERSION = $previousVersion
    $env:BUILD_DATE = $previousBuildDate
    $env:GIT_COMMIT = $previousGitCommit

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERR Wails build failed." -ForegroundColor Red
        exit 1
    }

    if (Test-Path $WailsOutExe) {
        try {
            Copy-Item $WailsOutExe $Output -Force
        } catch {
            Start-Sleep -Milliseconds 750
            try {
                Copy-Item $WailsOutExe $Output -Force
            } catch {
                Write-Host "ERR Built Wails binary, but could not overwrite: $Output" -ForegroundColor Red
                Write-Host "    Windows is still holding that file open. Close any running adomnia.exe or choose a different -Output path." -ForegroundColor Yellow
                Write-Host "    Fresh Wails output is available at: $WailsOutExe" -ForegroundColor Yellow
                exit 1
            }
        }
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
    go build -buildvcs=false -trimpath -tags production -ldflags $ldflags -o $Output .

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERR Go build failed." -ForegroundColor Red
        exit 1
    }
}

# ---- UPX compression (optional) ---------------------------------------------
if ($Compress) {
    $upxBin = Get-Command upx -ErrorAction SilentlyContinue
    if (-not $upxBin) {
        Write-Host "WARN -Compress requested but UPX not found in PATH -- skipping." -ForegroundColor Yellow
        Write-Host "     Install UPX: https://upx.github.io/" -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "--- Compressing with UPX --best --lzma..." -ForegroundColor Cyan
        $sizeBefore = [math]::Round((Get-Item $Output).Length / 1MB, 2)
        upx --best --lzma $Output
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERR UPX compression failed." -ForegroundColor Red
            exit 1
        }
        $sizeAfter = [math]::Round((Get-Item $Output).Length / 1MB, 2)
        $saved = [math]::Round((1 - $sizeAfter / $sizeBefore) * 100, 1)
        Write-Host "OK  Compressed: $sizeBefore MB -> $sizeAfter MB  (-$saved%)" -ForegroundColor Green
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
    Write-Host "  Built through the Wails 3 Taskfile pipeline." -ForegroundColor Green
    Write-Host "  Version metadata: $Version" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "  NOTE: Built without Wails 3 binding regeneration." -ForegroundColor Yellow
    Write-Host "        Run without -GoOnly for the standard release pipeline." -ForegroundColor Yellow
}
Write-Host ""

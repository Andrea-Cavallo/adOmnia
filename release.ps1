# release.ps1 - Build pulito non compresso per adOmnia
# Uso: .\release.ps1
# Produce: build\bin\adOmnia.exe (Wails build plain, no UPX)

$ErrorActionPreference = "Continue"

$wails = "C:\Users\Andrea\Documents\Workspaces\GO-LANG-WORKSPACE\bin\wails.exe"
$exe   = "build\bin\adOmnia.exe"

function Fail([string]$msg) {
    Write-Host ""
    Write-Host "ERRORE: $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Premi INVIO per chiudere"
    exit 1
}

# --- sanity checks ---
if (-not (Test-Path $wails)) { Fail "wails.exe non trovato: $wails" }

# --- step 1: icon generation (non bloccante se ImageMagick manca) ---
Write-Host ""
Write-Host "==> [1/2] Generazione icone ..." -ForegroundColor Cyan

$iconScript = Join-Path $PSScriptRoot "scripts\generate-icons.ps1"
if (Test-Path $iconScript) {
    & $iconScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "    AVVISO: generazione icone fallita (ImageMagick non installato?)." -ForegroundColor Yellow
        Write-Host "    Build continua con le icone esistenti in build\windows\icon.ico" -ForegroundColor Yellow
        Write-Host "    Per installare: winget install ImageMagick.ImageMagick" -ForegroundColor DarkGray
    }
} else {
    Write-Host "    AVVISO: scripts\generate-icons.ps1 non trovato - uso icone esistenti." -ForegroundColor Yellow
}

# --- step 2: build plain ---
Write-Host ""
Write-Host "==> [2/2] Build pulito non compresso..." -ForegroundColor Cyan
& $wails build
if ($LASTEXITCODE -ne 0) { Fail "Wails build fallita. Controlla output sopra." }

if (-not (Test-Path $exe)) { Fail "Binary non trovato dopo il build: $exe" }
$size = [math]::Round((Get-Item $exe).Length / 1MB, 2)

Write-Host ""
Write-Host "==> Fatto!" -ForegroundColor Green
Write-Host "    Compressione: NO UPX, no strip flags" -ForegroundColor Gray
Write-Host "    Dimensione:   $size MB" -ForegroundColor Gray
Write-Host "    Output:       $(Resolve-Path $exe)" -ForegroundColor White
Write-Host ""

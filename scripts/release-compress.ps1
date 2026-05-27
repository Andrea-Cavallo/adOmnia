# release-compress.ps1 - Build ottimizzato + compressione UPX per adOmnia
# Uso: .\release-compress.ps1
# Produce: build\bin\adOmnia.exe (stripped + UPX compressed)

$ErrorActionPreference = "Continue"

$exe = "build\bin\adOmnia.exe"

function Fail([string]$msg) {
    Write-Host ""
    Write-Host "ERRORE: $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Premi INVIO per chiudere"
    exit 1
}

# --- sanity checks ---
if (-not (Get-Command wails -ErrorAction SilentlyContinue)) {
    Fail "wails non trovato nel PATH. Installa Wails: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
}
if (-not (Get-Command upx -ErrorAction SilentlyContinue)) {
    Fail "upx non trovato nel PATH. Installa UPX: https://upx.github.io/"
}

# --- step 1: icon generation (non bloccante se ImageMagick manca) ---
Write-Host ""
Write-Host "==> [1/3] Generazione icone ..." -ForegroundColor Cyan

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

# --- step 2: build ---
Write-Host ""
Write-Host "==> [2/3] Build (stripped + trimpath)..." -ForegroundColor Cyan
wails build -ldflags "-s -w" -trimpath
if ($LASTEXITCODE -ne 0) { Fail "Wails build fallita. Controlla output sopra." }

if (-not (Test-Path $exe)) { Fail "Binary non trovato dopo il build: $exe" }
$sizeBefore = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Write-Host "    Binary prima di UPX: $sizeBefore MB" -ForegroundColor Gray

# --- step 3: UPX ---
Write-Host ""
Write-Host "==> [3/3] Compressione UPX --best --lzma..." -ForegroundColor Cyan
upx --best --lzma $exe
if ($LASTEXITCODE -ne 0) { Fail "UPX fallito." }

$sizeAfter = [math]::Round((Get-Item $exe).Length / 1MB, 2)
$saved     = [math]::Round((1 - $sizeAfter / $sizeBefore) * 100, 1)

Write-Host ""
Write-Host "==> Fatto!" -ForegroundColor Green
Write-Host "    Prima:  $sizeBefore MB" -ForegroundColor Gray
Write-Host "    Dopo:   $sizeAfter MB  (-$saved%)" -ForegroundColor Green
Write-Host "    Output: $(Resolve-Path $exe)" -ForegroundColor White
Write-Host ""

# release-linux-compress.ps1 - Build adOmnia per Linux compresso con UPX (via Docker)
# Uso: .\release-linux-compress.ps1
# Produce:
#   build\bin\adOmnia                      (ELF binary, UPX compressed)
#   build\bin\adOmnia-linux-amd64.tar.gz   (binary + icone hicolor + .desktop + install.sh)

$ErrorActionPreference = "Continue"

$image   = "adomnia-linux-builder"
$outDir  = "build\bin"
$tarball = "$outDir\adOmnia-linux-amd64.tar.gz"
$binary  = "$outDir\adOmnia"

function Fail {
    param([string]$msg)
    Write-Host ""
    Write-Host "ERRORE: $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Premi INVIO per chiudere"
    exit 1
}

# --- sanity checks ---
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker non trovato nel PATH."
}
if (-not (Get-Command upx -ErrorAction SilentlyContinue)) {
    Fail "upx non trovato nel PATH. Installa UPX: https://upx.github.io/"
}

# --- [1/5] Icon generation ---
Write-Host ""
Write-Host "==> [1/5] Generazione icone ..." -ForegroundColor Cyan

$iconScript = Join-Path $PSScriptRoot "scripts\generate-icons.ps1"
if (Test-Path $iconScript) {
    & $iconScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    AVVISO: generazione icone fallita - uso icone esistenti." -ForegroundColor Yellow
    }
} else {
    Write-Host "    AVVISO: scripts\generate-icons.ps1 non trovato - uso icone esistenti." -ForegroundColor Yellow
}

# --- [2/5] Docker build ---
Write-Host ""
Write-Host "==> [2/5] Build immagine Docker Linux..." -ForegroundColor Cyan
cmd /c "docker build -f Dockerfile.linux -t $image . 2>&1"
if ($LASTEXITCODE -ne 0) { Fail "Docker build fallita." }

# --- [3/5] Estrai binary dal container ---
Write-Host ""
Write-Host "==> [3/5] Estrazione binary dal container..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$id = (cmd /c "docker create $image 2>&1").Trim()
if ($LASTEXITCODE -ne 0) { Fail "docker create fallito." }

cmd /c "docker cp ${id}:/app/build/bin/adOmnia $binary 2>&1"
$copyOk = $LASTEXITCODE
cmd /c "docker rm $id > nul 2>&1"

if ($copyOk -ne 0) { Fail "Copia binary dal container fallita." }

# --- [4/5] UPX sul binary ---
Write-Host ""
Write-Host "==> [4/5] Compressione UPX --best --lzma sul binary..." -ForegroundColor Cyan
$sizeBefore = [math]::Round((Get-Item $binary).Length / 1MB, 2)
upx --best --lzma $binary
if ($LASTEXITCODE -ne 0) { Fail "UPX fallito." }
$sizeAfter = [math]::Round((Get-Item $binary).Length / 1MB, 2)

# --- [5/5] Costruisci tarball con icone hicolor + desktop + install.sh ---
Write-Host ""
Write-Host "==> [5/5] Packaging tarball con icone ufficiali..." -ForegroundColor Cyan

$tmpDir = "$outDir\linux-tmp"
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$tmpDir\icons" | Out-Null

# Binary
Copy-Item $binary "$tmpDir\adOmnia" -Force

# All hicolor icon sizes
$linuxSizes = @(16, 24, 32, 48, 64, 128, 256, 512)
foreach ($sz in $linuxSizes) {
    $src = "assets\icons\linux\adOmnia_${sz}x${sz}.png"
    if (Test-Path $src) {
        Copy-Item $src "$tmpDir\icons\adOmnia_${sz}x${sz}.png" -Force
    } else {
        Write-Host "ATTENZIONE: icona mancante $src" -ForegroundColor Yellow
    }
}

# Backward-compat single icon (256x256)
Copy-Item "assets\icons\linux\adOmnia_256x256.png" "$tmpDir\adOmnia.png" -Force

# Desktop entry and installer
Copy-Item "build\linux\adOmnia.desktop" "$tmpDir\adOmnia.desktop" -Force
Copy-Item "build\linux\install.sh"      "$tmpDir\install.sh"      -Force

# Create final tarball
tar -czf $tarball -C $tmpDir .
Remove-Item -Recurse -Force $tmpDir

$tarMB = [math]::Round((Get-Item $tarball).Length / 1MB, 2)
$saved = [math]::Round((1 - $sizeAfter / $sizeBefore) * 100, 1)

Write-Host ""
Write-Host "==> Fatto!" -ForegroundColor Green
Write-Host "    Binary (standalone): $sizeAfter MB  (-$saved% vs pre-UPX $sizeBefore MB)" -ForegroundColor Gray
Write-Host "    Tarball distribuibile: $tarMB MB" -ForegroundColor Gray
Write-Host ""
Write-Host "    build\bin\adOmnia                     <- binary standalone compresso UPX" -ForegroundColor White
Write-Host "    build\bin\adOmnia-linux-amd64.tar.gz  <- pacchetto con icone + launcher" -ForegroundColor White
Write-Host ""
Write-Host "    Installazione su Linux:" -ForegroundColor DarkGray
Write-Host "      tar -xzf adOmnia-linux-amd64.tar.gz" -ForegroundColor DarkGray
Write-Host "      sudo ./install.sh" -ForegroundColor DarkGray

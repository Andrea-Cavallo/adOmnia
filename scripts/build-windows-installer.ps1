[CmdletBinding()]
param(
    [string]$Version = $env:VERSION,
    [string]$ArtifactVersion,
    [string]$Executable = 'bin/adomnia.exe',
    [string]$OutputDirectory = 'dist',
    [string]$MakeNSIS,
    [string]$WebViewBootstrapper
)
$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = (Get-Content -LiteralPath (Join-Path $repoDir 'frontend/package.json') -Raw | ConvertFrom-Json).version }
$Version = $Version.TrimStart('v')
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') { throw 'Installer version must be a semantic version.' }
$resourceVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
if (-not $ArtifactVersion) { $ArtifactVersion = $Version }
if ($ArtifactVersion -notmatch '^[0-9A-Za-z.+-]+$') { throw 'Invalid artifact version.' }
$exePath = (Resolve-Path -LiteralPath $Executable).Path
$outputDir = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
if (-not $MakeNSIS) {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) { $MakeNSIS = $command.Source }
    else { $MakeNSIS = Join-Path ${env:ProgramFiles(x86)} 'NSIS/makensis.exe' }
}
if (-not (Test-Path -LiteralPath $MakeNSIS)) { throw 'NSIS is required. Install NSIS 3.11 or newer, or pass -MakeNSIS.' }
if (-not $WebViewBootstrapper) {
    $dependencyDir = Join-Path $repoDir '.wails/installer-deps'
    New-Item -ItemType Directory -Force -Path $dependencyDir | Out-Null
    $WebViewBootstrapper = Join-Path $dependencyDir 'MicrosoftEdgeWebview2Setup.exe'
    if (-not (Test-Path -LiteralPath $WebViewBootstrapper)) {
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $WebViewBootstrapper -TimeoutSec 90 -MaximumRedirection 5
    }
}
$bootstrapper = (Resolve-Path -LiteralPath $WebViewBootstrapper).Path
$signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
    throw 'The WebView2 bootstrapper must have a valid Microsoft Authenticode signature.'
}
$output = Join-Path $outputDir "adomnia-$ArtifactVersion-windows-amd64-setup.exe"
$sizeKB = [int][Math]::Ceiling((Get-Item -LiteralPath $exePath).Length / 1024)
& $MakeNSIS '/V2' "/DAPP_VERSION=$Version" "/DRESOURCE_VERSION=$resourceVersion" "/DAPP_SIZE_KB=$sizeKB" "/DAPP_EXE=$exePath" "/DREPO_DIR=$repoDir" "/DWEBVIEW_BOOTSTRAPPER=$bootstrapper" "/DOUTPUT_FILE=$output" (Join-Path $repoDir 'build/windows/installer.nsi')
if ($LASTEXITCODE -ne 0) { throw "NSIS compilation failed ($LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $output)) { throw 'NSIS did not produce the installer.' }
Write-Output $output

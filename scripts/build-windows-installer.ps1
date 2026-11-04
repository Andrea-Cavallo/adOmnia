<#
.SYNOPSIS
  Builds the per-user adOmnia setup.exe from an already built adomnia.exe.
.EXAMPLE
  ./scripts/build-windows-installer.ps1 -Version 1.2.3
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Version,
    [string]$AppExe = 'bin\adomnia.exe',
    [string]$OutDir = 'dist'
)
$ErrorActionPreference = 'Stop'

$normalized = $Version.Trim().TrimStart('v')
if (-not ($normalized -match '^(?<core>\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?$')) {
    throw "Invalid release version '$Version': expected 1.2.3 or 1.2.3-beta.1"
}
# Windows version resources take four numbers; the prerelease suffix stays in VERSION.
$viVersion = "$($Matches.core).0"

$exe = (Resolve-Path -LiteralPath $AppExe).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$outFile = Join-Path (Resolve-Path -LiteralPath $OutDir).Path "adomnia-$normalized-windows-amd64-setup.exe"

$makensis = (Get-Command makensis -ErrorAction SilentlyContinue).Source
if (-not $makensis) {
    $candidate = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
    if (Test-Path -LiteralPath $candidate) { $makensis = $candidate }
}
if (-not $makensis) { throw 'NSIS is not installed: run "winget install NSIS.NSIS" or "choco install nsis".' }

$script = Join-Path $PSScriptRoot '..\build\windows\installer\adomnia.nsi'
$rgDir = Join-Path $PSScriptRoot '..\build\rg\windows'
$rgExe = Join-Path $rgDir 'rg.exe'
if (-not (Test-Path -LiteralPath $rgExe)) {
    try { & node (Join-Path $PSScriptRoot 'fetch-ripgrep.mjs') } catch { Write-Warning "ripgrep not staged: $_" }
}
$defines = @("-DVERSION=$normalized", "-DVI_VERSION=$viVersion", "-DAPP_EXE=$exe", "-DOUTFILE=$outFile")
if (Test-Path -LiteralPath $rgExe) {
    $defines += "-DRG_EXE=$((Resolve-Path -LiteralPath $rgExe).Path)"
    $defines += "-DRG_LICENSE_DIR=$((Resolve-Path -LiteralPath $rgDir).Path)"
}
& $makensis -V2 -WX @defines $script
if ($LASTEXITCODE -ne 0) { throw "makensis failed with exit code $LASTEXITCODE" }
Write-Host "Installer: $outFile"

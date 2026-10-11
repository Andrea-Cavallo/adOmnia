# Install/update a user-owned Windows copy; preserves all application data.
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [string]$Destination = "$env:LOCALAPPDATA\Programs\adOmnia\adomnia.exe",
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use install.sh on Linux/macOS.' }
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') { throw 'Only Windows x86_64 releases are available.' }
if ($Version -ne 'latest' -and $Version -notmatch '^v?\d+\.\d+\.\d+([-+][A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
if (Get-Process -Name adomnia -ErrorAction SilentlyContinue) { throw 'Close adOmnia before running this script.' }
$Destination = [IO.Path]::GetFullPath($Destination)
if ([IO.Path]::GetExtension($Destination) -ne '.exe') { throw 'Destination must be an .exe path.' }
if ((Test-Path -LiteralPath $Destination) -and ((Get-Item -LiteralPath $Destination).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Symlink destinations are not supported.' }
$backup = "$Destination.adomnia-previous"
if (Test-Path -LiteralPath $backup) { throw 'A previous backup exists; review it before updating again.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$api = 'https://api.github.com/repos/Andrea-Cavallo/adOmnia/releases'
$endpoint = "$api/latest"
if ($Version -ne 'latest') { if (-not $Version.StartsWith('v')) { $Version = "v$Version" }; $endpoint = "$api/tags/$Version" }
$release = Invoke-RestMethod -Uri $endpoint -TimeoutSec 30
$package = @($release.assets | Where-Object { $_.name -cmatch '-windows-amd64\.exe$' })
$checksums = @($release.assets | Where-Object { $_.name -ceq 'SHA256SUMS.txt' })
if ($package.Count -ne 1 -or $checksums.Count -ne 1) { throw 'Release is missing the executable/checksums.' }
foreach ($asset in @($package[0], $checksums[0])) {
    if (-not $asset.browser_download_url.StartsWith('https://github.com/Andrea-Cavallo/adOmnia/releases/download/')) { throw 'Untrusted asset URL.' }
}
Write-Host "Release: $($release.tag_name). Destination: $Destination"
if (-not $Yes -and (Read-Host 'Download and install? [y/N]') -ne 'y') { return }
$work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
$staged = $null
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $download = Join-Path $work 'adomnia.exe'
    $sums = Join-Path $work 'SHA256SUMS.txt'
    Invoke-WebRequest -UseBasicParsing -Uri $package[0].browser_download_url -OutFile $download -TimeoutSec 1200
    Invoke-WebRequest -UseBasicParsing -Uri $checksums[0].browser_download_url -OutFile $sums -TimeoutSec 30
    $expected = @(Get-Content -LiteralPath $sums | ForEach-Object {
        if ($_ -match '^([a-fA-F0-9]{64})\s+\*?(.+)$' -and $Matches[2] -ceq $package[0].name) { $Matches[1] }
    })
    $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash
    if ($expected.Count -ne 1 -or $actual -ne $expected[0]) { throw 'Checksum rejected; nothing installed.' }
    $directory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $staged = Join-Path $directory ('.adomnia-install-' + [Guid]::NewGuid().ToString() + '.exe')
    Copy-Item -LiteralPath $download -Destination $staged
    if (Test-Path -LiteralPath $Destination) { Move-Item -LiteralPath $Destination -Destination $backup }
    try { Move-Item -LiteralPath $staged -Destination $Destination }
    catch {
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $Destination }
        throw
    }
    Write-Host "Installed: $Destination"
    Write-Host 'Launch adOmnia to verify it. Remove any PATH.adomnia-previous backup only after verification.'
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force
    if ($staged -and (Test-Path -LiteralPath $staged)) { Remove-Item -LiteralPath $staged -Force }
}

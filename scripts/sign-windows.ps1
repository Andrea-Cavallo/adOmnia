<#
.SYNOPSIS
  Authenticode-signs Windows binaries when a code-signing certificate is configured.
.DESCRIPTION
  Reads WINDOWS_CERTIFICATE (base64 .pfx) and WINDOWS_CERTIFICATE_PASSWORD from the
  environment. Without them the files stay unsigned and the script only says so, so
  forks and unconfigured repositories still produce a release.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string[]]$Path
)
$ErrorActionPreference = 'Stop'

if (-not $env:WINDOWS_CERTIFICATE) {
    Write-Host '::notice::WINDOWS_CERTIFICATE is not set: Windows binaries are unsigned (SmartScreen will warn on first run).'
    return
}
$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found: install the Windows 10/11 SDK.' }

$pfx = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString() + '.pfx')
try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
    foreach ($file in $Path) {
        & $signtool.FullName sign /f $pfx /p $env:WINDOWS_CERTIFICATE_PASSWORD /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 /d 'adOmnia' $file
        if ($LASTEXITCODE -ne 0) { throw "signtool failed on $file" }
        & $signtool.FullName verify /pa $file
        if ($LASTEXITCODE -ne 0) { throw "signature verification failed on $file" }
    }
}
finally {
    Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
}

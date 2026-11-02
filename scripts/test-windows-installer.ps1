[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$Version)
$ErrorActionPreference = 'Stop'
$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\adOmnia'
$shortcutDir = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs/adOmnia'
if ((Test-Path -LiteralPath $registryPath) -or (Test-Path -LiteralPath $shortcutDir)) {
    throw 'Run installer acceptance in a clean Windows account; an existing adOmnia installation must be preserved.'
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('adomnia setup test ' + [Guid]::NewGuid().ToString('N'))
$targetDir = Join-Path $testRoot 'Application'
$dataFile = Join-Path $testRoot 'workspace.adomnia'
New-Item -ItemType Directory -Path $testRoot | Out-Null
Set-Content -LiteralPath $dataFile -Value 'preserve local work'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
function Run-Setup {
    param([int]$ExpectedExit = 0)
    $process = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$targetDir") -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(120000)) { throw 'Installer timed out.' }
    if ($process.ExitCode -ne $ExpectedExit) { throw "Installer exit $($process.ExitCode), expected $ExpectedExit." }
}
Run-Setup
if (-not (Test-Path -LiteralPath (Join-Path $targetDir 'adomnia.exe'))) { throw 'Application was not installed.' }
$metadata = Get-ItemProperty -LiteralPath $registryPath
if ($metadata.DisplayVersion -ne $Version.TrimStart('v') -or $metadata.InstallLocation -ne $targetDir) { throw 'Incorrect installed-app metadata.' }
if (-not (Test-Path -LiteralPath (Join-Path $shortcutDir 'adOmnia.lnk'))) { throw 'Start menu shortcut is missing.' }
$unrelated = Join-Path $targetDir 'user-file.txt'
Set-Content -LiteralPath $unrelated -Value 'preserve this file'
$appPath = Join-Path $targetDir 'adomnia.exe'
$hashBefore = (Get-FileHash -LiteralPath $appPath).Hash
$lock = [IO.File]::Open($appPath, 'Open', 'Read', 'None')
try { Run-Setup -ExpectedExit 3 } finally { $lock.Dispose() }
if ((Get-FileHash -LiteralPath $appPath).Hash -ne $hashBefore) { throw 'Blocked upgrade changed the running application.' }
Run-Setup
if ((Get-Content -LiteralPath $unrelated) -ne 'preserve this file') { throw 'Reinstall changed an unrelated file.' }
$uninstaller = Join-Path $targetDir 'Uninstall.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$targetDir") -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(120000)) { throw 'Uninstaller timed out.' }
if ($process.ExitCode -ne 0) { throw "Uninstaller failed ($($process.ExitCode))." }
if (Test-Path -LiteralPath (Join-Path $targetDir 'adomnia.exe')) { throw 'Uninstaller left the application behind.' }
if (Test-Path -LiteralPath $registryPath) { throw 'Uninstaller left its registry entry behind.' }
if (Test-Path -LiteralPath $shortcutDir) { throw 'Uninstaller left its shortcuts behind.' }
if ((Get-Content -LiteralPath $unrelated) -ne 'preserve this file' -or (Get-Content -LiteralPath $dataFile) -ne 'preserve local work') { throw 'Uninstall changed user data.' }
Write-Output "Installer install/reinstall/uninstall acceptance passed: $testRoot"

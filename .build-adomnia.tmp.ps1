param([Parameter(Mandatory = $true)][string]$Root)

$ErrorActionPreference = "Stop"
Set-Location $Root

$rootExe = Join-Path $Root "adomnia.exe"
$builtExe = Join-Path $Root "build\bin\adomnia.exe"
$icon = Join-Path $Root "build\windows\icon.ico"

if (!(Test-Path $icon)) { throw "missing Windows icon: $icon" }

Write-Host "[build] checking frontend build"
Push-Location (Join-Path $Root "frontend")
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Pop-Location

Write-Host "[build] checking Go packages"
& go test ./...
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[build] closing old adomnia.exe if it is running from this project"
Get-Process adomnia -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $rootExe -or $_.Path -eq $builtExe -or $_.ProcessName -eq "adomnia" } |
  Stop-Process -Force

Write-Host "[build] building Windows exe with Wails (stripped + trimpath)"
& go run github.com/wailsapp/wails/v2/cmd/wails@latest build -ldflags "-s -w" -trimpath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (!(Test-Path $builtExe)) { throw "Wails did not create $builtExe" }

Write-Host "[build] copying exe to project root"
Get-Process adomnia -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
Remove-Item -LiteralPath $rootExe -Force -ErrorAction SilentlyContinue
$copied = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    Copy-Item -LiteralPath $builtExe -Destination $rootExe -Force
    $copied = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $copied) { throw "could not copy $builtExe to $rootExe because the destination is still locked" }
if (!(Test-Path $rootExe)) { throw "root exe was not created" }

Add-Type -AssemblyName System.Drawing
$associatedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($rootExe)
if ($null -eq $associatedIcon) { throw "created exe has no extractable Windows icon" }

$size = (Get-Item -LiteralPath $rootExe).Length
Write-Host "[build] done: $rootExe ($size bytes)"

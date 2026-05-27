<#
.SYNOPSIS
    Root entrypoint for the Windows production build.
.EXAMPLE
    .\build.ps1
    .\build.ps1 -Version "1.2.3"
    .\build.ps1 -Compress
    .\build.ps1 -Clean
#>

[CmdletBinding()]
param(
    [switch]$Clean,
    [string]$Output = "",
    [string]$Version = "dev",
    [switch]$GoOnly,
    [switch]$Compress
)

& (Join-Path $PSScriptRoot "scripts\build.ps1") @PSBoundParameters
exit $LASTEXITCODE

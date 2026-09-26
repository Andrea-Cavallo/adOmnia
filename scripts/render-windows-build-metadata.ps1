<#
.SYNOPSIS
  Renders Windows version-resource inputs for one adOmnia build.

.DESCRIPTION
  Wails 3's `generate syso` consumes literal JSON and XML files; it does not
  evaluate Go-template expressions in them. This script turns the checked-in
  templates into a per-build pair of files, using the release version supplied
  by the Taskfile. Generated files belong in .wails/ and are not source assets.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Version,
    [Parameter(Mandatory)]
    [string]$InfoTemplatePath,
    [Parameter(Mandatory)]
    [string]$ManifestTemplatePath,
    [Parameter(Mandatory)]
    [string]$InfoOutputPath,
    [Parameter(Mandatory)]
    [string]$ManifestOutputPath
)

$ErrorActionPreference = 'Stop'

# Windows file resources accept four numeric components. Release tags may have
# a leading v or a prerelease suffix; both are intentionally omitted here while
# the full tag remains available to Go through main.Version.
$normalized = $Version.Trim().TrimStart('v')
if ($normalized -match '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:[-+].*)?$') {
    $productVersion = "$($Matches.major).$($Matches.minor).$($Matches.patch)"
    $resourceVersion = "$productVersion.0"
} else {
    # Non-semantic versions (e.g. "dev") have no numeric components for the
    # Windows file resource. Fall back to a zeroed resource version while the
    # full tag remains available to Go through main.Version.
    $productVersion = "0.0.0"
    $resourceVersion = "0.0.0.0"
}

function Render-Template {
    param([string]$TemplatePath, [string]$OutputPath)

    $content = Get-Content -LiteralPath $TemplatePath -Raw -Encoding UTF8
    $content = $content.Replace('@@PRODUCT_VERSION@@', $productVersion)
    $content = $content.Replace('@@RESOURCE_VERSION@@', $resourceVersion)
    if ($content.Contains('@@')) {
        throw "Unresolved metadata token in $TemplatePath."
    }

    $parent = Split-Path -Parent $OutputPath
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    # `powershell.exe` 5.1 is still the default shell on many supported Windows
    # machines and does not understand Set-Content's utf8NoBOM alias.
    [System.IO.File]::WriteAllText(
        $OutputPath,
        $content,
        (New-Object System.Text.UTF8Encoding($false))
    )
}

Render-Template -TemplatePath $InfoTemplatePath -OutputPath $InfoOutputPath
Render-Template -TemplatePath $ManifestTemplatePath -OutputPath $ManifestOutputPath

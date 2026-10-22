<#
.SYNOPSIS
    Measure native adOmnia startup on Windows: time to first stable frame and
    peak/steady working set, using the app's own local performance sample.
.DESCRIPTION
    Each sample launches the desktop executable with an isolated APPDATA, waits
    for startup-performance.jsonl (written after the renderer reaches its first
    stable frame and the backend records its stages), then terminates the app
    tree. Nothing leaves the machine and the temporary data folder is removed.
.PARAMETER Exe
    Desktop executable. Defaults to build\bin\adomnia.exe.
.PARAMETER Samples
    Number of launches. Defaults to 3.
.PARAMETER TimeoutSeconds
    Per-launch timeout. Defaults to 90.
.PARAMETER Output
    Optional path for the JSON report.
.EXAMPLE
    powershell -File scripts/measure-startup.ps1 -Samples 5
#>
[CmdletBinding()]
param(
    [string]$Exe = "",
    [int]$Samples = 3,
    [int]$TimeoutSeconds = 90,
    [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Exe) { $Exe = Join-Path $ProjectRoot "build\bin\adomnia.exe" }
if (-not (Test-Path $Exe)) { throw "Executable not found: $Exe (build it with wails3 task build first)" }

function Get-ProcessTreeMemoryMB([int]$Id) {
    $rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue
    $total = 0
    if ($rootProcess) { $total += [int64]$rootProcess.WorkingSetSize }
    foreach ($child in Get-CimInstance Win32_Process -Filter "ParentProcessId=$Id" -ErrorAction SilentlyContinue) {
        $total += [int64]$child.WorkingSetSize
    }
    return [Math]::Round($total / 1MB, 1)
}

$results = @()
for ($sample = 1; $sample -le $Samples; $sample++) {
    $dataRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("adomnia-startup-{0}-{1}" -f $PID, $sample)
    New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
    $sampleFile = Join-Path $dataRoot "adomnia\startup-performance.jsonl"

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Resolve-Path $Exe).Path
    $startInfo.WorkingDirectory = $ProjectRoot
    $startInfo.UseShellExecute = $false
    # Isolate settings and the performance sample from the developer's profile.
    $startInfo.Environment["APPDATA"] = $dataRoot

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $peakMB = 0
    $exited = $false
    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Start-Sleep -Milliseconds 50
        if ($process.HasExited) { $exited = $true; break }
        $process.Refresh()
        $current = Get-ProcessTreeMemoryMB $process.Id
        if ($current -gt $peakMB) { $peakMB = $current }
        if (Test-Path $sampleFile) { break }
    }
    $firstFrameMs = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds, 0)
    $stopwatch.Stop()

    Start-Sleep -Seconds 2
    $steadyMB = if ($process.HasExited) { 0 } else { Get-ProcessTreeMemoryMB $process.Id }

    $sampleData = $null
    if (Test-Path $sampleFile) {
        $line = Get-Content $sampleFile -Tail 1
        try { $sampleData = $line | ConvertFrom-Json } catch { $sampleData = $null }
    }

    if (-not $process.HasExited) {
        & taskkill /PID $process.Id /T /F *> $null
        $process.WaitForExit(5000) | Out-Null
    }
    Remove-Item -Recurse -Force $dataRoot -ErrorAction SilentlyContinue

    $results += [pscustomobject]@{
        sample             = $sample
        firstFrameMs       = if ($exited) { $null } else { $firstFrameMs }
        peakTreeMemoryMB   = $peakMB
        steadyTreeMemoryMB = $steadyMB
        exitedEarly        = $exited
        backendMs          = if ($sampleData) { $sampleData.backend.totalMs } else { $null }
        frontend           = if ($sampleData) { $sampleData.frontend } else { $null }
    }
    Write-Host ("sample {0}: first frame {1} ms, peak tree {2} MB, steady tree {3} MB, backend {4} ms" -f `
        $sample, $results[-1].firstFrameMs, $peakMB, $steadyMB, $results[-1].backendMs)
}

$completed = @($results | Where-Object { -not $_.exitedEarly -and $_.firstFrameMs })
$summary = [pscustomobject]@{
    measuredAt      = (Get-Date).ToUniversalTime().ToString("o")
    executable      = (Resolve-Path $Exe).Path
    os              = [System.Environment]::OSVersion.VersionString
    samples         = $results
    medianFirstFrameMs = if ($completed.Count) { ($completed | Sort-Object firstFrameMs)[[Math]::Floor(($completed.Count - 1) / 2)].firstFrameMs } else { $null }
    medianPeakMemoryMB = if ($completed.Count) { ($completed | Sort-Object peakTreeMemoryMB)[[Math]::Floor(($completed.Count - 1) / 2)].peakTreeMemoryMB } else { $null }
}
$summary | ConvertTo-Json -Depth 6

if ($Output) {
    $parent = Split-Path -Parent $Output
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $Output
}

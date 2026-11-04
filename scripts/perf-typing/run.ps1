# Measures keypress-to-paint in the real app while tests, a log flood, a debugger and gopls work.
#   powershell -File scripts/perf-typing/run.ps1 -Exe bin\adomnia.exe -Label before
# Uses a throwaway profile and project under %TEMP%; your data is not touched. Needs Node 22+ and go.
# The results go to %TEMP%\adomnia-perf-typing\result-<Label>.json. See docs/performance/input-latency-2026-11-04.md.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Label = 'run',
  [string]$Scenarios = 'idle,run-flood,tests,debug,indexing'
)
$here = $PSScriptRoot
$exePath = (Resolve-Path $Exe).Path
$work = Join-Path $env:TEMP 'adomnia-perf-typing'
$realTools = Join-Path $env:APPDATA 'adomnia\goide\tools\bin'
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
$tools = Join-Path $work 'profile\adomnia\goide\tools\bin'
New-Item -ItemType Directory -Force $tools | Out-Null
foreach ($tool in 'gopls.exe', 'dlv.exe') { Copy-Item (Join-Path $realTools $tool) $tools -Force }
$env:PERF_WORK = $work
node (Join-Path $here 'gen.mjs')
$env:APPDATA = Join-Path $work 'profile'
$env:LOCALAPPDATA = Join-Path $work 'profile\local'
New-Item -ItemType Directory -Force $env:LOCALAPPDATA | Out-Null
$env:ADOMNIA_WEBVIEW2_ARGS = '--remote-debugging-port=19402'
# Detached on purpose: the app must outlive any time limit of the shell that started it.
$app = Start-Process -FilePath $exePath -PassThru
try {
  Start-Sleep 7
  node (Join-Path $here 'load.mjs') $Label $Scenarios
} finally {
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
}

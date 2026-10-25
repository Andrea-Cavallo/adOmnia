# Startup performance

adOmnia renders its shell and restores the workspace before starting optional
tools. This is a loading optimization, not a change to the workspace format or
the set of supported API, database and broker features.

## What is deferred

- The collection sidebar is not requested on a fresh Hub. A persisted API
  destination preloads it alongside the request workspace during module
  evaluation, overlapping the bootstrap load.
- The command palette and development log overlay load when opened.
- Environment and hosts editors load when opened, including in restored API
  workspaces. Their compact switchers remain available in the sidebar.
- A disconnected/unverified AI companion does not load its chat or provider
  runtime. A verified companion mounts after the first stable frame; an early
  Hub click can request it immediately and is retained while the chunk loads.
- File-drop imports load their collection/environment parsers on demand.
- AI gateway restoration imports the provider runtime only after the first
  frame and only if AI and the gateway are enabled.
- YAML has its own vendor chunk. It no longer shares a startup chunk with
  Zustand and the UI utility libraries.

Existing deferred panels, workspace hydration, startup backups and active-tab
restoration are preserved. No credentials are resolved by these loading checks.

## Production graph check

```bash
npm --prefix frontend run check:startup
```

The script builds the production graph in memory without replacing
`frontend/dist`. It walks the entry chunks' static imports, reports their
uncompressed JavaScript bytes, and fails above 650,000 bytes or if guarded
optional modules enter that graph. Dynamic imports are not included. Conditional
runtime preloads for restored API workspaces are therefore outside this number.
Images, CSS, fonts, worker payloads and the native executable are also excluded.

For a diagnostic report without enforcing the budget:

```bash
cd frontend
node scripts/check-startup-bundle.mjs --report-only
```

The desktop build workflow runs the budget on each change. It guards startup
loading strategy; it is not a benchmark of native launch time or total app size.

## Measurements: 2026-09-27

The baseline was the working tree after game extraction, before startup
deferral. Both graph measurements used the same installed toolchain.

| Measurement | Before | After |
| --- | ---: | ---: |
| Static initial JavaScript, uncompressed | 823,684 bytes | 572,407 bytes |
| Guarded deferred app modules present initially | 7 | 0 |
| Warm-cache renderer first-frame median, 3 samples | 83.8 ms | 80.9 ms |

Initial JavaScript is reduced by 251,277 bytes (30.5%). The small timing sample
does not establish a comparable native startup speedup. Browser samples used
the production preview at `127.0.0.1:5175` with an empty workspace and no Wails
backend: before 66.5 / 83.8 / 87.7 ms, after 84.7 / 80.9 / 77.2 ms. No hydration
skeleton appeared in these Hub samples.

## Timing diagnostics and limitations

`startupPerformance.ts` uses local Performance API marks for renderer mount,
bootstrap hydration, workspace-bundle loading and the first stable shell frame.
The HTML element's `data-startup-performance` attribute exposes numeric timing
and payload-size diagnostics for local smoke checks. It contains no workspace
contents, names, credentials or remote telemetry. Diagnostics failures cannot
interrupt the first-frame notification.

The renderer-entry mark is recorded when the entry module executes, after its
static imports. It does not measure the earlier cost of downloading, parsing
and evaluating that static graph. Nor does the first-frame mark guarantee that
every lazy panel/editor is ready. Native process launch, WebView initialization
and actual Go bootstrap need a separate Wails measurement on the target machine.
Use the built desktop with both an empty Hub and representative persisted API
workspaces; compare cold and warm launches separately rather than extrapolating
from browser preview reloads.

## Hardening checkpoint: 2026-10-15

The shared `layout/lazyPanels.ts` owns lazy component identities for both the
router and API workspace. The startup guard also rejects Yjs, y-monaco, xterm
(including addons) and d3-force. Snapshot graph checks passed at 601,577 bytes
before and 601,964 after, with zero guarded modules (concurrent working-tree
changes mean this delta is not an isolated size comparison).

`rendererToWorkspaceInteractive` is published in `data-startup-performance`
after the hydrated API workspace commits and passes two animation frames.
It is separate from the shell first-frame metric and remains absent when the
API workspace has not mounted. It indicates controls readiness; it does not
prove an actual user action completed or a lazy body editor is fully loaded.
For acceptance, record cold/warm native samples with a populated workspace,
edit the restored URL, and switch away and back. Native samples remain pending;
those concurrent TypeScript changes were resolved at the following checkpoint,
where frontend build, TypeScript, startup guard and Go build passed. Native
interaction samples remain pending.

Startup backup keeps schema 1.0 and the existing setting, but writes the
snapshot to backend storage bucket `workspace`, key `backup`. The previous
`adomnia.workspace.backup` copy is preserved; that key is written only when
backend persistence fails (including browser development). No `.adomnia`
export migration is required.

Run `node frontend/scripts/benchmark-history-clone.mjs` for the local clone
comparison. The initial Node 22.14.0 sample on a 1 MB body was 1.3493 ms median
for JSON round-trip versus 0.1963 ms for structuredClone (20 warmups, 100 samples).
This is not a native launch benchmark. History tests verify nested snapshot
isolation on capture and reopen.

## Lifecycle hardening: 2026-10-15

Closing an IDE session now releases dependency/workspace graph caches and graph
builder locks; late results cannot repopulate a closed session. Deferred Monaco
cleanup rechecks current ownership to preserve immediately reopened documents.
The registry test uses simulated Monaco models; native WebView model counts
and terminal/debug/database/broker/secondary-window cycles remain pending.

Registered Windows managed children use a non-inheritable Job Object with
kill-on-close, supplementing the existing registry sweep. A real subprocess
owner-crash test covers OS cleanup; 12 measured child/job cycles after warmup
kept handles at 112. Assignment is best effort and occurs after process start:
existing descendants or rejected assignment still need tree termination/sweep.
Independent GUI/updater processes and unregistered terminals are not enrolled.
See [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

## Repeatable local reports

From the repository root:

```powershell
node scripts/benchmark-performance.mjs
node scripts/benchmark-performance.mjs --baseline .artifacts/performance/phase-c16-initial/report.json
node --test scripts/performance-report.test.mjs
```

Optional `--out DIRECTORY` chooses the output directory; `--conditions TEXT`
records the declared measurement conditions. Use the same conditions string
when comparing. The runner records hardware, toolchain, commit and tracked
working-tree state. It runs sequentially to avoid its own benchmarks competing
for CPU. It does not control other programs or certify an idle system.

Each local report contains JSON schema v1 (`kind: developer-microbenchmark`),
raw lifecycle/Go/Vitest output, frontend latency statistics, production startup
graph and a self-contained HTML dashboard. Report directories are ignored by
Git. Go metrics retain all three samples; frontend rows use the p50 of their
measured iteration distribution, with full distributions' summary statistics
in the accompanying JSON. No application data, credentials or telemetry is sent.

Comparisons require matching CPU, logical CPU count, OS/architecture, Go/Node
versions, protocol and declared conditions, and compare only the same metric
and unit. Incompatible comparisons show pending rather than a percentage.
Deltas are descriptive, with no statistical significance claim or CI threshold.
A failed command leaves `failure.txt` and exits nonzero.

The backend fixtures cover project open, file open and search at 10/100/1000
files, source fingerprint at 10/1000 files, and dependency graph cold/cache-hit.
Frontend fixtures exercise benchmark comparison and persistence splitting of
25 tabs with 250 kB responses. These CPU microbenchmarks do not measure React
commit/input latency, WebView startup, or a complete user workflow.

Initial environment: Windows amd64, i7-14700KF (28 logical CPUs),
68,539,883,520 bytes RAM, Go 1.26.5, Node 22.14.0. The workstation had uncontrolled
background activity. Dependency graph medians were 146.8192 ms cold and
2.149756 ms for cache-hit. This supports retaining the Go cache path; it does
not justify adding Rust or establish a native before/after speedup.

## Native scenario baseline protocol

The scenario suite below produces the controlled release baseline that the
proposed budgets require. Two opt-in, local-only tools cover the capture; both
are inert unless explicitly enabled.

**Recording (Go, `internal/perf`).** Launch the built app (or `wails3 task dev`)
with the scenario environment set:

```powershell
$env:ADOMNIA_PERF_SCENARIO = 'typing-continuous'   # enables recording
$env:ADOMNIA_PERF_INTERVAL = '1s'                  # optional, default 1s
$env:ADOMNIA_PERF_DURATION = '10m'                 # optional auto-stop (0 = until shutdown)
```

Each sample is one JSONL line in `<dataDir>/perf/<scenario>-<timestamp>.jsonl`
(0600, local only) with Go runtime counters (goroutines, heap, GC pauses) and
the complete process tree — the WebView2 processes, gopls, debug adapters and
any child tool — with per-process RAM and CPU. `ADOMNIA_PPROF=1` additionally
exposes `net/http/pprof` on `127.0.0.1:6069` (any other value is a loopback
address; non-loopback is refused) for heap/goroutine/CPU profiles of the Go
backend itself.

While a recording is active, the renderer also measures keypress-to-paint input
latency (double `requestAnimationFrame`) and merges p50/p95/max per window into
the same samples through `main.App.PerfPushFrontendMetrics`. Without a recording
the module stays inert and adds no timers or listeners.

**Aggregation.** From the repository root:

```powershell
node scripts/perf-scenario-report.mjs <perf-dir> --out baseline-report.json
node --test scripts/perf-scenario-report.test.mjs
```

The report (`kind: native-scenario-baseline`) groups every sample by component —
`backend-go`, `webview2`, `gopls`, `debug-adapter`, `other-children` — with
RAM/CPU average, max and median per component, observed process counts, runtime
aggregates and the input-latency window, plus a Markdown table for this file.
Comparisons require the same hardware/conditions as the microbenchmark runner.

**Scenario suite.** One recording per row; record cold and warm samples
separately and state dataset sizes in `--conditions`.

| Scenario id | Procedure | Duration | Primary metrics |
| --- | --- | --- | --- |
| `cold-start` / `warm-start` | Launch the release build (cold: reboot or cleared caches; warm: relaunch) with an empty Hub | until interactive | backend-go RAM/CPU, webview2 count, startup marks |
| `hub-empty` | Leave the Hub open with no workspace | 5 min | idle CPU per component |
| `gostudio-small` / `gostudio-large` | Open a small / large Go project in Code Studio, let gopls settle | 5 min each | gopls RAM/CPU, backend-go heap |
| `workspaces-3-5` | Keep 3–5 workspaces open across tabs/windows | 10 min | per-component RAM growth |
| `typing-continuous` | Type continuously in a large file with completion and diagnostics on | 10 min | input p95, gopls CPU, heap |
| `large-files-json` | Open very large files / complex JSON payloads, scroll and edit | 10 min | heap max, webview2 RAM |
| `rapid-tabs` | Switch rapidly between modules/tabs and panels | 5 min | CPU spikes, input p95 |
| `open-close-10x` | Ten open/close cycles of the same project | one run | no resource growth (RAM/goroutine first vs last) |
| `idle-5m` / `idle-15m` / `idle-30m` | Leave the app idle in the foreground, then hidden | one run each | CPU near zero, zero child processes left |

Frame drops and full input-to-render traces need the plan's profiling tools on
top of the recording: React Profiler and Chrome/WebView2 DevTools Performance
for the renderer, `pprof`/runtime trace for the Go backend, Windows Performance
Counters for OS-level CPU. Record their findings (P50/P95, sample counts)
alongside `baseline-report.json`; never mark a missing measurement as zero.

**Status (2026-10-15).** Recording, classification and reporting are implemented
and covered by unit tests (`internal/perf`, `scripts/perf-scenario-report.test.mjs`,
`frontend/src/lib/inputLatency.test.ts`), including a real child-process
recording. The native numbers themselves are collected by running the suite
above on the target machine; until then the per-component table stays empty and
the proposed budgets remain unvalidated.

## Proposed native budgets — awaiting controlled release baseline

| Indicator | Proposed target | Validation status |
| --- | --- | --- |
| Total idle CPU | Below 2% on the declared test machine | Pending |
| Idle RAM | Reduce 20% where measured waste exists | Pending; no absolute workspace cap |
| Startup | Lower P95 without restore/navigation regressions | Pending native cold/warm runs |
| Typing | P95 input-to-render below 50 ms | Pending React/WebView capture |
| File open | Lower P95 vs baseline | Backend fixture available; native pending |
| Open/close cycles | No persistent resource growth | Dedicated tests pass; native workflows pending |
| Children | No orphan after close | Job owner-crash test passes; full lifecycle pending |
| Functional regressions | Zero in covered workflows | Focused checks pass; native acceptance pending |

For the release baseline, record the build/commit, dirty state, hardware, OS,
power mode, tool versions and dataset sizes. Separate empty Hub, populated API
workspace, small/large IDE projects and 3–5 workspaces. Keep cold and warm
samples separate; collect per-process CPU/private RAM for the Go host, WebView,
gopls and children. Cover typing/completion/diagnostics, large files, rapid tab
switching, ten lifecycle cycles, and idle at 5/15/30 minutes. Report sample
count and P50/P95; do not mark missing measurements as zero or validate targets
from development microbenchmarks. Only stable startup size is a timing-related
CI budget; resource correctness tests remain ordinary functional checks.

## LSP incremental updates and process sharing

The backend negotiates `textDocumentSync` and sends a contiguous UTF-16 edit
for incremental servers, preserving Unicode and CRLF boundaries. The renderer
binding still sends a complete buffer to the backend; this change reduces
backend-to-server payloads, not the separate Monaco/store hot path. Replaceable
read requests are superseded by connection, URI and method; buffer changes and
closure cancel these reads through the existing `$/cancelRequest` transport.
Explicit rename, formatting and execution requests are excluded.

The 2026-10-15 evaluation retains one connection/process per language/session.
Two sessions may have different unsaved contents for the same URI. Root-path
deduplication with a refcount would merge overlays, diagnostics and settings.
The [official gopls daemon design](https://go.dev/gopls/daemon) instead keeps
separate client sessions/views while sharing a cache. Adopting it here requires
central daemon ownership (not a child owned by the first session's Windows Job
Object), SDK/environment/configuration compatibility, explicit-start protection,
last-consumer teardown and crash recovery tests. It is not enabled by default.
Measure multi-session memory/CPU savings before adding this lifecycle.

An opt-in test uses an already installed binary, without downloading tools:
set `ADOMNIA_TEST_GOPLS` to its absolute path and run
`go test -race ./internal/codestudio -run TestIncrementalWithInstalledGopls -count=1`.
It validates delta/reverse delta, restart replay and independent overlays on
the same workspace root. Desktop editing acceptance remains REF-2.M1 in
`mds/MANUAL-CHECK.md`.

## Central activity policy

`internal/activity` owns the backend state and release allowlist; the small
frontend activity store/tracker publishes transitions and visible workspace
scopes from every renderer. Wails derives the reporter identity from the calling
native window; closed windows are discarded against the native registry.
No heartbeat, stored preference or workspace-format change is introduced.

| State | Meaning |
| --- | --- |
| Active | Visible workspace with recent trusted input; any active native window wins |
| Background | Workspace is not visible in a renderer, or its window is hidden |
| Idle | Visible window with no trusted input for five minutes |
| Suspended | All tracked automatic resources for that inactive scope were actually released |

Suspended is backend resource state, not a claim the renderer can send. In split
view both panes are visible even though only one owns keyboard shortcuts.
Activity is distinct from ownership/focus, so the other visible pane is protected.
A reopened editor resumes its suspended language server through the existing
buffer replay path. Open/dirty editors and pending language-server requests
continue to block suspension. Explicit LSP start/restart remains pinned until
Stop/Close and survives automatic settings/toolchain restarts. Existing public
binding signatures remain; additive automatic entry points serve editor work.

The manager never cancels terminal, debug, request, recording, run, database,
broker, WS/SSE or unknown resource kinds. Only automatic, restorable language
servers are currently on the release allowlist. Existing module-specific timeouts
and reapers are not accelerated or replaced by the global idle policy.

The shared polling helper parks timers in Background/Suspended, slows ordinary
Idle status to at least 15 seconds, and stops decorative clocks in Idle. Live
status consumers for intentional work retain their cadence while visible; their
backend operations are never stopped by visibility. Runtime Lens observes the
same scopes and prevents overlapping resume polls. Secondary context analysis
waits until its workspace becomes Active. The Hub clock and resource sampler
pause in Idle and refresh on return; a game already playing retains intentional
simulation while existing blur/visibility behavior is preserved.

Tests exercise transitions, detached-window precedence, reporter cleanup,
protected resource kinds and actual LSP helper processes. Fake-clock checks
cover 30 minutes without decorative timer activity and 100 consecutive inputs
without extra RPC/store notifications. These are scheduling/correctness checks,
not native CPU measurements. A production Windows empty-Hub recording completed
on 2026-10-15: 369 samples over 1,840 seconds; first observed Idle at 305 seconds;
total CPU averaged 0.04% in the trailing minute at both 15 and 30 minutes.
The five-minute trailing window was still Active; it is reported as such.
Evidence, build hash and limitations are recorded in `mds/MANUAL-CHECK.md`,
REF-11.M1. Populated API/IDE datasets and intentional workloads across hidden,
split and detached windows still require acceptance, including interaction
resume. Do not infer a CPU percentage from the absence of timer callbacks.

Opt-in native scenario recordings include an `activity` snapshot (aggregate
state and workspace scopes) alongside process CPU/RAM. The scenario report
includes 5/15/30-minute checkpoints using the trailing minute at each elapsed
time, retaining mixed states such as Active/Idle at the five-minute transition.
Incomplete checkpoints are marked incomplete in JSON and omitted from the
Markdown table. Recordings made before activity instrumentation show Unknown;
low CPU alone never supplies an inferred idle state.


## Interactive resource diagnostics (2026-10-19)

The resource monitor now controls the backend Go GC budget live and saves/restarts gopls per selected Go project. It records CPU/RSS over time, shows observed parent PIDs and registered ownership, and exports JSON, per-process CSV, Markdown or standalone HTML with charts. Backend default: 512 MiB unless an explicit startup GOMEMLIMIT exists; gopls retains 768 MiB or its inherited value. These are soft GC budgets, not process RSS caps. Methodology, measured results and persistence compatibility: [resource diagnostics report](performance/resources-2026-10-19.md).

## gopls memory budget under continuous typing (2026-10-24)

The gopls budget stays at 768 MiB. Ten 10-minute typing runs (five per budget, large repository and a four-file module) measured both limits through the real `LSPManager`: 512 MiB saved 218 MiB of RSS but made completion four times slower (p50 444 ms versus 114 ms, p95 571 ms versus 173 ms) and used 7.6 times the CPU (3.50 versus 0.46 cores). On a small module the two budgets were indistinguishable and 512 MiB saved nothing, so the budget is not sized automatically per project. The resource monitor now offers both values as presets and states the measured cost. Data and method: [typing campaign](performance/typing-2026-10-24.md). What the ~7 s workspace load is made of: [gopls load profile](performance/gopls-load-2026-10-24.md).

## Background projects and CLI cold start (2026-10-25)

With three restored Code Studio sessions (one active Go project, two Java projects in the list but not visible), Eclipse JDT LS was pre-started for every Java session: two instances, 830 MiB of working set (1.55 GiB private), 40% of a 2,084 MiB process tree, for projects nobody was looking at. The pre-start now applies to the active session only and runs again on session switch; opening a Java file still starts the server. Same restore after the fix: 1,115 MiB across 10 processes.

`adomnia mcp` took p50 278 ms while the desktop app was open, against 65 ms published with the app closed: a package-level variable opened `adomnia.db` with a 250 ms lock timeout before the CLI dispatch, and a package `init` allocated a hidden console (50–190 ms, one extra `conhost.exe`) for the CLI too. Both now run only for the desktop app: p50 42 ms with the app closed, 39 ms with it open. Data: [runtime memory and CLI cold start](performance/runtime-2026-10-25.md).


## Native cold-start measurement (2026-10-22)

Method: `scripts/measure-startup.ps1` launches the built desktop executable with
an isolated `APPDATA`, so no developer settings or workspace are loaded. It waits
for `startup-performance.jsonl`, which the renderer writes after the first stable
frame and the backend records its stages, then terminates the process tree and
deletes the temporary profile. Each sample is a fresh process; the OS file cache
is not flushed, so this is a cold application start with a warm system cache, not
a disk-cold boot. Memory is the working set of the app process plus its direct
children (WebView2 and the HTTP sidecar).

Windows 11 (10.0.26300), amd64, current build at the time of the measurement
(3 samples, empty Hub). Raw samples:
[`docs/performance/startup-2026-10-22-windows.json`](performance/startup-2026-10-22-windows.json).

| Metric | Sample 1 | Sample 2 | Sample 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Start to first stable frame | 1,302 ms | 987 ms | 959 ms | **987 ms** |
| Backend `OnStartup` total | 20.2 ms | 43.5 ms | 41.5 ms | 41.5 ms |
| Peak tree working set up to first frame | 180.4 MB | 175.4 MB | 175.2 MB | **175.4 MB** |
| Tree working set, 2 s after first frame | 195.2 MB | 193.7 MB | 215.6 MB | 195.2 MB |

Renderer marks from the same samples: React mounted at 118�127 ms, bootstrap
settings loaded at 147�157 ms, workspace hydrated at 167�172 ms, first stable
frame at 320�357 ms after renderer entry. The process tree median is dominated by
WebView2 initialization and varies with the machine's WebView2 version.

macOS and Linux are **not measured yet**. Run the same script with PowerShell 7
(`pwsh -File scripts/measure-startup.ps1 -Exe ./build/bin/adomnia -Samples 3`) on
each platform, or an equivalent launcher that sets `APPDATA` to a temporary
directory and watches for `startup-performance.jsonl`. Report the same three
columns. Do not infer those numbers from the Windows run or from the browser
preview. Until they exist, the README does not publish native startup figures.

### What runs in `ServiceStartup`

| Service | Work at startup | Without activation |
| --- | --- | --- |
| `App` | Dev Log, bbolt storage, plugin manager, sidecar token, proxy rules/CA, local HTTP sidecar | Always starts: the app shell and local storage |
| `Copilot` | `manager.Start()` | Returns after setting `disabled`: no installer lookup, no language-server process |
| `Milk` | `manager.Start()` | Returns after setting `disabled`: no binary resolution, no `milk serve --acp` |
| `ClaudeCode` | `manager.Start()` | Same, using `claude-code.json`; no `claude-agent-acp` process |
| `OpenCode` | `manager.Start()` | Same, using `opencode.json`; no ACP process |

`internal/copilot/redaction_test.go` (`TestDisabledManagerDoesNotStart`) and
`internal/milk/redaction_test.go` (`TestDisabledAgentDoesNotResolveOrSpawn`)
guard the disabled path: `Start` returns before calling the resolver.

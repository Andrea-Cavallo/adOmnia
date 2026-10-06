# Changelog

All notable changes to adOmnia are documented here.

This project follows a pragmatic release log format inspired by Keep a Changelog. Versions are created from Git tags such as `v0.1.0`; GitHub Actions builds the Windows, Linux, and macOS artifacts automatically.

## [Unreleased]

### Added
- **Crash recovery responsiveness check:** an automated test measures recovery snapshots and restore with 10 dirty files on the real store (slowest snapshot ~13 ms locally and ~160 ms on the Linux CI runner, within a 500 ms budget below the 750 ms typing debounce; restore ~6 ms), alongside the real-kill test.
- **Context propagation across packages:** the Context Propagation Inspector's *Context graph* is now a drawn graph; its *Project* scope uses typed analysis to follow `context.Context` through calls between packages and lists every function that receives a context but passes `context.Background()`/`TODO()`/`WithoutCancel` on. In the debugger, a context carrying a trace/request id opens the Log Inspector on that id.
- **Architecture decisions:** *Tools → Architecture Decisions…* lists the Markdown ADRs in `docs/adr` and opens them in the editor.
- **Dependency report export:** the Dependency Graph exports a local JSON report with modules, edges, licenses, weight and duplicates, plus updates and vulnerability counts when you asked for them.
- **Trace tree and trace → debugger:** Observability orders spans parent → child with indentation; a structured trace opens a multi-service detail, and spans matching a live debug request open its Split Debug View.
- **WebSocket binary viewer:** binary frames show as Hex/ASCII with the decoded size (first 4 KiB); the original Base64 stays copyable.
- **Benchmark comparisons:** a benchmark result compares with a chosen baseline — the previous run, the measurements saved on main/master (picked automatically when you work on another branch), any earlier commit, or a run pinned as the baseline before a refactor. Runs with `-count=N` keep every repetition: the panel compares medians and runs a Mann-Whitney U test like benchstat, marking a change *significant* or *~ noise* (at least 4 runs per side). A configurable regression threshold (default 5%) highlights slowdowns; saved history records branch and commit, also in the CSV export.
- **Fuzzing Studio:** *View → Fuzzing Studio* lists the project's fuzz targets with their corpus — seeds and failing inputs in `testdata/fuzz` and the inputs Go generated in its cache — and shows each input's typed values. Fuzz with a chosen duration and number of workers, replay one input or the whole corpus, promote a generated input to a regression case, copy it as `f.Add(...)`, delete inputs. Finished runs are recorded with throughput and new coverage; crashes are grouped by failure message, with the minimized failing input one click away.
- **SQL outcome in Live Session:** SQL capture now reads the database's answers too: each statement shows its time, rows returned or affected and the error with its code; slow statements (≥ 100 ms), possible N+1 patterns (the same statement three or more times in a request), transactions with how long they stayed open, and hints for deadlocks, lock timeouts and cancelled statements. *Code* opens the line that runs the statement (from the Architecture Explorer analysis, or a search). pgx's cached prepared statements are now captured on every execution.
- **Data access in Architecture Explorer:** database/sql, sqlx, pgx and GORM calls with their SQL, tables, transactions and prepared statements; a table view shows which functions read or write each table and opens it, or the exact statement, in Database Studio.
- **REST routes understood from the code:** route detection follows group prefixes, resolves the handler behind each route (methods, closures, `http.HandlerFunc`, wrappers, handler factories), lists route and global middleware, and finds the request and response DTOs the handler decodes and writes; OpenAPI generation now includes request bodies, responses and component schemas built from the structs and their `json` tags. Frameworks are small adapters (net/http, chi, gin, echo, gorilla/mux, fiber, httprouter).
- **Route lenses:** *Mock*, *Copy cURL* and *OpenAPI* next to *Open in API Client* above every HTTP route in the editor.
- **Documentation:** *View → Documentation* shows every Go package as `go doc` would (types, functions, methods, notes, links to the source) and every `.proto` file's services, RPCs, messages and enums, with optional hints for undocumented exported symbols and a one-click `// Name ` stub. *Generate* writes `docs/API.md`, `docs/ARCHITECTURE.md` (with Mermaid diagrams), `docs/openapi.json` from the HTTP routes found in the code (opened in API Docs) and `docs/PROTO.md`, never overwriting a file without showing the change.
- **Mermaid diagrams in Markdown previews:** ` ```mermaid ` blocks render as diagrams in Go Studio and in the Markdown module (loaded only when a document has one); `file.go#L12` links in Go Studio's preview open that line.
- **Architecture Explorer:** *View → Architecture Explorer* builds, from the types and without running code, the import graph, the calls between packages, a call graph around any function, the module graph, and the list of entry points and services — `main`, HTTP routes, gRPC services, Kafka producers and consumers with their topics, DB repositories, scheduled jobs and CLI commands — each opening its code or the matching studio (API Client, gRPC client, Broker Studio, Database Studio).
- **Interface Explorer:** every interface with its implementations, near-implementations and their missing methods, who uses it and which methods callers really call, a consumers/implementations graph and gentle hints for interfaces that are too broad, implemented only once or declared on the producer side.
- **Error Handling Intelligence:** *View → Error Handling Intelligence* analyzes every module with full type information and groups problems by rule — ignored, discarded, unhandled and shadowed errors, `%v` instead of `%w`, `err.Error()` breaking the chain, `==` instead of `errors.Is`, type assertions instead of `errors.As`, invalid `errors.As` targets, errors returned without context, `panic` in library code, ineffective or swallowing `recover()`, `return nil, nil`. One-click fixes wrap with `%w`, switch to `errors.Is` and generate a contextual `fmt.Errorf`. Tabs list sentinel errors with their checks, error types with what they wrap, and each function's error paths.
- **Worker pool saturation:** the debugger's Concurrency view reports a saturated pool when every worker started by the same function (at least three) is busy at the pause while other goroutines wait to send on a channel, and selects the workers and the waiting producers.

### Changed
- **Go toolchain switching keeps code intelligence in sync:** choosing, installing or resetting a Go SDK re-detects it and restarts gopls; *Reload Go + gopls* and *Install latest stable* in the toolchain dialog, a gopls *Restart* and *Choose binary* in the tools list. Releases and installed SDKs are ordered by real version (go1.26 before go1.9), and a failed gopls install says so instead of staying silent.
- **SonarQube setup is clearer:** the panel says why a scan cannot start (not enabled, project not trusted, scanner missing, token missing), labels the fields as the SonarQube server and project key, and explains that the scan reads the local project, not the service's API URL. `sonar-scanner.bat` on the Windows PATH is detected.
- **Native Linux sessions and local GTK4 builds:** local builds now use GTK4/WebKitGTK 6 by default, while release packaging explicitly keeps GTK3/WebKitGTK 4.1. Linux follows the detected Wayland or X11 session without forcing XWayland; legacy `app-xwayland` settings remain compatible and load as app chrome.
- **Smoother code editing:** Go Studio enables Monaco inertial scrolling, smooth scrolling and smooth caret movement/blinking. Reduced-motion preferences are respected live. Font families, sizes, weights and ligatures are unchanged; font smoothing follows the platform, forced editor text-layer hints are disabled, and Monaco refreshes glyph measurements when local fonts finish loading.

### Fixed
- **API Workspace in its own window shows the collections:** opened from Go Studio's Studios launcher (or detached from the rail), the API Workspace window now has the collections sidebar next to request and response, with the same width and resize handle as the main window.
- **Settings save immediately:** settings no longer wait for the workspace autosave interval. Writes are serialized to preserve update order and save errors remain visible.
- **GTK4 window icon:** native windows explicitly select the embedded adOmnia icon from an in-memory GTK resource, without installing files in the user's profile. Linux's program name matches the packaged `adomnia.desktop` entry.

## [0.9.59] - 2026-10-04

### Added
- **Open modules in windows from the rail:** right-click a module in the rail menu → *Open in a new window* (or *Show window* when it is already detached), or Shift+click it. Detached modules show a window mark in the menu.
- **Studios launcher in Go Studio:** the grid button in the Go Studio toolbar lists API Workspace, Database Studio, Broker Studio, Mock Server, gRPC and Docker Lab; one click opens the studio in its own window beside the code, or brings it forward. It also works from a project that is already in its own window.
- **Links from the code follow the module's window:** *Open in API Client*, *Send request*, *Add to Mock Server*, the Project Services handoffs (Database Studio, Broker Studio, Docker Lab), entity handoffs (database, topics, gRPC, WebSocket) and *Open in Power Tools* run in the window where that module lives and bring it forward, instead of switching the main window. From a module window, *open in Go* returns to the main window's Go Studio. Importing a collection from the project writes it where the API workspace is open, so a detached workspace is never overwritten by a stale copy.

### Fixed
- **Module windows never lose or overwrite edits:** closing a module window (its X, *Bring back here*, or quitting adOmnia) first writes the edits still queued there, with a 3-second safety net for a frozen window. Closing the main window closes the module windows first instead of leaving adOmnia running with only a module window. While the API workspace is open in its own window, the other windows never write their copy of collections, tabs, environments and hosts, and re-read it when it comes back.
- **Handoffs to a module window:** a module window keeps its module selected even after startup restores the main window's last view, so database, broker, gRPC and WebSocket handoffs sent to it are delivered instead of timing out. Module and project windows no longer change where adOmnia reopens.
- **Links from a Go Studio project window:** *open in Go* from a project window opens the code in that window, and Git, plugins, Search Everywhere panels, Log Inspector and Mock links bring the right window forward.

## [0.9.58] - 2026-10-04

### Added
- **Any module in its own window:** the ⧉ button in a panel's header opens that module — API Workspace, Database Studio, Broker Studio, Mock Server, Docker Lab and the other studios — in its own native window, so code, API, database and messages can sit side by side or on separate monitors. One window edits a module at a time: while it is detached, the main window shows *Show window* and *Bring back here* instead of a second copy, pending saves are written before the window opens, and the main window re-reads the API workspace from disk when it comes back. Closing the window also brings the module back. The Hub, Settings and Go Studio stay in the main window (Go Studio projects already move with *File → Open Project in New Window*).
- **Start and stop the whole local environment:** *Run → Start Workspace* detects the project's Compose files and Go `main` packages, reuses or creates shared Compose Up and Package run configurations (with restart on save), groups them in a pinned "Start workspace" compound and starts it, asking for runtime secrets of every member first. Without a Compose stack or service it opens the compound for manual setup. *Run → Stop Workspace* stops every running process of the project, with a controlled Compose stop. Nothing starts without the command and a trusted project.
- **Colour-coded comments in Go Studio:** comment tags stand out in the editor like Better Comments — `TODO`/`HACK`/`XXX` in amber, `FIXME`/`BUG`/`!` in red and bold, `NOTE`/`INFO`/`?` in blue, `* important` in the accent colour and bold. It works for `//` comments and for `#` comments in YAML, shell, Makefile and Dockerfile, ignores `//` inside strings and `//go:` directives, follows the theme colours and updates as you type.
- **Security panel: offline code scan in Go Studio.** *View → Security* (or **Security** in the status bar) now has a *Code* view next to *Dependencies* (govulncheck). It finds hardcoded secrets and committed private keys (masked), disabled TLS verification and old TLS versions, weak crypto and short RSA keys, plain HTTP, SQL and shell commands built from strings, path traversal and zip slip, gob decoding of untrusted input, unbounded request bodies and world-writable permissions. Every suppression needs a written reason (panel or `// adomnia:security-ignore <rule>: <reason>`); a versionable baseline in `.adomnia/security.json` keeps legacy projects readable; *Copy for AI*, *Save .md* and *Ask Copilot* export the active findings. Secrets are generic for every language (`internal/ide/security`), Go rules live in the Go adapter.
- **Vulnerabilities panel in Go Studio (govulncheck):** *View → Vulnerabilities* (or **Vulns** in the status bar) scans the module on demand and ranks findings by reachability (called, imported, required only), with advisory details and aliases, found → fixed version, vulnerable symbols, up to five clickable call paths from your code to the vulnerable symbol (dependencies and stdlib open read-only), the module dependency path, an upgrade preview of the `go.mod` change with a confirmed `go get module@fixed`, and *Copy for AI* / *Save .md* / *Ask Copilot* Markdown export.
- **Profiles from a running service:** Performance Studio → **From service** downloads a profile from `/debug/pprof` of a service on this machine (goroutines, heap, allocations, CPU for 1–60 s, block, mutex, thread creation), checks that it is a real pprof and saves it in the project root, where it opens. Goroutine and thread-creation profiles were the two that `go test` cannot produce. Localhost only, no proxy, trusted projects only.
- **Call graph view:** Performance Studio draws the most expensive functions as a layered graph from callers to callees, with edge thickness by cost and colours by code origin. Recursion does not break the layout. Click highlights a function's calls; double-click opens its source.
- **Line cost in the editor:** the open profile marks hot source lines in the editor with a heat bar in the gutter, the cost and share at the end of the lines that matter (≥ 1%), and a hover with the profile name. **Cost in editor** turns it off.

### Changed
- **A cleaner Hub:** the Hub fits on one screen down to 1280×720 with the headline "Call it. cOde it. Ship it.", a language-neutral **cO Studio** card instead of the Go-only one, new key art in dark, light and sketch variants, and the generic `</>` icon for the studio in the rail.

### Fixed
- **Dependency Graph vulnerability scan always came back empty:** govulncheck `-json` prints a stream of JSON messages, which the old parser read as a single object and silently discarded. Both the Dependency Graph and the new panel now read the stream, verified against real govulncheck v1.8.0 output.

## [0.9.57] - 2026-10-03

### Added
- **Create a profile or a trace in one click:** Performance Studio has a **Create .pprof** button (CPU, Memory, Block or Mutex) and Go Trace a **Create trace.out** button. You pick one local package with tests (`.` or `./pkg`); gO Studio runs its tests with the matching flag on the trusted project, saves a new timestamped file in the project root (`cpu-….pprof`, `trace-….out`) and opens it as soon as the run ends, with a **Stop** button while it runs and a clear message if the package has no tests or they fail. Go Trace now also lists `trace-*.out` files.
- **Optional SonarQube in Go Studio:** *View → SonarQube* (or the **Sonar** button in the status bar) configures a SonarQube server (URL, project key, sources, exclusions) and runs `sonar-scanner` on the trusted project, then imports the open issues from the Web API. It is off until you enable it, and it respects adOmnia's **Offline mode** and corporate proxy/CA; the server URL is validated and normalized, and the scan is refused while offline or for an untrusted project. Issues are listed by severity with file:line navigation, security-only and text filters, and per-severity counts. After the scan it waits for the server to finish processing the report, so the issues shown are the new ones; **Refresh** reimports without rescanning. Works with SonarQube 9.9 LTA, 10.x (including the new HIGH/MEDIUM/LOW severities) and SonarCloud, and its calls are listed under *Settings → Network & Privacy*. A **Copy problems** button copies every shown finding as `file:line [SEVERITY rule] message` (most severe first), **Resolve with AI** sends them grouped per file to the connected AI in adOmnia's preview-before-apply fix flow, and a **baseline** (`.adomnia/sonar-baseline.json`, keyed by rule/file/message so it survives code moving) hides the existing debt so only new problems appear. The SonarQube token is kept in memory for the session only — never persisted, never sent back to the UI — and no process starts without the project being trusted.

### Changed
- **IDE platform, phases 1–12 complete:** shared language registry, project units, SDK plumbing, language-server lifecycle, Run/Test and DAP live behind the language-neutral IDE core and the Go adapter. Existing `GoIDE` service names, settings, workspaces and saved configurations remain compatible. See [the migration plan](docs/architecture/ide-multilanguage-refactor.md).
- **Language contributions in the UI (phase 10):** the backend now reports its registered languages and their capabilities. The frontend describes each language in `components/ide/languages/<id>/` (icon, menu, commands, editor languages). The Go menu commands require the Go language, the menu bar builds language menus from the contributions, and editor intelligence (completion, hover, navigation, formatting, semantic highlighting, inlay hints, code vision) registers on the contributed editor languages instead of a hard-coded `go`. The status bar shows the active file's language icon, and the language-server status of one language no longer overwrites another's in the same project.
- **Language icons:** the project tree shows Simple Icons brand marks for Java, Kotlin, PHP, Ruby, .NET, C, C++, Swift, Dart, Scala, Elixir, Haskell, Lua and Zig sources, and for Maven and Gradle build files.
- **Project model without Go fields (phase 11):** `project.goModPath`, `goWorkPath`, `modules` and `looseGoDirs` are no longer part of the project returned to the UI. Go modules, `go.work` and loose folders are derived from the language units, and sessions saved by older versions are re-inspected on restore. Pure helpers used by the stores moved from `components/goide` to `lib/goide`.
- **Run/Test orchestration (phase 8):** the core owns test lifecycle, bounded history, result snapshots and progress/final events, plus pre/post tasks, compound runs, environment files, port checks and generic command/Make/Docker workflows. Go-specific flags, test2json, race reports and source mapping belong to the Go adapter. Saved opaque language options reach the runner unchanged; other language adapters and generic commands can run without a Go SDK. Existing flat Go fields remain supported for the current frontend.
- **DAP/Delve extraction (phase 9):** the core owns debugger sessions, breakpoints and DAP operations, with stdio, TCP startup and remote connections. The Go adapter supplies Delve launch/attach settings, error handling and runtime extensions for goroutines, defers, memory and registers.
- **Run tool window icon:** the Run stripe uses the Play icon, so it no longer looks like the Terminal one.
- **Dependencies updated:** Wails v3.0.0-beta.26 (bindings regenerated), xterm.js 6 with the matching fit/search add-ons, Monaco 0.57, lucide-react, Vite and Vitest patches; Go modules fsnotify 1.10.1, IBM/sarama 1.61.1 and modernc.org/sqlite 1.60.1.
- **Performance Studio and Go trace charts redesigned:** one validated palette (colour-blind safe, light and dark) colours every function by origin (your code, dependencies, standard library, Go runtime) across Top functions, flame graph and Callers. The flame graph renders at real pixel size (no stretched text), zooms on click, dims search misses and shows a hover tooltip; root stacks no longer overlap. Callers is a caller → function → callee view, Diff uses a diverging bar with ▲/▼ arrows, and view tabs are a segmented control. The trace timeline has a time axis, a GC/stop-the-world lane and bands, state encoded by colour and thickness, hover tooltips, stat tiles and per-goroutine time mix.
- **Performance reports for AI:** Performance Studio and Go Trace export the current view as Markdown written for an AI assistant (context, glossary, summary, top functions, hot paths, call edges, hot lines, profile diff; trace state breakdown, GC/STW, P utilization, longest blocking, long-running goroutines, scheduler latency, runtime events). *Copy for AI*, *Save .md* or *Ask Copilot*, which opens Copilot with the report in the message box for review. Source locations are project-relative or file names only, never absolute machine paths.

### Fixed
- **Run/Test edge cases:** fast test runs receive their ID before completion is published; trailing test output without a newline is parsed; returned snapshots do not share mutable timestamps or source locations with stored results. Concurrent Docker build/container callbacks preserve separate Rerun requests. Opaque Go options apply race, profiling, target-platform settings and real test coverage, and opaque test package paths remain confined to the project.
- **Language-server startup and workspace symbols:** server specifications carry startup arguments; workspace-symbol requests run independently across servers, preserving healthy results when another server times out.
- **Context menus near the left edge stay on screen:** a menu anchored on its right side (such as the terminal shell picker) is now always kept inside the window instead of opening partly off-screen to the left.

## [0.9.56] - 2026-10-02

### Added
- **Go execution trace viewer in Go Studio:** *View → Go Trace* (or the **Trace** button in the status bar) finds the `trace.out` / `*.trace` files a test run writes with the Execution trace (`-trace`) profiling option and reads them locally with Go's own trace parser — no `go tool trace`, no external process. It shows a **goroutine timeline** (running, runnable, waiting and syscall spans per goroutine), **scheduler activity** per P, **GC/STW ranges**, **blocking by category** (network, synchronization, GC, sleep) and **long-running or still-live goroutines**, plus a **runtime events** list (logs, tasks, regions). Clicking a span, an event or a goroutine opens the corresponding source frame, project files in the editor and standard-library files read-only. A filter narrows the timeline by goroutine id or starting function.
- **Images open in Go Studio:** clicking a `.png`, `.jpg`, `.gif`, `.webp`, `.bmp`, `.ico`, `.avif` or `.svg` in the Project tree no longer fails with *"not a UTF-8 text document"*. Images open read-only in a dedicated preview tab with zoom, fit-to-window and a dimensions readout, and are never sent to gopls or the code integrations. The same mechanism resolves **local images in the Markdown preview** (`![](relative/path.png)`), which previously showed as broken because a `file://` URL is not readable inside the WebView; the backend reads the image from the project and hands the preview a data URL.
- **Visible language-server activity and force reload:** starting, restarting or crashing gopls now always shows a small activity panel in the bottom-right of Go Studio with a spinner, the elapsed time, the indexing message and percentage, and buttons to **force reload gopls** or open its log. A crash keeps the panel visible with the error and the force-reload action, so a slow reload never looks like nothing happened. Starting or restarting gopls sets this state immediately, before the backend answers.
- **Performance Studio (pprof) in Go Studio:** the profiles a test run writes with `-cpuprofile`, `-memprofile`, `-blockprofile` or `-mutexprofile` are no longer just files on disk. *View → Performance Studio* (Alt+0), the **Profile** button in the status bar or the command palette lists every `*.pprof` found under the project (newest first, `.git` and `node_modules` skipped) and opens it in a tool window. The profile is read **locally** with the same parser as `go tool pprof` (`github.com/google/pprof`) — no process is started, no data leaves the machine. Views: **Top functions** with *Flat*/*Cumulative*, value bars, share of the total, *Group by package*, *Hide runtime* (drops `runtime.*` and Go SDK frames) and a function search; a real **flame graph** whose frame widths come from the sample stacks, with a *Flame*/*Icicle* toggle and per-frame value and percentage; **callers and callees** for a selected function (or the heaviest edges); a **sample-type selector** so a memory profile reads `alloc_objects`/`alloc_space` and `inuse_objects`/`inuse_space` separately; and a **diff** against a second profile showing base, target, delta and percentage per function, heaviest changes first. Every function with a `.go` frame opens its source — project files in the editor, standard-library files read-only. Reports are computed in Go (top, flame tree, call edges and cost per source line), so the UI never parses the raw profile. The execution trace (`-trace`) has its own viewer (see *Go execution trace viewer* above).
- **Local replaces in go.mod handled for you:** saving a go.mod in Go Studio that has `replace M => ../path` comments out any other replace of the same module (marked `// adomnia-off:`), because Go refuses two; removing the local replace and saving brings it back. The commit dialog warns when a go.mod you commit has a local replace, and every push from adOmnia (Git Sync, Git Actions, account push, force push) asks for confirmation when the commits being pushed contain one, since that path exists only on your machine.
- **Commit dialog shows the real changes:** the Go Studio commit dialog is now a large two-pane window: the changed files on the left (checkbox to include, click to inspect) and, on the right, the diff of the selected file between HEAD and what will be committed (unsaved editor text included), side by side or unified, with unchanged regions folded. Binary and very large files say so instead of showing nothing.
- **Shell picker next to the terminal tabs:** *+* and the shell menu (PowerShell, Command Prompt, Git Bash, WSL…) now sit right after the terminal tabs, so they stay visible even in a narrow panel.
- **Move Symbol to Package in Go Studio:** *Code → Move Symbol to Package…* moves a top-level func, var, const or type (with its methods) to another package of the module, new or existing. Every reference and import is rewritten across the module, including tests; moves that need unexported names, would create an import cycle or clash with an existing name are refused with the reason, and the affected packages are compiled with the changes in an overlay before the preview opens, so a move that would break the build never reaches your files.
- **Pending deferred calls from the runtime:** *Deferred calls* in the debugger now reads the goroutine's real defer chain (`runtime.curg._defer`): only defers that actually ran, across every frame, in the order they will execute, each with its `defer` line, function and one-click navigation. Debug builds disable open-coded defers, so the chain is complete; when the runtime is not readable it falls back to the source candidates.
- **Where a goroutine was created:** the goroutine detail in the debugger shows *Created at*, the exact `go` statement read from the runtime (`runtime.curg.gopc`) and opened with one click, plus the goroutine that ran it (*by goroutine #N*, selectable).
- **Total coverage against the base branch:** the Patch coverage view gets *Compare total with <base>*: Go Studio runs the same packages' tests on the merge-base in a temporary Git worktree (your working tree is untouched, the worktree is removed afterwards) and shows both totals with the delta in points, packages that are new in the branch and a warning when tests fail on the base.

### Fixed
- **Performance Studio accuracy:** inlined calls are expanded into their own frames (as `go tool pprof` does), so inlined callers appear in the flame graph, the cumulative column and callers/callees instead of vanishing; a function that shows up more than once in a stack (inlined copies, recursion) is counted once per sample in *Cumulative*; the Top list keeps the leaders of every sample type, so switching a memory profile to `alloc_space` no longer hides the functions that allocate most; and *Diff* only compares the same sample type (CPU with CPU, `inuse_space` with `inuse_space`), saying so when the second profile has a different kind.
- **macOS CI:** the disaster-recovery test no longer expects `\` to be a path separator on macOS; the recovery tests are green on Windows, macOS and Linux.

## [0.9.55] - 2026-10-02

### Added
- **Network & privacy for all of adOmnia (Settings → Privacy & Data):** one **Offline mode** switch blocks every connection adOmnia opens by itself to a non-local host — AI cloud providers, Copilot, update check, vulnerability database (govulncheck and gopls vulncheck), Go toolchain and module downloads (forces `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`), Git host APIs — while local models and the requests you send from the API client keep working. A single **corporate proxy** (with NO_PROXY) and **CA bundle** apply to the API client, AI providers, Copilot, Git and the Go toolchain (project values still win). A **Network activity** log lists, in memory only, every connection adOmnia opened or blocked (category, host, path without query, status). adOmnia states plainly that it has no telemetry.
- **Private Go modules in Go Studio:** per-host credentials for GOPRIVATE hosts and the internal registry are handed to the Git credential manager (never stored by adOmnia, the token never comes back to the UI); a switch sets `GOAUTH=netrc;git …` so `go` reads them, and **Test module registry** probes the saved GOPROXY with proxy, CA and credentials and explains auth, TLS and proxy failures.

### Removed
- **Minimap in Go Studio:** the editor minimap, its View menu toggle and its setting are gone; saved preferences drop the old key.

## [0.9.54] - 2026-10-02

### Added
- **Flaky Test Detector in Go Studio:** the Tests panel reruns a test or the whole run ×10/20/50/100 in random order (`-count=N -shuffle=on`), counts passes and failures per test, marks flaky tests with a badge and a filter, shows failure rate and min/avg/max duration, and replays the exact order with the printed `-shuffle` seed. A flaky test lists possible causes read from its output (data race, deadlock, timing, port conflict, external service, channel or map misuse, test order) and offers a rerun with `-race` or a GOMAXPROCS correlation (`-cpu=1,2,4,8`) that shows the failure rate per value and whether failures follow parallelism. Tests found flaky are remembered per project on this machine (names and counts only): later runs mark them *was flaky* and include them in the flaky filter until the history is cleared. The copy button in a test's detail copies the `go test` command that reproduces it (filter, `-count`, the printed `-shuffle` seed, `-race`, tags and working directory).
- **Line history in Go Studio:** *Git → Show History for Selection…* lists only the commits that changed the selected lines (`git log -L`), each diffed against the current editor.
- **Test affected code:** *Run → Test Changed and Dependent Packages* runs `go test` on the packages with modified, staged or new Go files plus every package of the module that imports them (transitively, or only from its tests), one run per module.
- **Lint changed files only:** *Code → Run Linter on Changed Files* runs golangci-lint or staticcheck only on the packages of modified, staged or new Go files and reports only those files; the status bar says "in changed files".
- **Faster Find in Files on large repositories:** files are read in parallel and skipped without line scanning when they cannot match; on a 40-module, 4,000-file monorepo the search goes from about 3 s to 0.5 s on Windows. A scale test now measures project open, Quick Open and search on that monorepo (with `node_modules` noise) and fails on regressions.
- **Workspace module graph:** in a multi-module project or `go.work`, *Module Dependencies* has a *Workspace modules* view: which project modules each module requires (with local `replace`), which modules use it, read from the go.mod files without running Go.
- **Per-project AI access:** *Tools → AI for This Project* sets any provider, local models only (Ollama or a localhost endpoint) or off, saved in `.adomnia/ai-policy.json` to commit with the project. Fix with AI and Copilot honour it, on top of the built-in secret patterns and `.adomnia/aiignore`; the settings report includes it.
- **Settings report for privacy and audit:** *Tools → Export Settings Report* saves a stable JSON of what Go Studio may contact and how: trust state, project/global toolchain environment and network mode, AI provider, model, credential mode and gateway, linter. Keys, tokens, passwords and credentials in URLs are redacted, and home paths are left out.
- **Corporate proxy and CA for Go and Git:** the toolchain settings write a corporate proxy (`HTTPS_PROXY`/`HTTP_PROXY`, validated), `NO_PROXY` and a PEM CA bundle (`GIT_SSL_CAINFO`, `SSL_CERT_FILE`) for go, git and gopls, per project or as global default; a proxy password stays in memory only.
- **Offline and air-gapped Go toolchain:** the toolchain settings have a *Network* switch: *Offline* sets `GOPROXY=off` and `GOTOOLCHAIN=local` (only the module cache and `vendor/`), *Air-gapped* also sets `GOSUMDB=off`; *Online* removes those values and keeps every other setting.
- **GOPRIVATE UX:** the toolchain settings validate GOPRIVATE/GONOPROXY/GONOSUMDB (no URLs, credentials, spaces or empty entries, save blocked until fixed), explain what GOPRIVATE does and suggest a pattern from the project's module path.
- **Patch coverage:** the coverage summary's *Patch* view shows, as a pull request would, the coverage of the Go lines changed since the merge base with a chosen branch (local changes included), file by file with the uncovered changed lines.
- **Branch insights from coverage:** the coverage summary's *Branches* view lists `if`, `else`, `case`, `default` and `select` branches whose condition ran but whose body never did, out of all evaluated branches, each opening its line.
- **Coverage by function:** the coverage summary in the Tests panel has a *Functions* view (like `go tool cover -func`) listing every function and method from the least covered, each opening its declaration.
- **Changed symbols in the commit dialog:** Go Studio's commit dialog summarises the functions, methods, types, constants and variables added (+), modified (~) or removed (−) since HEAD in the checked files, with exported and test counts, *breaking* marks on exported symbols that were removed or changed signature (parameter renames excluded), the HTTP/gRPC handlers and the database or broker code they touch (read from the source), a jump to each declaration and a *Test changed packages* shortcut.
- **Pre-commit checks:** before committing, Go Studio saves, lints the changed files and stops if the checked files have gopls errors or lint warnings, offering *Show Problems* or *Commit anyway* (the check can be turned off in the dialog).
- **Disassembly and registers in the debugger:** a paused frame's *Disassemble* shows the machine instructions around the current one (Delve `disassemble`), grouped by Go line with the current instruction marked; the CPU button in *Variables* adds a *Registers* scope to every frame.
- **Memory view in the debugger:** the *Memory* card reads 64 B–1 KB of the paused process from an address (`0x…`) or from the address of an expression such as `&buf[0]`, shown as a hex dump with ASCII; unreadable memory stops the dump with a clear message.
- **Code quality and debt trend:** *Code → Code Quality…* shows gopls/lint errors, lint findings (with the baseline), last coverage and known flaky tests, the top rules and files, and the technical-debt trend of full lint runs (visible + baseline findings) recorded per project on this machine.
- **Custom analyzers as linter:** any binary set in *Go Tool Paths → Linter* that is not golangci-lint or staticcheck runs as `<binary> ./...` and its `file.go:line[:column]: message` output (go vet and `go/analysis` single/multichecker style) appears in Problems, with lint on save, changed-files lint and baseline.
- **Project linter settings:** *Code → Linter Configuration for This Project* opens `.golangci.yml` or `staticcheck.conf`; when the project has none it offers to create a minimal one for the detected linter (golangci-lint v1/v2 or staticcheck).
- **Lint baseline:** *Code → Save Lint Baseline* records every current golangci-lint/staticcheck finding in `.adomnia/lint-baseline.json` (by file, linter and message, so moved code stays hidden); later runs show only new findings and the status bar counts the hidden ones. Commit the file to share it; *Remove Lint Baseline* shows everything again.

### Changed
- **Go Studio project tree:** folders use a Finder-style icon (two-tone Apple blue, front panel tilted when open) in light and dark themes.
- **Grouped Structure panel:** symbols are grouped into Constants, Variables, Types, Functions and Methods with counts; methods sit under their receiver type after the fields, functions show parameters and result, fields and constants their type or value, with GoLand-style letter badges (also in breadcrumb and searches).
- **Minimap on by default:** the editor minimap is on (one-shot migration of saved preferences), fills the editor height with readable blocks and a soft view slider, and the inspection widget no longer covers it.
- **Cleaner Go Studio header:** a larger adOmnia logo, the project shown with the Finder folder instead of initials, and a tidier branch widget.

## [0.9.53] - 2026-10-02

### Added
- **Context Propagation Inspector in Go Studio:** *View → Context Propagation Inspector* (Alt+9) analyses `context.Context` flow in the current file, offline and on unsaved buffers, with editor markers: `Background()`/`TODO()` inside call chains, missing or too-wide timeouts, context stored in structs, leaked `cancel` funcs, ignored cancellation, broken chains and trace-ID propagation.

### Fixed
- **gopls startup error:** opening a file while gopls was starting no longer shows "Error loading workspace folders … addView called before server initialized"; documents are sent only after the initialize handshake.
- **System title bar hidden by default (Windows/macOS):** Settings v13 migrates a saved *System* choice back to the app title bar once; detached Go Studio windows are frameless and use the Go Studio toolbar as their window bar.
- **Hub fits on one screen:** the hero and the studio cards share the viewport height, so all six studios are visible without scrolling.

## [0.9.52] - 2026-10-02

### Added
- **Readable, colour-coded logs:** the Go Studio Run console colours each line by its log level (log, slog text/JSON, zap, zerolog, logrus), dims timestamps and highlights the level token; stderr is no longer red by default, since Go's `log` package writes there — compile errors and panics still are. Console and integrated terminal use the bundled JetBrains Mono (13 px terminal, re-measured once the font loads). Log Inspector colours messages by level and marks error/warning rows.
- **go.mod editor in Go Studio:** the Dependencies dialog has a *go.mod* tab to change module path, Go version and toolchain, add or remove `exclude` and `retract` directives, and preview `go mod tidy -diff` without touching files. Each requirement can list its published versions (*Versions*) to upgrade or downgrade to a specific one. Every change runs `go mod edit`/`go get` after confirmation.
- **Apply part of a change:** the Go Studio change preview (AI fixes, multi-file refactorings) has a checkbox per file and per change block; *Apply selected* applies only what is ticked, recomputing each file from its original text.
- **AI privacy in Go Studio:** *Fix with AI* and *Resolve all with AI* honour `.adomnia/aiignore` and the built-in secret list (`.env`, keys, certificates): excluded files are never sent, not even as package context. Secrets inside code (cloud/API tokens, JWTs, PEM keys, connection-string passwords, string literals assigned to password/secret/token names) are replaced with placeholders before sending and put back into the proposed change. Git commit analysis and AI pull-request drafts send redacted diffs.
- **Per-workspace crash recovery store:** Go Studio keeps unsaved buffers under one `recovery/<workspace-id>` entry per project in the local adOmnia store (never inside the repository); each snapshot rewrites only the project being edited, and the previous single store migrates automatically on first start. Disaster-recovery tests (real process kill during snapshot writes, 10 dirty files) now run in CI on Windows, macOS and Linux.
- **Quick model switch in chat:** Copilot Chat lists the models available to the signed-in account and switches by starting a clean conversation; AI di a0 switches from its own header, verifies the selected model first, and keeps the current model if verification fails. Custom a0 model IDs remain supported without opening Settings.
- **Database/Broker workspace recovery:** Database Studio restores query tabs, active query and limits; Broker Studio now also restores the active protocol, saved profile and Kafka resource tab. Only local metadata and Vault-safe profile references are persisted; brokers are never connected automatically.

### Fixed
- **Debugger error chain:** *Resolve wrapped errors* now reads `fmt.Errorf` wrappers directly (`*fmt.wrapError`), so it also works when the program never calls `Unwrap()` and the linker removed it; other error types still call `Unwrap()`.
- **Tool versions cached:** gopls, Delve and linter versions are read once per binary (size + date) and remembered across restarts; terminal shells (`wsl -l -q`) are re-detected at most every 5 minutes.

### Changed
- **Cleaner window and Hub:** the system title bar is hidden by default and the Hub fits on one screen.

### Verified
- TypeScript passes; 218 frontend test files / 949 tests pass; the startup bundle budget passes.
- `go vet ./...` and `go test ./...` pass; the Windows Wails 3 production pipeline builds a GUI `adomnia.exe` with the embedded icon.

## [0.9.51] - 2026-10-01

### Fixed
- **Go Studio on corporate PCs (VPN/proxy):** SDK detection no longer runs `go version`/`go env` inside the project, where a newer `toolchain` directive made Go try to download it through GOPROXY (21 s measured, then "Go not found" after the 8 s timeout). Go is now available in milliseconds (VERSION file), `go env` completes in the background, results are cached across restarts and timings are logged per phase.
- **No silent toolchain downloads:** processes get `GOTOOLCHAIN=local` unless the user chose otherwise; tool installs pick a version compatible with the selected SDK.
- **Hub artwork in light mode:** the a0 scene now selects the light asset directly instead of relying on competing global CSS selectors, so the illustration remains visible after changing theme.
- **Recovery test hygiene:** background buffer-recovery notifications are DOM-safe, eliminating headless test-suite unhandled rejections.
- **Frontend dependency advisories:** DOMPurify and `fast-uri` are updated to patched releases; `npm audit --omit=dev` reports zero vulnerabilities.

### Added
- **Copilot chat identity:** the chat header shows provider (GitHub Copilot / GitHub Enterprise), host, account and the model actually used, or "Model: managed by GitHub Copilot".
- **Claude Code settings:** the Anthropic and Bedrock providers read `~/.claude/settings.json` and the workspace `.claude/settings(.local).json` (API key/auth token, base URL gateway, model, custom headers, proxy), cached by file date; AI settings list the detected files and variable names, never values.
- **Change Signature in Go Studio:** *Code → Change Signature…* (Ctrl+F6) reorders or removes parameters; gopls rewrites the declaration and every call in one previewed change.
- **Merge editor in Go Studio:** *Git → Resolve Conflicts…* opens the three-way conflict editor without leaving the IDE; each conflict block now has *Ours*, *Theirs*, *Both* and *Base* buttons (also in Git Studio), with a live count of conflicts left.
- **Crash recovery follows a moved project:** unsaved-buffer snapshots of a project whose folder was moved or renamed are offered again when it is opened at the new location (matched by its `go.mod` module path, only if the old folder is gone).
- **Go Studio terminals come back:** reopening a project reopens its terminals with the same name, shell and folder (relative to the project, so a moved project still works); only metadata is saved, never output or processes, and the shells start only on a trusted project when the Terminal tab opens.
- **Dependency Graph in Go Studio:** *Tools → Dependency Graph…* shows the module dependency tree (direct → transitive), duplicate transitive dependencies with who requires each version, per-module license, estimated weight and package-count impact, plus **unused** and **indirect** indicators. **Check updates** reports the latest available version (`go list -m -u`) and **Scan vulnerabilities** runs `govulncheck` on demand; both need the network, while the graph itself is computed offline.
- **Runtime Enrichment in Go Studio:** *Tools → Runtime Enrichment…* overlays the Live Development Session telemetry on the static picture — components actually exercised (routes, source files, datasources, broker topics), call frequency, average and max latency, error counts, dynamic edges (request → file / query / topic) and runtime-only integrations. With a module selected it also flags the static dependencies that never appeared at runtime.

### Changed
- **Fast IDE appearance switch:** Go Studio's bottom status bar now exposes dedicated Light and Dark buttons.
- **Apple-inspired light skin:** cool-white chrome, brighter editor islands, subtle blue-grey borders, larger radii and softer elevation match the supplied macOS-style IDE reference while preserving adOmnia's accent and readable code colors.

### Verified
- TypeScript passes; 215 frontend test files / 924 tests pass; the production Vite build passes.
- `go build ./...`, `go test ./...`, focused Go Studio/theme/runtime tests and the Windows Wails 3 production pipeline pass for version 0.9.51.
- `npm audit --omit=dev` reports zero vulnerabilities.

## [0.9.50] - 2026-10-01

### Added
- **Copilot Ask Chat in Go Studio:** a per-project streaming chat backed by the official Copilot Language Server. Each message can carry the current file, the live Monaco selection and a bounded, secret-filtered workspace-manifest context. Replies stream into the pane; **Stop** cancels the active JSON-RPC request and **New Chat** destroys the server conversation. The built-in secret exclusions and `.adomnia/aiignore` are enforced before context reaches the language server, and chat history is session-only.
- **Extra Go Tools:** *Go → Toolchains* now detects, installs and runs **govulncheck**, **goimports**, **mockgen** and **stringer**, plus any user-defined tool (binary name, optional `module@version`). Tools are found in adOmnia's tools folder, `GOBIN`, `GOPATH/bin` or the `PATH`; **Install…** runs `go install` with the project SDK after confirmation, **Run…** runs the tool with structured arguments in a project folder (no shell) and streams output to the Run console.
- **AI di a0 tool window:** the provider-configured a0 assistant now lives in the same closable right tool window as Structure and Project — a separate choice from Copilot — instead of the former global floating launcher and popup.

### Changed
- **Unified Settings dialog** (*File → Settings…*, Ctrl+Alt+S) gathers every Go Studio preference in one searchable dialog, with links to keymap, toolchains, tool paths and Copilot.
- **Right assistant tool window:** Copilot and AI di a0 are separate stripe choices in the same closable column; each button opens or closes it.

### Fixed
- **Copilot lifecycle hardening:** workspace notifications are gated on server initialization; Copilot starts only with an active project; one active workspace per account/project; and chat resolves a valid model via `copilot/models` (`{}`) before the first turn, so an empty model cache no longer mislabels or drops chat.

## [0.9.49] - 2026-09-30

### Added
- **GitHub Copilot in Go Studio:** official Copilot Language Server (SHA-512 verified install), GitHub.com / Enterprise Cloud / Enterprise Server accounts, ghost text, proxy and company CA, secrets and `.adomnia/aiignore` never sent. Off until enabled.
- **Go Studio terminal:** rename (double-click), split view, Ctrl+click on `file.go:line` and stack-trace frames, Ctrl+F search, copy clean output, clear, per-project command history (secrets never stored, no auto-run) and *Run in Test Explorer* for a typed `go test …`.
- **Low-Resource Mode** and **Low-Resource Mode on Battery** in Go Studio's View menu, with a status-bar badge.
- **Runtime Inspector** in the debugger (slices, maps, channels, interfaces, context, error chain), STATIC lifecycle hints from *Inspect source*, persisted race sources with a regression-test starter.
- **Benchmark Studio:** single or package benchmarks with `-benchmem`, metrics, local history, comparison with the previous run and CSV export; Test Explorer search and filters.
- **Live Development Session:** a Go service started from Go Studio (Run or Debug) is shared by every tool. A debug bar in every tool shows the service, port, paused location and Continue / Step / Stop (F9, F8, F7, Shift+F8, Ctrl+F2). **Debug Request** starts or reuses the service under Delve, waits for its port or health path, sends the request and shows PAUSED AT BREAKPOINT with Open in Go Studio; the response waits for the debugger. See [docs/LIVE-SESSION.md](docs/LIVE-SESSION.md).
- **Request ↔ code:** `{{service:name}}` linked requests with Local / Docker / remote targets; the handler that serves a request (with contract drift against the service's OpenAPI); handler CodeLens in Go Studio (open, run, debug request, last response, history); a Request tab in the Go Studio debugger.
- **What a request caused:** Logs, Debug, Timeline, DB and Kafka views of each request, tied by `X-AdOmnia-Request-ID` or by time; SQL from the service's logs or an opt-in loopback capture proxy (Postgres, MySQL); a Kafka watch without consumer group; service logs as a Log Inspector live source; *Mock this response*.
- **Navigation without losing context:** Go Studio and the API Workspace stay mounted across tool switches; Split Debug View; Ctrl+Tab context switcher; Alt+Shift+1…5 tool keys; palette commands. Interceptor and Browser Debug requests to a live service join its session.

### Changed
- **No separate title bar:** with the integrated window chrome the panel header is the window bar (drag, double-click to maximize, window controls at the right); the app titlebar is the default on Windows and macOS from the first launch.
- gopls diagnostics are coalesced (one update per file every 150 ms, max 1000 per file); the Run console draws the last 5000 lines; large Project folders load in pages of 500.

## [0.9.48] - 2026-09-30

### Added
- **Go Studio Project refresh:** *Reload from Disk* always reads the selected
  file again and asks before discarding unsaved text. *Refresh Folder* and
  *Refresh Project* reload the cached tree branch while preserving dirty tabs
  for Reload / Keep / Compare.
- **IDE-grade Project context actions:** Go files now expose Find Usages,
  Inspect Code, Refactor This, Move to New File, Bookmarks, Reformat, Optimize
  Imports, Run and Debug from the project tree; folders and non-Go files retain
  only actions that apply to them.

### Changed
- **gO rail entry:** the Go Studio launcher uses a compact, transparent cyan
  gO mark and retains the focused left-side active indicator instead of adding
  an intrusive tile around the icon.
- **README:** the Go Studio section now introduces the current IDE screenshot,
  showing the project view, editor actions and Run console in the local desktop
  workspace.

### Removed
- **Brick Workshop skin:** the LEGO-inspired theme, Hub artwork, settings
  entries, translations, built-in theme metadata and obsolete release mentions
  have been removed completely. Existing users fall back to the normal theme
  choices without a workspace migration.

### Verified
- 17 focused frontend tests covering the compact rail, the Project context menu
  and Go Studio disk refresh pass.
- TypeScript, the production frontend build, `go test ./...` and the Windows
  Wails `build.ps1 -Version 0.9.48` pipeline pass.
- Browser smoke check: the compact gO rail entry is visible in the Hub and
  opens Go Studio directly.

Full release notes: [v0.9.48](docs/releases/v0.9.48.md).

## [0.9.42] - 2026-09-29

### Fixed
- Go sources and test fixtures stay LF on Windows (`.gitattributes`), which fixes a Go Studio refactoring test that failed on Windows whenever gopls was installed.

### Added
- **Concurrency View (Go Studio debugger):** goroutine filters and grouping by identical stack; relation chips (channel, mutex/RWMutex, WaitGroup, context, network, database, timer); new diagnostics for channels without consumer or producer, RWMutex contention, a WaitGroup that can never reach zero and excessive goroutine counts; OBSERVED / CONFIRMED evidence badges; a goroutine timeline across pauses; copy snapshot as JSON.
- **Race Detector UX:** *Run with Race Detector* for the active run configuration; races compared across runs (new, recurring, gone), duplicates counted, accesses marked earlier and later.
- **Project tree decorations:** file names coloured by Git status, gopls errors and warnings underlined, a dot on files with failed tests; folders inherit the most important mark. Kubernetes, SQL, proto and script icons.
- **go.work management and Clone Repository** in Go Studio, with a hardened `git clone`.
- **Vulnerability diagnostics in Go Studio:** opt-in (Code menu, with confirmation), gopls marks vulnerable `go.mod` requirements using the Go vulnerability database.
- **Go Studio navigation and generation:** Call Hierarchy (Ctrl+Alt+H) and Type Hierarchy, Go to Test (Alt+Shift+T) with test generation, Recent Locations (Ctrl+Shift+E), Last Edit Location (Ctrl+Shift+Backspace), Next/Previous Problem (F8), and Code → Generate… (Alt+Insert): constructor, getters, setters, extract interface, table-driven test, benchmark and fuzz test.
- **Go Studio editor core:** Sticky Scopes, optional Minimap, Font Ligatures, Zoom (Ctrl+= / Ctrl+- / Ctrl+0), Zen Mode (Alt+Shift+Z), Preview Tab, Type Hints, Save Files on Focus Change, Trim Trailing Whitespace on Save, project-root `.editorconfig` support and Replace in Files through the change preview.

### Verified
- Go Studio Go tests pass; 791 frontend tests across 175 files, TypeScript, the production build and the startup budget pass.
- The debugger and Concurrency View need a manual check with a real Delve session and blocked goroutines.

Full release notes: [v0.9.42](docs/releases/v0.9.42.md).

## [0.9.41] - 2026-09-29

### Added
- **Concurrency-first debugger in Go Studio:** the Debug tool window groups goroutines by package and starting function, shows each goroutine's state (running, chan receive/send, select, mutex, WaitGroup, sleep, I/O…), what it is blocked on and the source line, with a detail card and a folded call stack.
- **Concurrency view:** a state summary, diagnostics for possible deadlocks, blocked channels, mutex contention, possible goroutine leaks and data races, and a flow of starting function → goroutines → awaited channels and mutexes.
- **Race detector:** *Run → Test Current Package with Race Detector* runs `go test -race`. Race reports from tests, runs and the debug console become navigable cards with both accesses and the creation stacks.
- **Inline values while debugging:** variable values appear at the end of the lines of the paused function.
- **More debug keys:** F6 and F10 also step over, F5 also resumes (only while paused).

### Changed
- The Debug tool window is redesigned: larger text, grouped toolbar, Session / Concurrency switch, typed value colours, copy value, lazily loaded scopes and package globals (Delve `showGlobalVariables`, system goroutines hidden).

### Fixed
- The `danger` colour was missing from the Tailwind theme, so error and stop colours in Go Studio had no effect.
- Coloured icon buttons in Go Studio (Run, Debug, Stop, Restricted) lost their colour because unlayered CSS overrode Tailwind 4 utilities.
- gopls telemetry is really off: `GOTELEMETRY=off` is read-only for Go's telemetry library and still started the `** telemetry **` process. gopls now starts with `GO_TELEMETRY_CHILD=2`, which starts no telemetry process (verified with gopls v0.23.0 on Windows) and leaves the global `go telemetry` mode untouched.

### Verified
- Go Studio Go tests pass, including goroutine state inference and race report collection.
- 768 frontend tests across 170 files, TypeScript, the production build and the startup budget pass.
- The debugger UI was checked against a simulated paused session; a real Delve session with blocked goroutines still needs a manual check.

Full release notes: [v0.9.41](docs/releases/v0.9.41.md).

## [0.9.40] - 2026-09-29

### Added
- **Maximize Editor in Go Studio:** Ctrl/Cmd+Shift+F12 or a double-click on an editor tab hides Project, Structure and the bottom tool window, and restores them as they were. Project and Structure get a hide button, and Project a shortcut (Alt+1).
- **Modern Go Studio menus:** icons on every command, check marks for toggles, rounded studio panels and keycap shortcuts.
- **docker compose in Go Studio:** ▶ on `services:` (Up all, Down) and on each service (Up), with Stop running `docker compose stop` and a *Docker Compose* run configuration type.
- **Send to API Workspace:** right-click a Postman, Insomnia, Bruno, OpenAPI or Swagger file in the Go Studio project tree to import it into the API Workspace.
- **Recent projects in the Go Studio project menu:** projects that are not open can be reopened from the toolbar.
- **Encrypt private keys in Power Tools:** the PEM / JKS tool encrypts and decrypts private keys as standard PKCS#8 (PBKDF2-SHA256 600k + AES-256-CBC, verified with OpenSSL). Go Studio opens `.pem`/`.key`/`.crt`/`.cer` there from the project tree.
- **File icons:** the Jenkins emblem for Jenkinsfiles, and a key for `.pem`, `.key`, `.p12`, `.pfx` and `.jks`.
- **Maximize Go Studio:** a toolbar button and Ctrl/Cmd+Shift+F11 hide adOmnia's rail, panel header and status bar.

### Changed
- Confirmation dialogs are redesigned: commands and paths sit in a structured, wrapped, monospaced section, and the dialog has a clear icon (command, question or deletion), a soft blurred backdrop, a spring entry and safe default focus. Go Studio dialogs share the same backdrop and animation.
- The a0 launcher in the bottom-right corner stays hidden and click-through until the pointer comes near the corner (or it gets keyboard focus).
- gopls runs with `GOTELEMETRY=off` and `GOMEMLIMIT=1GiB` unless you set them yourself.
- The README presents adOmnia as one local workspace for APIs and the code behind them, with a gO Studio screenshot.

### Verified
- Go Studio, nettools and Developer Context Go tests pass, including key encryption opened with the real OpenSSL.
- 760 frontend tests across 169 files, TypeScript, the production build and the startup budget pass.
- Docker compose, Dockerfile Build & Run and Stop still need a manual check with Docker Desktop running.

Full release notes: [v0.9.40](docs/releases/v0.9.40.md).

## [0.9.39] - 2026-09-29

### Added
- **Makefiles and Dockerfiles run in Go Studio:** the gutter ▶ offers *Run 'make target'* on every Makefile target, and *Build image* / *Build & Run container* on every Dockerfile stage. Output goes to the Run console with Stop and Rerun.
  - Build & Run starts `docker run --rm -i` only after a successful build, publishing the `EXPOSE` ports.
  - Stop runs `docker stop` on the container.
  - New Run Configuration types: *Make target*, *Docker build* and *Docker build & run*.
  - *Save as Run Configuration…* prefills Dockerfile `ARG`s and marks sensitive ones secret. Secret build args and container variables pass only through the environment (`--build-arg NAME`, `-e NAME`).
  - make is found on `PATH` (`make`, `gmake`, `mingw32-make`), in GnuWin32, or at a path set in Tool Paths.
- **Islands look for Go Studio:** Project, Editor, Structure and the bottom tool window become rounded islands on a darker ground, with pill tabs, gap resize handles and theme-token dark and light variants.
- **Developer Context and entity router:** a local scan of the Go Studio project. It covers modules, services, compose datasources, masked `.env`, OpenAPI/proto/WSDL, Go routes, env reads, SQL tables and topics. Results feed Ctrl+K *Project* and *Symbols* groups, with actions into the API Client, Mock, Database, Broker, API Docs, gRPC and SOAP studios.
- **New Hub:** an aO → gO ecosystem hero, Go Studio as the featured workspace with a static preview, and the a0 laptop scene.

### Fixed
- Go Studio showed HTML, CSS, JavaScript, Dockerfile, SQL, XML, shell and other non-Go files as plain text. They are now highlighted with Monaco's bundled languages, plus a Makefile tokenizer. Makefiles keep real tabs.
- Developer Context never leaks `.env` passwords (quoted values with comments, PASS/PWD keys, DSN forms), shares the first scan between concurrent requests, and serves only detected contracts.
- Entity handoffs to a panel that is still loading end with a notice instead of being dropped silently.

### Verified
- Go Studio tests pass, including a Makefile end-to-end test with the real `make`.
- 755 frontend tests across 168 files, TypeScript, the production build and the startup budget (592,314 bytes) pass.
- The Docker end-to-end test skips without a running daemon; Build & Run and Stop need a manual check with Docker Desktop running.

Full release notes: [v0.9.39](docs/releases/v0.9.39.md).

## [0.9.38] - 2026-09-29

### Added
- **Fix with AI in Go Studio:** a quick fix (lightbulb, Alt+Enter, error hover) and a Problems button that ask the AI provider configured in Settings to fix a Go error or warning. The file and, for `undefined: pkg.Name`, the local package are sent only on click. The answer may touch only those files and always opens in the change preview, applied all-or-nothing and undoable.
- **Real file icons:** gopher for Go sources with a test marker, the Go logo for `go.mod`/`go.work`/`go.sum`, and brand icons for Docker, Git, GitHub Actions, `.env`, Make, OpenAPI, Markdown, YAML, JSON and more across the tree, tabs, Quick Open, Search Everywhere, Find in Files and Problems. The 45 Simple Icons marks (CC0) are generated by `scripts/generate-brand-icons.mjs` and fall back to the text colour when the brand colour is not readable on the active theme.

### Verified
- 734 frontend tests across 162 files, TypeScript, the production build and the startup budget (584,053 bytes) pass.

Full release notes: [v0.9.38](docs/releases/v0.9.38.md).

## [0.9.37] - 2026-09-29

### Added
- **Go Studio sessions and terminal:** isolated multi-project sessions, restore of tabs, layout and unsaved buffers, persisted run configurations without secrets, a real PTY terminal (ConPTY on Windows) and a file watcher with cross-project conflict detection.
- **Tests and debugging:** structured test runner with Rerun Failed, editor coverage, and a Delve (DAP) debugger with breakpoints, stepping, variables, watches, attach and remote `dlv --headless`.
- **GoLand parity:** gopls refactorings with multi-file preview, implementation markers, navigation history, bookmarks, Search Everywhere, Go Tools menu, local history, TODO window, split tabs and GoLand keymap.
- **Git and adOmnia integration:** Git in the editor (branch, gutter diff with hunk revert, blame, history, commit, branch switch); Git Studio follows the Go Studio project's repository; Project Services for Docker Lab, Database and Broker Studio; "Open in API Client" CodeLens; read-only plugin events.
- **Workspaces and windows:** Go Studio workspaces separate from API workspaces; a project can move to its own window with single-window ownership and guarded close.
- **UI:** JetBrains-style Go Studio chrome.

### Fixed
- Process output lost at exit or split inside UTF-8 characters; concurrent runs exceeding the limit; unordered saves; a corrupt state file blocking Go Studio; case collisions in Linux recovery buffers.
- A data race when starting the debugger.
- Initial JavaScript over the 650 kB startup budget.
- `build.ps1` aborting when its output is redirected under Windows PowerShell 5.1.

### Verified
- 711 frontend tests across 159 files, TypeScript, the production build and the startup budget pass. `go vet`, staticcheck and `go test -race` pass for `internal/goide` and `internal/goidewindow` on Windows with Delve.

Full release notes: [v0.9.37](docs/releases/v0.9.37.md).

## [0.9.36] - 2026-09-28

### Added
- **Go Studio editing:** real project tree, Monaco tabs with atomic saves, external-change handling, Quick Open, pinned tabs, reopen closed tab, split editor and a symbolic breadcrumb. `.go` files show a Go gopher icon.
- **gopls intelligence:** per-project language server using the selected Go SDK, unsaved-buffer diagnostics, completion with auto-imports, hover, signature help, definition, implementation, usages, workspace symbols, previewed multi-file rename, code actions, reformat and optimize imports (also on save), a Structure pane and read-only navigation into Go SDK sources.
- **Linting:** golangci-lint or staticcheck, respecting project configuration, with cancellable runs, optional lint on save and findings in Problems, the gutter and the status bar.
- **Run and test:** Build/Run/Stop/Restart with stdin and clickable output, plus gutter ▶ actions for `func main` and individual tests and benchmarks. Tool windows for Run, Problems, Usages and Find in Files.
- **Toolchain and tools:** official Go SDK install and per-project selection; confirmed installs for gopls, golangci-lint and staticcheck; custom tool paths; dependency management through previewed `go get` and `go mod tidy`.
- **IDE menu bar:** File, Edit, View, Navigate, Code, Go, Run and Help with GoLand-style shortcuts and a Keyboard Shortcuts reference.

### Fixed
- A read-only SDK file could overwrite another file's unsaved buffer when switching tabs.
- Process Stop no longer races with natural exit, and gopls reports its final state as soon as Stop returns.
- Cancelled requests no longer produce unhandled promise rejections.
- Ctrl/Cmd+W inside Go Studio no longer closes a hidden HTTP tab.

### Verified
- 595 frontend tests across 130 files, TypeScript and the production build pass. `go vet` and `go test -race ./internal/goide/...` pass against real gopls, golangci-lint and staticcheck, and the package cross-builds for Windows and macOS.

Full release notes: [v0.9.36](docs/releases/v0.9.36.md).

## [0.9.35] - 2026-09-28

### Added
- **Go Studio foundation:** a dedicated local-first Go IDE domain now owns workspace sessions, documents, toolchain metadata, structured processes, LSP, terminal, debug, tests and versioned persistence behind thin Wails bindings.
- **Go Studio navigation:** the new panel is available from the compact `gO` rail entry, router, command palette, translations and a dedicated Zustand store without changing Git Sync ownership.
- **Safe project opening:** choosing a project records its resolved local root and Go module/workspace metadata without running repository code, scripts, hooks, tests or tools. Tool authorization remains a separate explicit state.
- **Architecture contract:** the Go Studio ADR records gopls/LSP, ConPTY/PTY, Delve/DAP, process limits, lifecycle, persistence and multiwindow decisions. `todo-ide.md` tracks sequential implementation gates and the approved visual references.

### Security
- Project paths are normalized, symlinks are resolved and document access is confined to the real project root.
- Persisted IDE metadata excludes document contents, environment values and credentials; no new network listener is exposed by Go Studio.

### Verified
- 565 frontend tests across 122 files, TypeScript, the production frontend build, `go test ./...`, `go build ./...`, `go vet ./...` and the Go Studio race test pass.
- The Go Studio domain cross-builds for Linux and macOS. Wails beta.25 bindings and the Windows desktop runtime were built and launched with an isolated profile; the rail and command-palette flows were exercised in the local preview.

Full release notes: [v0.9.35](docs/releases/v0.9.35.md).

## [0.9.34] - 2026-09-28

### Added
- **AI product model:** a0 now consults a compact capability map of every adOmnia tool (HTTP collections, Mock Server, Broker Studio, Database Studio, MCP, browser/HAR debuggers and more), so it reasons about the product that actually exists instead of inventing generic API-tool features.
- **AI mock generation:** with Agent actions enabled, a0 can generate local Mock Server endpoints from a natural-language description, convert them into the reviewed persisted shape, and open them for review.
- **AI panel navigation:** a0 can return validated `open-panel` actions to open or switch to a specific tool using an exact panel id from the capability map.
- **Multilingual assistant:** a0 now replies in the same language as the user instead of forcing English.
- **Conversation context:** a bounded slice of the recent conversation is included in the prompt so follow-up requests stay coherent.

### Changed
- **Leaner startup:** the fresh Hub loads about 30.5% less initial JavaScript (823,684 → 572,407 uncompressed bytes). Sidebar, command palette, AI assistant, import parsers and closed environment/hosts editors load only when relevant.
- **AI startup:** an unconfigured assistant no longer loads its provider runtime. A verified assistant mounts after the first stable frame, while early Hub clicks are retained during its asynchronous load. Gateway restoration remains deferred and runs only when enabled.
- **Workspace resume:** persisted API workspaces preload their sidebar alongside the existing request-workspace preload. Workspace restoration, credentials, settings and storage formats are unchanged.
- **Startup regression check:** a production-bundle budget now runs in CI and rejects optional AI, YAML, editor, diagram and PDF modules in the static startup graph. Local timing diagnostics contain only numeric timings and byte counts; no telemetry is added.
- **README:** reorganized the public overview, feature groups, platform installation, AI permissions, CLI workflows, development checks and documentation links.

### Removed
- **Bundled game:** extracted a0: Bug Hunt into a separate local project, including its source, tests, artwork and development references. adOmnia no longer ships game assets, an overlay or chatbot commands that launch it.
- **Game-only UI and documentation:** removed unused game translations, preview entry points and the game backlog from the active product documentation. Historical release notes remain intact.

### Unchanged
- The Hub mascot, a0 AI assistant, workspace actions, API tools, Database Studio and Broker Studio remain available. Workspace data and settings are unchanged; existing local game records are not erased.

### Verified
- 563 frontend tests pass, together with TypeScript and the production frontend build. The production browser smoke check covers the Hub, command palette, API sidebar, environment and hosts editors, and the AI connection gate.
- `go build ./...`, `go test ./...` and the canonical Windows Wails production build pass. The separately extracted game retains its source and artwork outside the app.
- Browser warm-cache first-frame samples remain similar (median 83.8 ms before, 80.9 ms after). These are renderer diagnostics, not a measurement of full native Windows startup; see [the performance guide](docs/PERFORMANCE.md).

Full release notes: [v0.9.34](docs/releases/v0.9.34.md).

## [0.9.33] - 2026-09-27

### Added
- **Agent actions:** AI Engine now has an explicit permission that lets a0 create and update supported workspace items when the user asks for a mutation.
- **Root request creation:** structured `create-request` actions are validated, converted into native adOmnia requests, saved outside user collections and opened automatically for review.

### Changed
- **Useful instead of advisory:** when Agent actions are enabled, a0 is instructed to perform supported explicit requests instead of explaining which UI button the user should click.
- **Refreshed product screenshots:** the dark, light and Git interface artwork used by the public project has been updated.

### Fixed
- **Greeting API command:** English and Italian requests to create a greeting API at workspace root have a deterministic local path, so the action still succeeds if a provider ignores the structured-response schema.
- **Mutation safety:** action URLs, methods, names, headers and bodies are bounded and validated before they can reach the local workspace. Credentials remain excluded from the action protocol.

### Verified
- A live DeepSeek request using the environment credential completed successfully, and DeepSeek returned the expected `create-request` action for the Italian greeting prompt.
- All frontend tests, the production frontend build, `go build ./...` and `go test ./...` pass.

Full release notes: [v0.9.33](docs/releases/v0.9.33.md).

## [0.9.32] - 2026-09-27

### Added
- **Native DeepSeek support:** DeepSeek is now a first-class AI provider with its official OpenAI-compatible endpoint, model discovery and curated V4 Pro and V4.1 Flash choices.
- **Intelligent credential discovery:** adOmnia can resolve the selected provider's exact key from the process environment, saved adOmnia Environments, Vault references and standard workspace `.env` files without exposing or persisting the resolved secret in AI settings.

### Changed
- **AI Engine workspace:** provider selection, model search, connection testing and advanced configuration now use a responsive master-detail layout with cloud/local grouping, optimization presets and a persistent active-configuration footer.
- **Generic English a0:** the assistant opens with a neutral English welcome, answers in English and never assumes or invents the user's name.

### Fixed
- **Credential fallback behavior:** automatic discovery preserves explicit provider settings and existing OpenAI-compatible environment behavior while checking only exact, provider-specific variable names.
- **AI configuration clarity:** automatic credentials show their source rather than a secret value, and Cancel reliably restores the last saved provider configuration.

Full release notes: [v0.9.32](docs/releases/v0.9.32.md).

## [0.9.31] - 2026-09-26

### Added
- **Reactive Hub mascot:** a0 now appears as a complete, uncropped full-body character between the four Hub cards. Each card has its own pose and expression, with smooth cross-fades, restrained motion, keyboard focus support and reduced-motion handling.
- **Terminal Green:** a near-black, WCAG-checked built-in theme with a focused signal-green palette, matching brand artwork treatment and a quick switch in the status bar.
- **Product planning artifacts:** added the accepted direction for controlling a running adOmnia desktop through MCP and an interactive connection-error response sketch with three recovery patterns.

### Changed
- **a0 is the intentional game entrance:** Bug Hunt opens only when the user explicitly asks the chatbot to play in English or Italian. Negative requests and ordinary mentions do not trigger it; spinning the Hub logo is now only a visual fidget.
- **Hub-to-assistant flow:** clicking the mascot opens the compact chatbot when the selected provider/model pair has been verified. Otherwise the Hub explains what is missing and links directly to Settings → AI Engine.
- **Focused Settings:** Themes, Templates and Plugins now live inside Settings instead of occupying a separate Workspace rail group; Git Sync remains the focused Workspace destination.
- **Broker Studio:** the event-broker workspace is organized around saved connections and their event streams, with connection-aware navigation and tests for the connection model.
- **Brick Workshop:** stronger tactile treatment across the rail, tabs, workspace header, editors and active request states while retaining reduced-motion support.

### Fixed
- **Mascot composition:** replaced the cropped mascot and malformed arm treatment with dedicated transparent full-body renders for the resting state and all four Hub reactions.
- **AI/game behavior:** opening a0 from the Hub requires a verified connection, and local intent recognition launches Bug Hunt without sending the play command to an AI provider.
- **Documentation hygiene:** removed obsolete implementation scratch documents and kept current product behavior in the README, changelog, release notes and planning artifacts.

Full release notes: [v0.9.31](docs/releases/v0.9.31.md).

## [0.9.30] - 2026-09-26

### Changed
- **a0, made compact:** the assistant is now a 48 px circular launcher rather than a labelled pill. It disappears while its smaller 320 × 380 px chat is open, and the chat can be expanded when a longer conversation needs room.
- **Focused assistant header:** the header is 44 px high, uses a small avatar and keeps provider/model information in an on-demand menu instead of a persistent technical line.
- **Quieter first conversation:** a0 opens with “Ciao Andrea, cosa facciamo?” and two compact prompts that disappear after the first message.
- **Subtle personality:** opening, idle, thinking and hover movements are intentionally brief and respect the operating-system reduced-motion preference.

### Fixed
- **AI availability:** a0 is no longer shown merely because AI is enabled. It appears only after **Test connection** succeeds for the currently selected provider and model; changing either, or a failed test, hides it again.

Full release notes: [v0.9.30](docs/releases/v0.9.30.md).

## [0.9.29] - 2026-09-26

### Added
- **Quick root requests:** right-click the active workspace header and choose **New Request** to create an immediately visible request at the top of the sidebar, outside every user collection. Quick requests stay local, persist with their workspace and can later be moved into a collection.
- **Brick Workshop skin:** an optional tactile, playful visual skin is available alongside the existing themes without changing the default appearance.
- **a0 AI companion:** when AI is explicitly enabled, a0 appears as an expandable chat companion in the lower-right corner. It can explain the active workspace, draft Flow instructions, route to API Docs, and propose headers for the active request. Header changes remain a visible, one-click review step; it never changes an API request autonomously.

### Changed
- **Denser collection navigation:** Workspace, Environment and Hosts are now three compact controls on one sidebar row. Their management actions remain available in their menus, leaving more room for Collections.
- **Dependency refresh:** Wails and its runtime were updated together to `3.0.0-beta.25`; Sarama and Bart were updated to their compatible current releases.

### Fixed
- **Workspace startup resilience:** incomplete legacy request tabs are repaired during hydration instead of causing a recoverable UI error.
- **Windows executable details:** generated Windows resources now receive the actual release version, description and build metadata instead of unresolved template values.

Full release notes: [v0.9.29](docs/releases/v0.9.29.md).

## [0.9.28] - 2026-09-26

### Fixed
- **Git Sync commit graph:** scrolling through a loaded history and returning to an earlier commit no longer breaks or truncates graph connections. Loaded rows remain mounted while history continues to load incrementally.

Full release notes: [v0.9.28](docs/releases/v0.9.28.md).

## [0.9.23] - 2026-09-24

### Fixed
- Developer Desk pickup shelves stay stable; the final code module rests on the desk.
- Exit visuals now respect the living guard and explain why the exit remains locked.

Full release notes: [v0.9.23](docs/releases/v0.9.23.md).

## [0.9.22] - 2026-09-24

### Changed
- Bug Hunt: removed enemy trajectory and move previews in Developer Desk while keeping actual impacts visible.
- Head stomps damage the attacking Brute and take priority over impact damage.
- Added longer grapple crossings and replaced first-stage rewind, sudo and freeze pickups with shields, ammunition and movement boosts.

Full release notes: [v0.9.22](docs/releases/v0.9.22.md).

## [0.9.21] - 2026-09-24

### Changed
- Bug Hunt: rebuilt Developer Desk opening, code packets, physical power modules and six new enemy silhouettes.
- Clicking outside the game no longer pauses it automatically.

Full release notes: [v0.9.21](docs/releases/v0.9.21.md).

## [0.9.20] - 2026-09-24

### Changed
- Bug Hunt: tuned ground/air movement, C ground slide with momentum-preserving long jump, stronger held stomp and connected book/platform routes.
- Developer Desk: optional roaming Gremlin/Phantom, expanded active Brute finale and distinct common enemy silhouettes.
- Updated IT/EN controls; removed the poorly integrated wrist-weapon overlay.

Full release notes: [v0.9.20](docs/releases/v0.9.20.md).

## [0.9.19] - 2026-09-22

### Added
- **Bug Hunt developer-world campaign:** distinct Dev Desk, Datacenter and Legacy visuals; themed platforms, a collapsing keyboard, rack lifts, fan columns, cycling pods, CPU pressure and an overheating escape.
- **New encounters:** flying dive bugs, aimed Timeout drones, growing Memory Leaks, charging Race Conditions, Deadlocks, zombies, clones and an exit-guarding NullPointer. The extended first stage now has 21 enemies.
- **Three-phase Legacy Monolith:** SOAP/XML/500 volleys, timed rule overrides, falling Java 6 debris and CORE/SESSION/SOAP modules that gate the final hit.

### Fixed
- **Controllable boss gravity:** a three-second warning, five-second inversion, playable ceiling and normal-gravity safe zone beside the boss replace proximity-pinned inversion. Commands expire even outside the arena.

### Changed
- **Campaign progression:** precision, moving infrastructure and rule changes introduce the mechanics reused by the boss. Three lives remain shared across all stages.
- **Records:** developer-world.v5 migrates only audio and reduced-motion settings from previous profiles, preserving old records and workspace compatibility.
- Synchronize desktop and npm manifest/lockfile versions for release packaging.

Full release notes: [v0.9.19](docs/releases/v0.9.19.md).

## [0.9.18] - 2026-09-22

### Added
- **Bug Hunt — a0 has a personality:** the eyes track the nearest enemy or projectile, eyebrows and mouth tense with the danger, landings squash proportionally to the impact, an edge makes a0 wobble for balance, and a checkpoint raises both arms. The hitbox is untouched. Reduced motion keeps the poses but drops the oscillation.
- **Bug Hunt — contextual quips:** IT/EN speech bubbles after a death, at a checkpoint and after a close call, positioned above the popups so nothing overlaps.
- **Bug Hunt — Localhost is a full level:** 3220 px to 4820 px, 8 enemies to 15, extra platforms and grapple anchors, and 21 additional bits (156 across the campaign). Hotfix at x=4590, exit at x=4700. API Gateway and Production keep their geometry.

### Changed
- **Bug Hunt — three lives for the whole campaign:** three hearts in the HUD. A hit or a fall costs one; checkpoints and environment changes do not refill them. At zero the run stops with a campaign restart or exit, and a defeat never writes a victory record.
- **Bug Hunt — records move to `adomnia.bughunt.preferences.three-lives.v4`:** only audio and reduced-motion preferences migrate, from the first existing key among `arcade.v3`, `campaign.v2` and `v1`. The old keys stay in place and the `.adomnia` workspace format is unchanged.

Full release notes: [v0.9.18](docs/releases/v0.9.18.md).

## [0.9.17] - 2026-09-19

### Fixed
- **Bug Hunt — the Legacy Monolith could not be defeated.** An arena slab sat directly above the core, catching the fall that damages it. The slab moved beside the core, and a regression test now fails if anything solid enters the approach band above it.

### Changed
- **Bug Hunt platforms are built, not drawn as rectangles:** every slab now has a lit rail, end caps, etched circuit traces, a recessed glyph window (`>>>`, `</>`, `<   >`, `/ / /`) and a neon accent per role. Ground slabs carry a chassis with vent bays, status lights, bolts, pylons and cabling; floating slabs get pulsing anti-gravity mounts; the arena ceiling is the same slab hung upside down.
- **A clearer start menu:** the dense mission paragraph is replaced by a goal box, a controls grid with real key caps, and a LIVES panel that states the rule. The HUD pill now reads `LIVES ♥♥♥ 3` instead of three bare glyphs, and turns red on the last life.
- **Dependency sweep:** every direct Go module and every npm package updated to its current release — `wails/v3` and `@wailsio/runtime` to 3.0.0-beta.23 (moved together, as the IPC layer requires), `golang.org/x/crypto` 0.57.0, `golang.org/x/net` 0.59.0, `grpc` 1.84.0, `goja`, `nats.go` 1.54.0, `klauspost/compress` 1.20.0, `modernc.org/libc` 1.77.0 and others; `vite` 8.3.0, `vitest` 5.0.1, `postcss` 8.5.28, `lucide-react` 1.47.0, `yaml` 2.9.1.

### Held back
- **mermaid 12.0.0** stays on 11.17.2: it pulls `chevrotain` → `lodash-es` with five high-severity advisories (code injection via `_.template`, prototype pollution in `_.unset`/`_.omit`). 11.17.2 keeps `npm audit` at zero.
- **`digitorus/pkcs7` and `digitorus/timestamp`** stay pinned: their current releases require Go 1.27 and this project targets Go 1.26.5. Raising the toolchain floor is a separate decision — it affects CI and every contributor.

Full release notes: [v0.9.17](docs/releases/v0.9.17.md).

## [0.9.16] - 2026-09-19

### Added
- **WebSocket parallel send:** split the composer with a line containing only `---` and fire every command `N` times concurrently (1–500). `{{$i}}` resolves to the 1-based send index, and the log reports `ok/total` with elapsed milliseconds and the first error.
- **Bug Hunt — debug gun:** hold F to fire debug packets. They close bugs, knock SOAP envelopes out of the air, and armoured bugs take two.
- **Bug Hunt — reactive enemies:** chasers wake within 320 px and charge without leaving solid floor; turrets track a0 within 430 px and return fire every 1.85 s behind a visible aim line and charge pips.
- **Bug Hunt — a boss that rewrites the rules:** the Legacy Monolith announces a command for 1.7 s, then executes it — `sudo reverse gravity` (a0 lands on the arena ceiling and jumps down onto the core), `fork() → 3 clones`, and `systemctl stop platforms`. Every rule is local to the arena and ends with its phase.

### Changed
- **Bug Hunt — the Legacy Monolith** is a full tower: a CRT face that tracks a0, the legacy stack it will not retire, sticky notes, and two fists that lob SOAP envelopes in an arc. The old ground wave is gone.
- **The secret is easier to find:** one full spin of the home-screen logo asks whether you want to play. The three-turn gesture and the 30-second hold are gone, and the invite can be dismissed.
- **Dependencies:** `wails/v3` and `@wailsio/runtime` to 3.0.0-beta.22 (moved together, as the IPC layer requires), React and React DOM to 19.3.0, `tailwind-merge` 3.7.0, `autoprefixer` 10.6.1, `modernc.org/sqlite` 1.59.0, `mongo-driver/v2` 2.9.1, `amqp091-go` 1.15.0.

### Fixed
- **Bug Hunt boss layout:** a duplicated announcement covering the boss's face, the state line printed across the legacy stack, wall graffiti drawn over the checkpoint terminal, and a0's `aO` reading as `90` while upside down.

Full release notes: [v0.9.16](docs/releases/v0.9.16.md).

## [0.9.15] - 2026-09-18

### Added
- **Bug Hunt DELETE wave:** in Production the floor is deleted behind a0. Platforms the wave passes stop being solid, outrunning it to the checkpoint pays 400 points, and stopping costs a life. Four new high ramps offer a faster line and the Breakpoint power freezes the wave.
- **Magnetic grapple:** press E to latch onto the glowing nodes above every main-route gap. The cable swings like a real pendulum, W and S reel it in and out, and releasing it launches a0 and refills the dash, so grapple, launch, dash and bug hits chain without touching the ground.

Full release notes: [v0.9.15](docs/releases/v0.9.15.md).

## [0.9.14] - 2026-09-17

### Added
- **Bug Hunt encounter chains:** successful bug hits recharge the dash; optional aerial enemies give players a route for linking stomps, double jumps and dashes.
- **Bonus Rush:** collect six bits in eight seconds for 500 bonus points in each stage. The challenge is optional and never blocks the campaign.
- **Arcade results:** final S/A/B/C score rank, bonus challenge tally, and boss hit rewards that cannot be farmed through retries.
- **Final boss escalation:** the Legacy Monolith warns and fires a double wave in its last phase.

### Fixed
- **Game framing:** canvas scaling no longer crops the bottom of the level, and hint text no longer covers the player.

Full release notes: [v0.9.14](docs/releases/v0.9.14.md).

## [0.9.13] - 2026-09-17

### Added
- **Bug Hunt campaign:** the hidden hub game now has three stages (Localhost, API Gateway, Production) with moving and crumbling platforms, timed firewalls, hopping Retry bugs and the Legacy Monolith boss, plus stage-clear screens and campaign records.
- **New moves:** double jump, a dash that defeats bugs and crosses firewalls, springs with reward trails and a combo score multiplier.
- **Developer power-ups:** git revert (press R to rewind three seconds), Breakpoint (freezes bugs, firewalls, platforms and the boss), sudo (temporary root immunity that deletes bugs on contact) and Garbage Collector (a shockwave that frees every bug in range), in every stage and in English and Italian.

Full release notes: [v0.9.13](docs/releases/v0.9.13.md).

## [0.9.12] - 2026-09-16

### Added
- **MongoDB Explorer:** a Compass-style workspace with a database/collection tree, collection stats and Documents, Aggregations, Schema, Indexes and Validation tabs. Documents supports mongosh-syntax filters, server-side paging, list/JSON/table views, type-preserving edit, clone, delete, insert, JSON/NDJSON/CSV import, filtered export, explain plans and export to mongosh, Node.js, Python, Go and Java. The previous JSON runner remains available.
- **MongoDB connection options:** URI options (`authSource`, `tls`, `replicaSet`…) and SRV (`mongodb+srv`) connections.
- **a0: Bug Hunt:** a hidden platformer in the hub (spin the logo three times or hold it for 30 seconds). The first level, Localhost, is complete, runs offline, keeps local records and follows the app language.

### Fixed
- **MongoDB authentication:** connections no longer fail with `SCRAM-SHA-1 ... not enabled` when the user lives outside the default `authSource`; adOmnia retries with SCRAM-SHA-256 and the selected database, and explains `authSource` on real failures.
- **Hub logo gesture:** exactly three turns now registers reliably and the logo keeps its momentum before easing upright.
- **UI localization guard:** new hub labels are translated through the shared UI dictionary.

Full release notes: [v0.9.12](docs/releases/v0.9.12.md).

## [0.9.11] - 2026-09-15

### Added
- **Staged Flow Stress:** editable warm-up, steady, spike, recovery and cooldown phases support target VUs, ramp duration and explicit measurement inclusion, with up to 200 local virtual users.
- **Dataset-driven flows:** CSV columns become per-iteration variables with sequential, per-VU or pseudo-random row allocation plus built-in VU, iteration, timestamp and UUID values.
- **Performance diagnostics:** APDEX and its release gate, active-VU timeline, latency histogram, and a persistent 12-run p95/RPS trend join the existing traffic, error, percentile and baseline views.
- **Headless flow stress:** portable CI plans run through `adomnia stress` with data handoffs, retries and error branches plus CLI/JSON/JUnit output, dataset/env overrides and non-zero gate failures.

### Changed
- **Decision-grade reports:** warm-up/cooldown traffic no longer distorts measured RPS or percentiles; CSV marks phase/measurement and offline HTML carries the richer charts.
- **Local history:** recent flow stress summaries survive restart and can be selected as comparison baselines without reopening an export.

Full release notes: [v0.9.11](docs/releases/v0.9.11.md).

## [0.9.10] - 2026-09-15

### Added
- **AI Flow Architect:** natural-language instructions can now describe ordered calls, response-field extraction into `{{variables}}`, success paths and recovery branches for network errors, timeouts and HTTP failures. The preview exposes data handoffs and recovery paths before applying the generated flow.
- **Decision-grade stress tests:** Smoke, Load, Spike and Soak presets join configurable p95, error-rate and throughput release gates, run verdicts, long-tail and bottleneck diagnostics, normalized error fingerprints, aggregate percentiles and data-rate metrics.
- **Log Inspector P3:** reusable parsing profiles, integrity diagnostics for missing data, clock skew, truncation and uncertain correlation, request diffs, metric extraction and a local evidence-grounded AI investigation assistant.

### Changed
- **Richer stress evidence:** HTML and JSON reports now carry release checks, diagnosis, overall p95/p99, status totals and grouped errors while remaining compatible with earlier v1 baselines.
- **Cross-platform acceptance:** the final four-service JSONL/Go/mixed-log investigation journey and its keyboard/resizable-panel contract run in Windows, Linux and macOS CI jobs.
- **Dependency refresh:** Wails and the frontend/Go dependency set were updated together.

### Fixed
- **Variable context menu:** right-click now recognizes `{{variables}}` in wrapped editors and non-JSON request bodies.

Full release notes: [v0.9.10](docs/releases/v0.9.10.md).

## [0.9.9] - 2026-09-11

### Added
- **Flow stress test:** the **Stress** button runs a flow with up to 25 concurrent virtual users (ramp-up, iterations or duration, think time, Stop). Each user keeps its own variables; live per-step p50/p90/p95/p99, errors and throughput.
- **Stress exports and baseline:** per-request CSV log, JSON run file and self-contained HTML report through the native save dialog; load a previous JSON export to see the per-step p95 and throughput change.
- **Variable context menu:** right-click any `{{var}}` in the body, URL, path params, query or headers to edit its value, copy the value or copy the reference — no selection needed.

### Fixed
- **Flow variables flagged unresolved:** a `{{var}}` extracted by another flow step no longer shows red in a step's request editor; the producer step or last run value appears in the tooltip.

Full release notes: [v0.9.9](docs/releases/v0.9.9.md).

## [0.9.8] - 2026-09-10

### Added
- **Complete investigation sessions:** Log Inspector now manages multiple sources, controlled deduplication, service waterfalls, paired payloads, request diffs, surrounding source context and grouped error fingerprints.
- **Structured search and working layouts:** typed `AND`/`OR` expressions with parentheses, numeric comparisons, ranges, null/missing checks and array paths join resizable, reorderable custom columns with per-format presets.
- **Persistent, shareable investigations:** versioned local sessions retain sources, query, layout, selection, bookmarks and notes; redacted evidence packages include timeline, payloads, original rows, provenance, filters and a Markdown summary.
- **From evidence to action:** observed calls can become editable Composer requests, Flow/mock proposals, Browser Debug links, source-mapped stack frames and OpenAPI payload validation.
- **Live and very large logs:** local/container tails feed the same correlation session, while a disk-backed index provides cancellable, paginated access to datasets larger than available RAM.

### Fixed
- **Log drop ownership:** dropping a supported `.log` inside Log Inspector no longer also reaches the global collection importer, eliminating the false “Unsupported file” notification and duplicate native handling.

### Changed
- **Integrated investigation navigation:** Composer, request history, proxy traffic, Browser Debug and Log Inspector share correlation handoffs and preserve the relevant tab state.
- **Documentation and backlog:** the Log Inspector guide, feature catalog and implementation checklist now describe the completed P1/P2 workflow and large-file path.

Full release notes: [v0.9.8](docs/releases/v0.9.8.md).

## [0.9.7] - 2026-09-09

### Added
- **Log Inspector reliability pass:** request analysis now accepts trace-only chains, separates final success from intermediate timeout/retry evidence, marks observed-window durations with `~`, reads request/response bodies from `attributes.http.*`, and keeps source provenance through JSON/JSONL export.

### Changed
- **Multi-file source handling:** homonymous files are labelled distinctly (`app.log #1`, `app.log #2`), `source:` and `sourceName:` filters both work, and large merged batches no longer use a massive spread push.
- **Log Inspector internals split up:** `LogInspectorPanel.tsx` now delegates import, toolbar, status bars and preferences to focused files.
- **CI Linux packaging:** GitHub Actions removes preinstalled Google apt sources before installing Wails native dependencies, avoiding external `Hash Sum mismatch` failures.

Full release notes: [v0.9.7](docs/releases/v0.9.7.md).

## [0.9.6] - 2026-09-09

### Note
- Superseded by `v0.9.7` after the tag workflow hit the same external Ubuntu apt mirror failure before release publication.

### Added
- **Log Inspector reliability pass:** request analysis now accepts trace-only chains, separates final success from intermediate timeout/retry evidence, marks observed-window durations with `~`, reads request/response bodies from `attributes.http.*`, and keeps source provenance through JSON/JSONL export.

### Changed
- **Multi-file source handling:** homonymous files are labelled distinctly (`app.log #1`, `app.log #2`), `source:` and `sourceName:` filters both work, and large merged batches no longer use a massive spread push.
- **Log Inspector internals split up:** `LogInspectorPanel.tsx` now delegates import, toolbar, status bars and preferences to focused files.
- **CI Linux packaging:** GitHub Actions removes the preinstalled Google Chrome apt source before installing Wails native dependencies, avoiding external `Hash Sum mismatch` failures.

Full release notes: [v0.9.6](docs/releases/v0.9.6.md).

## [0.9.5] - 2026-09-09

### Note
- Superseded by `v0.9.6` after the tag workflow hit an external Ubuntu apt mirror failure before release publication.

### Added
- **Log Inspector reliability pass:** request analysis now accepts trace-only chains, separates final success from intermediate timeout/retry evidence, marks observed-window durations with `~`, reads request/response bodies from `attributes.http.*`, and keeps source provenance through JSON/JSONL export.

### Changed
- **Multi-file source handling:** homonymous files are labelled distinctly (`app.log #1`, `app.log #2`), `source:` and `sourceName:` filters both work, and large merged batches no longer use a massive spread push.
- **Log Inspector internals split up:** `LogInspectorPanel.tsx` had grown to 866 lines, past the repo's 800-line limit. The import pipeline moved to a `useLogImport` hook, the toolbar and its popovers to `LogInspectorToolbar.tsx`, the progress/error/summary bars to `StatusBars.tsx`, the shared toolbar primitives to `toolbarControls.tsx`, and the persisted preferences to `prefs.ts`. The panel is now 383 lines and no file in the feature is above 460.
- **Small accessibility additions:** the import progress bar reports `role="progressbar"` with its value, and the search input, retention selector and add-field inputs carry explicit labels.

Full release notes: [v0.9.5](docs/releases/v0.9.5.md).

## [0.9.4] - 2026-09-09

### Added
- **Multi-file investigations:** Open and drag-and-drop accept several log files in one import. Each file is parsed independently, then all events share one timeline and can be filtered or correlated by `correlation_id`, trace ID or request ID across microservices.
- **Request and response payload view:** structured request and response bodies inside `attributes` are retained and shown as two navigable JSON trees in the event detail panel.
- **Source-aware search:** combined imports identify the source file on every event and support queries such as `source:wallet.log`.

### Changed
- **Only useful columns are shown:** columns with no values in the current dataset, including Pod / Container, disappear from the event table and column chooser instead of displaying placeholder dashes. Source file is enabled automatically for multi-file imports.

### Fixed
- **Nested attributes are preserved:** promoting a recognized nested field no longer removes its sibling fields from the payload, so request bodies, response bodies and application attributes remain available for inspection and filtering.

Full release notes: [v0.9.4](docs/releases/v0.9.4.md).

## [0.9.3] - 2026-09-09

### Added
- **Request-level log analysis:** Log Inspector groups JSONL events by `correlation_id`, falling back to `request_id`, and presents each end-to-end request with operation, route, HTTP status, duration, service and downstream clients.
- **Deterministic diagnostics:** requests are classified as success, client error, server error, timeout or retry. `context deadline exceeded` with a latency around 10 seconds produces a concrete client-timeout action, while validation failures such as a missing DEAN are identified as client errors.
- **Enterprise structured-log context:** the detail panel promotes slog/zap/logback fields for layer, operation, client, operation status, latency, error, HTTP, outcome, service version, environment and source location.
- **Sensitive-data findings:** clear-text fiscal codes, IBANs, DEAN identifiers, PANs, phone numbers and secrets are reported by field path and covered by the built-in masking action.

### Fixed
- **Latest import wins:** overlapping file reads, clipboard reads and parses can no longer overwrite the latest input. Clear discards late results, explicit Cancel keeps the partial result, and unmount cancels background work.
- **Large-import rendering:** progressive snapshots are throttled and request analysis waits for parsing to finish, avoiding repeated full analysis while a large file streams in.
- **Complete structured export:** JSON and JSONL exports retain the original parsed payload, source line count and mixed-log prefix.
- **Large correlation chains:** duration calculation no longer spreads every timestamp into a function call, avoiding stack overflow on very large requests.

Full release notes: [v0.9.3](docs/releases/v0.9.3.md).

## [0.9.2] - 2026-09-09

### Added
- **Automatic field discovery:** loading a JSON log now detects every key it contains, nested ones included, with coverage, inferred types and most frequent values. The sidebar lists them; clicking a field shows its values, clicking a value filters by it. High-cardinality fields are marked `id`. A custom application format is searchable with no configuration.
- **Remembered log shapes:** the top-level keys form a signature and the union of every path ever seen for that shape is stored locally under `adomnia.loginspector.schemas` (last 20). Later imports are matched by resemblance rather than an exact key set, and paths known from earlier imports but absent now are still offered.
- **Search any payload key:** a query field that is not one of the modelled fields is now resolved canonically against the event payload, so `merchantId:M-4471` and `http.status:502` work without the field being modelled. The index is built lazily per event and cached.
- **Regular expressions and alternatives:** `/timed ?out/` as a bare term or `pod:/^pay-\d$/` as a field value, always case-insensitive, spaces allowed, degrading to a literal search when malformed; `level:warn|error` for alternatives.
- **Unwrap toggle in the JSON tab:** turns every JSON escaped inside a string into a real subtree — expandable, searchable and pretty-printed. On by default.

### Changed
- **Field aliases are matched canonically:** case, `-` and `_` are ignored, so `correlationId`, `correlation_id`, `correlation-id` and `CORRELATION_ID` resolve to the same field. The alias set now covers ECS, OpenTelemetry, Serilog CLEF, Python `logging`, log4j2, Monolog, GELF, Datadog, Spring MDC, OpenShift `project`/`nodeName` and gateway headers including `X-Correlation-Id`, `X-Request-Id`, `X-B3-TraceId` and `X-Idempotency-Key`.
- **Nested JSON decoding is recursive** and covers more carrier fields (`result`, `error`, `exception`, `detail`, `context`, `params`, `attributes`), capped at six levels.
- **Log Inspector empty state rebuilt full width:** left-aligned header with a `local only` marker, drop zone and editor side by side at equal height, five samples on one row, shortcuts on a single bottom bar. The duplicate clipboard button and the disabled `oc logs` placeholder were removed; the `ctrl v` hint moved next to Analyze.

Full release notes: [v0.9.2](docs/releases/v0.9.2.md).

## [0.9.1] - 2026-09-09

### Changed
- **Log Inspector is a first-class destination:** Power Tools now presents exactly `JSON Studio → Log Inspector → Tool Launcher`. Opening Log Inspector goes directly to its dedicated full-size workspace.
- **Cleaner Tool Launcher:** Log Inspector is no longer duplicated among the launcher utilities, and the command palette opens the standalone destination directly.
- **Release documentation:** the Log Inspector guide is now written as public release notes covering supported sources, parsing, investigation, correlation, privacy and known limitations.

Full release notes: [v0.9.1](docs/releases/v0.9.1.md).

## [0.9.0] - 2026-09-09

### Added
- **Log Inspector:** a local-first Power Studio for JSON, JSON arrays, JSONL/NDJSON, plain and mixed OpenShift logs, CRI prefixes, ANSI output, nested JSON strings, and multiline Java or Go stack traces.
- **Fast investigation workflow:** virtual event list, field/full-text queries, visual filters, facets, time histogram, saved queries, resizable desktop panes, focused narrow layout, JSON tree, raw/message/stack/context detail views, configurable columns and hidden fields.
- **Distributed request correlation:** rebuild a request by correlation, trace or request ID, with chronological list/timeline views, inter-event deltas, services and error counts.
- **Safe local export:** copy or export filtered results as JSON, JSONL or text, with optional masking for built-in and user-configured sensitive fields.

### Changed
- **Large log handling:** parsing runs in a Web Worker with progressive batches, cancellation, configurable 50k–500k retention limits, explicit memory errors, deferred filtering and a virtualized list tested with 100,000 events.

### Fixed
- **Chronological ordering:** ascending sort now orders timestamps even when source records arrive out of order.
- **Narrow Power Tools layout:** filters open as an overlay and event details use the full available width, then close back to the event list.

Full release notes: [v0.9.0](docs/releases/v0.9.0.md).

## [0.8.3] - 2026-09-09

### Changed
- **Fluid flow workspace:** compact nodes, readable arrows, branch-preserving arrangement, free dragging with optional grid snapping, cursor-anchored zoom and keyboard fit/reset controls.
- **Adjustable panels:** inspector, timeline, Mermaid import and AI panels can close, float, move, resize, maximize and dock. Toolbar controls reopen inspector/timeline and toggle canvas focus without reopening panels during execution.
- **Release maintenance:** desktop and npm metadata are aligned to 0.8.3; includes the Go and frontend dependency refresh since v0.8.2.

### Fixed
- **REC save failure:** the local `flows` storage bucket is created automatically. Naming the recording no longer closes the dialog when the name is cleared, and duplicate saves are prevented.
- **Response-to-request data:** recordings infer exact, unambiguous JSON response values reused in later request bodies, parameters or bearer auth. Extractions and references survive save/reopen; replay preserves JSON types and escapes strings correctly.
- **Replay reliability:** transport errors reach the timeline, stop-on-failure halts linear execution, cancellation stops retries, and replay cannot record itself. Fixed nested/array extraction paths, status range assertions, terminal failure detection and Mock Commerce demo startup.
- **Saved graph preservation:** reopening a flow retains its positions and variable mappings. Existing definitions remain compatible; raw response bodies used for matching are not persisted.

Full release notes: [v0.8.3](docs/releases/v0.8.3.md).

## [0.8.2] - 2026-09-01

### Changed
- **Sidebar follows the active tab:** selecting a tab now expands the full collection/folder path of its saved request and scrolls that row into view, so a request nested several folders deep is no longer invisible in the sidebar. An active search filter is intentionally left untouched; the request is revealed again as soon as the search is cleared.
- **Active request is readable at a glance:** the selected row in the collection tree now uses an accent-tinted surface with medium weight instead of a plain surface swap, and exposes `aria-current="page"` for assistive technology.

### Security
- **Dependency refresh:** Go and frontend dependencies were updated to their current releases, clearing all open Dependabot advisories. `github.com/wailsapp/wails/v3` moved from `3.0.0-beta.7` to `3.0.0-beta.16` and `@wailsio/runtime` was bumped in lockstep, preserving the version lock the IPC layer requires. Also updated: `google.golang.org/grpc` 1.83.0 -> 1.83.2, `go.mongodb.org/mongo-driver/v2` 2.8.0 -> 2.8.1, `github.com/IBM/sarama` 1.60.1 -> 1.60.2, `github.com/rabbitmq/amqp091-go` 1.13.0 -> 1.14.0, plus transitive bumps to `golang.org/x/crypto` 0.55.0, `golang.org/x/net` 0.58.0, and `golang.org/x/text` 0.41.0. On the frontend: `lucide-react` 1.38.0, `zustand` 5.0.15, `vitest` 4.1.11, and `rollup-plugin-visualizer` 7.1.1.

## [0.8.1] - 2026-08-30

### Added
- **API Flow recording:** the REST/API Composer now has a local `Record` / `Stop` control. It records every completed Composer send in order — including HTTP failures, timeouts, and user-cancelled requests — and creates an editable, executable Flow with Start, one API Request node per captured call, and Stop.
- **Recorded-flow context:** request snapshots retain the configured method, URL template, path/query parameters, headers, body configuration, authentication references, scripts, assertions, timeout, source request id, environment, sequence, timestamp, and non-secret execution diagnostics.
- **Complete Flow authoring:** New Flow opens an empty Start→Stop canvas; API and condition nodes can be added, and the inspector uses the real Composer to edit URL, method, parameters, headers, body, auth, timeout, retry, scripts, and assertions. Response extractions and condition operators are editable inline.
- **Flow interchange:** exported Flow JSON can now be opened again from the Flow workspace; Mermaid paste/file import remains available.
- **Recorded-flow ordering:** recorded steps are numbered by sequence, retain their canvas position when saved, and can apply a left-to-right canvas order before replay.
- **Flow execution stop:** a running flow can now be stopped from the Flow toolbar; the active request is aborted through the shared execution pipeline.

### Changed
- **API Flows is core navigation:** the Flow workspace is no longer hidden when optional advanced features are disabled.
- **Flow persistence schema v4:** saved flows now carry `schemaVersion: 4`; legacy v3 and step-based flows are normalized and rewritten compatibly on load. JSON export reports the same schema version.

### Security
- **Secret-safe recorder:** direct auth credentials, sensitive headers/cookies, sensitive form values, and recognised sensitive JSON body fields are redacted before a recording is persisted. Variable templates and Vault/secret references are preserved for safe replay.

## [0.7.2] - 2026-08-09

### Changed
- **Sketch Hub preview in the README:** the public project page now shows the redesigned main Hub in its engineering-notebook skin, so the immediately discoverable API, Docs, Git, and Infrastructure workspaces are visible before download.
- **Release metadata aligned:** the Wails desktop configuration and both npm manifests now report `0.7.2`, matching the annotated `v0.7.2` release tag and preventing the About panel, development build, and package metadata from drifting apart.

### Fixed
- **Sketch active body controls:** JSON, Raw, URL Encoded, Form Data, and GraphQL could still show white labels and icons on white paper. The underlying `text-white` utilities had higher cascade precedence than the Sketch highlighter. Active radio controls now force dark ink for both label and icon while retaining the yellow marker swipe.
- **Sketch Git Sync cohesion:** commit history and staged/unstaged file lists no longer render as a stack of disconnected notebook cards. Dense Git data now flows on continuous rails with light separators, and the selected commit receives one controlled marker swipe.

## [0.8.0] - 2026-08-09

### Added
- **The hub is a notebook page:** the home screen was a stack of four collapsing rows that hid every tool behind a chevron. It is now a single readable page — a two-line headline, a search field, four index cards laid out two by two, and the last requests you sent. Nothing needs to be expanded to be seen.
- **Search from the hub:** the shortcut hint on the home screen is a real field. Clicking it opens the same command palette `Ctrl/Cmd + K` opens, so the hub no longer advertises a shortcut you cannot reach with the mouse.
- **Every tool is one click from the hub:** each card lists its tools by name — REST, SOAP, gRPC, Streaming, Browser on the first card, and so on — and each name opens that tool directly. The card's own action opens the studio it belongs to.
- **Recent notes:** the bottom of the hub shows the last three responses with method, path, status and duration, written on torn-off slips. Clicking one opens the history panel. Before you send anything the strip says so instead of showing placeholder rows.
- **Automatic AI credentials:** AI settings gained an *auto* credential mode, now the default. adOmnia uses the machine's environment key when one is set and falls back to the encrypted Vault key when it is not, instead of forcing a choice between the two. Existing Vault-only profiles migrate to this mode and keep their stored key as the fallback; Vault-only mode remains selectable.

### Changed
- **The hub is written in one hand:** in the Sketch skin the home screen now uses the skin's handwriting face throughout. It previously mixed the handwriting headline with monospaced labels, which broke the drawing halfway down the page.
- **Sketch paper details on the hub:** the red margin rule, masking tape, index cards on solid paper with punched rings and a turned-up corner, and hand-drawn section underlines. All of it is scoped to the Sketch skin — every other theme renders the same layout in its own tokens.
- **No binding rings over the navigation rail:** an earlier pass drew the notebook's spiral down the left edge of the window, which sat on top of the rail icons and made the menu hard to read. The rings now appear only on the hub's cards.

### Fixed
- **Unreadable active buttons in the Sketch skin:** selecting JSON, Raw, URL Encoded or any other radio-style toggle left white text on white paper. Those controls mark themselves with `aria-checked`, which the skin's highlighter never matched, so they kept their white label while the skin repainted the accent fill back to paper. Active controls now keep dark ink under a yellow marker swipe, icons included.
- **Missing red margin colour in the Sketch skin:** the `--sk-margin` token had been dropped while stylesheet rules still referenced it, so the margin rule rendered as nothing. It is defined again.

## [0.7.0] - 2026-08-09

### Added
- **Sketch skin:** a hand-drawn engineering-notebook appearance — ruled paper running under the whole layout, drawn borders, a highlighter swipe for active states, and a hand-drawn app mark that spins while a request is in flight. Typography is Architects Daughter for the interface and Monaspace Radon for code; the code face stays monospaced because the editor measures fixed character cells, and a proportional hand would put the caret in the wrong place.
- **Skin support in the theme system:** themes may declare `meta.skin`, which the renderer exposes as `data-skin` on the document root so a stylesheet can add surface treatment that colour tokens cannot express — paper, ruling, drawn edges. Skins also publish `--skin-font-ui` and `--skin-font-mono`, which take precedence over the UI Font setting; leaving the skin restores that setting.
- **Quick appearance switcher:** the status bar now offers dark, light, and Sketch as three explicit buttons instead of a two-state toggle, and `Ctrl+Shift+L` cycles all three. Switching between dark and light prefers the opposite theme in the same family, so changing mode no longer discards the chosen palette.
- **AI-generated request scripts:** Pre-request, Post-response, and Tests each gained a *Generate with AI* action. The prompt carries the request method, URL, active headers, and body, and attaches the collection's OpenAPI specification when the collection was imported from one. Generated code is appended rather than replacing existing work.
- **Tools as workspace tabs:** JSON Studio and API Docs can be opened in a request tab from the navigation menu's context menu, sitting alongside requests instead of replacing the whole main area. Reopening a tool focuses its existing tab rather than stacking duplicates.
- **Liquid-glass Send button:** the send action is rendered as layered glass with distinct hover, active, and disabled states, tinted from the active theme's accent. Built from `backdrop-filter` and gradients only — the SVG displacement approach does not render in WKWebView or WebKitGTK, and would have degraded on two of the three platforms.
- **Executable JavaScript plugins:** installed plugins can now load their declared entry point, run through request lifecycle hooks, surface notifications, and contribute to real request workflows within the local plugin runtime.
- **Keyboard-accessible core workflows:** interactive cards, rows, tabs, trees, graphs, annotations, and dialogs now support semantic keyboard activation, contextual actions, predictable focus trapping, and focus restoration.
- **Detached API workflows:** a request tab can leave the hub in its own native window without creating a second copy of the request. Its request, response, editor state, and active environment stay local and synchronised when the tab returns.
- **Split Request + Response pop-out:** the third layout action opens two native windows for the current request: a focused composer window and an independent response viewer. They share one live session, so sending or editing in Request immediately updates Response; closing either reunites the workflow in the main hub.
- **Detached Swagger editor:** OpenAPI authoring can now be opened in a dedicated native window, enabling API request/response work and specification editing side by side.

### Changed
- **Wails 3 desktop runtime:** the desktop shell moved from Wails 2 to Wails 3 (`v3.0.0-beta.5`). Backend bindings are now registered as Wails services and exposed through generated TypeScript in `frontend/bindings/`; the `@wailsio/runtime` package replaces the old `wailsjs/runtime` shim and is version-locked to the Go side.
- **Task-based build system:** `wails.json` is replaced by `Taskfile.yml` plus per-platform task files under `build/`. Production builds run through `wails3 task build`, and release metadata (`VERSION`, `BUILD_DATE`, `GIT_COMMIT`) is injected via environment variables.
- **Go 1.26.5 toolchain:** the minimum Go version moved from 1.25.0 to 1.26.5 across `go.mod`, both Docker build images, and all CI jobs (which resolve it from `go.mod`).
- **Linux target consolidated on GTK 3 / WebKitGTK 4.1:** Wails 3 removed WebKitGTK 4.0 support, so the dual-variant Linux release is replaced by a single `gtk3-webkitgtk-4.1` tarball built with the `gtk3` build tag. Release asset names change accordingly.
- **macOS packaging rebuilt for Wails 3:** the `.app` bundle is assembled from an explicit `Info.plist` and a generated icon set, replacing the Wails 2 templating that referenced the removed `wails.json`.
- **Themes own their accent colour:** the runtime previously discarded every theme's accent and repainted it with a fixed purple, which silently gutted accent-defined themes and left the accent fields in the advanced theme editor decorative. adOmnia's purple now lives where it belongs — in the default theme's own definition.
- **The welcome screen follows the active theme:** its palette was hardcoded — a violet wash, slate greys, fixed card accents — and ignored the design tokens, so every theme rendered the same purple page. All of its colours now resolve through the tokens.
- **Dependencies refreshed:** all Go modules updated to their latest compatible releases. `github.com/digitorus/pdf` is deliberately held at `v0.1.2` — `v0.2.0` unexports `Reader.Resolve`, which `pdfsign v0.9.0` still calls.
- **Explicit update checks:** update lookups now run only after a user action, removing automatic network requests during application startup.
- **Complete core-workflow localization:** the primary product workflows now provide consistent English and Italian copy, including dialogs, feedback, errors, and accessibility labels.
- **Modern request tabs:** tabs now use Radix UI's accessible tab primitive, retain drag/pin/close actions, respond to arrow-key navigation, and use softer rounded geometry with a clearer active focus state.

### Fixed
- **Desktop backend reported as unavailable:** fourteen modules detected the backend by probing the Wails 2 `window.go` global, which does not exist in Wails 3. Persistence, flow storage, Markdown, Git Sync, MCP, Docker Lab, browser debugging, the folder picker, and the collection filesystem all reported the backend as missing or quietly fell back to browser storage. Detection now uses the Wails 3 runtime marker, and calls go through the generated bindings.
- **Wrong version number in builds:** the frontend read its version from `wails.json`, removed during the Wails 3 migration, and silently fell back to `1.0.0`. It now reads `build/config.yml` and fails the build when the version is missing, rather than shipping a build labelled with the wrong number.
- **File drag and drop:** the Wails 2 drop configuration was lost in the migration while the renderer still listened for the removed `runtime.OnFileDrop` callback, so dropped files were never read. The window now enables file drop and the renderer listens for the Wails 3 event.
- **UI Font setting had no visible effect:** activating any theme overwrote the monospace font variable, reverting the chosen font across the monospace interface — which is most of the application.
- **Duplicated themes in the theme editor:** built-in themes appeared twice, once under *Built-in* and again under *Custom*, because the custom list rendered the full deduplicated catalogue instead of subtracting the built-ins.
- **Default theme accent:** the default dark theme defined a cyan accent that was hidden by the runtime's fixed purple. It now carries adOmnia purple in its own definition, matching the CSS defaults.
- **Incomplete built-in themes:** all six core themes were missing the required `surface-4` and `border-3` tokens, leaving those surfaces at whatever the previously active theme had set. A test now validates every built-in theme against the schema and checks the Sketch palette against WCAG AA.
- **Menus unreadable in the Sketch skin:** floating surfaces inherited the transparency that lets ruled paper show through the layout, leaving menus, popovers, and dialogs see-through. They now keep a solid surface with a drawn edge and shadow.

### Security
- **Vault-backed persisted credentials:** database and broker connection profiles now persist Vault references instead of plaintext secrets, preserve existing profiles during migration, and redact sensitive values from stored or displayed data.

## [0.6.10] - 2026-08-06

### Fixed
- **Environment variables in JSON requests:** extracting a selected JSON value now preserves its type when the request is sent. Numbers, booleans, and `null` remain unquoted; strings retain valid JSON quotes even when the whole quoted value was selected. The editor also recognises `{{VARIABLE}}` placeholders as valid JSON values while editing, without hiding genuine syntax errors.

## [0.6.9] - 2026-08-06

### Added
- **Extract JSON values into environment variables:** select a value in a JSON editor, right-click, and choose the adOmnia context-menu action to store it in the active environment and replace it with `{{VARIABLE_NAME}}`. Variable names are inferred from the enclosing JSON property and stay unique; a local Development environment is created only when needed.
- **Contextual header-value presets:** focusing a request header value now offers compatible choices for the selected header. Content-Type and Accept include common API media types such as JSON, XML, form data, multipart, Server-Sent Events, NDJSON, JSON:API, GraphQL, SOAP, YAML, CBOR, MessagePack, PDF, and binary payloads.
- **Expanded header preset catalog:** the Headers panel now groups and filters practical presets for content and encoding, authentication/API keys, cache and conditional requests, browser/CORS/proxy work, tracing, webhooks, GraphQL/SOAP, and PSD2/Berlin Group.
- **Request/Response layout switcher:** choose side-by-side panels or stack Request above Response. Both layout and independently resized panel dimensions are saved locally.
- **JavaScript script editor:** Pre-request, Post-response, and Tests now use a local Monaco editor with JavaScript syntax colors, line numbers, bracket matching, completion, and inline syntax errors with line and column details. The dynamic `pm.*` API does not produce false validation errors.
- **Interactive request-body JSON Graph:** nested nodes are joined by clear, colored arrowed connections. Matching `{ n }` references, destination nodes, and arrows share a depth color, and values can be edited inline directly from the graph.

### Changed
- **Coherent request workspace:** the request editor now has a matching `Request` header alongside `Response`, with the layout controls placed directly where they are needed.
- **Clearer empty response state:** the response pane now says "Ready for the response." while retaining the Ctrl+Enter send shortcut.

- **Readable request notes:** the Notes description editor now opens at a practical multi-line height and remains vertically resizable.
- **Monaco 0.56 compatibility:** OpenAPI and script editors now load all local editor workers through the current public Monaco entry points; the script editor is loaded only when its tab is opened.
- **Dependency maintenance:** upgraded `github.com/gabriel-vasile/mimetype` to 1.4.15, `github.com/gaissmai/bart` to 0.29.0, `github.com/rabbitmq/amqp091-go` to 1.13.0, and `monaco-editor` to 0.56.0.
- **Codebase cleanup:** removed obsolete assertion UI and unused client, demo, storage, mock, proxy, and binding paths so the shipped code follows the active product surface.

## [0.6.7] - 2026-07-31

### Fixed
- **Path template preservation:** changing only query parameters or a fragment in the resolved top request bar no longer replaces a `{pathParam}` template with its current literal value.
- **OpenAPI component schemas:** Contract validation now resolves local `$ref` component schemas, so Mock Server and response checks validate the common `#/components/schemas/...` shape correctly.
- **Mock collection isolation:** endpoints imported from another collection are no longer checked against the selected collection's OpenAPI contract.
- **MCP hydration race:** a slow local-storage read cannot overwrite a configuration edited while the MCP Control Room is opening.
- **Dependency security:** upgraded transitive `fast-uri` and `dompurify` versions; `npm audit --omit=dev` now reports zero vulnerabilities.

## [0.6.6] - 2026-07-31

### Added
- **Mock Server contract checks:** the Control Room now validates every active mock response against the selected collection's OpenAPI specification before consumers hit it. It reports undocumented status codes, Content-Type and required-header mismatches, and JSON-schema failures locally and inline.

### Changed
- **Single request URL synchronizer:** the composer and the top request bar now use the same URL update path. Editing a URL keeps query rows and path-parameter keys together, including parameter renames.
- **MCP desktop persistence:** saved MCP server configurations now hydrate from adOmnia's local bbolt storage. Existing browser-only configurations are copied forward automatically and remain available during the migration.
- **Release metadata alignment:** the application and frontend package now share version `0.6.6`.

### Fixed
- **Live path-parameter regression coverage:** URL templates, inline defaults, renamed placeholders, query rows, and rendered path values are covered by automated tests.
- **Path-param helper copy:** the Params panel hint no longer renders a broken text-encoding sequence.

## [0.6.5] - 2026-07-31

### Fixed
- **Live path parameters:** `{id:value}` is resolved as path key `id` with value `value`, and changing a Path Params value updates the visible request URL immediately.

## [0.6.0] - 2026-07-22

### Added
- **Swagger Editor workspace redesign:** the section now opens straight into a live editor/preview split (no landing card), powered by the Monaco editor with offline workers — syntax highlighting, folding, find/replace, format, cursor position, and inline error markers on the offending line.
- **Schema-aware OpenAPI IntelliSense:** completion and hover for YAML (`monaco-yaml`) and JSON (native) against the OpenAPI 3.0 meta-schema, plus `$ref` completion of the document's own component names.
- **Swagger preview parity (dark):** rendered markdown in descriptions with external links, an OpenAPI version badge (e.g. `OAS 3.2`), per-tag "Find out more" external-docs links, a switchable media-type dropdown for request/response bodies, JSON example syntax highlighting, and endpoint search/filter — all on the adOmnia design system.
- **Mock this tab in context:** opens the Mock Server on the Endpoints view with the chosen request selected and a focused request scope, applied live without changing the port or restarting.
- **Mock Server Control Room:** Overview / Endpoints / Traffic / Contract views, an endpoint explorer with inspect/edit, manual endpoint creation, and explicit (no longer automatic) collection import that preserves the source collection.
- **Mock traffic diagnostics:** each request shows the mock's decision (selected endpoint, chosen response, or error reason), rows link to the endpoint involved, and Clear now empties the backend log.
- **Live mock runtime updates:** a runtime configuration endpoint atomically swaps mock endpoints while the server runs (port stays fixed).
- **AI system-environment credentials:** a "Use system environment credentials" mode in Settings > AI Engine that bypasses the Vault entirely and reads the key only from the machine environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `HUGGINGFACE_API_KEY`/`HF_TOKEN`, `OPENAI_COMPATIBLE_API_KEY`, and the `ADOMNIA_AI_API_KEY` fallback).

### Changed
- **OpenAPI 3.2 QUERY:** the QUERY method is parsed and rendered as a first-class operation in the Swagger preview.
- Optional provenance metadata (`sourceCollectionId`, `sourceRequestId`) is stored on saved mock endpoints; existing configurations remain valid.

## [0.5.9] - 2026-07-19

### Added
- **Swagger Try it out to API Core:** API Docs operations now open directly in API Core collections for immediate request testing from the Swagger-style preview.
- **Pinned tab protection:** pinned request tabs are compact and cannot be closed by single close, close-left/right, close-all, or request deletion tab cleanup.
- **Modern desktop UI polish:** command palette/drop overlays, tab save feedback, resize handles, response diff flashes, network mini-timeline, and compact Raycast-style toasts now share a cohesive interaction layer.

## [0.5.8] - 2026-07-19

### Changed
- **Swagger Editor preview fidelity:** API Docs now renders operations closer to Swagger UI, with light preview styling, method-colored endpoint cards, visible parameters/request body/response sections, generated JSON examples from schemas, and a response table layout.

### Fixed
- **OpenAPI YAML fallback validation:** lenient YAML parsing now rejects structurally broken documents instead of silently treating them as valid specs.

## [0.5.7] - 2026-07-18

### Changed
- **Swagger Editor in API Core:** API Docs is now a Swagger Editor-style workspace with YAML/JSON editing, live preview, a split editor/preview layout, preview-only mode, adjustable pane width, and quick conversion between OpenAPI/Swagger specs and API Core collections.

## [0.5.6] - 2026-07-18

### Added
- **HTTP QUERY method support:** adOmnia now supports the new HTTP `QUERY` method standardized by RFC 10008. `QUERY` sits between `GET` and `POST`: it allows a complex read-only search to be sent in the request body while preserving safe and idempotent semantics.
- **QUERY across the API workspace:** `QUERY` is available in the request composer, top request bar, tab labels, collection tree, request import/export, API Docs parsing, HAR/browser debug views, load testing, Net Tools CORS checks, Mock Server endpoints, and generated client snippets.
- **QUERY-aware code generation:** generated examples now use generic request APIs where a language or library has no native `query()` helper, including Python `requests.request("QUERY", ...)`, C# `new HttpMethod("QUERY")`, Java OkHttp `builder.method("QUERY", body)`, Ruby `Net::HTTPGenericRequest`, and Rust `reqwest::Method::from_bytes`.
- **Mock Server QUERY examples:** mock presets and tab-to-mock actions can create `QUERY` endpoints with JSON search responses, and mock CORS headers advertise `QUERY`.

### Changed
- **Lean default product surface:** adOmnia now starts lighter around API Core, Protocols, Document Studio, and Power Tools, while heavier areas such as Browser Debug, Database Studio, and Git Sync are treated as advanced features.
- **API Core placement:** Mock Server and Proxy Interceptor now live under API Core so API authoring, mocking, and interception stay close together.
- **JSON Studio placement:** JSON Studio is promoted ahead of Notes/Markdown so JSON payload work is immediately available from the primary workspace.
- **URL input cleanup:** pasted API URLs are normalized by trimming surrounding spaces and removing line breaks/tabs that would otherwise produce malformed requests.

### Fixed
- **Release test fixture restored:** the collection contract freeze fixture is present again so backend collection filesystem tests can run during release checks.

### QUERY Usage Notes
Use `GET` when the request is simple and naturally fits in the URL:

```http
GET /transactions?status=COMPLETED&from=2026-01-01&limit=100
```

Use `QUERY` when the search is read-only but too complex for a query string:

```http
QUERY /transactions
Content-Type: application/json

{
  "statuses": ["COMPLETED", "PENDING"],
  "dateRange": {
    "from": "2026-01-01",
    "to": "2026-06-30"
  },
  "accountIds": ["ACC-100", "ACC-200", "ACC-300"],
  "sort": [
    {
      "field": "bookingDate",
      "direction": "DESC"
    }
  ]
}
```

`QUERY` is useful for advanced transaction searches, account movement filters, dynamic reporting, search engines, complex catalog filters, long identifier lists, nested `AND`/`OR` conditions, aggregations, grouping, SQL-like queries, or proprietary read-only DSLs.

Continue using `GET` for simple reads such as:

```http
GET /transactions/123
GET /transactions?status=PENDING&page=0&size=20
GET /accounts/456/balance
```

Do not use `QUERY` for commands or mutations:

```http
POST /payments
POST /transfers
POST /accounts/123/block
```

Rule of thumb: simple filter and reasonable URL -> `GET`; complex read-only search with body -> `QUERY`; creation or data mutation -> `POST`, `PUT`, or `PATCH`.

| Aspect | GET | QUERY |
| --- | --- | --- |
| Search data | URL/query string | Request body |
| Body semantics | Not defined | Expected and meaningful |
| Modifies data | No | No |
| Idempotent | Yes | Yes |
| Automatic retry | Safe | Safe |
| Bookmark/share URL | Yes | Not directly |
| Cache | Simple and widespread | Possible, but the cache key must include body and request metadata |

For `QUERY`, the body and its `Content-Type` formally define the search. Servers should reject requests with missing or inconsistent `Content-Type`. `QUERY` responses are formally cacheable, but caches must consider the request body and metadata, so support is more complex than for `GET`.

## [0.5.5] - 2026-07-17

### Added
- **Standalone JSON Studio:** the left rail now exposes a dedicated JSON workspace with Raw as the first/default view, formatted tree inspection, graph view, fullscreen mode, file/drop loading, search, copy, clear, minify, and persisted local session state.
- **Two-pane JSON comparison:** JSON Studio can open a second JSON document on the right, keep both panes fullscreen side by side, sort object keys A-Z, and show path-level differences.
- **Lossless JSON utilities:** JSON formatting, sorting, minifying, and diffing preserve long numeric tokens without rounding or rewriting their original spelling.
- **Feature Surface settings:** Settings now includes switches for advanced features, lab features, Plugins, and Daily Scenarios so the product surface can stay cleaner by default.

### Changed
- **Cleaner product taxonomy:** the rail is now driven by a central feature registry and grouped around API, Protocols, Infrastructure, Browser Debug, Local Data, Tools, Docs, and Workspace.
- **Command palette alignment:** the command palette now uses the same feature registry and respects advanced/lab visibility settings.
- **Focused Welcome hub:** the first screen now emphasizes API-first workflows and payload/document work instead of presenting every module with equal weight.
- **Document Studio cleanup:** advanced document tools can be hidden behind feature flags instead of crowding the primary rail.
- **Net Tools consolidation:** Net Tools now route through Browser Debug, keeping network inspection in one coherent workspace.
- **Power Tools split:** Base64, Hash, JWT, Password, and UUID utilities were moved into focused tool components with a shared utility registry.

### Removed
- **Duplicate legacy JSON Tools panel:** JSON workflows now live in the dedicated JSON Studio instead of the old Utils-embedded panel.
- **Public legacy rail aliases:** `jsontools`, `utils`, `nettools`, and `kafka` were removed from the active rail type surface; startup normalization still maps old saved values to the new destinations.

### Fixed
- **Browser-safe Wails fallbacks:** local preview can render the new frontend routes without crashing on missing desktop bindings.
- **Rail visibility regressions:** advanced/lab filtering is now applied consistently to the rail and command palette.

### Fixed
- **Reliable gRPC Studio execution:** load tests now classify the actual gRPC status instead of treating every HTTP 200 as success, and they carry metadata, TLS, custom CA, mTLS certificates, and request timeout settings into every invocation.
- **Honest descriptor and connection state:** imported proto/protoset descriptors remain available for offline request authoring without pretending a live server connection; changing endpoint, TLS, certificates, or profile invalidates the previous connection state.
- **Reproducible gRPC history:** call history now preserves and restores metadata, TLS/mTLS paths, and timeout settings for accurate reruns.
- **Safe request defaults:** new gRPC sessions no longer send demonstration authorization metadata automatically.

### Added
- **Live cancellable gRPC streaming:** server and bidirectional stream messages are delivered incrementally through the local sidecar, with an in-place Cancel action, configurable timeout, response headers, and trailers.

## [0.5.1] - 2026-06-27

### Added
- **Versionable collection folders:** collections can now be exported as deterministic, diff-friendly folders with stable metadata, folder/request JSON files, Windows-safe names, and a sync manifest. The importer reconstructs the collection tree from disk and round-trips the exported structure deterministically.
- **Collection folder workflow in Git Sync:** the Git Sync panel includes a `Collection Folder` section for exporting the selected collection, importing a folder-backed collection, and checking drift between the in-app collection and the folder projection.
- **Headless collection runner foundation:** the desktop executable now supports `adomnia run <collection-folder>` without opening the Wails UI. The runner imports folder-backed collections, executes supported HTTP requests through the Go transport, supports CLI/JSON reports, `--out`, `--bail`, `--env`, and `--env-var KEY=VALUE`.
- **CI-ready runner output:** the headless runner now supports `--folder` for focused folder runs and `--reporter junit` for pipeline-readable XML reports.
- **Shared request execution contract:** GUI and headless execution now share a stable request-resolution layer for variables, path params, query/header/body resolution, simple auth, and assertion evaluation.
- **OpenAPI governance lint engine:** added the local `internal/oaslint` engine with built-in rules for operation IDs, descriptions, response coverage, JSON response schemas, tags, security requirements, path naming, duplicate operation IDs, local ruleset overrides, and structured JSON/text reporting.
- **CI-ready OpenAPI lint CLI:** the desktop executable now supports `adomnia lint <openapi.json|openapi.yaml|collection-folder>` with `--ruleset`, `--reporter text|json`, `--out`, and `--fail-on-warn`, returning non-zero exit codes for blocking governance errors.
- **Collection and folder inheritance foundation:** folder-backed collections can now carry shared auth, headers, variables, and scripts, with a single resolver applying top-down inheritance to headless runner requests. Collection bearer auth, folder headers, request overrides, and disabled inherited headers are covered by backend tests.
- **Git-safe environment workflow:** the headless runner loads a collection-local `.env` with deterministic precedence below named environments and CLI overrides. The environment editor can mark an environment private; private environments stay in local bbolt storage and are excluded from collection-folder and workspace-file exports. Public secret variables are exported as empty placeholders, and stale environment files are removed when an environment becomes private.
- **OpenAPI governance in API Docs:** API Docs now includes an integrated Governance view powered by the same local lint engine as the CLI, with severity badges, searchable/filterable findings, local ruleset overrides, and navigation from a violation to its documented operation.
- **Advanced headless runtime parity:** `adomnia run` now supports non-interactive OAuth2 grants, AWS Signature v4, explicit Vault values from CI environment variables, a run-scoped cookie jar, multipart fields/file uploads, sandboxed pre/post/test scripts, and OpenAPI response-contract validation.
- **Single-request collection export:** Git Sync can update only the active request in an existing collection-folder projection, preserving its path and sequence so a request edit produces a one-file Git diff.

### Changed
- **Request sending now records a resolved request contract before transport:** the existing GUI send path still calls the same backend transport, but the resolved request shape is now explicit and covered by tests.

### Notes
- Interactive OAuth authorization-code/PKCE remains a desktop browser flow. Headless automation uses client credentials, password, or refresh-token grants, and injects Vault-backed values through explicit process environment variables without exposing ciphertext or plaintext in reports.

## [0.4.8] - 2026-06-25

### Added
- **Save a response value as an environment variable:** right-click any value in the response Body (or a Headers value) and choose *Save as environment variable…* — pick the name (the JSON key is suggested automatically) and the target environment. Perfect for capturing a token from a getToken-style response straight into `{{access_token}}`. A *Copy value* action is included in the same menu.

### Changed
- **System titlebar is now the real default:** existing installs that still carried the legacy in-app titlebar are migrated to the native system titlebar on launch (explicit choices are preserved). New installs already defaulted to it.

### Fixed
- **Welcome hub search hint readability:** the "Press Ctrl/Cmd + F to search any feature" badge was nearly invisible on the light theme — it now uses theme-aware contrast.
- **PSD2 / Berlin Group header presets visibility:** the quick-add presets area is taller so the Berlin Group section is no longer hidden below the Common headers.

## [0.4.7] - 2026-06-25

### Added
- **PSD2 / Berlin Group header presets:** the request Headers tab now offers the NextGenPSD2 (XS2A) standard headers — `Consent-ID`, `PSU-ID`, `PSU-IP-Address`, `TPP-Redirect-URI`, `Digest`, `Signature`, `TPP-Signature-Certificate`, `Aspsp-Sca-Approach`, and more — as one-click chips, grouped separately from the common headers.

### Changed
- **Environments & Hosts moved into the sidebar (more vertical room):** the Env and Hosts switchers no longer sit in a strip above the request — they live in the left sidebar under the Workspace selector, right above Collections. Switching, adding, renaming, and editing environments/hosts all happen from there. The request method + URL bar now sits higher, giving the Body/Response area more space.
- **Workspace name in the panel header:** the API Workspace header shows the active workspace name (live — rename it in the sidebar and the header updates) instead of a static "API Workspace" label.
- **Clearer header presets and labels:** preset chips that share a value (e.g. `application/json` for both Accept and Content-Type) now show the full `Header: value` so they are no longer ambiguous duplicates, and the Headers tab columns read **Header name / Header value** for consistency with the Cookies tab.

### Added
- **GitHub host integration (Pull Requests):** connect with a Personal Access Token, list open pull requests for the origin repository, and open a PR from the current branch — without leaving adOmnia. Available in the Git "Actions" tab.
- **Multi-host Git collaboration accounts:** save multiple GitHub, GitLab, Bitbucket, and Azure DevOps identities, auto-select them from the repository remote, and protect access tokens with local Vault references. Self-hosted API base URLs are supported.
- **AI pull request drafts:** generate a reviewable PR title and Markdown description from the actual base-to-branch diff using the AI provider configured in adOmnia.
- **Repository terminal:** run shell and Git commands with the active repository as CWD, inspect output and exit status, and refresh the Git graph/status immediately after every command.

### Changed
- **Request editor hierarchy:** primary request sections now use full active tabs, body examples use selectable tab-cards with rename/duplicate/delete actions, and payload formats use a distinct segmented control with clearer labels and keyboard focus states.

## [0.4.6] - 2026-06-25

### Added
- **Cancel in-flight requests:** while a request is running the **Send** button turns into a red **Cancel** button, so a slow or hung request can be aborted immediately. Cancellation is wired end-to-end — the Go backend registers each request by id and aborts the underlying connection (both the native HTTP path and the browser-fetch upload path). Cancelled requests report a clean `CANCELED` status instead of a misleading error.
- **Close All tabs:** new **Close All** action in the tab context menu, alongside Close / Close to the Right / Close to the Left. Honors the unsaved-changes confirmation dialog.
- **Create an environment straight from the URL bar:** right-clicking an `{{variable}}` token in the URL when no environment exists now creates one on the spot and opens the inline value editor, so the variable can be given a value without leaving the request.

### Changed
- **Collapsible API Tools bar (cleaner, more minimal layout):** the API Tools row (Follow redirects, Load test, Timeout, URL Encode, Query String, Import cURL, HTTP Status) is now hidden by default and toggled with a small control next to **Send**. Collapsing it gives the Body/Response area more vertical room; the open/closed state is remembered between sessions.

### Removed
- **Settings → Features section:** removed the non-functional "Plugins (experimental)" and "Daily Scenarios (experimental)" toggles and their navigation entry.

### Notes
- adOmnia has request timeouts: a per-request **Timeout (ms)** field (`0` = no timeout) plus a global default in **Settings → Requests**. Requests exceeding the timeout fail with a `TIMEOUT` status — the same model used by Postman/Bruno.

## [0.4.0] - 2026-06-20

### Added
- **Git client overhaul — professional, single-repo workflow now substantially complete (34/40 GitKraken-class features):**
  - Granular staging: separate Staged/Unstaged sections, per-file and per-hunk/per-line stage/unstage, and partial commits (`CommitPaths`).
  - Full branch management: checkout of local and remote (tracking) branches, delete local/remote, and set-upstream.
  - Complete stash workflow: apply/show/drop per stash entry plus stash of selected files only.
  - Three-way conflict editor: Base/Ours/Theirs side by side with an editable merged result, saved and staged in-app.
  - Generic undo via reflog: restore to an earlier recovery point (soft/mixed/hard) beyond the last commit.
  - Visual blame and file history: per-line gutter and a navigable per-revision diff timeline.
  - AI assistance on staged changes, working changes, and branch level (commit message generation, explanation, risk scan).
  - Named Git profiles with per-host auto-switch, plus persistent repo/branch pins.
  - Advanced repository support: worktrees, submodules, and sparse checkout with UI.
  - Virtualized/lazy commit graph and extended drag & drop (branch→branch, commit→branch, file→stage).
  - Azure DevOps deep-links (commit/compare) for HTTPS, SSH `v3`, and Visual Studio hosts.
- Advanced HTTP load-test workflows in the Composer drawer: named scenarios, persisted results, baseline comparisons, and Markdown/HTML reports.
- gRPC load testing directly from gRPC Studio.
- Full bbolt snapshot export/restore and legacy localStorage migration controls in Storage Explorer.
- Active-session administration for WebSocket and SSE clients, plus configurable Proxy breakpoint patterns.
- Backend-powered RFC 6902 JSON patches and X.509 certificate inspection in Power Tools.

### Fixed
- `Push`/`Pull` no longer fall back to a hardcoded `main`/`master` when no branch is passed: the checked-out branch is resolved via `symbolic-ref`, with an explicit error on detached HEAD.
- `git status --porcelain` parsing no longer corrupts the first entry (column-0 space is preserved).

### Removed
- Orphaned Scheduler frontend bindings and the misleading RabbitMQ exchange-info endpoint, which only performed a connection check.

## [0.2.2] - 2026-06-14

### Added
- **PDF Editor** panel: view, annotate (free text, highlight, shapes, ink), fill
  AcroForm fields, place a visible signature, and export a flattened PDF. Projects
  are re-editable and persisted locally (bbolt). Open via drag-drop, file picker, or
  the "Open in PDF Editor" action on `application/pdf` API responses.
- **Cryptographic PDF signing** with `digitorus/pdfsign` (real ByteRange/CMS
  signatures), including signature verification from the toolbar.
- **Enterprise signing tier:**
  - Import **PKCS#12 (`.p12`/`.pfx`) and JKS** keystores directly in the signing
    dialog (pure-Go, no `keytool`/`openssl`); the private key is extracted in the
    backend and never reaches the frontend.
  - **Inspect certificate** before signing — shows subject, issuer, validity, and
    chain length without exposing the private key.
  - **RFC 3161 timestamping** via a configurable TSA URL (optional basic auth; URL
    can be remembered, credentials never stored).
  - **Long-term validation (LTV)** — embeds the certificate chain plus OCSP/CRL
    revocation data into the document DSS.
- Read-only **API Docs / Swagger viewer** (OpenAPI 3 and Swagger 2.0).
- GitHub Actions desktop artifact pipeline for Windows, Linux, and macOS.
- Layered hub layout for the main desktop workspace.
- Runtime support for request scripts and test/post-response execution.

### Changed
- Improved Markdown layout and Git diff workflow.
- README download instructions now point users to GitHub Releases and Actions artifacts.

### Fixed
- OpenAPI import now also accepts PDF-sourced specs.
- Linux Docker artifact export no longer creates a container from a scratch image.

### Out of scope
- PKCS#11 / HSM / smart-card signing (requires native OS drivers; conflicts with the
  single portable executable) and PAdES B-LTA archive-timestamp refresh.

## [0.1.0] - unreleased

Initial public packaging target.

### Included
- Wails 2 desktop shell with Go backend and React/TypeScript frontend.
- API workspace, environments, scripts, assertions, response viewer, and import tooling.
- SOAP, gRPC, WebSocket/SSE, brokers, mock server, proxy, browser debugging, database tools, vault, and utilities.

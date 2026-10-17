# Code Studio — Technical Reference

Complete technical reference for the IDE inside adOmnia: the **adOmnia IDE Platform**
(shared core + language adapters) and its user-facing surface, **Code Studio**.

This document is organized by area and covers everything implemented so far. It is the
*engineering* companion to the user guide:

| Document | Purpose |
| --- | --- |
| **This document** | Architecture, modules, adapters, UI surface, bindings, invariants, status |
| [`CODE-STUDIO.md`](CODE-STUDIO.md) | User-facing guide: how to use Code Studio feature by feature |
| [`architecture/ide-multilanguage-refactor.md`](architecture/ide-multilanguage-refactor.md) | The migration plan "Code Studio → adOmnia IDE Platform" (Phases 1–12, complete) |
| [`LIVE-PREVIEW.md`](LIVE-PREVIEW.md) | Live Preview / web projects deep dive |
| [`adomnia-feature-catalog.en.md`](adomnia-feature-catalog.en.md) (section J) | Feature checklist of the Code Studio |
| [`../internal/ide/CLAUDE.md`](../internal/ide/CLAUDE.md) | Hard rules and placement decision tree for IDE code |

Status statements in this document are dated **2026-10-17**. Numbers that change over
time (test counts, bundle size, tool versions) carry their date and are snapshots, not
guarantees.

---

## 1. Naming and terminology

| Term | Meaning |
| --- | --- |
| **Code Studio** | The user-facing IDE feature of adOmnia ("the Code Studio built into adOmnia"). |
| **adOmnia IDE Platform** | The architecture underneath: a language-agnostic core with pluggable language adapters. |
| **IDE core** | `internal/ide/*` — language-agnostic packages. Never imports adapters or Go tooling. |
| **Language adapter** | `internal/languages/<id>` — implements the adapter contract for one language family (`golang`, `web`). |
| **Host** | `internal/codestudio` — composition root + `GoIDE` Wails facade. Registers adapters, wires the core. |
| **Language contribution** | Frontend side of a language: `frontend/src/components/ide/languages/<id>/` (icons, menus, Monaco languages). |
| **Project / Unit** | One open folder is a *Project* containing zero or more build *Units* (`project.Unit{Language, Kind, Root, Name, Manifest}`). A monorepo = one project, many units. |
| **Trust** | A project is `opened` (read/save only) until `tooling-permitted` (*Trust Project Tools*). **Opening is not trusting; nothing runs implicitly.** |
| **Studio Workspaces** | Named sets of open projects inside Code Studio (max 20, `default` always present). Distinct from adOmnia API workspaces. |

Go is a *consumer* of the platform, not the platform itself: the core has no Go-specific
code, and the UI never hard-codes the language id `'go'`.

---

## 2. Architecture at a glance

```text
frontend (React)                         Go / Wails
──────────────────────────────────────────────────────────────
components/code-studio/   (Code Studio UI shell)   code_studio_bindings.go   ← stable Wails facade `GoIDE`
components/ide/     (language contribs)          │
        │  generated bindings                    ▼
        └──────────────► bindings/adomnia/goide.ts
                                              internal/codestudio            HOST: composition root,
                                                  │                     Service facade, gopls/Delve
                          ┌───────────────────────┼─────────────────┐   config, persistence
                          ▼                       ▼                 ▼
                  internal/ide/*            internal/ide/*   internal/languages/{golang,web}
                  (core: lsp, dap, run,     (language        ADAPTERS: implement the contract,
                   testing, sdk, process,    contract +       build ServerSpec / CommandSpec /
                   preview, graph, …)        registry)        AdapterSpec
```

**Dependency direction:** `internal/codestudio` → `internal/ide/*` ← `internal/languages/<id>`.

**Enforced by tests (build breaks on violation):**

- `internal/ide/architecture_test.go`
  - `TestCoreDoesNotImportLanguageAdapters` — `internal/ide/...` must not depend on `internal/languages/`, `internal/codestudio`, `golang.org/x/mod`, `golang.org/x/tools`, `golang.org/x/exp/trace`, or `github.com/google/pprof`.
  - `TestLanguageAdaptersDoNotImportHost` — `internal/languages/...` must not depend on `internal/codestudio`.
- `internal/ide/process_launch_guard_test.go` — every background process in the repo must be spawned through `internal/procutil` (hidden consoles, process groups); a small allowlist of *visible* launchers exists.
- `internal/codestudio/architecture_test.go` — host-side layering rules.

**Hard rules** (from `internal/ide/CLAUDE.md`): no `switch language` in the core (capabilities
are discovered by type assertion), no feature logic in binding files, no per-session state
in globals, every persisted format needs a loader migration, every process launch is gated
on `session.Project.Authorization == AuthorizationPermitted`.

---

## 3. The language adapter contract (`internal/ide/language`)

The only mandatory interface is `Language`:

```go
type Language interface { ID() string; Name() string }   // stable lowercase id, e.g. "go"
```

Optional capabilities are discovered **by type assertion** (never hand-declared; add one
only when a real core consumer exists):

| Interface | Purpose | Implemented by Go | Web |
| --- | --- | --- | --- |
| `ProjectDetector` | `DetectUnits(ctx, root)` — recognize build units | ✔ | ✔ (script + html adapters) |
| `DocumentSelector` | `DocumentLanguageID(path)` — file ownership + LSP languageId | ✔ | ✔ |
| `UsageClassifier` | declaration / write / read / import from syntax | ✔ | — |
| `DeclarationExtractor` | declaration source for quick-definition | ✔ | — |
| `Runner` (`run.Runner`) | `RunKinds()` + `CommandSpec(Request)` | ✔ | — |
| `RunTargetResolver` | discover/resolve runnable targets | ✔ | — |
| `TestRunner` (`idetesting.TestRunner`) | test command + `EventParser` | ✔ | — |
| `DebugAdapterProvider` (`dap.DebugAdapterProvider`) | `AdapterSpec` for the debug adapter | ✔ (Delve) | — |

There is deliberately **no `LanguageServerProvider` interface**: an adapter builds an
`lsp.ServerSpec` directly (`gopls.GoplsServerSpec`, `web.ServerSpec`).

**Registry** (`language.Registry`, one per service, never global):
`Register` (fail-fast on invalid id — `^[a-z][a-z0-9+#._-]{0,31}$` — or duplicates),
`Get`, `Unregister`, `All` (registration order), `ForPath` (first `DocumentSelector` wins),
`DetectUnits` (fans out to all detectors; failures are joined, found units never hidden).

**Capabilities exposed to the UI** — `GetCapabilities().languages: []language.Info`, built
by `language.InfoOf`: `{ id, name, capabilities: { debug, run, tests, projectDetection,
documents, usages, declarations } }`. Registered today (2026-10-17):

| id | name | capabilities |
| --- | --- | --- |
| `go` | Go | all seven |
| `typescript` | TypeScript / JavaScript | projectDetection, documents |
| `html` | HTML | projectDetection, documents |
| `css` | CSS | documents |
| `json` | JSON | documents |

Registration point: `internal/codestudio/languages.go` (one line per adapter: `golang.New()`,
`web.Languages()...`).

---

## 4. Project model (`internal/ide/project`)

- `Unit{Language, Kind, Root, Name, Manifest}` — kind examples: `module` (go.mod),
  `workspace` (go.work), `loose` (stray `.go` dirs), `node` (package.json), `static`
  (index.html without package.json).
- `IgnoredDirectory` — fixed deny-list (`.git`, `node_modules`, `vendor`, `bin`, `dist`,
  `__pycache__`, `.venv`, …).
- `EnsureWithin(root, candidate)` — the central containment check used by everything that
  touches paths (preview server, SDK extraction, run targets, env files). Symlink-aware.
- `gitignore.go` — a `.gitignore` subset parser (`*`, `?`, `**`, `/`-anchoring, `!`
  negation, last-match-wins) used by the watcher, search and quick open.

---

## 5. IDE core modules (`internal/ide/*`)

### 5.1 `language` — contract + registry
See §3. Capability flags: `Debug/Run/Tests/ProjectDetection/Documents/Usages/Declarations`.

### 5.2 `lsp` — LSP subset
- `jsonrpc.go` — `Conn` (JSON-RPC over stdio, `Content-Length` framing): `Call`, `Notify`,
  `$/cancelRequest` on context cancel, pending-request limit (backpressure →
  `ErrTooManyPendingRequests`), 64 MiB message cap.
- `supersede.go` — `CallLatest` (latest-wins per (uri, method) for read-only editor
  queries), `CancelDocument` (invalidate pending reads on buffer change/close).
- `server.go` — `ServerSpec{Language, Name, Binary, Arguments, Environment,
  InitializationOptions, Configuration, WatchesFile}`; one server per (session, language).
- `protocol.go` — `Position` (zero-based, UTF-16 columns), `Range`, `TextEdit`,
  `WorkspaceEdit.Normalize()` (merges `changes` + `documentChanges`; only non-overwriting
  *create* file ops accepted — rename/delete rejected), `Diagnostic`, `Hover`,
  `CompletionItem`, `CodeAction`, `PrepareRenameResult`, …
- `text.go` / `incremental.go` — `OffsetForPosition`, `ApplyEdits` (atomic,
  overlap-rejecting), `IncrementalChange` (one contiguous replacement that never splits
  UTF-8 runes or CRLF pairs).

### 5.3 `dap` — Debug Adapter Protocol
- `AdapterSpec{AdapterID, Executable, Arguments, Transport (Stdio|TCPListen),
  ReadyPattern, Address, Detach, Launch(), ExplainError, RetryEvaluate, PanicFunction}` —
  built by the adapter (Delve for Go).
- `Client` — ordered event channel, 32 MiB frame cap, rejects inverse requests
  (`runInTerminal`).
- `DebugManager` — `Start` (spawn → endpoint discovery via `ReadyPattern` → TCP connect,
  or stdio, or `startRemote` for an already-listening adapter), `Step`
  (continue/pause/next/stepIn/stepOut), `Threads`, `StackTrace`, `Scopes`, `Variables`,
  `Evaluate` (watch/repl/hover with adapter hooks), `Disassemble`, `Stop`, `Shutdown`.
  States: `starting/running/stopped/terminated`. Events: `debug.state`, `debug.output`,
  `debug.breakpoints`, `debug.functionBreakpoints`.
- `breakpoints.go` — line breakpoints (`Condition`, `HitCondition`, `LogMessage`,
  `Disabled`; legacy int form still loads), function breakpoints (`StopOnPanic` via
  `PanicFunction`, e.g. `runtime.gopanic`), `RunToCursor` (temporary breakpoint, with
  line-borrowing fallback when the line already holds a conditional BP), adapter-verified
  `BreakpointState`, per-project storage. Limits: 1000-char conditions, 100 function BPs,
  one BP per line, 500 variables / 200 frames / 200 instructions per view.
- Handshake `initialize → launch → initialized → setBreakpoints → configurationDone`;
  graceful `disconnect` (`terminateDebuggee` unless detach) before forced tree-kill.

### 5.4 `run` — run configurations, processes, tools
- `Configuration` — the flat, Git-shared persisted DTO (`.adomnia/run-configurations.json`):
  `Language`, `LanguageOptions` (opaque per-adapter JSON), `Kind`, `Target`, `Files`,
  `WorkingDirectory`, `ProgramArguments`, `Environment` (with `Secret` flag), `DockerOptions`,
  `EnvFile`, `Port` (pre-check), `PreRun`/`PostRun`/`Compound`, `Shared`, `Pinned`,
  `RestartOnSave`, `RestartPolicy`, `Order`. Max 50 per session; snapshots redact secrets.
- `Runner` (adapter capability) → `CommandSpec` — **structured argv, never a shell string**.
- `ProcessManager` — 8 concurrent runs, 4 MiB console buffer, 256 pending output events,
  100-execution history, UTF-8-safe output chunking, truncation notices, `WriteStdin`
  (64 KiB), tree-kill with `OnStop` hook (e.g. `docker stop`). Events `run.started`,
  `run.output`, `run.finished`.
- `tools.go` — Make / Docker build / Docker run / Docker Compose with strict rules:
  make targets and `VAR=val` only (flags via `MAKEFLAGS`), volumes must be project-relative
  (no arbitrary binds, no docker socket), secret build-args passed as bare `KEY` with the
  value in process env (never on the command line), `docker run` only after a successful
  build, `compose stop` on Stop, `WaitComposeReady` readiness probing.
- `environment.go` / `parameters.go` / `workflow.go` / `targets.go` — project-confined
  `.env` loading (256 KiB), parameter fill-in + `PORT` injection, Pre/Main/Post chains and
  compounds (2–10 configs, no nesting), run-target discovery/validation (symlink-aware).

### 5.5 `testing` — test runs
Adapter supplies `TestCommand(Request) → (run.CommandSpec, EventParser)`; the `Manager`
aggregates events into a result tree correlated **by package/test identity, never text
heuristics** (`Tree`). States `running/pass/fail/skip/timeout/bench`; benchmark samples for
`-count=N`; race reports captured; 250 ms throttled publication; limits 5000 nodes,
64 KiB output/node, 4096 outcomes, 200 benchmark samples; max 20 retained runs.

### 5.6 `process` — platform process primitives
Hidden consoles on Windows (`CREATE_NEW_PROCESS_GROUP`), `Setpgid` on Unix, whole-tree
termination (`taskkill /T /F` / `kill(-pgid, SIGKILL)`), CTRL_BREAK interrupt helper on
Windows (cached compiled `ctrlbreak-v1.exe`), default shell discovery, and the
**managed-child registry**: JSON file (0600) of supervised children (gopls, DAP adapters)
swept after crashes — PID-reuse safe (executable-name match) — plus Windows Job Objects
(`KILL_ON_JOB_CLOSE`) as a containment layer.

### 5.7 `sdk` — toolchain plumbing (shared by all languages)
Environment assembly/validation (128 entries × 32 KiB; credential-bearing URLs never
persisted; net-policy proxy/CA/offline applied), `ToolSearch` candidate ordering
(custom → managed dir → language dirs → PATH), bounded version queries (8 s), a
process-wide tool-version cache, and hardened archive handling (`Download` with SHA-256
verification; `ExtractArchive` rejects path traversal, symlinks, special entries, zip bombs).

### 5.8 `security` — static scanner core
Language-agnostic `Scan(root, analyzers...)` with pluggable `Analyzer`s: built-in
`SecretsAnalyzer` (private keys, AWS/GitHub/GitLab/Stripe/OpenAI/Slack/Google tokens, JWTs,
connection-string passwords; entropy heuristics; masked output) plus adapter rule packs.
Findings carry stable `Fingerprint`s, motivated suppressions (**reason mandatory**, inline
marker `// adomnia:security-ignore rule1,rule2: reason`) and a versionable baseline
(`.adomnia/security.json`, format `adomnia-security` v1). Walk limits: 1 MiB files,
5000 findings, binary sniffing.

### 5.9 `preview` — Live Server
The language-agnostic Live Server, on `127.0.0.1`, tied to the project session:
- `ModeStatic` — adOmnia's own static server: GET/HEAD only, `Cache-Control: no-store`,
  hidden-segment rejection (`.git`, `.env`, `.adomnia` except `.well-known`), traversal and
  symlink-escape protection, SPA fallback, in-memory live-client injection (disk untouched).
- `ModeDevServer` — supervises the project's own dev server (Vite, Next, …): URL discovered
  from output (`URLScanner`) then real HTTP readiness; a **bridge proxy** adds reload,
  back/forward, console/error surfacing and strips `X-Frame-Options`/`frame-ancestors`;
  HMR/WebSocket pass through; degrades gracefully to the direct URL.
- Live events via SSE (`/__adomnia/events`) + embedded client (`/__adomnia/live.js`);
  CSS-only changes hot-swap stylesheets, anything else reloads; DNS-rebinding defense
  (`allowedHost`); diagnosed failure kinds (`port-in-use`, `missing-dependencies`, `exited`,
  `timeout`, `spawn`, `unreachable`); dev servers registered as managed children.

### 5.10 `graph` — Semantic Workspace Graph
Nodes (module/package/file/function/method/interface/type/test/endpoint/rpc/topic/websocket/
table/envvar/config/dependency/stdlib/entry) and edges (contains/imports/requires/calls/
dispatches/implements/handles/produces/consumes/queries/reads/starts/uses), built by each
adapter's analyzer and persisted in app storage (never in the user's project).
`impact.go` — reverse-dependency index: `Impact(id)` (upstream callers incl. interface
dispatch; risk `low|medium|high`, depth 12 / 5000-node caps), `ModuleImpact`, `RiskMap`.
`drift.go` — architecture rules (`.adomnia/architecture.json`): layers, allow/forbidden
imports, domains, no-cycles, violation report. `metrics.go` coupling metrics;
`compose.go` links docker-compose services to `entry` mains.

### 5.11 `apicontract` — contract drift
`Operation`/`Contract` from OpenAPI 3 + Swagger 2 (auto-discovered `openapi|swagger|api*.{yaml,yml,json}`),
`CompareWithContract` (undocumented/removed/added operations, field drift, breaking flags),
`CompareRevisions`, and event contracts (`EventShape`/`EventSchema` — Avro `.avsc` + JSON
Schema; producer/consumer drift and breaking message changes between revisions).

### 5.12 `agentreview` — AI-agent edit review
At each agent turn the `Tracker` snapshots in-memory file fingerprints; at turn end it
diffs. **Nothing touches disk unless the user accepts**: `AcceptFile`/`RejectFile`/
`AcceptAll`/`RejectAll`, `SetBaseline` (partial accept), `WriteCurrent` (partial reject,
`ErrStale` guard — never overwrites a later edit). Event `agentReview.changed`.

### 5.13 `remote` — WSL / SSH / dev containers
`Target{Kind, Name, Directory}` (WSL distro | SSH host | container); `Wrap()` translates
project paths to remote paths and builds a quoted guard script (secrets stay in env, never
in argv); WSL path translation incl. `\\wsl.localhost\` UNC; SSH host discovery from
`~/.ssh/config`; container inspection (mount mapping, published ports); dev-container CLI
resolution (no install/shell-eval).

### 5.14 `startup` — startup/shutdown analysis core
Timestamped boot timeline (`Observe`: output lines, first listening port, connections to
known service ports → `Timeline`), plus `ObserveShutdown` (port close, connection drain,
graceful window, kill fallback). Host adds Go-specific parts (`GODEBUG=inittrace=1`).

### 5.15 `flight`, `fileio` — small shared utilities
`flight`: singleflight `Group.Do(key, fn)` for concurrent identical work.
`fileio`: `AtomicWriteFile` (temp + fsync + rename, symlink write-through, 5 retries with
exponential backoff for Windows AV/indexer/gopls locks).

---

## 6. Host: `internal/codestudio` (composition root + `GoIDE` facade)

`Service` owns the managers (`WorkspaceManager`, `DocumentManager`, `ToolchainManager`,
`ProcessManager`, `LSPManager`, `TerminalManager`, `DebugManager`, `TestManager`,
`RunConfigManager`, `RecoveryManager`, `ProcessSupervisor`, `LocalHistory`, `Persistence`)
and delegates to the core. Per-concern method groups live in `service_*.go` files.

### 6.1 Sessions, projects, trust
`OpenProject`, `CreateProject` (folder + `go mod init` + template after explicit
confirmation), `ListSessions`, `CloseSession`, `PruneMissingSessions`, recents,
`SetToolAuthorization` (**the trust gate** — no tool execution without
`tooling-permitted`), Studio Workspaces (`List/Create/Rename/Delete/SetActive`, max 20),
`go.work` management via official `go work` commands only, crash status
(`CrashRecoveryStatus`, `AcknowledgeCrash`; `runtime.lock` heartbeat), per-session native
windows (`ClaimSessionWindow` — one window owns a session's unsaved buffers).

### 6.2 Documents, files, search
Open/save/close with disk-token conflict detection (`CheckDocument`, `SaveDocument(force)`),
image and PDF viewing, external documents, in-memory **Quick Open** index (fuzzy,
gitignore-aware, watcher-invalidated), project-wide **search** (benchmarked), file
create/move/duplicate/delete confined to the project, **local file history**, debounced FS
watcher (feeds `didChangeWatchedFiles`, quick-open invalidation, `RestartOnSave`), crash
**recovery of unsaved buffers** (versioned schema, size caps), side-by-side path compare,
gists, project keystore (opaque bytes, no password stored).

### 6.3 LSP host
Generic lifecycle in `lsp.go`: spawn, `initialize/initialized` handshake, document sync,
crash-restart with backoff, **idle suspension/hibernation** (buffers + versions replayed on
resume), memory-budget/low-resource mode, diagnostics throttling (150 ms) + dedup by
SHA-256 signature, code-action cache. Editor API (`service_lsp.go`): `Completion`, `Hover`,
`SignatureHelp`, `Locations` (def/ref/impl), `DocumentSymbols`, `WorkspaceSymbols`,
`PrepareRename`/`Rename`, `FormatDocument`, `CodeActions`/`ResolveCodeAction`,
`ChangeSignature`, `OrganizeImports`, `SemanticTokens`, `InlayHints`, `DocumentHighlights`,
`RecursiveCalls`, `PrepareHierarchy`/`ExpandHierarchy`, `QuickDefinition`,
`ImplementationMarkers`, `*FromUser` variants for explicit user actions. Coordinates are
Monaco-style (1-based lines, UTF-16 columns) at the facade boundary.

### 6.4 Lint, vet, Go tools
`DetectLinter`/`ConfigureLinter`/`InstallLinter`/`RunLint`/`RunLintChanged` — kinds
`golangci-lint`, `staticcheck`, `custom` (any `file.go:line:col: message` analyzer);
project config discovery; official suppression directives honored; quick-fix edits;
changed-only runs; caps (5 min, 32 MB, 5000 issues); versionable baseline
(`.adomnia/lint-baseline.json`, line-independent entries). `go vet` is an entry of the Go
Tools menu (`vet`, `generate`, `fix`, `modWhy`, `modGraph`, `doc` — structured args, preview
before run, `ModifiesFiles` warnings). Extra tools: govulncheck, goimports, mockgen,
stringer, user tools; `InstallGoModule(path@version)` validated.

### 6.5 Tests & coverage
`StartTests` with `TestOptions` (packages, `-run`, `-bench`, race, shuffle, timeout,
repeat, coverage flags); result tree + `RaceReports` (full DATA RACE blocks);
`AffectedTestPackages` for changed files; coverage resolved onto project files
(package/file/function/block, Monaco columns) incl. **base-branch delta coverage** and
inferred **never-executed branches** (Go has no branch coverage).

### 6.6 Debug
Delve detection/install (`dlv dap`, DAP ≥ 1.6.1, listen `127.0.0.1:0`), modes
debug/test/attach/remote with remote↔local source mapping; breakpoints (conditional,
hit-count, logpoints, function + panic, run-to-cursor); goroutines with blocked-on analysis
(channel/mutex/WaitGroup), goroutine creation stacks, pending defers, memory reads,
registers, disassembly, evaluate/watch. Concurrency-first debugger views and "Why is this
goroutine running?" live in the UI (§8.4).

### 6.7 Codegen & refactoring
Codegen on editor text via `go/ast` (only the snippet formatted): `constructor`, `getters`,
`setters`, `interface`, `benchmark`, `fuzz`; HTTP handler test scaffolding;
retry-policy candidates. **Move Symbol** and **Move File**: module-wide reference/Import
rewriting, verified with `go test -run=^$` under `-overlay` *before* proposing — nothing
written until the user applies. Rename / Change Signature / Organize Imports / code actions
come through LSP and return `WorkspaceChange` previews.

### 6.8 Dependencies & vulnerabilities
`ListDependencies` (replacements/exclusions/retractions), module version listing, dependency
actions as `Execution`s, dependency graph at MVS-selected versions (duplicates, updates),
`DependencyWhy` (`go mod why -m` shortest chain), dependency source browsing, and
`VulnerabilityScan` (govulncheck with call paths, reachability `called/imported/required`,
fixed versions, OSV/CVSS; on-demand, network-policy aware).

### 6.9 Fuzz, trace, pprof
Fuzzing Studio: target discovery (corpus from `testdata/fuzz` + build cache), input
inspection, promote to corpus, delete; fuzz *runs* go through normal test runs. Go trace
viewer (`trace.out` via `x/exp/trace`): goroutine timelines, scheduler activity, GC/syscall/
network/sync spans, runtime events. Performance Studio (pprof): top, flame graph, call
graph, per-line cost, live capture against localhost-only pprof endpoints. Runtime
snapshots (saved labeled runtime state).

### 6.10 Analyses
Startup analysis (`GODEBUG=inittrace=1` init steps + port/health), shutdown analysis
(signal → exit timeline), error-handling intelligence (ignored/discarded/unhandled errors,
shadowed `err`, sentinel/typed error catalog, suggested fixes), memory-model helper (sync
primitives shared by the cursor's function), binary inspector (size, build metadata,
modules, `nm` symbol breakdown, embedded files, comparison between binaries), architecture
explorer + diff, package documentation report (undocumented exported symbols with ready
stubs), API/event contract drift (§5.11).

### 6.11 Security & Sonar
`SecurityScan` + finding management (suppress/unsuppress with reason, baseline
`.adomnia/security.json`). Go rule pack (`internal/languages/golang/security.go`, 12 AST
rules: TLS skip-verify/old TLS, weak crypto, insecure HTTP, SQL/command injection, path
traversal, zip-slip, unsafe deserialization, unbounded body, file permissions). Optional
SonarQube integration — nothing installed or started automatically; token kept in session
memory only, never sent to the frontend; offline-aware.

### 6.12 VCS
Status, file/line history, blame, commit files, checkout, stage, revert, pull, push,
working-tree diff, changed symbols, multi-repo repository selection. (Rebase and
drag-and-drop cherry-pick are deliberately hidden in V1; conflicts *are* resolvable.)

### 6.13 Terminal
PTY sessions (go-pty; ConPTY on Windows), max 8 per session, chunked reads with 25 ms
coalescing, rename/resize/close, profiles per platform (PowerShell/cmd/bash/zsh…, Go
binaries prepended to PATH) and **remote targets** (WSL/SSH/container) via `internal/ide/remote`.

### 6.14 Run configurations, supervision, shared env
Run-config CRUD (`List/Save/Duplicate/Rename/Reorder/Delete`, `StartConfiguredRun`,
`StartConfiguredBuild`), kinds `package | files | build | binary | test | make |
docker-build | docker-run | docker-compose | command | go-tool | compound`; GOOS/GOARCH,
race, coverage, test profiling (cpu/mem/block/mutex/trace), debug flags, restart-on-save,
restart policy after crash; `ProcessSupervisor` reports processes interrupted by an adOmnia
crash; shared environment variables injected into every run (`{{NAME}}` references).

### 6.15 Project templates
Embedded templates (`projecttemplates/`, `.tmpl` suffix): `empty`, `cli`, `rest`, `grpc`,
`worker`, `kafka`, `library` — with `Requires` modules and `go mod tidy` after creation,
versions pinned to what adOmnia's own build cached (works offline). Tokens `__MODULE__`,
`__NAME__`, `__PACKAGE__`; custom templates from `<UserConfigDir>/adomnia/go-templates/`
(`custom:` prefix) and plugin-contributed ones (`plugin:<pluginID>:<id>`); limits 500 files,
1 MiB/file.

### 6.16 Web projects & Live Preview wiring
`service_web.go` bridges the host to `internal/ide/preview` + `internal/languages/web`:
`DetectWebProject`, `StartPreview`/`StopPreview`/`ListPreviews`/`ReadyPreviewURL`,
`GetPreviewConfig`/`SavePreviewConfig` (mode static|devserver, dir, script, entry, SPA
fallback, placement tab|split|panel|window, device/size, auto-reload), `InstallWebDependencies`
(after confirmation), web language-server lifecycle, `InstallWebTools`.

### 6.17 Extensions & integrations
Plugin bridge (`SetExtensionManager`, `IDEContributions`, `InvokeIDEExtension`, extension
language servers) and the read-only plugin event contract v1
(`onCodeStudioProjectOpen/ProjectClose/Save/RunFinished`), plus `ProjectServices` (external
services inferred from direct go.mod dependencies, preset IDs matching Docker Lab).

### 6.18 Persistence
bbolt bucket `goide`: `state` **v4**, `recovery` **v1**, `localHistory` **v1** —
metadata only (no sources, buffers or credentials), versioned JSON, migrations read old
versions and refuse future ones. `.adomnia/settings.json` for project settings and keymap
layers; `.adomnia/run-configurations.json` intentionally keeps its flat Go fields for
backward compatibility.

---

## 7. Language adapters (`internal/languages/*`)

### 7.1 Go — `internal/languages/golang` (id `go`)
Stateless `Language` value; unit kinds `module`, `workspace`, `loose`.

| Area | What it provides |
| --- | --- |
| Detection | go.mod modules, root go.work, loose `.go` dirs; `ReadModulePath` |
| Documents | `.go` → `go`; go.mod/go.work/go.sum languageIds |
| Run | Kinds `run, build, test, vet, generate, install, tidy, go-tool, package, files`; strict argv validation (no flags in targets, project boundary + symlink checks); `RunOptions` (build tags, GOOS/GOARCH, race, coverage, profile, debug flags) as opaque JSON; run-target discovery incl. the `cmd/` convention, ambiguity rejection |
| Tests | `go test` command builder + `Test2JSONParser` event parser, test location resolution |
| Debug | Delve `AdapterSpec` (stdio/tcp-listen; debug/test/attach/remote), breakpoint normalization (Delve hit conditions, `runtime.gopanic`) |
| LSP | `GoplsServerSpec` — locate gopls (custom → managed tools → GOBIN/GOPATH → PATH), settings (gofumpt/staticcheck/vulncheck opt-in, resource settings), workspace/configuration, watched files |
| SDK | `ToolchainManager` per session; fast usable-SDK detection before slow `go env` (never run inside the project); corporate env inheritance; official downloads with traversal-safe extraction into isolated, removable installs |
| Architecture explorer | HTTP routes & DTOs (net/http, gin, …), SQL queries/tables, interfaces & implementations (near-miss hints), goroutine usage & risk, context flow, messaging topics (Kafka/NATS/AMQP), WebSocket, config/env reads, sync primitives — feeding the workspace graph, contract drift, memory model and docs |
| Static analyses | error-handling report, Go security rule pack (12 rules), package docs, handler test-gen, retry policies, fuzz corpus parsing, `inittrace` parsing, binary info (`nm`, embedded files) |
| Debug runtime extensions | goroutines (+ blocked-on), goroutine creation, pending defers, memory, registers, DATA RACE collection |

### 7.2 Web — `internal/languages/web` (ids `typescript`, `html`, `css`, `json`)
Four small adapters sharing one detection/extension table; one standard language server each.

- **Languages**: `typescript` covers JS/TS/JSX/TSX (one server serves all), `html`, `css`
  (incl. scss/less), `json` (incl. jsonc). Unit kinds: `node` (package.json), `static`
  (index.html without package.json).
- **Detection**: package.json scanning (root first, monorepos, depth ≤ 4, ≤ 4000 dirs /
  50 units, skipping node_modules/generated); static-site recognition; broken manifests stay
  reportable without failing the scan.
- **Project info**: dev tool (vite, next, react-scripts, angular, astro, nuxt, webpack), UI
  framework, package manager (npm, pnpm, yarn, bun — from `packageManager` field → lockfile
  → default), lockfile presence (respected by install), scripts and dev-script detection,
  TypeScript presence, dependencies-installed state, entry HTML, Node engine.
- **Runtime**: Node + package-manager availability/versions with diagnostics and remedies.
- **Servers**: `typescript-language-server`, `vscode-html-language-server`,
  `vscode-css-language-server`, `vscode-json-language-server` (`--stdio`). Locate order:
  custom → project `node_modules/.bin` → managed dir (`tools/node`, installed by adOmnia
  after confirmation) → PATH. Server-side formatting/validation configured (HTML
  format/auto-close, JSON validate+format+bundled schema with `schemaDownload: false` =
  local-first, CSS validate). **No prettier/eslint/biome integration in the backend** —
  formatting comes from the language servers' built-in formatters.
- **Schema**: `schemas/package.schema.json` (draft-07) served to the JSON server for
  validation + completion of `package.json`.
- **Capabilities**: no Runner/TestRunner/Debug/Usages/Declarations (yet) — web execution
  goes through Live Preview, not run configurations.

### 7.3 What is intentionally not abstracted
No `Formatter`, `Builder`, or `LanguageServerProvider` interfaces exist without a concrete
core consumer ("reuse before abstraction" — the migration plan's rule).

---

## 8. Frontend

### 8.1 Two component areas
- `frontend/src/components/code-studio/` — the **Code Studio UI shell** (all panels, dialogs,
  editor stack; ~230 `.tsx` + ~180 `.ts`). Moving it is a declared non-goal.
- `frontend/src/components/ide/` — the **language-contribution layer** only
  (`languages.ts` registry + `languages/<id>/` folders). No panels here.

### 8.2 Language contributions (`components/ide/languages.ts`)
`IdeLanguageContribution = { id, name, icon (Simple-Icons slug), editorLanguages (Monaco
ids), languageServer (status-bar name), menu?, heavyFeatures? }`; `IDE_LANGUAGES =
[GO_LANGUAGE, ...WEB_LANGUAGES]`. Helpers: `languageServerEditorLanguages()` (generic LSP
providers — never hard-code `'go'`), `heavyFeatureEditorLanguages()` (semantic colors,
inlay hints, Code Vision — Go only today), `ideLanguageForEditor`, and
`languageRequirement(languageId, registered)` for command gating.

- **`languages/go/`** — icon `go`, Monaco `go`, server label `gopls`, contributed **Go menu**
  with 25 commands (toolchains, modules, go.work, tools, trust, gopls lifecycle, tool
  installers), each `requires: { language: 'go' }`.
- **`languages/web/`** — typescript/html/css/json entries (heavy features off), 12 commands
  (`requires: { language: 'html' }`) for Live Preview and tool install; `useWebMonaco.ts`
  disables Monaco's built-in JS/TS/HTML/CSS/JSON services while a real language server is
  ready (no duplicate completions/hover/diagnostics) and suppresses TS "cannot find module"
  noise without project context; `emmet.ts` Emmet abbreviations for HTML/CSS/JSX/TSX.
- Extra Monaco-only grammars (`codeStudioExtraLanguages.ts`): `gosum`, `goasm`, `makefile`.

### 8.3 Shell & layout
`CodeStudioPanel` (root: command dispatch, menus, key handling, global dialogs, session and
run/debug/test routing, autosave & buffer recovery) → `CodeStudioWorkspace` ("islands" grid:
project tree · editor/debug · side pane · tool window, resizable splitters, Zen mode, debug
layout takeover) with `CodeStudioToolbar` (menu bar, project switcher, branch widget, search,
Run group, Studio switcher), `CodeStudioTitlebar` (frameless drag region + window controls),
`CodeStudioStatusBar` (cursor, file info, language-server status, watcher, toolchain, trust
switch, lint state), `CodeStudioActivityBar`, `CodeStudioToolStripes` (left: Project, Commit,
Bookmarks + tool-window buttons with badges; right: Structure, AI Assistant, Module
Dependencies), `CodeStudioSidePane` (Structure, Context, Project, AI Assistant), split
editor, tool-window placement logic (`studioToolState/Layout/Bridge`), and **detached
native windows** (`DetachedCodeStudioWindow`, `DetachedStudioToolWindow`). Every modal uses
`CodeStudioModal` / `CodeStudioPalette` (never hand-built backdrops/headers).

### 8.4 Tool windows
Hosted by `CodeStudioRunPanel`; ids: `run, problems, references, find, terminal, tests,
debug, todo, context, profile, trace, sonar, vulns, fuzz, errors, architecture, interfaces,
goroutines, docs, config, impact, git, go, preview`.

| Window | Highlights |
| --- | --- |
| Run | stdout/stderr/system streams, log-level coloring, build-step progress (incl. Docker BuildKit), rerun/stop, path click-through, windowed rendering |
| Problems | merged gopls + linter diagnostics, per-problem AI fix / fix-all, extension diagnostics |
| Tests | tree + filter, run/debug single/package, rerun-failed, race-repeat, benchmarks (+history/compare), flaky detection & causes, coverage: Files/Functions/Branches/**Patch** (coverage of changed lines vs base branch) |
| Debug | goroutine tree, stack frames, variables with inline values, evaluate/watch, memory + disassembly, "Why is this running?", goroutine birth site, concurrency diagnostics, AI debug actions, remote attach |
| Breakpoints | conditional, logpoints, run-to-cursor, mute |
| Terminal | multi-terminal, split, search, run-from-terminal detection, themes, persisted/restored terminals |
| Find / References / TODO | project search, LSP usages, comment-tag scan |
| Git | branches, staged/unstaged, pull/push, history graph, commit flow (+ AI commit messages), hunk staging, blame, diffs, local history, gists, conflict resolver |
| Go (Go-only hub) | pprof profiling, escape analysis, struct optimization (fieldalignment), extra Go tools |
| Profile / Trace | flame graph, heat, export, live capture; trace timeline (wait categories, spans) |
| Architecture | 12 tabs: packages, calls, interfaces, services, data, modules, rules, heatmap, contract, binary, memory, goroutines |
| Context / Errors | context-propagation inspector; error-handling intelligence |
| Fuzz / Sonar / Security / Vulns | fuzzing studio; SonarQube; security exposures + baseline; govulncheck results |
| Config / Docs / Impact | go.mod settings, private modules; documentation generation (hands `openapi.json` to API Docs); change-impact & risk maps |
| Dependencies | module browser, graph, heatmap, "why is this dependency here" |
| Live Preview | split / tab / tool-window / separate window, device emulation, navigation, live-reload toggle, external browser, dev-server proxy |

Plus drawers for startup analysis and runtime snapshots.

### 8.5 Editor stack
Monaco wrapper with themes, run-target gutter, tabs (preview tabs, pin, dirty dot, Live
Preview virtual tab), breadcrumb, custom viewers (image, Markdown render/edit, HTML
source↔preview), quick-info popup, inline AI assistant popup (accept/reject all),
inspection widget, line context (SQL/topics/routes at caret → cross-panel handoffs) and
debug line context, and decoration modules: Code Lens, Code Vision, semantic tokens, inline
diagnostics, line/implementation/context markers, TODO comment tags, proto lens (opens
gRPC Studio). Editor modes: default/vim/emacs; save actions (format/organize imports);
navigation history and bookmarks.

### 8.6 AI features
`CodeStudioAiHubPanel` hosts the last-used provider: GitHub Copilot (Ask chat + ghost text),
milk, Claude Code, OpenCode, legacy "a0" (each with a detachable dialog variant). Plus
agent chat with **agent-review accept/reject** (file and hunk level, backed by
`internal/ide/agentreview`), inline assistant, Fix with AI / AI actions (prepare prompts
only — nothing runs without a click), AI commit messages, project rules toggle
(`.rules`/`AGENTS.md`/`CLAUDE.md`/`.cursorrules`, 8 KiB per file, 64 KiB budget), secrets
prompt.

### 8.7 Commands & keymap
~201 core commands + 25 Go + 12 web (`codeStudioCommands.ts`), remappable keymap
(`codeStudioKeymap.ts`) with `when`-context expressions (`editor`, `input`, `terminal`,
`vim`, `emacs`, `vim.normal|insert|visual`; `&&` > `||`, `!` negation). Availability order:
language requirement → window restrictions (main-window-only commands) → session/trust →
toolchain → gopls readiness → linter/debug/vcs specifics → web-only mapping (Run → Live
Preview). Disabled items display the reason. Menus: File, Edit, View, Navigate, Code,
[language menu], Run, Tools, Git, Help — language menus are contributed, not hard-coded.

### 8.8 State stores (`frontend/src/stores/`)
`codeStudio.ts` (sessions, projects, capabilities, documents/buffers, tabs, splits, toolchains,
executions + console chunks, run configs), `codeStudioLsp.ts` (diagnostics, **tool-window
selection**, editor preferences), `codeStudioDebug.ts`, `codeStudioTests.ts`, `codeStudioVcs.ts`,
`codeStudioNavigation.ts`, `codeStudioWindows.ts`, `codeStudioWorkspaces.ts`, `codeStudioTasks.ts`,
`codeStudioToast.ts`, `codeStudioAgentReview.ts`, `codeStudioProjectSettings.ts`, `codeStudioAssistant.ts`,
`codeStudioWhenContext.ts`, `codeStudioInsights/RuntimeContext/RuntimeProfile.ts`,
`ideExtensions.ts`, `ideWebServers.ts`, `livePreview.ts`, `devcontext.ts` (project entity
snapshots from `internal/devcontext`). Events are routed per `sessionId`/`resourceId`;
**state never crosses sessions**.

### 8.9 Entity router (cross-panel navigation)
`frontend/src/lib/entities/` — `registerOpener`, `openEntity`, `handoffToPanel(rail, ref,
intent, payload)` / `useEntityHandoff(rail, handler)` (retried while the panel is not
ready). IDE-relevant openers: `symbol` → "Open in gO", `route` → "Go to handler",
`service` → "Inspect runtime in gO" (OTLP span), `artifact` → project artifacts (mTLS,
keystore). The IDE *emits* handoffs to database (tables/SQL), broker (topics), API Docs
(`openapi.json`), gRPC Studio (proto), API Client (routes), and *receives* the runtime
intent in `useCodeStudioRuntimeContext`.

### 8.10 Wails bindings
Stable facade `GoIDE` in `code_studio_bindings.go` (no feature logic allowed there), regenerated
with the pinned `wails3 generate bindings`. Generated TypeScript bindings:
`frontend/bindings/adomnia/goide.ts` — **296 functions** (2026-10-17), models under
`bindings/adomnia/internal/{goide,ide/*,languages/*}/models`. Typed wrappers used by the
UI live in `frontend/src/lib/code-studio-*.ts` (`code-studio-api`, `-lsp-api`, `-debug-api`,
`-tests-api`, `-vcs-api`, `-workspaces-api`, `-window-api`, `livepreview-api`,
`devcontext-api`). Events: a single `code-studio:event` carrying a versioned
`EventEnvelope{eventType, sessionId, resourceId, payload}` (plus `code-studio:close-requested`
and agent-review-changed). Event emitters inside the core: `DebugManager`, `ProcessManager`,
`preview.Manager`, `agentreview.Tracker`.

Representative bound groups: capabilities (`GetCapabilities`, incl. `languages`),
projects/sessions/trust, documents & buffers, runs & run configs, debug & breakpoints, LSP
& editor features, tests, terminals & remote targets & windows, security & vuln scan,
graph/architecture/contracts, previews, toolchains, VCS, analyses (startup/shutdown,
memory model, binary, pprof, trace), agent review.

---

## 9. Cross-cutting invariants

1. **Trust model** — `AuthorizationPermitted` gates every process launch. An untrusted
   project can be browsed and edited, nothing else. Opening is not trusting.
2. **No shell strings** — every command is a structured argv; secret values travel in the
   process environment, never on the command line, never in logs or persisted snapshots.
3. **Path confinement** — all file/tool/preview operations are checked against the real
   project root (`project.EnsureWithin`, symlink-aware).
4. **Language-agnostic core** — no `switch language`, no Go tooling imports; capabilities
   via type assertion; adapters never import the host.
5. **Nothing implicit on open/restore** — no scripts, no servers, no builds run on project
   open, session restore or detection.
6. **Crash resilience** — atomic saves, buffer recovery, managed-child registry + Windows
   Job Objects, interrupted-process reporting, heartbeat-based crash detection.
7. **Backpressure everywhere** — bounded consoles, pending LSP requests, output events,
   message sizes; truncation is reported, never silent.
8. **Local-first** — bbolt/localStorage/`.adomnia` files only; no telemetry, no cloud
   calls; network access (downloads, Sonar, govulncheck) is explicit and policy-aware.
9. **Persisted formats are versioned** — bbolt keys (`state` v4, `recovery` v1,
   `localHistory` v1), `.adomnia/*` files; every change ships a loader migration.
10. **Verification tiers** — automated tests never substitute for desktop manual
    acceptance or native platform builds.

---

## 10. Current status and open items (2026-10-17)

**Complete:** the 12-phase IDE Platform refactor (core/adapters split, multi-server LSP,
registry, capabilities-driven UI); the Go adapter end-to-end; the web adapter
(typescript/html/css/json) with Live Preview (static + dev-server supervision); separate
native windows (automated tests); Studio Workspaces; agent review; the analysis suite
(graph, impact, drift, contracts, binary, startup/shutdown, error handling, memory model).

**Shipped but awaiting in-app verification:** the six independent P2 items (dev container,
gRPC capture, full goroutine capture, retry→policy, cache hit/miss, unit-test generation)
are in code and released (1.0.1, 2026-10-12); four are UI-verified, goroutine/gRPC capture
are code-presence verified only.

**Open by design or pending acceptance:**
- Desktop manual smoke checklist: `mds/03-GO-STUDIO-PIANO-UNIFICATO.md` (gates **M1–M34**)
  and `mds/MANUAL-CHECK.md` (incl. **REF-2.M1** incremental sync desktop acceptance,
  **Z1.4.M1** project-rules native UI acceptance).
- macOS/Linux native builds unverified (Windows is the acceptance platform).
- Web roadmap (from the web action plan): Next.js profile, Prettier/ESLint integration,
  Vitest, JS debugging via `vscode-js-debug`, framework extensions (Vue/Volar first, then
  Svelte/Astro/Angular). React/Vite are *project profiles*, not languages.
- Deliberate V1 limits: rebase & drag-drop cherry-pick hidden; plugin events read-only;
  refactorings beyond gopls code actions are the custom Move Symbol/Move File pair; remote
  debugging needs identical source paths; Fix with AI requires a verified provider and a
  user click.

Historical notes: ADR 0001 is **superseded** by `ide-multilanguage-refactor.md` (cite it
only for rationale); the web action plan is historical for status but remains the roadmap
source. When citing counts or budgets (frontend tests, startup JS budget — gate `check:startup`
**650 kB** — tool versions: Go 1.26.5, gopls v0.23.0, Delve 1.27.2), attach the date.

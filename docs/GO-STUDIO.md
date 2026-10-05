# Go Studio

Go Studio is the Go IDE built into adOmnia. It opens real Go projects, understands them through gopls, and runs, tests and debugs them with the project's own Go SDK. It connects to the rest of adOmnia: Git Studio, Docker Lab, Database Studio, Broker Studio, the API Client, plugins and the AI provider.

Everything stays on your machine. Nothing in a project runs until you trust it.

## IDE platform refactor status (2026-10-03)

The product still exposes the Go Studio UI and the existing `GoIDE` Wails service. The backend now separates the shared IDE core (`internal/ide`) from the Go adapter (`internal/languages/golang`); this does not add another language or change the trust model.

The debugger lifecycle, breakpoint store and DAP operations live in `internal/ide/dap`. Adapter startup supports both stdio and TCP readiness; Delve supplies its launch/attach parameters, Go error messages and explicit console evaluation retry. Goroutines, runtime defer chains, memory inspection and register configuration belong to the Go adapter and use the core's `dap.Session` interface. Existing saved line-number breakpoints and current breakpoint options remain readable.

Run configurations also have additive `language` / `languageOptions` fields. The core stores language options as opaque JSON. Legacy Go fields remain accepted and exposed by the facade for the current frontend; persisted state keys, workspace schema and `.adomnia/run-configurations.json` format/version remain unchanged. Explicit secret environment values are still removed from snapshots and shared files.

Phases 1–12 are complete. The shared core owns processes, configurations, Run chains/compound execution, generic Make/Docker/command workflows and test lifecycle/history/publication. Go adapters own command options, test2json, race reports and Go source interpretation; the Wails facade preserves existing APIs and persisted fields. A fixture language runs and tests through the registry with no Go on PATH, including saved opaque options, environment files and generic commands. In the UI, `GetCapabilities().languages` lists the registered languages; each one contributes its icon, menu, commands and editor languages from `frontend/src/components/ide/languages/<id>/`. The project model carries language units only: Go modules, `go.work` and loose folders are derived from them (`goLayoutOf` in the backend, `lib/goide/goProject.ts` in the frontend). See [the migration plan](architecture/ide-multilanguage-refactor.md) for the decisions and the manual smoke checklist.

Phase 8 was published in [`fe3456a`](https://github.com/Andrea-Cavallo/adOmnia/commit/fe3456ac351ebae9ce7d8cbd76b2ca0b070df4e4), following the phase 9 backend in `daa2e89`. Validation passed: full Go suite with managed gopls/Delve, build/vet, focused race regressions, pinned Wails bindings, TypeScript, frontend build and startup budget. Real Make passed; real Docker integration was skipped because the daemon was stopped. The new desktop build has not received the complete manual smoke check, and macOS/Linux validation remains open in phase 12.

## Using Go Studio

1. **Open a project** with *File → Open Project* (Ctrl+O), a recent project, or *New Go Project* (which runs `go mod init` after you confirm). New Go Project offers templates — empty module, CLI, REST service, gRPC service, worker, Kafka producer/consumer, library — plus your own templates: folders in `<user config dir>/adomnia/go-templates/`, where `__MODULE__`, `__NAME__` and `__PACKAGE__` are replaced in file contents and paths. The gRPC and Kafka templates run `go mod tidy`, pinned to the versions adOmnia itself uses, so they resolve from the module cache; if that fails (offline) the project is still created and a warning asks you to run Tidy. A project may be a module, a `go.work` workspace, or a folder inside a larger repository.
2. **Trust it.** A newly opened project is *opened* only: you can browse and edit files, but no tool runs. The first time a folder is opened, a dialog asks whether to trust it; *Trust Folder* allows local Go tools and is remembered for that folder, so reopening it never asks again. *Browse Only* keeps tools off for the session; trust later with *Go → Trust Project Tools* (the same command revokes it).
3. **Pick a Go SDK.** Go Studio detects Go on `PATH`, or installs an official release from *Go → Go SDKs & Toolchains…*. Each project can use a different SDK; click the Go version in the status bar to switch quickly. The toolchain dialog shows `GOROOT`, `GOPATH`, the module proxy/privacy settings and the target platform, and edits them for *This project* or as the *Global default* used by projects without their own settings: Go binary, `GOPROXY`, `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, CGO, `GOOS`/`GOARCH`, build tags (written to `GOFLAGS` as `-tags=`) and other variables. It reads the `go` and `toolchain` directives of `go.mod` and warns when the selected SDK is older: with `GOTOOLCHAIN=local` the build would fail, otherwise `go` would download the newer toolchain. Its *Go tools* section health-checks gopls, the linter and Delve, and installs or updates them to `@latest`.
4. **Write code.** gopls provides completion, diagnostics on unsaved buffers, hover, signature help, navigation (Ctrl+click or Ctrl+B for the declaration), usages, rename with preview, code actions and refactoring. golangci-lint or staticcheck add lint findings.
5. **Run, test, debug.** Use Build, Run with stdin, the gutter ▶ next to `func main` and tests, the structured test runner with coverage, the Delve debugger (launch, attach or remote) and a real terminal. Makefile targets and Dockerfiles run for real too (see below).
6. **Commit and integrate.** The toolbar shows the Git branch and changes, and the gutter shows diffs against HEAD. Commit from Go Studio; Git Studio follows the open project's repository for push, pull and merges. *Tools → Project Services* opens Docker Lab, Database Studio or Broker Studio for the services detected in `go.mod`. HTTP handlers get an *Open in API Client* CodeLens. Package-level functions, methods, types, constants and variables show **Code Vision** above the declaration: the usage count from gopls (click it to list the usages) and the git author of the latest change, with `*` for uncommitted lines. The author is hidden while the buffer has unsaved changes, because blame describes the file on disk.

*View → Maximize Editor* (Ctrl+Shift+F12, or a double-click on an editor tab) closes Project, Structure and the bottom tool window so the code takes all the space; press it again to bring them back exactly as they were. Every pane also closes on its own with its — button or its shortcut (Project Alt+1, Structure Alt+7, bottom tool window Alt+4).

The status bar starts with the breadcrumb (file path › enclosing symbol; click a symbol to jump to its siblings) and shows line:column, the line separator (LF/CRLF), the language and the Go SDK. Save and Maximize editor sit at the right of the tab row. The top-right corner of the editor shows the problems of the open file: a green check when it is clean, otherwise error and warning counts with arrows for the previous and next problem (Shift+F8 / F8).

*View → Maximize Go Studio* (Ctrl+Shift+F11, or the ⤢ button at the right of the toolbar) hides adOmnia's rail, the Go Studio header and adOmnia's status bar, so the IDE fills the window. Press it again to restore them; leaving Go Studio restores them too.

The project menu in the toolbar lists the open projects and, below them, the recent projects that are not open, so you can reopen one with a click (*File → Open Recent* shows the same list).

Several projects can stay open at the same time, isolated from each other, grouped into Go Studio workspaces that are separate from adOmnia's API workspaces. A project can also move into its own window (*File → Open Project in New Window*).

## Editor

- **View:** Sticky Scopes (on by default), Font Ligatures, Preview Tab, Zoom (Ctrl+= / Ctrl+- / Ctrl+0, including the `+` key of Italian layouts and the numeric keypad) and Zen Mode (Alt+Shift+Z: only the code; leaving it restores the panes as they were).
- **Preview Tab** (off by default): a single click in Project opens the file in an italic tab that the next click replaces. Editing it or double-clicking the file keeps it open.
- **Code → Type Hints:** the inferred types of `:=` and `range`, composite literal types and constant values, on top of parameter hints.
- **File → Save Files on Focus Change:** saves modified files when adOmnia goes to the background or you switch file, never while you type.
- **File → Trim Trailing Whitespace on Save** and **`.editorconfig`:** the project-root `.editorconfig` sets indentation, trailing whitespace and the final newline for non-Go files; Go, assembly and Makefiles keep tabs. Only the changed characters are edited, so the cursor stays and Ctrl+Z undoes it.
- **Navigate:** Test (Alt+Shift+T) jumps between a file and its `_test.go` and between a function and its test, and offers to generate a missing test. Call Hierarchy (Ctrl+Alt+H) shows callers and callees, and Type Hierarchy shows supertypes and subtypes, as lazy trees with recursion marked. Recent Locations (Ctrl+Shift+E), Last Edit Location (Ctrl+Shift+Backspace) and Next/Previous Problem (F8 / Shift+F8) are also there.
- **Code → Generate… (Alt+Insert):** Constructor, Getters and Setters (only for unexported fields), Extract Interface (exported methods), Test (gopls writes a table-driven test), Benchmark and Fuzz Test (added to the `_test.go` file, created when missing; missing imports are added on save). The generated code is inserted after the struct or function, and the rest of the file is untouched. Ctrl+Z undoes it.
- **Code → Vulnerability Diagnostics** (off by default): after you confirm, gopls downloads the Go vulnerability database from vuln.go.dev and marks the `go.mod` requirements whose imported code has known vulnerabilities. Your source code is not sent.
- **Replace in Files:** *Replace All… (preview)* in Find in Files opens every change in the change preview, applied all or nothing and undoable. With regular expressions, `$1`, `$2`… insert the captured groups.

## Security and project authorization

- **Opening is not trusting.** An opened project reads and saves files only. Every action that starts a process requires *Trust*: gopls, linters, build, run, tests, debugging, the terminal, Go Tools, dependency changes and tool installation. Revoking trust stops the project's processes and gopls.
- **Nothing runs implicitly.** Opening a project or restoring a session never runs code. Recovered unsaved buffers are offered, never applied silently.
- **Files stay inside the project.** Paths are confined to the project root, including after resolving symlinks. Run targets and Go Tools arguments that look like flags (for example `-toolexec=…`) are rejected.
- **Secrets are not persisted.** Run configurations store the names of secret environment variables but never their values, which you enter when you start the run. Local history never records `.env` files, keys or certificates.
- **Network access only on request.** Go Studio contacts the network only when you install an SDK or tool, or when your own commands do (for example `go get`). SDK downloads come from the official Go catalog and are verified with SHA-256.
- **Fix with AI sends code only when you click.** It sends the file with the problem and, for `undefined: pkg.Name` errors, the non-test files of that local package, to the AI provider configured in *Settings → AI*. A local provider such as Ollama keeps everything on the machine. The answer may change only the files that were sent and always opens in a preview before anything is applied.
- **Makefiles and Dockerfiles are project code.** They run only in a trusted project. Arguments go to `make` and `docker` as a list, never through a shell. Make accepts targets and `VAR=value`, not flags (use `MAKEFLAGS`). Docker stages, tags and ports are validated. The Dockerfile, the build context and every volume must stay inside the project, so the Docker socket or arbitrary host folders cannot be mounted. Secret build args and secret container variables reach `docker` only through the process environment (`--build-arg NAME`, `-e NAME`), so their values never appear in the command line, the Run console or the saved state.
- **One window edits a project.** When a project moves to a separate window, the main window cannot edit or close it until it moves back. Closing a window with unsaved files asks first.

## Optional external tools

Go Studio works without any of these installed. Each feature says clearly what it needs, and offers to install it after you confirm.

| Tool | Used for | How Go Studio gets it |
| --- | --- | --- |
| **Go SDK** | Build, run, test, `go mod`, and running the tools below | Detected on `PATH`, or installed from *Go → Go SDKs & Toolchains…* (official releases, checksum-verified). Stored per user in the adOmnia data folder and selectable per project with `GOTOOLCHAIN=local`; the system `PATH` is never changed. |
| **gopls** | Language intelligence, refactoring, navigation | *Go → Install gopls…* runs `go install golang.org/x/tools/gopls@latest` with the project SDK. |
| **golangci-lint** or **staticcheck** | Lint findings, lint on save | *Go → Install golangci-lint…* or *Install staticcheck…* runs `go install` for `golangci-lint/v2` or `staticcheck` at `@latest`. The project's own `.golangci.yml` is respected. |
| **Delve** | Debugger (launch, attach, remote) | *Go → Install Delve (debugger)…* runs `go install github.com/go-delve/delve/cmd/dlv@latest`. |
| **Git** | VCS in the editor | Uses the Git already installed for Git Studio. |
| **make** | Makefile targets | Found as `make`, `gmake` or `mingw32-make` on `PATH`, or in the GnuWin32 folder, or set in *Go → Tool Paths*. On Windows: `winget install ezwinports.make`, `choco install make` or `scoop install make`. |
| **Docker** | Dockerfile build and run | Docker Desktop or Docker Engine with `docker` on `PATH`. Go Studio checks that the daemon answers before starting and says so when it does not. |

gopls starts with `GO_TELEMETRY_CHILD=2`, so Go's telemetry library starts no `** telemetry **` process and collects nothing for it; your global `go telemetry` mode is left untouched. It also starts with `GOMEMLIMIT=1GiB`, which makes its garbage collector trim memory peaks near that limit. Values you set yourself in the environment win. The first hover or Ctrl+hover after opening a project waits for gopls to load the module and its dependencies; the status bar shows its progress. On Windows, excluding `%LOCALAPPDATA%\go-build` and `go env GOMODCACHE` from Defender speeds this up.

Managed tools are installed into `<data>/goide/tools/bin`. A tool on `PATH`, or a path set in *Go → Tool Paths (gopls, linter, dlv)…*, is used instead when present.

**Supported versions.** The Go SDK runs the project, so any release the project's `go.mod` accepts works. gopls, the linters and Delve are built with the project SDK and follow their upstream support policy, which usually covers the two most recent Go releases. If the SDK is too old for the installed Delve, Go Studio says so and suggests selecting a newer SDK or a compatible `dlv`. Development and verification use Go 1.26.5, gopls v0.23.0 and Delve 1.27.2.

`<data>` is `%APPDATA%\adomnia` on Windows and `~/.config/adomnia` on macOS and Linux.

**Fast, cached SDK detection (VPN and proxy friendly).** Go is usable as soon as its binary is found and its version is read from the SDK's `VERSION` file — no process, no network. `go version` (only if `VERSION` is missing) and `go env` run outside the project folder, so a `go.mod` asking for a newer toolchain can never trigger a download through a slow GOPROXY; `go env` runs in the background and a timeout keeps the SDK valid with the last known values. The last detection is saved: on the next start the same binary (same size and date) is loaded from the saved config in a few milliseconds and only re-validated in the background. *Go → Toolchains* shows each phase's time (also written to adOmnia's log as `goide.toolchain`). Processes started by Go Studio inherit `GOPROXY`, `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `HTTP(S)_PROXY` and `NO_PROXY` unchanged and run with `GOTOOLCHAIN=local` unless you chose a `GOTOOLCHAIN` yourself (environment, project variables or `go env -w`): Go Studio never downloads a Go toolchain on its own. Installing a tool (golangci-lint, staticcheck, gopls, dlv…) pins the newest version compatible with the selected SDK, or explains which Go it needs.

**More Go tools.** *Go → Toolchains* also lists **govulncheck**, **goimports**, **mockgen** and **stringer**, plus any tool you add (binary name and, optionally, a `module@version` to install it). Each is found in adOmnia's tools folder, `GOBIN`, `GOPATH/bin` or the `PATH`; **Install…** runs `go install` with the project SDK after confirmation, **Run…** runs it with your arguments in a project folder (no shell), with the output in the Run console. Running needs a trusted project.

**Dependency graph.** *Tools → Dependency Graph…* reads `go list -m -json all`, `go mod graph` and `go list -deps` offline: direct → transitive tree, duplicate versions with who requires each and the shortest chain from your module, license (from the module's LICENSE file), estimated weight on disk, package count, and **unused** / **indirect** badges. *Check updates* (`go list -m -u`) and *Scan vulnerabilities* (`govulncheck`) contact the network and run only when clicked. Needs a trusted project.

## Makefiles and Dockerfiles

Go Studio runs Makefiles and Dockerfiles with the real `make` and `docker`, and streams their output to the Run console like `go run`. Any file type opened in the editor is highlighted: HTML, CSS, JavaScript/TypeScript, SQL, XML/WSDL, Protobuf, shell, PowerShell, Dockerfile, Makefile, `.env`, TOML/INI and more.

- **▶ in the gutter.** In a Makefile, every target gets *Run 'make target'*. Variables, special targets (`.PHONY`) and pattern rules (`%.o`) do not. In a Dockerfile, every named stage (`FROM … AS builder`) and the final `FROM` get *Build image* and *Build & Run container*. Both menus offer *Save as Run Configuration…*.
- **docker compose.** In `docker-compose*.yml` and `compose*.yaml`, `services:` gets *Compose Up (all services)* and *Compose Down*, and every service gets *Compose Up 'service'*. `docker compose up` stays attached, so the logs stream to the Run console. *Stop* runs `docker compose stop` on the same services, because killing the client would leave the containers running. The run configuration type *Docker Compose* accepts only `up [services]` or `down`.
- **Postman and other collections.** Right-click a `.json` or `.yaml` file in the project tree and choose *Send to API Workspace*. Postman, Insomnia, Bruno JSON, OpenAPI and Swagger 2 files are imported into adOmnia's API Workspace, including unsaved changes in the editor. You stay in Go Studio, and a notice offers *Open API Workspace*.
- **Keys and certificates.** Right-click a `.pem`, `.key`, `.crt` or `.cer` file and choose *Open in Power Tools: Inspect / Encrypt Key*. The PEM / JKS tool opens with the file loaded and inspected. A private key can be encrypted there with a password, as standard encrypted PKCS#8 (PBKDF2-SHA256, 600,000 iterations, AES-256-CBC) that OpenSSL, Java and Go open. It can also be decrypted back. Certificates in the same file stay unchanged, and everything happens locally.
- **Working directory.** Commands start in the folder that contains the file, so `make -f Makefile` and a Docker build context of `.` behave as they do in a terminal opened there.
- **Build & Run.** `docker build` runs first. Only when it succeeds does `docker run --rm -i --name adomnia-…` start the container, with the ports the Dockerfile declares with `EXPOSE`. *Stop* runs `docker stop` on that container, because killing the client alone would leave it running. The same happens when trust is revoked, the project closes or adOmnia quits. *Rerun* runs the build and the container again.
- **Run configurations.** Three types join the existing ones:
  - *Make target*: the Makefile, targets and `VAR=value`, plus environment.
  - *Docker build*: Dockerfile, context, tag (default `<project>:dev`), stage, `--no-cache` and build args.
  - *Docker build & run*: the same, plus published ports, volumes, container command and container environment.

  *Save as Run Configuration…* from a Dockerfile lists its `ARG`s as build args. Names that look sensitive (`password`, `token`, `secret`, `key`…) are marked secret: only the name is saved, and the value is asked once when you start. When an environment variable and a build arg share a name, one value serves both.
- **Execution options.** Every run configuration also has: an *env file* (`.env` syntax, confined to the project; variables set in the configuration win), a *port* (exported as `PORT` and checked free before the start, so a busy port fails immediately instead of at bind time), and, for Go kinds, `GOOS`/`GOARCH`, the race detector (`-race`, with `CGO_ENABLED=1`) and coverage (`-cover`; for run and build the data goes to `.gocoverdata` through `GOCOVERDIR`). Test configurations add profiling (`cpu`, `mem`, `block`, `mutex` or `trace`, written next to the package). Package and build configurations add *debug build flags* passed to Delve, for example `-gcflags=all=-N`. The toolbar *Build* compiles a saved package/build configuration with all of these; secret variables are left out of builds.
- **Before launch / after it finishes.** A configuration can run other configurations first (for example *Docker Compose up* or a *make* target) and afterwards (cleanup, reports). They run in order in the Run console. A failing task before launch stops the launch; tasks after it run whatever the exit code, unless you stopped the run; a failing task after it skips the rest. Only one level is followed: the tasks' own before/after lists are ignored.
- **Command, Go tool and Compound.** *Command* runs any program on the PATH or a script inside the project (`./scripts/seed.sh`), with arguments passed as a list, never through a shell. *Go tool* runs `go <command>` with the project toolchain (`generate`, `vet`, `tool pprof -top cpu.pprof`…). *Compound* starts two to ten other configurations together, in parallel; a compound cannot contain another compound.
- **Shared or private.** A configuration is private by default (stored on this machine). *Share with the project* also writes it to `.adomnia/run-configurations.json`, readable JSON meant to be committed: teammates who open the repository get the same configurations. Secret values, pins and restart-on-save are never written there; for shared configurations the file wins when it changes.
- **Pin, history, hot restart.** Pinned configurations come first in the toolbar and in Search Everywhere. The editor shows the last runs of each configuration (time, exit code, duration), kept locally per project. *Restart on save* restarts a running execution when you save a Go file of the project (several saves restart it once).
- **Run Current Context** (Ctrl+Shift+F10, as in GoLand) runs the test that contains the cursor, the `main` of a main package, or the tests of the current package otherwise.

## Breakpoints

A click on a line number toggles a breakpoint; a **right-click** opens its editor:

- **Condition:** stops only when a Go expression is true (`len(items) > 10`). Delve evaluates it.
- **Hit count:** `3` stops only on the third hit, `>= 5` from the fifth on, `% 10` every tenth.
- **Log message (logpoint):** prints the message without stopping; `{expression}` is evaluated when the line runs and the text appears in the Debug console.
- **Enabled:** a disabled breakpoint stays in place, grey, and is not sent to Delve.

In the gutter a plain breakpoint is a red dot, one with a condition or hit count shows a `?`, a logpoint is a diamond, a disabled one is grey, and a hollow dot means Delve has not verified it yet (the tooltip says why). Options follow the line while you edit and are saved with the project; breakpoints saved by older versions (line numbers only) are read as plain breakpoints.

**View Breakpoints (Ctrl+Shift+F8)** lists every breakpoint of the project: enable or disable each one (or all of them: *Run → Mute / Unmute Breakpoints*), edit its options, remove it, or double-click to open the line. The same dialog holds:

- **Function breakpoints:** stop on entry to a function, e.g. `main.handler` or `(*Server).Serve`, with optional condition and hit count. Delve reports whether it found the function.
- **Stop on every panic:** also stops on panics that are recovered later, by breaking in `runtime.gopanic`; the stack shows where the panic started. Unrecovered panics always stop the debugger.

**Run to Cursor (Alt+F9)** resumes a paused program until the line with the caret, through a temporary breakpoint removed at the next stop, whatever the reason. On a line without code it says so and the program stays paused. *Set next statement* is not available: Delve does not support jumping over code through DAP.

## Concurrency-first debugger

The Debug tool window (Alt+5) is built around goroutines. Delve still does
the debugging through DAP; Go Studio reads every goroutine stack once per
pause and explains it.

- **Session view.**
  - Goroutines are grouped by package and by the function the `go`
    statement started. Each goroutine shows its state (running, chan
    receive/send, select, mutex, WaitGroup, cond, sleep, I/O wait, syscall)
    and what it is blocked on, read from the source line (for example
    `s.orderChannel`).
  - Selecting a goroutine shows its detail card (state, blocked on,
    started in, location and the source line) and its call stack. Runtime
    and library frames are folded.
  - Variables show package globals too, colour values by type, copy a value
    with one click and load expensive scopes on request.
  - While paused, variable values also appear at the end of the lines of
    the current function, as in GoLand.
- **Concurrency view.**
  - A state summary and diagnostics: possible deadlock (every goroutine
    waits on another one), blocked channels, mutex contention, possible
    goroutine leaks (10 or more goroutines from the same function stuck at
    the same line), saturated worker pools (every goroutine started by
    the same function, at least 3, is busy while others wait to send on a
    channel) and data races.
  - A flow lays out, for every starting function, its goroutines and the
    channels, mutexes and WaitGroups they wait on. A resource shared by
    several functions is highlighted.
- **Race detector.** *Run → Test Current Package with Race Detector* runs
  `go test -race`. Reports from tests, runs (a `-race` flag in a run
  configuration) and the debug console become cards with both conflicting
  accesses and the goroutine creation stacks; every frame opens the
  source.
- **Filters and grouping.** Filter goroutines by All, Blocked or Running or
  by text, and group them by starting function or by identical stack.
  Relation chips show channels, locks, WaitGroups, contexts, network,
  database and timers.
- **Evidence.** Diagnostics are OBSERVED (paused snapshot) or CONFIRMED
  (race detector). A timeline shows goroutines per state at each pause, and
  *Copy snapshot* exports goroutines, diagnostics and races as JSON.
- **Run with Race Detector** runs the active configuration with `-race`.
  Races are compared across runs: new, recurring or gone.
- Goroutine states are inferred from the stack because DAP does not expose
  Go's wait reason. The analysis covers the first 1000 goroutines of a
  pause.

## Flaky tests

- **Run N times.** In the Tests panel, **↻ ×** with 10/20/50/100 reruns the current run with `-count=N -shuffle=on`; the ↻ on a test row runs that test 20 times. Repetitions are counted from the `go test -json` events, never from text.
- **Flaky badge and filter.** A test that both passed and failed shows *flaky failed/runs*; a test that always failed stays a plain failure. The *N flaky* toggle shows only flaky tests. One failed repetition keeps the test red even if the last one passed.
- **Failure rate and durations.** The detail header shows the failure rate and min/avg/max duration across repetitions.
- **Possible causes.** For a flaky test the detail lists hints read from the output of every repetition: data race, deadlock, timing, port conflict, unreachable service, channel or map misuse, or (with shuffling and no other hint) test-order dependency. *×N with -race* repeats it with the race detector. These are hints, not a diagnosis.
- **Flaky history.** Tests found flaky in a repeated run are remembered per project in local storage (package, name, runs and failures, never output). Later runs mark them *was flaky*, the flaky filter includes them, and the trash button next to it forgets them.
- **Reproducible scenario.** The copy button in a test's detail copies the `go test` command that reproduces it outside the IDE: working directory, `-run` filter, `-count`, the `-shuffle` seed the package printed, `-race` and build tags.
- **Benchmark comparisons.** A benchmark's detail compares it with a chosen baseline: the previous run, measurements saved on main/master (default when you are on another branch), any earlier commit, or a run pinned with *Pin as baseline* (before a refactor). With `-count=N` every repetition is kept: medians are compared with a Mann-Whitney U test like benchstat (*significant* or *~ noise*, at least 4 runs per side). Slowdowns over the *Regression ≥ N%* threshold (default 5%, per project) are highlighted. Saved history stores branch and commit, never output.
- **Seed replay.** Selecting a package shows the `-shuffle` seed it printed; clicking it reruns the package in the same order.

## Linting

- **Whole project or changed files.** *Code → Run Linter* runs golangci-lint or staticcheck on `./...`; *Run Linter on Changed Files* only on the packages of modified, staged or new Go files and keeps only those files' findings.
- **Custom analyzers.** Set any analyzer binary in *Go Tool Paths → Linter*: it runs as `<binary> ./...` and every `file.go:line[:column]: message` line becomes a finding.
- **Baseline.** *Save Lint Baseline* writes the current findings to `.adomnia/lint-baseline.json` (file, linter, code and message, no line numbers). Later runs hide those findings and show only new ones; the status bar shows how many are hidden. Commit the file to share the baseline; *Remove Lint Baseline* deletes it.
- **Pre-commit check.** The commit dialog lints the changed files and stops on gopls errors or lint warnings in the checked files, with *Show Problems* or *Commit anyway*.

## Performance Studio (pprof)

- **Capture.** A test run configuration can profile the run: CPU (`-cpuprofile`), Memory (`-memprofile`), Blocking (`-blockprofile`), Mutex (`-mutexprofile`) or Execution trace (`-trace`), chosen in the configuration's *Profiling* menu. Go writes the file (`cpu.pprof`, `mem.pprof`, …) in the package directory of the test.
- **Open it.** *View → Performance Studio* (Alt+0) or the status-bar *Profile* button lists every `*.pprof` under the project, newest first, and opens one. It is read locally with the same parser as `go tool pprof`; no process starts and no file leaves the machine.
- **Top functions.** Flat or cumulative, one row per function, with a value bar, the percentage of the total, package grouping and a search box. *Hide runtime* drops `runtime.*` and Go SDK frames.
- **Flame graph.** Real frame widths from the sample stacks; *Flame (root on bottom)* and *Icicle (root on top)*, each frame hoverable with its value and percentage.
- **Sample type.** A CPU profile exposes `samples` and `cpu`; a memory profile exposes `alloc_objects`, `alloc_space`, `inuse_objects` and `inuse_space`. The selector switches every view, so allocations and in-use memory are separate reads of the same file.
- **Callers.** Pick a function in Top or the flame graph to see its callers and callees with weights; without a selection the 200 heaviest edges are listed.
- **Diff.** Compare the open profile with a second one: per-function base, target, delta and percentage, heaviest changes first. Useful for before/after a refactor.
- **Go to source.** Every function that has a `.go` frame opens it, project files in the editor and standard-library files read-only.
## Fuzzing Studio

- **Open it.** *View → Fuzzing Studio* lists every `func FuzzXxx(f *testing.F)` of the project. Nothing runs until you press **Fuzz** or **Replay**, and both need a trusted project.
- **Fuzz.** Pick the duration (`-fuzztime`, or *Until stopped*) and the workers (`-parallel`, *Auto* = GOMAXPROCS); the run appears in the Run console and can be stopped there.
- **Corpus.** *Seeds and failures* are the files in `testdata/fuzz/FuzzXxx/` (run by every `go test`); *Generated* are the inputs Go keeps in `$GOCACHE/fuzz/<import path>/FuzzXxx/` (`GOCACHE` from the environment or Go's default). Selecting an input shows its typed values; identical inputs are marked *dup*.
- **Crashes.** Every finished fuzz run is parsed: the failing input Go wrote (already minimized when the output says so), the failure message and the throughput. Crashes with the same normalized message are grouped with a ×N counter.
- **Actions.** *Replay* reruns the target on one testdata input (`-run=^FuzzXxx$/^name$`) or the whole corpus; *Promote to test* copies a generated input into `testdata/fuzz`, so `go test` runs it as a regression case; *Copy f.Add* copies the values as a seed call; delete removes an input from the project or the cache.
- **Sessions.** Duration, executions, executions per second, new interesting inputs, corpus size and workers of each run, stored per project in local storage (never the output).

## Go trace

- **Capture.** A test run configuration with the *Execution trace* (`-trace`) profiling option writes `trace.out` in the package directory.
- **Open it.** *View → Go Trace* (or the **Trace** button in the status bar) lists every `trace.out` / `*.trace` under the project and opens one. It is read locally with Go's own trace parser (`golang.org/x/exp/trace`); no `go tool trace` and no external process.
- **Goroutine timeline.** One track per goroutine with colored spans for `running`, `runnable`, `waiting` and `syscall`, plus the total busy time; filter by goroutine id or starting function.
- **Scheduler.** One track per P with its running intervals.
- **Blocking.** The longest waits by category — network, synchronization, GC, sleep — and the goroutines that are still live or ran longer than 5 ms.
- **GC.** GC/STW ranges appear in the timeline header and their total is in the stats chips.
- **Runtime events.** Logs, tasks and user regions with time and goroutine.
- **Go to source.** Clicking a span, an event or a goroutine opens the corresponding frame — project files in the editor, standard-library files read-only.
- **Stats.** Duration, goroutine count, running/waiting/syscall time, GC, network wait and synchronization wait.

## Images and local Markdown assets

- **Image tabs.** Clicking an image in the Project tree opens a read-only preview tab (zoom, fit-to-window, dimensions) instead of failing as a non-text file. Supported: png, jpg/jpeg, gif, webp, bmp, ico, avif, svg, up to 16 MB. Image tabs are never sent to gopls.
- **Markdown.** Relative image links in the Markdown preview (`![](img/a.png)`) are read from the project as data URLs, because a `file://` URL is not readable inside the WebView.

## Security

*View → Security (Code and Dependencies)* or the **Security** button in the status bar. Two views share the panel and keep their results when you switch.

### Code (offline static scan)

- **What it checks.** *Scan code* reads the project files (no network, no processes; dependencies, `vendor/`, `node_modules/`, tests and fixtures are skipped):
  - **Secrets** in any text file: AWS, GitHub, GitLab, Stripe, OpenAI/Anthropic, Slack and Google keys, JWTs, passwords in connection strings, private keys with a real PEM body, and random-looking strings assigned to credential names. Values are masked (first 4 characters only); dev defaults (`postgres`, `guest`), placeholders and label names such as `tokenKey` or `passwordField` are ignored.
  - **Go rules** from the AST (aliases resolved, generated files skipped): `InsecureSkipVerify`, TLS 1.0/1.1, MD5/SHA-1/DES/RC4, RSA keys under 2048 bits, plain HTTP URLs and `http.ListenAndServe`, SQL built with `fmt.Sprintf` or concatenation, `sh -c`/`cmd /C`/`powershell -Command` with a runtime command line, file paths from request input, archive entry names joined to a destination (zip slip), `gob` decoding of request bodies or connections, request bodies decoded without `http.MaxBytesReader`, world-writable modes (`0666`, `0777`, `os.ModePerm`).
- **Severity.** High (exploitable as written), Medium (risky in context), Low (hardening). Each finding shows why it matters and how to fix it, and opens its line in the editor.
- **Suppress with a reason.** A suppression always needs a written reason. From the panel it is saved in `.adomnia/security.json`; in the code, put `// adomnia:security-ignore <rule>: <reason>` on the line or the line above (a comment without a reason is ignored). Findings are matched by rule, file and the code of the line, not the line number, so they survive code moving.
- **Baseline.** *Save baseline* accepts the current findings in `.adomnia/security.json` (commit it): later scans show only new ones. *Clear baseline* brings them back. Suppressed and baselined findings stay visible with the filters.
- **Export for AI.** *Copy for AI*, *Save .md* and *Ask Copilot* export only the active findings with each rule's risk and fix. Secret values stay masked.

### Dependencies (govulncheck)

- **Scan.** *Scan with govulncheck* runs `govulncheck -json ./...` on the chosen Go module of a trusted project. It is on demand: govulncheck downloads the Go vulnerability database from vuln.go.dev (shown in *Settings → Network & Privacy* under **Vulnerability DB**; offline and air-gapped modes block it). Install govulncheck from *Go → Toolchains* if it is missing.
- **Priority from reachability.** The Go database rarely publishes CVSS scores, so findings are ranked by what govulncheck proves: **High · Called** (your code calls the vulnerable symbol), **Medium · Imported** (the package is imported, no call found), **Low · Required only** (the module is only in the build). A CVSS vector is shown when the advisory has one. Priority always has an icon and a label, never colour alone.
- **Detail.** Each finding shows ID and aliases (CVE, GHSA), summary and details, found → fixed version, vulnerable symbols, references and a link to the advisory.
- **Call paths and dependency path.** Up to five call paths per finding, from your function to the vulnerable symbol. Every step opens its source: project files in the editor, dependencies and the standard library read-only (resolved from `GOMODCACHE` and `GOROOT`). The dependency path is the shortest module chain from your module, read offline from `go mod graph`.
- **Upgrade preview.** The `go.mod` change (`require module old → fixed`, or the new indirect requirement) and the exact `go get module@fixed` command. *Upgrade…* asks for confirmation and runs it like the other dependency actions; standard library findings point to a Go toolchain upgrade instead.
- **Export for AI.** *Copy for AI*, *Save .md* and *Ask Copilot* produce a Markdown report (context, glossary, summary table, per-finding fix, call paths, dependency path). Locations are project-relative or bare file names, never absolute machine paths.

## SonarQube (optional)

- **Opt-in.** *View → SonarQube* (or the **Sonar** button in the status bar) is off until you enable it for the project. Configure the server URL, project key, sources (default `.`) and exclusions; `sonar-scanner` must be installed and is detected on the managed tools folder or the PATH (a custom path is accepted). Nothing is installed or started by adOmnia on its own.
- **Token.** The SonarQube token is kept in memory for the session only: it is never persisted and never sent back to the UI. Saving a scan without a token asks for it again after a restart.
- **Network.** The scan uploads the analysis to your server; adOmnia's **Offline mode** blocks it and the corporate proxy/CA apply. Every connection is recorded in *Network activity*.
- **Scan and import.** *Scan now* runs `sonar-scanner` on the trusted project and waits for the server's Compute Engine to finish processing the report (`.scannerwork/report-task.txt` → `/api/ce/task`, up to 3 minutes), then imports the open issues from `/api/issues/search` (at most 5,000, below the server's 10,000-result limit). Works with SonarQube 9.9 LTA, 10.x (including MQR severities HIGH/MEDIUM/LOW) and SonarCloud: the token is sent as Basic credentials, which every version accepts. If processing takes longer, use **Refresh** (which only reimports, without rescanning). Calls appear in *Settings → Network & Privacy* under **SonarQube**.
- **Issues.** Listed by severity with file:line navigation, a text filter, a severity filter and a *Security only* toggle; the header shows totals, security count and how many are hidden by the baseline.
- **Copy problems.** Copies every shown finding as `file:line [SEVERITY rule] message`, ordered from the most severe.
- **Resolve with AI.** Sends the findings grouped per file to the AI configured in *Settings → AI*, through the same preview-before-apply flow as *Fix with AI*: nothing is written without confirmation and the change is undoable.
- **Baseline.** *Save baseline* records the current findings in `.adomnia/sonar-baseline.json` (versionable with the project) so later scans show only new problems; *Clear baseline* removes it. Suppression keeps the file, rule and message, not the line, so it survives code moving.

## Language server activity

- **Always visible.** Starting, restarting, indexing or a gopls crash shows a small panel in the bottom-right of Go Studio with a spinner, elapsed time, the indexing message and percentage, and its own progress bar.
- **Force reload.** The panel's reload button (and *Go → Restart Language Server*) restarts gopls from scratch; **Log** opens the language-server log. On a crash the panel stays with the error and the same reload action.

## Crash recovery

- **Unsaved buffers.** Every dirty buffer is snapshotted about 750 ms after the last keystroke, outside the file and on this machine only (bbolt, one atomic transaction per write). The last three versions of each file are kept with their SHA-256: if the newest is corrupt, the previous one is used. The original file is never touched until you save.
- **Crash detection.** At start adOmnia writes `runtime.lock` (random instance id, PID, start time) and refreshes its heartbeat every 10 s; a clean shutdown removes it. A lock whose heartbeat stopped for more than 30 s means the previous run ended abnormally. The PID alone is never trusted, because the system can reuse it.
- **Restore after a crash.** Go Studio opens *adOmnia closed unexpectedly* with every recovered file, its time, `+added/−removed` lines and a status: *Safe to restore* (disk unchanged since the snapshot), *Already on disk*, *Conflict* (the file changed after the snapshot) or *File no longer exists*. Each file offers **Use Recovered**, **Keep Disk** and **Open Diff** (Disk Version ↔ Recovered Version); **Restore All**, **Review** and **Discard** act on all of them. Restored text opens as unsaved changes: nothing is written to disk until you save.
- **Session view.** Open tabs, the active file, the cursor position in each file, the editor split with its own tabs, layout, bookmarks and breakpoints are saved with the session (a couple of seconds after the cursor stops) and restored when the project reopens. Processes are never relaunched on their own; gopls alone restarts automatically after a crash (at most three times).
- **Interrupted runs.** A process supervisor, independent of the UI, records every run started from a run configuration and clears the list on a clean shutdown. After a crash the recovery dialog lists the runs that were still going: **Relaunch** starts the configuration again through the normal Run flow (trust and secrets are asked again), **Dismiss** forgets it. Each configuration has an *After a crash* policy: ask (default), never (for migrations and scripts with side effects) or relaunch automatically (only if you choose it, and only for a trusted project).
- **Storage and limits.** Snapshots stay in adOmnia's local store, isolated per project by a stable hash of its path, so they follow the project even when its Go Studio session is recreated. If the project folder is moved or renamed, opening it at the new location picks its snapshots up again: they are matched by the module path(s) in `go.mod`, and only when the old folder no longer exists. Snapshots older than 14 days are removed. If a snapshot cannot be written (disk full, permission denied, recovery space exhausted) a red bar warns that unsaved changes are not protected.

## Persistence and migrations

Go Studio stores metadata only. Source files stay where they are, and file contents are kept only in the recovery and local-history stores described below. All stores live in adOmnia's local bbolt database, in the `goide` bucket.

| Key | Contents | Schema |
| --- | --- | --- |
| `state` | Open sessions (project path, authorization, Go Studio workspace), recent projects, run configurations (Go, Make and Docker) without secret values, per-session layout (open tabs, active file, panes, navigation history, bookmarks, breakpoints), Go Studio workspaces, per-project and global toolchain settings (Go binary and variables; values with credentials in URLs are never written) | `version` 4 |
| `recovery` | Unsaved buffers, kept so that a crash or restart does not lose them. Up to 200 buffers of 4 MB each. | `version` 1 |
| `localHistory` | Previous versions of saved files: at most 20 per file, 2 MB per version, 32 MB in total, kept 14 days. `.env`, keys and certificates are never recorded. | `version` 1 |

Managed Go SDKs are stored under `<data>/goide/toolchains` and tools under `<data>/goide/tools`.

**Migrations run in memory when the state is read, and are saved on the next write:**

- **Version 1 → 2.** Recent projects are rebuilt from the open sessions.
- **Version 3 → 4.** Sessions without a Go Studio workspace move into the default workspace, *Main*, without losing any session.
- **Newer than supported.** A state saved by a newer adOmnia is refused rather than overwritten, so a downgrade cannot destroy it.
- **Unreadable state.** Go Studio starts empty and rebuilds the state on the next save; this state holds only metadata. An unreadable recovery store is discarded in the same way.
- **Transient read errors.** If the store is not ready yet, the load is retried on the next action instead of failing permanently.

Ownership of projects by separate windows is not persisted: after a restart every project belongs to the main window.

## Keyboard shortcuts

Go Studio follows the GoLand keymap. The table below is generated from the command registry that also drives the menus and the *Help → Keyboard Shortcuts* dialog. Editor-owned keys (for example Ctrl+Z and Ctrl+F) are handled by the editor. Ctrl+W closes the active editor tab, so *Extend Selection* is Shift+Alt+→.

**Keymaps and custom shortcuts.** *Help → Keyboard Shortcuts* switches between the **GoLand** (default) and **VS Code** keymaps, searches actions by name or by key (`ctrl shift f`), and lets you click any shortcut to record a new one, remove it or reset it. Shortcuts shared by two actions are flagged; the first available action wins. Choices are stored on this machine. *View → Vim Mode* / *Emacs Mode* turn on keyboard emulation in the editor (monaco-vim / monaco-emacs, loaded only when enabled). The table below lists the GoLand defaults.

**Settings** (*File → Settings…*, Ctrl+Alt+S) gathers every Go Studio preference in one searchable dialog: editor, save actions, gopls options, low-resource mode, plus links to keymap, toolchains, tool paths and Copilot.

**Search Everywhere** (Shift Shift) also finds tests and benchmarks (Enter runs them in the Test Explorer), run configurations (Enter runs them), adOmnia settings (Enter opens the right Settings section) and actions by shortcut; with an empty query it shows the recently used actions.

### File

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Settings… | Ctrl+Alt+S | ⌘⌥S |
| Open Project | Ctrl+O | ⌘O |
| Save | Ctrl+S | ⌘S |
| Save All | Ctrl+Shift+S | ⌘⇧S |
| Close Editor | Ctrl+W | ⌘W |
| Reopen Closed Tab | Ctrl+Shift+T | ⌘⇧T |

### Edit

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Undo | Ctrl+Z | ⌘Z |
| Redo | Ctrl+Shift+Z | ⌘⇧Z |
| Find | Ctrl+F | ⌘F |
| Replace | Ctrl+H | ⌘H |
| Go to Line | Ctrl+G | ⌘G |
| Toggle Line Comment | Ctrl+/ | ⌘/ |
| Duplicate Line or Selection | Ctrl+D | ⌘D |
| Delete Line | Ctrl+Y | ⌘Y |
| Move Line Up | Ctrl+Shift+ArrowUp | ⌘⇧ArrowUp |
| Move Line Down | Ctrl+Shift+ArrowDown | ⌘⇧ArrowDown |
| Add Caret at Next Occurrence | Alt+J | ⌥J |
| Select All Occurrences | Ctrl+Alt+Shift+J | ⌘⌥⇧J |
| Column Selection Mode | Alt+Shift+Insert | ⌥⇧Insert |

### View

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Go to File | Ctrl+P | ⌘P |
| Zoom In / Out / Reset | Ctrl+= / Ctrl+- / Ctrl+0 | ⌘= / ⌘- / ⌘0 |
| Zen Mode | Alt+Shift+Z | ⌥⇧Z |
| Maximize Editor (Hide All Tool Windows) | Ctrl+Shift+F12 | ⌘⇧F12 |
| Maximize Go Studio | Ctrl+Shift+F11 | ⌘⇧F11 |
| Project Pane | Alt+1 | ⌥1 |
| Project Overview Pane | Alt+7 | ⌥7 |
| Run / Problems Pane | Alt+4 | ⌥4 |
| Problems | Alt+6 | ⌥6 |
| Terminal | Alt+F12 | ⌥F12 |
| Tests | Alt+8 | ⌥8 |
| Performance Studio | Alt+0 | ⌥0 |
| Debug | Alt+5 | ⌥5 |
| Split Right | Ctrl+\ | ⌘\ |

### Navigate

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Search Everywhere | Shift Shift | Shift Shift |
| Declaration | Ctrl+B | ⌘B |
| Implementation(s) | Ctrl+Alt+B | ⌘⌥B |
| Super Method | Ctrl+U | ⌘U |
| Find Usages | Alt+F7 | ⌥F7 |
| Show Usages | Ctrl+Alt+F7 | ⌘⌥F7 |
| Quick Definition | Ctrl+Shift+I | ⌘⇧I |
| File Structure | Ctrl+F12 | ⌘F12 |
| Back | Ctrl+Alt+ArrowLeft | ⌘⌥ArrowLeft |
| Forward | Ctrl+Alt+ArrowRight | ⌘⌥ArrowRight |
| Toggle Bookmark | F11 | F11 |
| Bookmarks | Shift+F11 | ⇧F11 |
| Symbol in Workspace | Ctrl+T | ⌘T |
| Find in Files | Ctrl+Shift+F | ⌘⇧F |

### Code

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Code Completion | Ctrl+Space | ⌘Space |
| Parameter Info | Ctrl+Shift+Space | ⌘⇧Space |
| Quick Documentation | Ctrl+Q | ⌘Q |
| Type Info | Ctrl+Shift+P | ⌘⇧P |
| Show Context Actions | Alt+Enter | ⌥Enter |
| Implement Interface | Ctrl+I | ⌘I |
| Rename | Shift+F6 | ⇧F6 |
| Refactor This | Ctrl+Alt+Shift+T | ⌘⌥⇧T |
| Extract Variable | Ctrl+Alt+V | ⌘⌥V |
| Extract Constant | Ctrl+Alt+C | ⌘⌥C |
| Extract Function/Method | Ctrl+Alt+M | ⌘⌥M |
| Inline | Ctrl+Alt+N | ⌘⌥N |
| Move to New File | F6 | F6 |
| Move Symbol to Package (another package of the module; references, imports and tests rewritten, build checked before the preview) | Code menu | Code menu |
| Change Signature (reorder or remove parameters; gopls rewrites every call, preview first) | Ctrl+F6 | ⌘F6 |
| Reformat Code | Ctrl+Alt+L | ⌘⌥L |
| Optimize Imports | Ctrl+Alt+O | ⌘⌥O |
| Run Linter | Ctrl+Alt+Shift+L | ⌘⌥⇧L |

### Run

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Run | Ctrl+F5 | ⌘F5 |
| Debug | Shift+F9 | ⇧F9 |
| Build | Ctrl+Shift+B | ⌘⇧B |
| Build Current Package | Ctrl+F9 | ⌘F9 |
| Run Current Context | Ctrl+Shift+F10 | ⌘⇧F10 |
| Rerun Failed Tests | Ctrl+Alt+Shift+F10 | ⌘⌥⇧F10 |
| Build All (go build ./...) | Ctrl+Shift+F9 | ⌘⇧F9 |
| Test All (go test ./...) | Ctrl+Alt+F10 | ⌘⌥F10 |
| Stop | Shift+F5 | ⇧F5 |
| Restart | Ctrl+Shift+F5 | ⌘⇧F5 |
| Toggle Line Breakpoint | Ctrl+F8 | ⌘F8 |
| View Breakpoints | Ctrl+Shift+F8 | ⌘⇧F8 |
| Run to Cursor | Alt+F9 | ⌥F9 |
| Resume Program | F9 (also F5 while paused) | F9 (also F5) |
| Step Over | F8 (also F6, F10 while paused) | F8 (also F6, F10) |
| Step Into | F7 | F7 |
| Step Out | Shift+F8 | ⇧F8 |
| Stop Debugging | Ctrl+F2 | ⌘F2 |

### Git

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Commit | Ctrl+K | ⌘K |

Other mouse gestures: Ctrl+click (Cmd+click on macOS) goes to the declaration, Alt+click adds a cursor, Shift+Alt+drag selects a column, a click on a line number toggles a breakpoint, and a right-click on a line number edits it (condition, hit count, logpoint).


**Local replaces in go.mod.** Saving a go.mod with `replace example.com/lib => ../lib` comments out the other replace of the same module as `// adomnia-off: …` (Go accepts one replace per module) and restores it when the local replace is removed. Commits of a go.mod with a local replace show a warning, and pushes from adOmnia ask for confirmation while the pushed commits contain one.
## Performance and low-resource mode

- **Low-Resource Mode** (View menu) pauses semantic highlighting, inlay and type hints, sticky scroll and lint on save. Your preferences are kept; a **Low-resource** badge in the status bar turns it off. **Low-Resource Mode on Battery** does the same only while a laptop runs on battery (Battery Status API, available in WebView2 on Windows; elsewhere it stays normal).
- gopls diagnostics are coalesced: at most one update per file every 150 ms, and at most 1000 diagnostics per file reach the UI (errors first).
- Large repositories, measured on Windows (2026-10-02, gopls v0.23.0, `gopls stats`): adOmnia itself (96 workspace packages, 950 with dependencies) loads in 5.4 s with a 430 MB heap; the opentelemetry-go-contrib monorepo through `go.work` (69 modules, 232 workspace packages, 1585 in total) loads in 3.7 s with a 255 MB heap once modules are cached. The first load of that monorepo took 50 s, mostly module downloads. Go Studio's own index (`TestLargeMonorepoStaysResponsive`, 40 modules / 4000 files): open ~80 ms, Quick Open ~40 ms, Find in Files ~0.5 s.
- The Run console draws the last 5000 lines; search and Copy console still use the full 4 MB buffer. Project folders with more than 500 entries show them in pages (**Show more**).

## Platform verification

| Platform | Status |
| --- | --- |
| **Windows** | All automated suites pass with `-race`, real gopls and Delve, including process-tree cleanup, the ConPTY terminal and debugger orphan checks. `build.ps1` builds the Wails 3 executable. Manual checks in the running app are still open (M1–M31 in `todo-ide.md`). |
| **Linux** | The automated suites run in CI (`go test -tags gtk3 ./...` on Ubuntu) and passed in the container used during development, including process-tree and PTY cleanup. Manual checks in a desktop session are still open. |
| **macOS** | The package cross-builds. No runtime verification yet. |

**Separate windows** (*File → Open Project in New Window*) are covered by automated tests only. They will be declared supported in the release notes once the manual check in a real window (M31) passes.

## GitHub Copilot

Go Studio integrates GitHub Copilot through the official **GitHub Copilot Language Server** (`@github/copilot-language-server`). It is not the VS Code extension: the UI is adOmnia's, the language server is the engine. gopls stays the semantic engine (types, diagnostics, completion, navigation, refactoring); Copilot adds the generative layer on top.

**Turn it on.** *Tools → GitHub Copilot…* or the Copilot item in the status bar. Copilot is off until you enable it, and nothing is downloaded on its own: *Install* downloads the native language server for your platform from the npm registry and refuses it unless its SHA-512 matches the integrity npm publishes. A custom binary path is also accepted.

**Accounts: GitHub.com, Enterprise Cloud and Enterprise Server.** Nothing assumes `github.com`. Each account is a profile with a name and a host: `github.com`, `company.ghe.com` (Enterprise Cloud with data residency) or your own host (Enterprise Server). For enterprise hosts the language server is configured with `github-enterprise.uri` before sign-in. Sign-in uses GitHub's device flow on that host: adOmnia shows the code, copies it to the clipboard and opens the host's page. A project can be bound to an account (*Account for this project*), so company code never uses the personal account by mistake; switching to a project bound to another account restarts the language server on that account. The status bar always shows user **and host**.

**Ghost text.** Suggestions appear as you type in any editable file: **Tab** accepts, **Esc** dismisses, **Ctrl+→** accepts word by word, **Alt+]** / **Alt+[** browse alternatives. Every keystroke cancels the previous request (`$/cancelRequest`), and a suggestion computed on an older buffer is discarded. *Tools → Toggle Copilot Inline Completions* turns them off without disabling Copilot.

**Ask chat.** *Tools → Open Copilot Chat* (or the sparkle on the right tool stripe) opens a per-project conversation. The message can include the current file, the live Monaco selection and a filtered workspace manifest. Only the active buffer and explicit selection include source text; workspace context is a bounded path manifest. Built-in secret exclusions and `.adomnia/aiignore` apply before context reaches the language server. Replies stream into the pane, **Stop** cancels the active JSON-RPC request, and **New Chat** destroys the server conversation. Chat history is session-only and never written to the project.

**Right assistant tool window.** Copilot and **AI di a0** are separate choices in the same right column as Structure and Project. Each stripe button opens or closes the column. Both chat headers provide a quick model switch: Copilot lists the models available to the signed-in account and starts a clean conversation after a change; a0 lists locally cached provider models, accepts an exact custom ID, and verifies the new model before activating it. a0 keeps its existing API-workspace actions; the former global floating launcher and popup no longer exist.

**Network.** A company proxy (with TLS verification on by default) and a company CA bundle (PEM, added to the system trust store through `NODE_EXTRA_CA_CERTS`) can be set in the dialog. TLS verification is never disabled.

**Privacy and data.** Your workspace stays local. When Copilot is on, the open file and nearby code are sent to the GitHub host of the selected account. `.env`, `.env.*`, keys and certificates (`*.pem`, `*.key`, `*.p12`, `*.jks`…), SSH/AWS/GnuPG folders, `secrets/**` and every pattern in the project's `.adomnia/aiignore` (one glob per line, `dir/**` for folders) are never sent. adOmnia has no telemetry and asks the language server to turn its telemetry off. The GitHub token is kept by the language server in its own credential store; adOmnia's `copilot.json` holds only profiles, hosts, bindings and network settings.

**Resilience.** If the language server crashes it restarts after 1, 2, 5 and 10 seconds; after that Copilot pauses with *Restart* and *Show logs*. gopls, the debugger, Git, the terminal and the rest of Go Studio keep working whether Copilot is on, off or failing.

Edit and Agent modes with adOmnia tools (Go, debugger, API Workspace, databases, Kafka, Git) are the next phases; see `todo-ide.md`. Ask chat is implemented and automatically tested, with its real-account manual check still open.

## Known limits

- Push, pull, merge, rebase and stash live in Git Studio, not in the editor. Conflicts can be resolved in Go Studio too: *Git → Resolve Conflicts…* (or *conflict · resolve…* in the Commit dialog) opens the three-way editor — base, ours and theirs side by side, an editable result, and for each conflict block *Ours*, *Theirs*, *Both* or *Base*; saving writes and stages the file, then Continue, Skip or Abort finish the merge, rebase or cherry-pick. Other version control systems are not supported.
- Plugins receive read-only Go Studio events (contract v1) and no commands.
- HTTP route prefixes are resolved only within the same file for the *Open in API Client* CodeLens.
- Remote debugging needs the same source paths on both sides for breakpoints to bind.
- Set next statement is not available (Delve has no DAP `goto`); Run to Cursor covers moving forward.
- Refactorings are the code actions gopls offers; nothing is simulated with text replacement.
- Ctrl+click on an undefined symbol has no target; use *Fix with AI* or the gopls quick fixes.

## Project tree, terminal and AI fixes

- **Project tree context menu** (files, folders and the project root), in GoLand order: Open and Open in Split (right/down); New Go File / File / Folder; Cut (Ctrl+X), Copy (Ctrl+C) and Paste (Ctrl+V), which copy or move files and folders inside the project; Copy Path/Reference (absolute path Ctrl+Shift+C, path from project root Ctrl+Alt+Shift+C, file or folder name, Go import path); for Go files, Find Usages, Inspect Code, Refactor This, Move to New File, bookmarks, Reformat Code and Optimize Imports; Rename or move (Shift+F6 or F2; type a path with `/` to move), Duplicate, Delete (Delete key; always confirmed, and the text of deleted files is kept in Local History); **Reload from Disk** always re-reads a file and asks before discarding unsaved text, while **Refresh Folder / Project** re-reads the loaded tree branch and marks dirty tabs for Reload / Keep / Compare without discarding them; Find in Folder; Go Package (test, test with coverage, build, vet, go generate on the package of the folder or file), plus Run / Debug Current Configuration; Open In File Explorer or Terminal (a new terminal in that folder); Local History and Git (file history, blame) for files. Paste never overwrites: when the name is taken it picks `name_copy`. A cut item is dimmed until pasted. Operations stay inside the project; files with unsaved changes must be saved or discarded before moving them. On macOS, Cmd replaces Ctrl.
- **Terminal profiles**: the arrow next to `+` lists the shells found on the machine — PowerShell 7, Windows PowerShell, Command Prompt, Git Bash and every WSL distribution (e.g. Ubuntu) on Windows; `$SHELL`, bash, zsh and fish on Linux/macOS. The chosen shell becomes the default for `+`. The UI can only start detected profiles, never an arbitrary executable.
- **Terminals come back**: reopening a project reopens its terminals with the same name, shell and folder. Only that metadata is kept (per project, in local storage); output and processes are not, and the shells start only on a trusted project when the Terminal tab opens.
- **Connected workspaces come back**: Database Studio restores query tabs, the active query, row limit and timeout. Broker Studio restores the active protocol, saved profile and Kafka resource tab. Connections remain stopped until you explicitly connect; persisted broker profiles keep the existing session-only/Vault secret boundary.
- **Terminal tools**: double-click a tab to rename it; **Split** shows two terminals side by side (clicking the right-hand tab swaps sides). **Ctrl+click** on `file.go:12:5` or on a stack-trace frame (`/path/main.go:12 +0x1d`) opens the file in the project, GOROOT or the module cache. **Ctrl+F** finds in the scrollback; **Copy output** copies the buffer as plain text, without colors or control codes. **History** lists the last 50 commands typed in this project (stored locally; commands that mention tokens, passwords or keys are never saved); picking one types it into the shell without pressing Enter. Typing `go test …` offers **Run in Test Explorer** with the same packages and `-run`/`-bench`/`-race`/`-cover`/`-tags`. Limits: commands edited with arrows or Tab completion are not recorded, a path split across wrapped lines is not clickable, and the Test Explorer uses the folder the terminal was opened in, not a later `cd`.
- **Resolve all with AI** (Problems pane, with an AI provider enabled in Settings → AI): one request per file with errors or warnings (up to 10 files), then a single change preview; nothing is written until you apply it. The file contents are sent to the configured provider.
- **Code → everything**: CodeLens above SQL tables, broker topics, gRPC service registrations and WebSocket endpoints open them in Database Studio, Broker Studio, the gRPC client (with reflection) and the WebSocket client.
- **Layout**: Go Studio opens maximized; the adOmnia logo in the top-left corner returns to the hub. The button next to Save maximizes the editor alone (Ctrl+Shift+F12).


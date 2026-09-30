# Go Studio

Go Studio is the Go IDE built into adOmnia. It opens real Go projects, understands them through gopls, and runs, tests and debugs them with the project's own Go SDK. It connects to the rest of adOmnia: Git Studio, Docker Lab, Database Studio, Broker Studio, the API Client, plugins and the AI provider.

Everything stays on your machine. Nothing in a project runs until you trust it.

## Using Go Studio

1. **Open a project** with *File → Open Project* (Ctrl+O), a recent project, or *New Go Project* (which runs `go mod init` after you confirm). New Go Project offers templates — empty module, CLI, REST service, gRPC service, worker, Kafka producer/consumer, library — plus your own templates: folders in `<user config dir>/adomnia/go-templates/`, where `__MODULE__`, `__NAME__` and `__PACKAGE__` are replaced in file contents and paths. The gRPC and Kafka templates run `go mod tidy`, pinned to the versions adOmnia itself uses, so they resolve from the module cache; if that fails (offline) the project is still created and a warning asks you to run Tidy. A project may be a module, a `go.work` workspace, or a folder inside a larger repository.
2. **Trust it.** A newly opened project is *opened* only: you can browse and edit files, but no tool runs. *Trust* (in the toolbar, or *Go → Trust Project Tools*) allows local Go tools for that project.
3. **Pick a Go SDK.** Go Studio detects Go on `PATH`, or installs an official release from *Go → Go SDKs & Toolchains…*. Each project can use a different SDK; click the Go version in the status bar to switch quickly. The toolchain dialog shows `GOROOT`, `GOPATH`, the module proxy/privacy settings and the target platform, and edits them for *This project* or as the *Global default* used by projects without their own settings: Go binary, `GOPROXY`, `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, CGO, `GOOS`/`GOARCH`, build tags (written to `GOFLAGS` as `-tags=`) and other variables. It reads the `go` and `toolchain` directives of `go.mod` and warns when the selected SDK is older: with `GOTOOLCHAIN=local` the build would fail, otherwise `go` would download the newer toolchain. Its *Go tools* section health-checks gopls, the linter and Delve, and installs or updates them to `@latest`.
4. **Write code.** gopls provides completion, diagnostics on unsaved buffers, hover, signature help, navigation (Ctrl+click or Ctrl+B for the declaration), usages, rename with preview, code actions and refactoring. golangci-lint or staticcheck add lint findings.
5. **Run, test, debug.** Use Build, Run with stdin, the gutter ▶ next to `func main` and tests, the structured test runner with coverage, the Delve debugger (launch, attach or remote) and a real terminal. Makefile targets and Dockerfiles run for real too (see below).
6. **Commit and integrate.** The toolbar shows the Git branch and changes, and the gutter shows diffs against HEAD. Commit from Go Studio; Git Studio follows the open project's repository for push, pull and merges. *Tools → Project Services* opens Docker Lab, Database Studio or Broker Studio for the services detected in `go.mod`. HTTP handlers get an *Open in API Client* CodeLens. Package-level functions, methods, types, constants and variables show **Code Vision** above the declaration: the usage count from gopls (click it to list the usages) and the git author of the latest change, with `*` for uncommitted lines. The author is hidden while the buffer has unsaved changes, because blame describes the file on disk.

*View → Maximize Editor* (Ctrl+Shift+F12, or a double-click on an editor tab) closes Project, Structure and the bottom tool window so the code takes all the space; press it again to bring them back exactly as they were. Every pane also closes on its own with its — button or its shortcut (Project Alt+1, Structure Alt+7, bottom tool window Alt+4).

*View → Maximize Go Studio* (Ctrl+Shift+F11, or the ⤢ button at the right of the toolbar) hides adOmnia's rail, the Go Studio header and adOmnia's status bar, so the IDE fills the window. Press it again to restore them; leaving Go Studio restores them too.

The project menu in the toolbar lists the open projects and, below them, the recent projects that are not open, so you can reopen one with a click (*File → Open Recent* shows the same list).

Several projects can stay open at the same time, isolated from each other, grouped into Go Studio workspaces that are separate from adOmnia's API workspaces. A project can also move into its own window (*File → Open Project in New Window*).

## Editor

- **View:** Sticky Scopes (on by default), Minimap, Font Ligatures, Preview Tab, Zoom (Ctrl+= / Ctrl+- / Ctrl+0, including the `+` key of Italian layouts and the numeric keypad) and Zen Mode (Alt+Shift+Z: only the code; leaving it restores the panes as they were).
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
    the same line) and data races.
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

### File

| Action | Windows / Linux | macOS |
| --- | --- | --- |
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
| Test Current Package | Ctrl+Shift+F10 | ⌘⇧F10 |
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

## Platform verification

| Platform | Status |
| --- | --- |
| **Windows** | All automated suites pass with `-race`, real gopls and Delve, including process-tree cleanup, the ConPTY terminal and debugger orphan checks. `build.ps1` builds the Wails 3 executable. Manual checks in the running app are still open (M1–M31 in `todo-ide.md`). |
| **Linux** | The automated suites run in CI (`go test -tags gtk3 ./...` on Ubuntu) and passed in the container used during development, including process-tree and PTY cleanup. Manual checks in a desktop session are still open. |
| **macOS** | The package cross-builds. No runtime verification yet. |

**Separate windows** (*File → Open Project in New Window*) are covered by automated tests only. They will be declared supported in the release notes once the manual check in a real window (M31) passes.

## Known limits

- Push, pull, merge, conflict resolution, rebase and stash live in Git Studio, not in the editor. Other version control systems are not supported.
- Plugins receive read-only Go Studio events (contract v1) and no commands.
- HTTP route prefixes are resolved only within the same file for the *Open in API Client* CodeLens.
- Remote debugging needs the same source paths on both sides for breakpoints to bind.
- Set next statement is not available (Delve has no DAP `goto`); Run to Cursor covers moving forward.
- Refactorings are the code actions gopls offers; nothing is simulated with text replacement.
- Ctrl+click on an undefined symbol has no target; use *Fix with AI* or the gopls quick fixes.

## Project tree, terminal and AI fixes

- **Project tree context menu** (files, folders and the project root): New Go File / File / Folder, Rename or move (Shift+F6 or F2; type a path with `/` to move), Duplicate, Delete (Delete key; always confirmed, and the text of deleted files is kept in Local History), Copy Path / Copy Relative Path, Reveal in File Explorer. Operations never overwrite an existing file and stay inside the project; files with unsaved changes must be saved or discarded first.
- **Terminal profiles**: the arrow next to `+` lists the shells found on the machine — PowerShell 7, Windows PowerShell, Command Prompt, Git Bash and every WSL distribution (e.g. Ubuntu) on Windows; `$SHELL`, bash, zsh and fish on Linux/macOS. The chosen shell becomes the default for `+`. The UI can only start detected profiles, never an arbitrary executable.
- **Resolve all with AI** (Problems pane, with an AI provider enabled in Settings → AI): one request per file with errors or warnings (up to 10 files), then a single change preview; nothing is written until you apply it. The file contents are sent to the configured provider.
- **Code → everything**: CodeLens above SQL tables, broker topics, gRPC service registrations and WebSocket endpoints open them in Database Studio, Broker Studio, the gRPC client (with reflection) and the WebSocket client.
- **Layout**: Go Studio opens maximized; the adOmnia logo in the top-left corner returns to the hub. The button next to Save maximizes the editor alone (Ctrl+Shift+F12).


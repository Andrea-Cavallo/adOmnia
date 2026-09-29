# Go Studio

Go Studio is the Go IDE built into adOmnia. It opens real Go projects, understands them through gopls, and runs, tests and debugs them with the project's own Go SDK. It connects to the rest of adOmnia: Git Studio, Docker Lab, Database Studio, Broker Studio, the API Client, plugins and the AI provider.

Everything stays on your machine. Nothing in a project runs until you trust it.

## Using Go Studio

1. **Open a project** with *File → Open Project* (Ctrl+O), a recent project, or *New Go Project* (which runs `go mod init` after you confirm). A project may be a module, a `go.work` workspace, or a folder inside a larger repository.
2. **Trust it.** A newly opened project is *opened* only: you can browse and edit files, but no tool runs. *Trust* (in the toolbar, or *Go → Trust Project Tools*) allows local Go tools for that project.
3. **Pick a Go SDK.** Go Studio detects Go on `PATH`, or installs an official release from *Go → Go SDKs & Toolchains…*. Each project can use a different SDK.
4. **Write code.** gopls provides completion, diagnostics on unsaved buffers, hover, signature help, navigation (Ctrl+click or Ctrl+B for the declaration), usages, rename with preview, code actions and refactoring. golangci-lint or staticcheck add lint findings.
5. **Run, test, debug.** Use Build, Run with stdin, the gutter ▶ next to `func main` and tests, the structured test runner with coverage, the Delve debugger (launch, attach or remote) and a real terminal.
6. **Commit and integrate.** The toolbar shows the Git branch and changes, and the gutter shows diffs against HEAD. Commit from Go Studio; Git Studio follows the open project's repository for push, pull and merges. *Tools → Project Services* opens Docker Lab, Database Studio or Broker Studio for the services detected in `go.mod`. HTTP handlers get an *Open in API Client* CodeLens.

Several projects can stay open at the same time, isolated from each other, grouped into Go Studio workspaces that are separate from adOmnia's API workspaces. A project can also move into its own window (*File → Open Project in New Window*).

## Security and project authorization

- **Opening is not trusting.** An opened project reads and saves files only. Every action that starts a process requires *Trust*: gopls, linters, build, run, tests, debugging, the terminal, Go Tools, dependency changes and tool installation. Revoking trust stops the project's processes and gopls.
- **Nothing runs implicitly.** Opening a project or restoring a session never runs code. Recovered unsaved buffers are offered, never applied silently.
- **Files stay inside the project.** Paths are confined to the project root, including after resolving symlinks. Run targets and Go Tools arguments that look like flags (for example `-toolexec=…`) are rejected.
- **Secrets are not persisted.** Run configurations store the names of secret environment variables but never their values, which you enter when you start the run. Local history never records `.env` files, keys or certificates.
- **Network access only on request.** Go Studio contacts the network only when you install an SDK or tool, or when your own commands do (for example `go get`). SDK downloads come from the official Go catalog and are verified with SHA-256.
- **Fix with AI sends code only when you click.** It sends the file with the problem and, for `undefined: pkg.Name` errors, the non-test files of that local package, to the AI provider configured in *Settings → AI*. A local provider such as Ollama keeps everything on the machine. The answer may change only the files that were sent and always opens in a preview before anything is applied.
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

Managed tools are installed into `<data>/goide/tools/bin`. A tool on `PATH`, or a path set in *Go → Tool Paths (gopls, linter, dlv)…*, is used instead when present.

**Supported versions.** The Go SDK runs the project, so any release the project's `go.mod` accepts works. gopls, the linters and Delve are built with the project SDK and follow their upstream support policy, which usually covers the two most recent Go releases. If the SDK is too old for the installed Delve, Go Studio says so and suggests selecting a newer SDK or a compatible `dlv`. Development and verification use Go 1.26.5, gopls v0.23.0 and Delve 1.27.2.

`<data>` is `%APPDATA%\adomnia` on Windows and `~/.config/adomnia` on macOS and Linux.

## Persistence and migrations

Go Studio stores metadata only. Source files stay where they are, and file contents are kept only in the recovery and local-history stores described below. All stores live in adOmnia's local bbolt database, in the `goide` bucket.

| Key | Contents | Schema |
| --- | --- | --- |
| `state` | Open sessions (project path, authorization, Go Studio workspace), recent projects, run configurations without secret values, per-session layout (open tabs, active file, panes, navigation history, bookmarks, breakpoints), Go Studio workspaces | `version` 4 |
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
| Resume Program | F9 | F9 |
| Step Over | F8 | F8 |
| Step Into | F7 | F7 |
| Step Out | Shift+F8 | ⇧F8 |
| Stop Debugging | Ctrl+F2 | ⌘F2 |

### Git

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Commit | Ctrl+K | ⌘K |

Other mouse gestures: Ctrl+click (Cmd+click on macOS) goes to the declaration, Alt+click adds a cursor, Shift+Alt+drag selects a column, and a click on a line number toggles a breakpoint.

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
- Refactorings are the code actions gopls offers; nothing is simulated with text replacement.
- Ctrl+click on an undefined symbol has no target; use *Fix with AI* or the gopls quick fixes.

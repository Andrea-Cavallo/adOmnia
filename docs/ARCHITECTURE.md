# Architecture

adOmnia is a local-first desktop developer toolbox built with Wails 3.

## Runtime Shape

```text
React/TypeScript frontend
        |
Wails generated bindings
        |
Go backend services
        |
local files, bbolt, network clients, subprocesses
```

## Frontend

Location: `frontend/`

- React 19 and TypeScript.
- Vite build pipeline.
- Zustand stores for shared UI state.
- Wails 3 generated bindings under `frontend/bindings/` (`frontend/src/wailsjs/` is only a compatibility shim).
- Dense desktop UI with local design tokens and utility classes.

Key areas:

- `frontend/src/components/` for panels and layout.
- `frontend/src/lib/` for API wrappers, request execution, parsers, and helpers.
- `frontend/src/stores/` for app state.

Startup navigation is split by the local UI-session memento. The lightweight
`MainAreaRouter` stays in the entry bundle; the request workspace is a separate
chunk, preloaded before React when the restored rail is `collections` and left
unrequested for Home or secondary panels. Its Suspense fallback reuses the
quiet hydration shell to preserve layout stability.

## Backend

Location: the repository root is a thin Wails binding layer (`main.go`, `app.go`, `*_bindings.go`); feature logic lives in `internal/<domain>/`.

The Go backend owns local system integrations:

- HTTP execution, proxy, mock server, record/replay.
- Browser debugging through Chrome DevTools Protocol.
- Kafka and broker integrations.
- gRPC, WebSocket, SSE, load testing.
- Database tooling.
- Docker Lab generation.
- Themes, plugins, templates, vault, storage.

Wails exposes backend methods to the frontend through generated bindings.

## Storage

adOmnia uses local storage only:

- bbolt for durable app data.
- localStorage for selected frontend state.
- `.adomnia` workspace files for portable exports.
- Local filesystem for templates, skins, plugins, and artifacts.

Storage changes should preserve backward compatibility.

Collection workspaces use an additive bbolt schema:

- `collections/index-v3` stores the active workspace id and lightweight workspace metadata.
- `collections/workspace:<id>` stores one collection tree per workspace; only the active shard is read during bootstrap and other shards load on first access.
- `collections/all` remains a complete version-2 snapshot. Migration to v3 never removes it, and every v3 write rebuilds it atomically for downgrade, snapshot, and storage-inspector compatibility.

If the v3 index or active shard is invalid, startup falls back to `collections/all`. Migration and writes are local, idempotent, and do not change the portable `.adomnia` format.

The Wails startup bootstrap has two compatible envelopes. Version 2 embeds the
persisted JSON as structured values and reports per-block byte sizes; version 1
remains available as a string-based fallback for existing builds and corrupted
or unsupported v2 responses.

## Go Studio

Go Studio is the integrated Go IDE. User-facing behaviour, trust rules and storage details are in [GO-STUDIO.md](GO-STUDIO.md).

**Backend.** `internal/goide` holds a single `Service`, registered through `goide_bindings.go` and shared by every window. It is composed of managers, each owning one kind of resource:

| Manager | Owns |
| --- | --- |
| `WorkspaceManager`, `studioWorkspaceRegistry` | Sessions (one per open project), trust state, Go Studio workspaces |
| `DocumentManager`, `WatchManager`, `LocalHistory`, `RecoveryManager` | Documents confined to the project root, atomic saves, file watching, local history, unsaved-buffer recovery |
| `ToolchainManager`, `ToolchainInstaller` | Go SDK detection, official installs, per-session environment |
| `LSPManager` (`internal/goide/lsp`) | One gopls process per trusted session, JSON-RPC, document sync, features and diagnostics |
| `ProcessManager` | Build, run, tests, Go Tools and dependency commands; output events, stdin, process-tree stop |
| `TerminalManager` | PTY shells (ConPTY on Windows) per session |
| `DebugManager` (`internal/goide/dap`) | Delve over DAP: launch, attach, remote |
| `TestManager`, `RunConfigManager` | Structured test runs and coverage; saved run configurations |
| `windowRegistry` | Which window may edit each session |

`internal/goidewindow` creates the native separate windows (same pattern as `internal/swaggerwindow`), and `internal/git` provides the Git operations reused by the editor VCS features.

**Lifecycle.** Opening a project creates a session in the *opened* state; nothing is started. Trusting it allows gopls, linters, processes, terminals and debugging for that session. Every process is owned by a manager and tied to its session: closing the session, revoking trust or quitting the app stops the whole process tree, and `Service.Shutdown` releases everything in order. `restore()` loads the persisted state lazily on the first call and retries after transient errors.

**Events.** The backend reports progress through `goide:event` envelopes (`sessionId`, `resourceId`, sequence, payload) broadcast to every window: `run.*`, `terminal.*`, `lsp.*`, `debug.*`, `files.changed`, `session.*`. Each frontend store routes them by session and resource. Close confirmation uses `goide:close-requested` for the main window and `goide:window-close-requested` for separate windows.

**Frontend.** Zustand stores under `frontend/src/stores/goide*.ts` hold UI state per session (documents, runs, LSP, VCS, tests, debug, workspaces, windows). Components live in `frontend/src/components/goide/`, and Monaco language features are registered once in `goStudioLanguageFeatures.ts`. The whole of Go Studio is lazy-loaded, and the startup budget check keeps it out of the initial bundle.

**Windows.** The backend stays single. A separate window hosts its own frontend, with its own unsaved buffers, so each session has exactly one editing window. The registry refuses a second one, `CloseSession` refuses a session owned elsewhere, and the window that gives up a project stops persisting its view.

**Storage.** Go Studio uses the bbolt `goide` bucket: `state` (schema 4, migrated in memory from older versions), `recovery` and `localHistory`. Managed SDKs and tools live under the adOmnia data folder.

## Live Development Session

`internal/devsession` is the single owner of live sessions: Go services started from Go Studio, the requests sent to them (API Workspace, Interceptor, Browser Debug) and what those requests caused (breakpoint hits, log lines, SQL, Kafka messages). It does not import Go Studio: `devsession_bindings.go` translates `goide` events (`run.*`, `debug.state`, `debug.output`, `session.closed`) and hands debugger operations to the manager as functions. Changes reach the frontend as `devsession:event` envelopes, applied by `stores/devSession.ts`; the debug bar and its overlays load after the first frame. The API Workspace talks to Go Studio only through that store, the entity router and DOM events (`adomnia:go-debug-start`, `adomnia:debug-active-request`). Details: [LIVE-SESSION.md](LIVE-SESSION.md).

## Security Model

- No telemetry.
- No hidden cloud sync.
- Network calls happen only from explicit user workflows.
- Vault entries are encrypted locally.
- Proxy, mock, Docker, browser, and script features are powerful local tools and should be treated carefully.
- Go Studio runs project code and tools only after the project is explicitly trusted, and confines file access to the project root.

## Distribution

GitHub Actions builds platform artifacts:

- Windows `.exe`
- Linux executable and `.tar.gz`
- macOS universal `.dmg`

See [docs/BUILD.md](BUILD.md) and [docs/RELEASE.md](RELEASE.md).

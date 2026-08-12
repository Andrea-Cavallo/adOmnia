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

- React 18 and TypeScript.
- Vite build pipeline.
- Zustand stores for shared UI state.
- Wails bindings under `frontend/wailsjs/`.
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

Location: repository root Go files.

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

## Security Model

- No telemetry.
- No hidden cloud sync.
- Network calls happen only from explicit user workflows.
- Vault entries are encrypted locally.
- Proxy, mock, Docker, browser, and script features are powerful local tools and should be treated carefully.

## Distribution

GitHub Actions builds platform artifacts:

- Windows `.exe`
- Linux executable and `.tar.gz`
- macOS universal `.dmg`

See [docs/BUILD.md](BUILD.md) and [docs/RELEASE.md](RELEASE.md).

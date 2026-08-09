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

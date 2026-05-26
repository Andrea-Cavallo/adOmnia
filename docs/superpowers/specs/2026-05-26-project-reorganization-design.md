# adOmnia — Project Reorganization Design

**Date:** 2026-05-26  
**Status:** Approved  
**Scope:** Go backend package separation + Frontend App.tsx decomposition  
**Approach:** Progressive (Approach C) — one module per commit, always shippable

---

## 1. Problem Statement

The project has two structural pain points:

1. **Go backend:** ~65 `.go` files all in `package main` at the root. No domain boundaries, no compile-time separation, global variables scattered across files, untestable in isolation.
2. **Frontend App.tsx:** 429 lines mixing 5 unrelated concerns (appearance, data init, keyboard handling, file drop, layout). Impossible to read, hard to test, hard to extend.

Neither issue blocks shipping today, but both accumulate friction with every feature added.

---

## 2. Go Backend Reorganization

### 2.1 Guiding Principles (Go best practices)

- **`internal/` not `pkg/`** — adOmnia is a single binary, not a library. `internal/` enforces that no external consumer can import these packages. `pkg/` is a convention for reusable libraries; it has no meaning here.
- **One package = one domain** — each package owns exactly one domain (e.g., Kafka, gRPC, Proxy). It does not reach into another package's internals.
- **Accept interfaces, return structs** — public constructors return concrete types. Parameters and dependencies are interfaces so tests can swap them.
- **No global variables in `internal/`** — all dependencies are injected via constructors. Global state (`globalPluginManager`, `globalPythonBridge`) lives only in `main.go` during wiring and is eliminated as soon as the consuming package owns it.
- **Wails binding constraint** — Wails requires the bound structs to be registered in `wails.Run`. The solution is the **thin wrapper pattern**: `internal/<module>` holds all logic; `package main` exposes a thin controller struct that embeds or delegates to it. The frontend binding surface (method names and signatures) does not change.
- **One test file per package** — each `internal/<module>` package gets a `<module>_test.go`. The existing root-level `*_test.go` files migrate with their package.
- **Error wrapping** — all errors returned across package boundaries use `fmt.Errorf("context: %w", err)` so callers get full context.
- **`context.Context` first** — every method that does I/O or runs a subprocess accepts `ctx context.Context` as its first parameter.

### 2.2 Target Directory Layout

```
adomnia/
├── main.go                        ← wireman only (~80 lines)
├── app.go                         ← Wails App facade, delegates to internal/*
├── server.go                      ← HTTP sidecar (stays in main — Wails lifecycle)
├── devlog.go                      ← dev log helpers (stays in main)
├── exec_hidden_windows.go         ← platform shim
├── exec_hidden_other.go           ← platform shim
├── hide_windows.go                ← platform shim
├── platform_options_linux.go      ← platform shim
├── platform_options_other.go      ← platform shim
├── window_chrome.go               ← platform shim
├── window_chrome_linux.go         ← platform shim
├── window_chrome_other.go         ← platform shim
│
└── internal/
    ├── kafka/
    │   ├── controller.go          ← KafkaController struct (Wails binding target)
    │   ├── producer.go
    │   ├── consumer.go
    │   ├── scram.go               ← from root scram.go
    │   ├── broker.go              ← from root broker.go
    │   └── kafka_test.go
    ├── grpc/
    │   ├── controller.go          ← GrpcController struct
    │   ├── client.go
    │   └── grpc_test.go
    ├── loadtest/
    │   ├── controller.go          ← LoadTestController struct
    │   ├── engine.go
    │   └── loadtest_test.go
    ├── mock/
    │   ├── controller.go          ← MockController struct
    │   ├── server.go
    │   └── websocket.go
    ├── proxy/
    │   ├── controller.go          ← ProxyController struct
    │   ├── rules.go
    │   ├── traffic.go
    │   ├── ca.go
    │   ├── export.go
    │   ├── map.go
    │   ├── record_replay.go
    │   └── proxy_test.go
    ├── browser/
    │   ├── controller.go          ← BrowserDebugController struct
    │   ├── discover.go
    │   ├── extended.go
    │   └── browser_test.go
    ├── themes/
    │   ├── manager.go             ← ThemeManager struct
    │   ├── catalog.go
    │   └── extended.go
    ├── plugins/
    │   ├── manager.go             ← PluginManager struct
    │   ├── sandbox.go
    │   └── events.go
    ├── python/
    │   ├── bridge.go              ← PythonBridge struct
    │   ├── runtime.go
    │   ├── sdk_server.go
    │   ├── worker.go
    │   ├── worker_windows.go
    │   └── worker_other.go
    ├── storage/
    │   ├── store.go               ← bbolt open/close + key helpers
    │   ├── bindings.go            ← StorageBindings struct (Wails binding target)
    │   ├── workspace.go
    │   └── storage_test.go
    ├── vault/
    │   ├── vault.go               ← Vault struct
    │   └── vault_test.go
    ├── docker/
    │   ├── lab.go                 ← DockerLab struct
    │   └── lab_test.go
    ├── templates/
    │   └── store.go               ← TemplateStore struct
    ├── net/
    │   ├── tools.go               ← NetTools struct
    │   ├── hosts.go
    │   └── cert.go
    ├── oauth/
    │   ├── flow.go
    │   └── oauth_test.go
    ├── ws/
    │   └── client.go              ← WebSocket client
    ├── sse/
    │   └── client.go              ← SSE client
    └── util/
        ├── helpers.go
        ├── json.go
        ├── folderdiff.go
        └── httpexec.go
```

### 2.3 Thin Wrapper Pattern (Wails binding)

The frontend does **not change**. Method names and signatures are preserved. The only change is where the logic lives.

```go
// internal/kafka/controller.go
package kafka

type Controller struct {
    producers map[string]*Producer
    consumers map[string]*Consumer
}

func NewController() *Controller {
    return &Controller{
        producers: make(map[string]*Producer),
        consumers: make(map[string]*Consumer),
    }
}

// SendMessage is the method Wails exposes to the frontend.
func (c *Controller) SendMessage(ctx context.Context, topic, payload string) error {
    // real logic here, no globals
    return fmt.Errorf("kafka: send: %w", err)
}
```

```go
// main.go — wireman only
func main() {
    configureWindowChromeBackend(startupWindowChrome)

    kafkaCtrl   := kafka.NewController()
    grpcCtrl    := grpc.NewController()
    proxyCtrl   := proxy.NewController()
    browserCtrl := browser.NewController()
    themesMgr   := themes.NewManager()
    tmplStore   := templates.NewStore()
    pluginsMgr  := plugins.NewManager()
    wasmRT      := plugins.NewWasmRuntime()
    dockerLab   := docker.NewLab()
    pythonBr    := python.NewBridge()
    app         := NewApp(kafkaCtrl, grpcCtrl, proxyCtrl, browserCtrl)

    wails.Run(&options.App{
        Bind: []interface{}{
            app, kafkaCtrl, grpcCtrl, proxyCtrl,
            browserCtrl, themesMgr, tmplStore,
            pluginsMgr, wasmRT, dockerLab, pythonBr,
        },
        ...
    })
}
```

### 2.4 Extraction Phases (each is one atomic commit)

Each phase: move files → fix imports → `go build ./...` green → commit.

| Phase | Package | Source files | Risk |
|-------|---------|--------------|------|
| 1 | `internal/kafka` | `kafka.go`, `scram.go`, `broker.go` | Low — no deps on other root files |
| 2 | `internal/grpc` | `grpc.go` | Low |
| 3 | `internal/loadtest` | `loadtest.go` | Low — uses kafka types, import after phase 1 |
| 4 | `internal/mock` | `mock.go`, `websocket_mock.go` | Low |
| 5 | `internal/proxy` | `proxy.go`, `proxy_rules.go`, `proxy_traffic.go`, `proxy_ca.go`, `proxy_export.go`, `proxy_map.go`, `record_replay.go` | Medium — most interconnected |
| 6 | `internal/browser` | `browser_debug.go`, `browser_debug_discover.go`, `browser_debug_extended.go` | Low |
| 7 | `internal/themes` | `themes.go`, `themes_extended.go` | Low |
| 8 | `internal/plugins` | `plugins.go`, `plugins_sandbox.go` | Low |
| 9 | `internal/python` | `python_bindings.go`, `python_runtime.go`, `python_sdk_server.go`, `python_worker*.go` | Medium — depends on plugins |
| 10 | `internal/storage` | `storage.go`, `storage_bindings.go`, `workspace_go.go` | Low |
| 11 | `internal/vault` | `vault.go` | Low — depends on storage |
| 12 | `internal/docker` | `dockerlab.go` | Low |
| 13 | `internal/templates` | `templates.go` | Low |
| 14 | `internal/net` | `nettools.go`, `hostsmap.go`, `certtools_go.go` | Low |
| 15 | `internal/util` | `helpers.go`, `jsontools_go.go`, `folderdiff_go.go`, `httpexec.go`, `oauth.go`, `sse_client.go`, `websocket_client.go` | Low |

**Definition of done per phase:** `go build ./...` passes, `go test ./...` passes, `wails dev` starts correctly.

---

## 3. Frontend App.tsx Decomposition

### 3.1 Guiding Principles (React/TypeScript best practices)

- **Custom hooks = pure logic, no JSX** — every `useXxx` hook returns state and callbacks. It never renders anything.
- **Single Responsibility** — one hook owns one concern. `useFileDrop` knows nothing about keyboard shortcuts.
- **Explicit return types** — every hook has a typed return interface. No implicit `any`.
- **Effects cleanup** — every `useEffect` that registers a listener returns a cleanup function. No memory leaks.
- **Stable references** — callbacks passed to `addEventListener` are wrapped in `useCallback` with correct deps to avoid re-registration on every render.
- **No store access in JSX** — the component reads from hooks, not directly from Zustand in the render body.
- **Micro-components for inline JSX blobs** — `DropOverlay` and `DropToast` are extracted as named components, not anonymous JSX blocks.

### 3.2 Target File Layout

```
frontend/src/
├── App.tsx                             ← ~70 lines, pure layout shell
├── hooks/
│   ├── useAppearance.ts                ← theme / font / density CSS effects
│   ├── useAppInit.ts                   ← window chrome + data bootstrap + dev logs
│   ├── useKeyboardShortcuts.ts         ← global Ctrl+K, Ctrl+N, mouse side buttons
│   └── useFileDrop.ts                  ← drag/drop, file routing, workspace import
└── components/
    └── layout/
        ├── ErrorBoundary.tsx           ← extracted from App.tsx inline class
        ├── DropOverlay.tsx             ← extracted inline JSX blob
        └── DropToast.tsx               ← extracted inline JSX blob
```

### 3.3 Hook Signatures

```typescript
// hooks/useAppearance.ts
export function useAppearance(): void
// Side-effect only. Applies CSS vars for theme/font/density. Returns nothing.

// hooks/useAppInit.ts
interface AppInitResult {
  activeWindowChrome: 'app' | 'app-xwayland' | 'system' | null
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
}
export function useAppInit(): AppInitResult
// Handles: window chrome detection, store loading, dev log polling, empty-workspace routing.

// hooks/useKeyboardShortcuts.ts
interface KeyboardShortcutsOptions {
  setCommandPaletteOpen: (open: boolean) => void
}
export function useKeyboardShortcuts(opts: KeyboardShortcutsOptions): void
// Registers and cleans up all global keydown + mousedown listeners.

// hooks/useFileDrop.ts
interface FileDropResult {
  dragOver: boolean
  dropFeedback: { msg: string; ok: boolean } | null
  handlers: {
    onDragEnter: React.DragEventHandler
    onDragLeave: React.DragEventHandler
    onDragOver: React.DragEventHandler
    onDrop: React.DragEventHandler
  }
}
export function useFileDrop(): FileDropResult
// Owns all drag/drop state, file routing, workspace import logic.
```

### 3.4 App.tsx Result (~70 lines)

```tsx
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { DropOverlay }   from '@/components/layout/DropOverlay'
import { DropToast }     from '@/components/layout/DropToast'
import { useAppInit }         from '@/hooks/useAppInit'
import { useAppearance }      from '@/hooks/useAppearance'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useFileDrop }         from '@/hooks/useFileDrop'
// ... layout component imports

export default function App() {
  const { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen } = useAppInit()
  const { dragOver, dropFeedback, handlers } = useFileDrop()
  const devLogVisible = useAppStore((s) => s.devToolsVisible)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)

  useAppearance()
  useKeyboardShortcuts({ setCommandPaletteOpen })

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div
          className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0 relative"
          {...handlers}
        >
          {activeWindowChrome !== 'system' && <Titlebar />}
          <StorageQuotaBanner />
          <div className="flex flex-1 min-h-0">
            <Rail />
            <Sidebar />
            <ErrorBoundary><MainArea /></ErrorBoundary>
          </div>
          <StatusBar />
          {dragOver && <DropOverlay />}
          {dropFeedback && <DropToast feedback={dropFeedback} />}
        </div>
        <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
        <DevLogOverlay visible={devLogVisible} onClose={toggleDevTools} />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
```

---

## 4. What Does NOT Change

- **Wails-generated bindings** (`frontend/src/wailsjs/`) — auto-generated, untouched
- **Existing component structure** (`frontend/src/components/`) — untouched except the three new layout micro-components
- **Existing stores** (`frontend/src/stores/`) — untouched
- **Existing `lib/`** (`frontend/src/lib/`) — untouched in this phase
- **`go.mod` module name** — untouched
- **`cmd/cli/`** — untouched
- **`proto/`** — untouched

---

## 5. Success Criteria

### Go backend
- [ ] `go build ./...` passes after every phase
- [ ] `go test ./...` passes after every phase
- [ ] `wails dev` starts and all features work after every phase
- [ ] Zero global variables in `internal/` packages
- [ ] No circular imports between `internal/` packages
- [ ] `main.go` ≤ 100 lines

### Frontend
- [ ] `npm run build` passes
- [ ] App.tsx ≤ 80 lines
- [ ] Each hook has an explicit TypeScript return type
- [ ] Every `useEffect` in every hook has a cleanup function where needed
- [ ] No regressions: drag/drop, keyboard shortcuts, theme switching, data loading all work

---

## 6. Out of Scope (future phases)

- `frontend/src/lib/` reorganization (45 files — separate effort)
- Zustand store consolidation
- `frontend/src/stores/` audit
- Database or bbolt schema changes
- Any new features

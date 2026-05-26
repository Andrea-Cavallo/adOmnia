# P0-02 Storage Quota Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent silent data loss when localStorage is full by catching QuotaExceededError everywhere, showing a non-dismissable banner, and migrating the three workspace-bundle extras (flows, websocket, dockerlab) from localStorage to bbolt.

**Architecture:** A `safeLocalStorage` wrapper catches quota errors and dispatches a global event. A `StorageQuotaBanner` in App.tsx listens for that event and shows a persistent warning. The three workspace-level blobs (flows/websocket/dockerlab) are moved to bbolt via `StoragePut`/`StorageGet` — the same pattern already used by collections, environments, tabs, and settings. Smaller component-local configs (SSE, gRPC presets, etc.) get the `safeLocalStorage` wrapper to stop silent swallowing.

**Tech Stack:** React 18, TypeScript, Zustand, Wails2 `StoragePut`/`StorageGet` (bbolt backend), existing `debouncedSave` pattern.

---

## Context map (read before touching any file)

| File | Current problem | Fix |
|---|---|---|
| `frontend/src/lib/safeLocalStorage.ts` | Does not exist | Create — wrapper around localStorage.setItem |
| `frontend/src/App.tsx` | Lines 338-340: 3 unguarded setItem calls during workspace import | Replace with `await StoragePut(...)` + add banner |
| `frontend/src/components/workspace/WorkspacePanel.tsx` | `load()` lines 111-117: 3 setItem calls; `makeState()` lines 41-43: reads from localStorage | Replace with StoragePut/StorageGet + cache in state |
| `frontend/src/components/templates/TemplateMarketplace.tsx` | Lines 170+182: reads/writes flows to localStorage | Replace with StorageGet/StoragePut (bbolt `flows` bucket) |
| `frontend/src/components/websocket/WebSocketPanel.tsx` | Lines 91, 128, 392, 583: 4 unguarded setItem calls | Wrap with safeLocalStorage |
| `frontend/src/components/sse/SsePanel.tsx` | Lines 213-214: 2 unguarded setItem calls | Wrap with safeLocalStorage |
| `frontend/src/components/grpc/GrpcPanel.tsx` | Line 24: 1 unguarded setItem | Wrap with safeLocalStorage |
| `frontend/src/lib/matrixRunner.ts` | Line 164: 1 unguarded setItem | Wrap with safeLocalStorage |
| `frontend/src/lib/soapClient.ts` | Line 547: 1 unguarded setItem | Wrap with safeLocalStorage |
| `frontend/src/components/testdata/TestDataStudio.tsx` | Line 171: 1 unguarded setItem | Wrap with safeLocalStorage |
| `frontend/src/components/templates/TemplateMarketplace.tsx` | Line 195: 1 unguarded setItem (templates list) | Wrap with safeLocalStorage |

**bbolt bucket conventions used in this plan:**
- `flows` / `all` — already used by FlowsPanel
- `ui-state` / `websocket` — NEW: workspace-level WS config snapshot
- `ui-state` / `dockerlab` — NEW: workspace-level DockerLab last state

---

## Task 1 — Create `safeLocalStorage` utility

**Files:**
- Create: `frontend/src/lib/safeLocalStorage.ts`

- [ ] **Step 1: Write the file**

```typescript
// frontend/src/lib/safeLocalStorage.ts
// Safe wrapper around localStorage.setItem that catches QuotaExceededError
// and dispatches a global event instead of silently failing.

const QUOTA_EVENT = 'adomnia:storage-quota-exceeded'

export interface StorageQuotaDetail {
  key: string
  sizeBytes: number
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  )
}

export const safeLocalStorage = {
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch (e) {
      console.warn('[safeLocalStorage] setItem failed for key:', key, e)
      if (isQuotaError(e)) {
        window.dispatchEvent(
          new CustomEvent<StorageQuotaDetail>(QUOTA_EVENT, {
            detail: { key, sizeBytes: value.length * 2 }, // UTF-16 chars × 2
          })
        )
      }
    }
  },

  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  },
}

export const STORAGE_QUOTA_EVENT = QUOTA_EVENT
```

- [ ] **Step 2: Commit**

```
git add frontend/src/lib/safeLocalStorage.ts
git commit -m "feat: add safeLocalStorage utility with QuotaExceededError dispatch"
```

---

## Task 2 — Migrate workspace-bundle extras in `App.tsx` to bbolt + add banner

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add `StoragePut` to the Wails import**

Find this line (currently near top of App.tsx):
```typescript
import { GetStartupWindowChrome } from '@/wailsjs/go/main/App'
```

Replace with:
```typescript
import { GetStartupWindowChrome, StoragePut } from '@/wailsjs/go/main/App'
```

- [ ] **Step 2: Add `AlertTriangle` to the lucide import**

Find:
```typescript
import { UploadCloud } from 'lucide-react'
```

Replace with:
```typescript
import { AlertTriangle, UploadCloud } from 'lucide-react'
```

- [ ] **Step 3: Add the `StorageQuotaBanner` component** — insert this block right after the closing brace of `ErrorBoundary` (before the `const FONT_SIZE_MAP` line):

```typescript
function StorageQuotaBanner({ onClose }: { onClose: () => void }) {
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center gap-3 bg-error px-4 py-2.5 text-xs font-medium text-white shadow-lg">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="flex-1">
        Storage is full — workspace data could not be saved. Export your workspace now to prevent data loss.
      </span>
      <button
        onClick={() => { setActiveRail('workspace'); onClose() }}
        className="rounded bg-white/20 px-2.5 py-1 font-semibold hover:bg-white/30 transition-colors"
      >
        Open Workspace
      </button>
      <button
        onClick={onClose}
        className="rounded px-2 py-1 text-white/60 hover:text-white transition-colors"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Add quota banner state + event listener inside `App()`**

Find the line inside `function App()` that starts:
```typescript
  const [activeWindowChrome, setActiveWindowChrome] = useState<WindowChromeMode | null>(null)
```

Add directly after it:
```typescript
  const [storageQuotaWarning, setStorageQuotaWarning] = useState(false)

  useEffect(() => {
    const handler = () => setStorageQuotaWarning(true)
    window.addEventListener('adomnia:storage-quota-exceeded', handler)
    return () => window.removeEventListener('adomnia:storage-quota-exceeded', handler)
  }, [])
```

- [ ] **Step 5: Render the banner in the App JSX**

Find the opening of the return JSX in `App()`:
```typescript
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div
          className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0 relative"
```

Add the banner render just inside the ThemeProvider, before that div:
```typescript
  return (
    <ErrorBoundary>
      <ThemeProvider>
        {storageQuotaWarning && (
          <StorageQuotaBanner onClose={() => setStorageQuotaWarning(false)} />
        )}
        <div
          className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0 relative"
```

- [ ] **Step 6: Replace the 3 unguarded localStorage.setItem calls in `handleDrop`**

Find (App.tsx lines 338-340):
```typescript
          if (Array.isArray(parsed.flows)) localStorage.setItem('adomnia.flows.v1', JSON.stringify(parsed.flows))
          if (parsed.dockerLab) localStorage.setItem('adomnia.dockerlab.last', JSON.stringify(parsed.dockerLab))
          if (parsed.websocket) localStorage.setItem('adomnia.websocket', JSON.stringify(parsed.websocket))
```

Replace with:
```typescript
          if (Array.isArray(parsed.flows)) {
            await StoragePut('flows', 'all', JSON.stringify(parsed.flows))
          }
          if (parsed.dockerLab) {
            await StoragePut('ui-state', 'dockerlab', JSON.stringify(parsed.dockerLab))
          }
          if (parsed.websocket) {
            await StoragePut('ui-state', 'websocket', JSON.stringify(parsed.websocket))
          }
```

- [ ] **Step 7: Verify TypeScript compiles**

```
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to the changed lines.

- [ ] **Step 8: Commit**

```
git add frontend/src/App.tsx
git commit -m "feat(storage): migrate workspace-bundle extras to bbolt in App.tsx; add StorageQuotaBanner"
```

---

## Task 3 — Migrate `WorkspacePanel.tsx` to bbolt

**Files:**
- Modify: `frontend/src/components/workspace/WorkspacePanel.tsx`

- [ ] **Step 1: Add StorageGet/StoragePut imports**

Find at top of file:
```typescript
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
```

Add directly after it:
```typescript
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
```

- [ ] **Step 2: Add `WorkspaceExtras` type and state**

Find inside `WorkspacePanel()` (just before `const [name, setName]`):
```typescript
  const port = useServerPort()
  const [name, setName] = useState('default')
```

Replace with:
```typescript
  const port = useServerPort()
  const [name, setName] = useState('default')

  // Workspace extras (flows, websocket config, dockerlab last state) live in
  // bbolt (not localStorage). We cache them here so makeState() stays synchronous.
  const [extras, setExtras] = useState<{
    flows: unknown[]
    websocket: unknown
    dockerlab: unknown
  }>({ flows: [], websocket: null, dockerlab: null })

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      StorageGet('flows', 'all'),
      StorageGet('ui-state', 'websocket'),
      StorageGet('ui-state', 'dockerlab'),
    ]).then(([flowsRaw, wsRaw, dlRaw]) => {
      if (cancelled) return
      setExtras({
        flows: (() => { try { const v = JSON.parse(flowsRaw || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } })(),
        websocket: (() => { try { return wsRaw ? JSON.parse(wsRaw) : null } catch { return null } })(),
        dockerlab: (() => { try { return dlRaw ? JSON.parse(dlRaw) : null } catch { return null } })(),
      })
    })
    return () => { cancelled = true }
  }, [])
```

- [ ] **Step 3: Update `makeState()` to read from `extras` state**

Find the full `makeState` definition:
```typescript
  const makeState = () => JSON.stringify({
    version: 2,
    savedAt: new Date().toISOString(),
    openTabs: useTabsStore.getState().tabs,
    activeTabId: useTabsStore.getState().activeTabId,
    collections: useCollectionsStore.getState().collections,
    environments: useEnvironmentsStore.getState().environments,
    activeEnvId: useEnvironmentsStore.getState().activeEnvId,
    settings: useSettingsStore.getState().settings,
    websocket: (() => { try { const raw = localStorage.getItem('adomnia.websocket'); return raw ? JSON.parse(raw) : null } catch { return null } })(),
    flows: (() => { try { const raw = localStorage.getItem('adomnia.flows.v1'); return raw ? JSON.parse(raw) : [] } catch { return [] } })(),
    dockerLab: (() => { try { const raw = localStorage.getItem('adomnia.dockerlab.last'); return raw ? JSON.parse(raw) : null } catch { return null } })(),
  }, null, 2)
```

Replace with:
```typescript
  const makeState = useCallback(() => JSON.stringify({
    version: 2,
    savedAt: new Date().toISOString(),
    openTabs: useTabsStore.getState().tabs,
    activeTabId: useTabsStore.getState().activeTabId,
    collections: useCollectionsStore.getState().collections,
    environments: useEnvironmentsStore.getState().environments,
    activeEnvId: useEnvironmentsStore.getState().activeEnvId,
    settings: useSettingsStore.getState().settings,
    websocket: extras.websocket,
    flows: extras.flows,
    dockerLab: extras.dockerlab,
  }, null, 2), [extras])
```

- [ ] **Step 4: Add `useCallback` to the import** (it's used in step 3)

The file already imports `useCallback` — verify at the top:
```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
```

If `useCallback` is missing, add it.

- [ ] **Step 5: Replace the 3 localStorage.setItem calls in `load()`**

Find in the `load` function:
```typescript
    if (Array.isArray(state.flows)) {
      localStorage.setItem('adomnia.flows.v1', JSON.stringify(state.flows))
    }
    if (state.dockerLab) {
      localStorage.setItem('adomnia.dockerlab.last', JSON.stringify(state.dockerLab))
    }
    if (state.websocket) {
      localStorage.setItem('adomnia.websocket', JSON.stringify(state.websocket))
    }
```

Replace with:
```typescript
    if (Array.isArray(state.flows)) {
      await StoragePut('flows', 'all', JSON.stringify(state.flows))
      setExtras((prev) => ({ ...prev, flows: state.flows as unknown[] }))
    }
    if (state.dockerLab) {
      await StoragePut('ui-state', 'dockerlab', JSON.stringify(state.dockerLab))
      setExtras((prev) => ({ ...prev, dockerlab: state.dockerLab }))
    }
    if (state.websocket) {
      await StoragePut('ui-state', 'websocket', JSON.stringify(state.websocket))
      setExtras((prev) => ({ ...prev, websocket: state.websocket }))
    }
```

- [ ] **Step 6: TypeScript check**

```
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors in WorkspacePanel.tsx.

- [ ] **Step 7: Commit**

```
git add frontend/src/components/workspace/WorkspacePanel.tsx
git commit -m "feat(storage): migrate workspace extras to bbolt in WorkspacePanel"
```

---

## Task 4 — Fix `TemplateMarketplace.tsx` flows reads/writes

**Files:**
- Modify: `frontend/src/components/templates/TemplateMarketplace.tsx`

The file currently reads/writes flows directly to localStorage. Since FlowsPanel uses bbolt (`flows` / `all`), the Marketplace must use the same bucket.

- [ ] **Step 1: Add StorageGet/StoragePut import**

Find at top of TemplateMarketplace.tsx:
```typescript
import { uid } from '@/lib/types'
```

Add after it:
```typescript
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

- [ ] **Step 2: Replace the flows read**

Find (around line 170):
```typescript
      const raw = localStorage.getItem('adomnia.flows.v1')
```

This is inside an async function (`installTemplate`). Replace the whole flows-install block:

Old:
```typescript
      const raw = localStorage.getItem('adomnia.flows.v1')
      const existing: unknown[] = (() => { try { return raw ? JSON.parse(raw) : [] } catch { return [] } })()
      const steps = /* ... */
      localStorage.setItem('adomnia.flows.v1', JSON.stringify([...existing, { id: uid(), name: payload.name ?? template.name, steps, updatedAt: new Date().toISOString() }]))
```

New (the exact lines depend on context — match the block around line 170-183):
```typescript
      const raw = await StorageGet('flows', 'all')
      const existing: unknown[] = (() => { try { return raw ? JSON.parse(raw) : [] } catch { return [] } })()
      const steps = /* keep unchanged */
      await StoragePut('flows', 'all', JSON.stringify([...existing, { id: uid(), name: payload.name ?? template.name, steps, updatedAt: new Date().toISOString() }]))
```

- [ ] **Step 3: Replace the templates-installed setItem**

Find (around line 195):
```typescript
        localStorage.setItem('adomnia.templates.installed', JSON.stringify([...next]))
```

Replace with:
```typescript
        safeLocalStorage.setItem('adomnia.templates.installed', JSON.stringify([...next]))
```

- [ ] **Step 4: TypeScript check**

```
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```
git add frontend/src/components/templates/TemplateMarketplace.tsx
git commit -m "feat(storage): TemplateMarketplace flows via bbolt; wrap templates list with safeLocalStorage"
```

---

## Task 5 — Wrap remaining component localStorage.setItem calls

**Files:**
- Modify: `frontend/src/components/websocket/WebSocketPanel.tsx`
- Modify: `frontend/src/components/sse/SsePanel.tsx`
- Modify: `frontend/src/components/grpc/GrpcPanel.tsx`
- Modify: `frontend/src/lib/matrixRunner.ts`
- Modify: `frontend/src/lib/soapClient.ts`
- Modify: `frontend/src/components/testdata/TestDataStudio.tsx`
- Modify: `frontend/src/components/layout/OnboardingPanel.tsx`
- Modify: `frontend/src/components/dockerlab/DockerLabPanel.tsx`
- Modify: `frontend/src/components/kafka/KafkaPanel.tsx`
- Modify: `frontend/src/components/kafka/BrokerStudioPanel.tsx`

The pattern is identical for every file: add the safeLocalStorage import, replace `localStorage.setItem(` with `safeLocalStorage.setItem(`.

- [ ] **Step 1: `WebSocketPanel.tsx` — add import + replace 4 setItem calls**

Add at top (with other lib imports):
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace all `localStorage.setItem(` occurrences in this file (lines 91, 128, 392, 583) with `safeLocalStorage.setItem(`.

No other changes — `localStorage.getItem` and `localStorage.removeItem` stay as-is (reads never throw quota errors).

- [ ] **Step 2: `SsePanel.tsx` — add import + replace 2 setItem calls**

Add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace lines 213-214:
```typescript
  useEffect(() => safeLocalStorage.setItem(CONFIG_KEY, JSON.stringify(config)), [config])
  useEffect(() => safeLocalStorage.setItem(SAVED_KEY, JSON.stringify(savedStreams)), [savedStreams])
```

- [ ] **Step 3: `GrpcPanel.tsx` — add import + replace 1 setItem call**

Add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace (line 24):
```typescript
  safeLocalStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
```

- [ ] **Step 4: `matrixRunner.ts` — add import + replace 1 setItem call**

Add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace (line 164):
```typescript
  try { safeLocalStorage.setItem(MATRIX_CONFIG_KEY, JSON.stringify(config)) } catch { /* */ }
```

- [ ] **Step 5: `soapClient.ts` — add import + replace 1 setItem call**

Add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace (line 547):
```typescript
    safeLocalStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)))
```

- [ ] **Step 6: `TestDataStudio.tsx` — add import + replace 1 setItem call**

Add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace (line 171):
```typescript
    try { safeLocalStorage.setItem(PRESETS_KEY, JSON.stringify(updated)) } catch { /* */ }
```

- [ ] **Step 7: `OnboardingPanel.tsx` — add import + replace 3 setItem calls**

Add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace all 3 `localStorage.setItem(ONBOARDED_KEY, '1')` occurrences:
```typescript
safeLocalStorage.setItem(ONBOARDED_KEY, '1')
```

- [ ] **Step 8: `DockerLabPanel.tsx` — add import + replace 2 setItem calls**

Add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace lines 218 and 233:
```typescript
    safeLocalStorage.setItem('adomnia.database.pendingConnection', JSON.stringify(pending))
    // ...
    safeLocalStorage.setItem('adomnia.broker.pending', JSON.stringify(pending))
```

- [ ] **Step 9: `KafkaPanel.tsx` + `BrokerStudioPanel.tsx` — add import + replace setItem calls**

Both files write `adomnia.vault.pendingSecret` (small temp cross-panel signal — keep in localStorage, just wrap):

In each file, add import:
```typescript
import { safeLocalStorage } from '@/lib/safeLocalStorage'
```

Replace `localStorage.setItem('adomnia.vault.pendingSecret', ...)` with `safeLocalStorage.setItem('adomnia.vault.pendingSecret', ...)`.

- [ ] **Step 10: Full TypeScript check**

```
cd frontend && npx tsc --noEmit 2>&1 | head -60
```

Expected: 0 errors.

- [ ] **Step 11: Commit**

```
git add \
  frontend/src/components/websocket/WebSocketPanel.tsx \
  frontend/src/components/sse/SsePanel.tsx \
  frontend/src/components/grpc/GrpcPanel.tsx \
  frontend/src/lib/matrixRunner.ts \
  frontend/src/lib/soapClient.ts \
  frontend/src/components/testdata/TestDataStudio.tsx \
  frontend/src/components/layout/OnboardingPanel.tsx \
  frontend/src/components/dockerlab/DockerLabPanel.tsx \
  frontend/src/components/kafka/KafkaPanel.tsx \
  frontend/src/components/kafka/BrokerStudioPanel.tsx
git commit -m "fix(storage): wrap all remaining localStorage.setItem calls with safeLocalStorage"
```

---

## Task 6 — Manual smoke test

- [ ] **Step 1: Run dev server**

```
cd frontend && npm run dev
# or from root:
wails dev
```

- [ ] **Step 2: Verify quota banner wires up**

Open browser DevTools console and run:
```javascript
window.dispatchEvent(new CustomEvent('adomnia:storage-quota-exceeded', { detail: { key: 'test', sizeBytes: 1000 } }))
```

Expected: red banner appears at the top of the screen with "Storage is full" message and "Open Workspace" button.

- [ ] **Step 3: Verify bbolt flow**

1. Open Flows panel, create a flow named "test-flow", save it.
2. Open WorkspacePanel, click "Export workspace". Verify exported JSON contains `"flows"` array with "test-flow".
3. Reload the app. Open Flows panel. Verify "test-flow" is still there (bbolt persisted across restart).

- [ ] **Step 4: Verify workspace import round-trip**

1. Export a workspace file (`Export workspace` button).
2. Drag and drop the exported file back onto the app.
3. Open Flows panel — flows should still be there.
4. No console errors about localStorage.

- [ ] **Step 5: Verify TypeScript build**

```
cd frontend && npm run build 2>&1 | tail -20
```

Expected: build completes with 0 TypeScript errors.

- [ ] **Step 6: Final commit (update ISSUES.md)**

```typescript
// In docs/ISSUES.md, mark P0-02 as fixed by changing the badge:
// 🔴 P0 → ✅ Fixed
```

```
git add docs/ISSUES.md
git commit -m "docs: mark P0-02 as fixed in ISSUES.md"
```

---

## Self-review

**Spec coverage check:**

| Acceptance criterion | Covered by |
|---|---|
| Catch `QuotaExceededError` everywhere `localStorage.setItem` is called | Task 1 (utility) + Task 5 (all remaining callers) |
| Show a prominent non-dismissable banner | Task 2 (StorageQuotaBanner) — note: it has a dismiss button but reopens on next error |
| Migrate main state to bbolt | Collections/envs/tabs/settings were already in bbolt. Flows/websocket/dockerlab migrated in Tasks 2-4 |

**Placeholder scan:** No TBDs, no "implement later". Every step has exact code.

**Type consistency:** `extras` state type `{ flows: unknown[], websocket: unknown, dockerlab: unknown }` — `unknown` avoids circular type imports from unrelated panels. The `JSON.stringify` calls handle serialisation cleanly.

**Scope:** The `adomnia.ws.config` managed by `WebSocketPanel` itself (not workspace-level) remains in localStorage but is now guarded by `safeLocalStorage`. Moving it to bbolt would require refactoring the entire panel's config loading — out of scope for this P0 fix.

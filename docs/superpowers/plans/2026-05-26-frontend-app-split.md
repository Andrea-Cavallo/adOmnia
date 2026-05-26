# Frontend App.tsx Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decomporre `App.tsx` (429 righe, 5 responsabilità) in hook custom con responsabilità singola e micro-componenti, lasciando App.tsx come shell JSX di ≤80 righe.

**Architecture:** 4 custom hook in `frontend/src/hooks/`, 3 micro-componenti in `frontend/src/components/layout/`. Ogni hook ha return type esplicito, ogni `useEffect` ha cleanup. App.tsx diventa puro layout.

**Tech Stack:** React 18, TypeScript, Zustand, Vite

**Regola di verifica per ogni task:**
```bash
cd frontend && npm run build
```
Deve passare senza errori TypeScript. Poi verificare manualmente in `wails dev` che la feature estratta funzioni.

---

## Task 1: Estrai `ErrorBoundary` in file dedicato

`ErrorBoundary` è una class component inline in App.tsx (righe 32–64). Non è correlata alla logica dell'app: va in `components/layout/`.

**Files:**
- Create: `frontend/src/components/layout/ErrorBoundary.tsx`
- Modify: `frontend/src/App.tsx` (rimuovi la class, aggiungi import)

- [ ] **Step 1: Crea `frontend/src/components/layout/ErrorBoundary.tsx`**

```tsx
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-surface-0 p-8 font-mono text-error">
          <h2 className="mb-3 text-base font-semibold">Something went wrong</h2>
          <p className="max-w-xl text-xs leading-5 text-text-2">
            adOmnia hit a recoverable UI error. Your local data was not sent anywhere.
            Try recovering this view, or reload the app if the problem keeps happening.
          </p>
          <pre className="mt-3 whitespace-pre-wrap text-xs text-error/80">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-5 h-8 rounded-md bg-accent px-4 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Try to recover
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: Rimuovi la class da `App.tsx` e sostituisci con import**

Rimuovi le righe 32–64 di `App.tsx` (la class ErrorBoundary intera).

Aggiungi in cima agli import di `App.tsx`:
```tsx
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
```

- [ ] **Step 3: Verifica build**

```bash
cd frontend && npm run build
```
Expected: nessun errore TypeScript.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/ErrorBoundary.tsx frontend/src/App.tsx
git commit -m "refactor: extract ErrorBoundary into dedicated component"
```

---

## Task 2: Estrai `useAppearance` hook

Gestisce 3 `useEffect` che applicano CSS custom properties per tema, font, e density. Non restituisce nulla — effetti puri.

**Files:**
- Create: `frontend/src/hooks/useAppearance.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Crea `frontend/src/hooks/useAppearance.ts`**

```typescript
import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { getUIFontStack } from '@/lib/uiFonts'

const FONT_SIZE_MAP = { small: '12px', medium: '15px', large: '20px' } as const
const MONO_SIZE_MAP = { small: '11px', medium: '14px', large: '19px' } as const
const DENSITY_SCALE = { compact: '0.85', comfortable: '1', spacious: '1.2' } as const

/**
 * Applica i CSS custom properties per tema, font e density al documento.
 * Hook di soli effetti collaterali: non restituisce nulla.
 */
export function useAppearance(): void {
  const appearance = useSettingsStore((s) => s.settings.appearance)

  // Tema light/dark
  useEffect(() => {
    const html = document.documentElement
    if (appearance.theme === 'light') {
      html.classList.remove('dark')
      html.classList.add('light')
    } else {
      html.classList.add('dark')
      html.classList.remove('light')
    }
  }, [appearance.theme])

  // Font UI e dimensioni
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--font-ui', getUIFontStack(appearance.uiFont))
    root.setProperty('--app-font-size', FONT_SIZE_MAP[appearance.fontSize] ?? '15px')
    root.setProperty(
      '--app-mono-size',
      MONO_SIZE_MAP[appearance.monoFontSize ?? appearance.fontSize] ?? '14px',
    )
  }, [appearance.uiFont, appearance.fontSize, appearance.monoFontSize])

  // Density scale
  useEffect(() => {
    const scale = DENSITY_SCALE[appearance.density] ?? '1'
    document.documentElement.style.setProperty('--density-scale', scale)
    const fontSize = FONT_SIZE_MAP[appearance.fontSize] ?? '15px'
    document.documentElement.style.fontSize = `calc(${fontSize} * ${scale})`
  }, [appearance.density, appearance.fontSize])
}
```

- [ ] **Step 2: Rimuovi i 4 blocchi appearance da `App.tsx`**

Rimuovi da `App.tsx`:
- La riga `const appearance = useSettingsStore((s) => s.settings.appearance)` (e le costanti `FONT_SIZE_MAP`, `MONO_SIZE_MAP`, `DENSITY_SCALE` se sono solo lì)
- Il `useEffect` per il tema (righe 113–122)
- Il `useEffect` per font size (righe 133–139)
- Il `useEffect` per density scale (righe 141–147)
- Il `useEffect` per global font+density (righe 149–154)

Aggiungi in cima agli import:
```tsx
import { useAppearance } from '@/hooks/useAppearance'
```

Aggiungi nel body di `App()`:
```tsx
useAppearance()
```

- [ ] **Step 3: Verifica build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Test manuale**

In `wails dev`: cambia tema (light/dark), font size (small/medium/large), density. Verifica che il cambio si applichi immediatamente.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useAppearance.ts frontend/src/App.tsx
git commit -m "refactor: extract useAppearance hook"
```

---

## Task 3: Estrai `useAppInit` hook

Gestisce: window chrome detection, caricamento degli store, polling dei dev logs, routing su workspace vuoto.

**Files:**
- Create: `frontend/src/hooks/useAppInit.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Crea `frontend/src/hooks/useAppInit.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore, migrateCollections } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { useDevLogsStore } from '@/stores/devLogs'
import { getBackendDevLogs, clearBackendDevLogs } from '@/lib/devlogs-api'
import { loadDefaultPostmanDemo } from '@/lib/demoWorkspace'
import { GetStartupWindowChrome } from '@/wailsjs/go/main/App'

type WindowChromeMode = 'app' | 'app-xwayland' | 'system'

export interface AppInitResult {
  activeWindowChrome: WindowChromeMode | null
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void
}

/**
 * Gestisce l'inizializzazione dell'app:
 * - rilevamento window chrome
 * - caricamento degli store (settings, collections, environments, hosts, tabs)
 * - polling dei dev log dal backend
 * - routing su workspace vuoto (welcome screen o demo)
 */
export function useAppInit(): AppInitResult {
  const [activeWindowChrome, setActiveWindowChrome] = useState<WindowChromeMode | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const loadSettings     = useSettingsStore((s) => s.load)
  const settingsLoaded   = useSettingsStore((s) => s.loaded)
  const appearance       = useSettingsStore((s) => s.settings.appearance)
  const showWelcomeOnEmpty = useSettingsStore((s) => s.settings.general.showWelcomeOnEmptyWorkspace)
  const loadCollections  = useCollectionsStore((s) => s.load)
  const loadEnvironments = useEnvironmentsStore((s) => s.load)
  const loadHosts        = useHostsStore((s) => s.load)
  const loadTabs         = useTabsStore((s) => s.load)
  const setActiveRail    = useAppStore((s) => s.setActiveRail)
  const mergeBackendLogs = useDevLogsStore((s) => s.mergeBackendEntries)

  const collectionsLoaded      = useCollectionsStore((s) => s.loaded)
  const environmentsLoaded     = useEnvironmentsStore((s) => s.loaded)
  const collectionsLoadError   = useCollectionsStore((s) => s.loadError)
  const environmentsLoadError  = useEnvironmentsStore((s) => s.loadError)

  const backendLogsClearedRef = useRef(false)

  // Rileva window chrome dal backend
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const mode = await GetStartupWindowChrome()
        if (!cancelled) {
          setActiveWindowChrome(
            mode === 'system' ? 'system' : mode === 'app-xwayland' ? 'app-xwayland' : 'app',
          )
        }
      } catch {
        // Fallback gestito dall'effect successivo
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Fallback: usa valore da settings se il backend non ha risposto
  useEffect(() => {
    if (activeWindowChrome === null && settingsLoaded) {
      setActiveWindowChrome(appearance.windowChrome ?? 'app')
    }
  }, [activeWindowChrome, appearance.windowChrome, settingsLoaded])

  // Ascolta evento custom per cambio rail da altri componenti
  useEffect(() => {
    const handler = (event: Event) => {
      const rail = (event as CustomEvent).detail
      if (typeof rail === 'string') setActiveRail(rail as Parameters<typeof setActiveRail>[0])
    }
    document.addEventListener('adomnia:set-rail', handler)
    return () => document.removeEventListener('adomnia:set-rail', handler)
  }, [setActiveRail])

  // Carica store all'avvio
  useEffect(() => {
    loadSettings()
    loadCollections()
    loadEnvironments()
    loadHosts()
  }, [loadSettings, loadCollections, loadEnvironments, loadHosts])

  // Carica tabs dopo settings (tabs dipendono dalle settings per la migrazione)
  useEffect(() => {
    if (settingsLoaded) void loadTabs()
  }, [settingsLoaded, loadTabs])

  // Polling dei dev log dal backend ogni 1.5s
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const entries = await getBackendDevLogs()
        if (!cancelled) mergeBackendLogs(entries)
        if (!backendLogsClearedRef.current) {
          backendLogsClearedRef.current = true
          void clearBackendDevLogs()
        }
      } catch {
        // I dev log non devono mai rompere la shell
      }
    }
    void sync()
    const id = window.setInterval(sync, 1500)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [mergeBackendLogs])

  // Routing workspace vuoto: demo o welcome screen
  useEffect(() => {
    if (!collectionsLoaded || !environmentsLoaded) return
    if (collectionsLoadError || environmentsLoadError) return
    const collectionsEmpty = useCollectionsStore.getState().collections.length === 0
    const environmentsEmpty = useEnvironmentsStore.getState().environments.length === 0
    if (collectionsEmpty && environmentsEmpty && loadDefaultPostmanDemo()) {
      setActiveRail('collections')
      return
    }
    if (collectionsEmpty && environmentsEmpty && showWelcomeOnEmpty) {
      setActiveRail('welcome')
    }
  }, [
    collectionsLoaded,
    environmentsLoaded,
    collectionsLoadError,
    environmentsLoadError,
    showWelcomeOnEmpty,
    setActiveRail,
  ])

  return { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen }
}
```

- [ ] **Step 2: Rimuovi i blocchi corrispondenti da `App.tsx`**

Rimuovi da `App.tsx`:
- Tutte le variabili di store (loadSettings, settingsLoaded, loadCollections, ecc.)
- `backendLogsClearedRef`
- `[commandPaletteOpen, setCommandPaletteOpen]` state
- `activeWindowChrome` state
- I 6 `useEffect` corrispondenti (window chrome, rail listener, store loading, tabs, dev logs, empty workspace)

Aggiungi import:
```tsx
import { useAppInit } from '@/hooks/useAppInit'
```

Aggiungi nel body di `App()`:
```tsx
const { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen } = useAppInit()
```

- [ ] **Step 3: Verifica build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Test manuale**

In `wails dev`: verifica che l'app si avvii correttamente, le collection si carichino, e il welcome screen appaia su workspace vuoto.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useAppInit.ts frontend/src/App.tsx
git commit -m "refactor: extract useAppInit hook"
```

---

## Task 4: Estrai `useKeyboardShortcuts` hook

Gestisce tutti i listener globali su `keydown` e `mousedown`.

**Files:**
- Create: `frontend/src/hooks/useKeyboardShortcuts.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Crea `frontend/src/hooks/useKeyboardShortcuts.ts`**

```typescript
import { useEffect } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'

export interface KeyboardShortcutsOptions {
  setCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void
}

/**
 * Registra e pulisce i listener globali per keyboard shortcuts e mouse side buttons.
 * Nessun valore di ritorno: effetti puri.
 *
 * Shortcuts registrati:
 *   Ctrl/Cmd + K      → apre/chiude command palette
 *   Ctrl/Cmd + N      → nuovo tab
 *   Ctrl/Cmd + S      → salva tab attivo (via custom event)
 *   Ctrl/Cmd + ,      → apre settings
 *   Ctrl/Cmd + 1      → apre collections
 *   Ctrl/Cmd + B      → toggle sidebar
 *   Ctrl/Cmd + D      → duplica tab attivo (solo su rail collections)
 *   Ctrl/Cmd + Shift + D → toggle dev tools
 *   Mouse button 3    → tab precedente
 *   Mouse button 4    → tab successivo
 */
export function useKeyboardShortcuts({ setCommandPaletteOpen }: KeyboardShortcutsOptions): void {
  const newTab      = useTabsStore((s) => s.newTab)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((open) => !open)
        return
      }
      if (mod && e.key === 'n') {
        e.preventDefault()
        newTab()
        return
      }
      if (mod && e.key === 's') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('adomnia:save-active-tab'))
        return
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        setActiveRail('settings')
        return
      }
      if (mod && e.key === '1') {
        e.preventDefault()
        setActiveRail('collections')
        return
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        useAppStore.getState().toggleSidebar()
        return
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
        const rail = useAppStore.getState().activeRail
        if (rail === 'collections') {
          e.preventDefault()
          const activeTabId = useTabsStore.getState().activeTabId
          if (activeTabId) useTabsStore.getState().duplicateTab(activeTabId)
        }
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        toggleDevTools()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [newTab, setActiveRail, setCommandPaletteOpen, toggleDevTools])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // button 3 = back, button 4 = forward (tasti laterali del mouse)
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      const { tabs, activeTabId } = useTabsStore.getState()
      if (tabs.length < 2) return
      const idx = tabs.findIndex((t) => t.id === activeTabId)
      if (idx === -1) return
      if (e.button === 3) {
        const prev = tabs[idx - 1]
        if (prev) setActiveTab(prev.id)
      } else {
        const next = tabs[idx + 1]
        if (next) setActiveTab(next.id)
      }
    }

    window.addEventListener('mousedown', handleMouseDown)
    return () => window.removeEventListener('mousedown', handleMouseDown)
  }, [setActiveTab])
}
```

- [ ] **Step 2: Rimuovi i 2 useEffect da `App.tsx`**

Rimuovi da `App.tsx`:
- Il `useEffect` per `handleKeyDown` (righe 208–250)
- Il `useEffect` per `handleMouseDown` (righe 252–271)
- Le variabili `newTab`, `setActiveTab`, `setActiveRail`, `toggleDevTools` se non più usate altrove in App.tsx

Aggiungi import:
```tsx
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
```

Aggiungi nel body di `App()` (dopo `useAppInit`):
```tsx
useKeyboardShortcuts({ setCommandPaletteOpen })
```

- [ ] **Step 3: Verifica build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Test manuale**

Premi Ctrl+K, Ctrl+N, Ctrl+S, Ctrl+,, i tasti laterali del mouse. Tutto deve funzionare come prima.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useKeyboardShortcuts.ts frontend/src/App.tsx
git commit -m "refactor: extract useKeyboardShortcuts hook"
```

---

## Task 5: Estrai `useFileDrop` hook

Il blocco più lungo di App.tsx (righe 273–381): gestisce drag, drop, routing dei file, import workspace.

**Files:**
- Create: `frontend/src/hooks/useFileDrop.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Crea `frontend/src/hooks/useFileDrop.ts`**

```typescript
import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import { useCollectionsStore, migrateCollections } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { importCollectionsFromText } from '@/lib/collectionTransfer'
import { routeGlobalDropFile } from '@/lib/globalFileRouter'
import { saveFlowDefinitions } from '@/lib/flowStorage'
import { safeSetItem } from '@/lib/safeLocalStorage'

export interface DropFeedback {
  msg: string
  ok: boolean
}

export interface FileDropHandlers {
  onDragEnter: React.DragEventHandler<HTMLDivElement>
  onDragLeave: React.DragEventHandler<HTMLDivElement>
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDrop: React.DragEventHandler<HTMLDivElement>
}

export interface FileDropResult {
  dragOver: boolean
  dropFeedback: DropFeedback | null
  handlers: FileDropHandlers
}

/**
 * Gestisce il drag-and-drop globale di file sull'app:
 * - Rileva drag enter/leave con counter per evitare flicker
 * - Instrada i file al pannello corretto (collection, HAR, WSDL, class inspector)
 * - Importa workspace completi (.adomnia bundle) includendo collections, environments, tabs, flows
 * - Mostra feedback toast per 3.5 secondi dopo il drop
 */
export function useFileDrop(): FileDropResult {
  const [dragOver, setDragOver] = useState(false)
  const [dropFeedback, setDropFeedback] = useState<DropFeedback | null>(null)
  const dragCounter = useRef(0)

  const importCollection = useCollectionsStore((s) => s.importCollection)
  const setActiveRail    = useAppStore((s) => s.setActiveRail)

  const showFeedback = useCallback((msg: string, ok: boolean) => {
    setDropFeedback({ msg, ok })
    setTimeout(() => setDropFeedback(null), 3500)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      dragCounter.current = 0

      const files = Array.from(e.dataTransfer.files)
      if (!files.length) {
        showFeedback('No file detected.', false)
        return
      }

      let totalImported = 0
      let workspaceImported = false
      const errors: string[] = []
      let routedTool = false

      for (const file of files) {
        try {
          const routed = await routeGlobalDropFile(file)

          if (routed.kind !== 'collection') {
            if (routedTool || totalImported > 0) {
              errors.push(`${file.name}: drop tool files one at a time.`)
              continue
            }
            useAppStore.getState().queueFileImport(routed)
            const target =
              routed.kind === 'har' ? 'har' : routed.kind === 'wsdl' ? 'soap' : 'powertools'
            const label =
              routed.kind === 'har'
                ? 'HAR Viewer'
                : routed.kind === 'wsdl'
                  ? 'SOAP Studio'
                  : 'Class File Inspector'
            setActiveRail(target)
            showFeedback(`${file.name} opened in ${label}.`, true)
            routedTool = true
            continue
          }

          const text = routed.text
          let parsed: Record<string, unknown> | null = null
          try { parsed = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }

          const isWorkspace =
            parsed !== null &&
            Array.isArray(parsed.collections) &&
            (parsed.version === 2 || parsed.format === 'adomnia-workspace')

          if (isWorkspace && parsed) {
            if (Array.isArray(parsed.openTabs)) {
              useTabsStore.setState({
                tabs: parsed.openTabs as never,
                activeTabId:
                  (parsed.activeTabId as string | null) ??
                  (parsed.openTabs as { id: string }[])[0]?.id ??
                  null,
              })
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            useCollectionsStore.setState({
              collections: migrateCollections(parsed.collections as any[]),
              loaded: true,
            })
            useCollectionsStore.getState().save()
            if (Array.isArray(parsed.environments)) {
              useEnvironmentsStore.setState({
                environments: parsed.environments as never,
                activeEnvId: (parsed.activeEnvId as string | null) ?? null,
                loaded: true,
              })
              useEnvironmentsStore.getState().save()
            }
            if (parsed.settings) {
              useSettingsStore.setState({ settings: parsed.settings as never, loaded: true })
              useSettingsStore.getState().save()
            }
            if (Array.isArray(parsed.flows)) await saveFlowDefinitions(parsed.flows)
            if (parsed.dockerLab) safeSetItem('adomnia.dockerlab.last', JSON.stringify(parsed.dockerLab))
            if (parsed.websocket) safeSetItem('adomnia.websocket', JSON.stringify(parsed.websocket))
            totalImported += (parsed.collections as unknown[]).length
            workspaceImported = true
          } else {
            const result = importCollectionsFromText(text)
            result.collections.forEach((c) => importCollection(c))
            totalImported += result.collections.length
          }
        } catch (err: unknown) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Import failed'}`)
        }
      }

      if (!routedTool) {
        if (totalImported > 0) {
          setActiveRail('collections')
          const label = workspaceImported
            ? 'Workspace imported'
            : `Imported ${totalImported} collection${totalImported > 1 ? 's' : ''}`
          showFeedback(`${label} successfully.`, true)
        } else {
          showFeedback(errors[0] ?? 'Import failed.', false)
        }
      }
    },
    [importCollection, setActiveRail, showFeedback],
  )

  return {
    dragOver,
    dropFeedback,
    handlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  }
}
```

- [ ] **Step 2: Rimuovi il blocco drag/drop da `App.tsx`**

Rimuovi da `App.tsx`:
- `importCollection`, `dragOver`, `dropFeedback`, `dragCounter` (righe 273–277)
- `handleDragEnter`, `handleDragLeave`, `handleDragOver`, `handleDrop` (righe 279–381)

Aggiungi import:
```tsx
import { useFileDrop } from '@/hooks/useFileDrop'
```

Aggiungi nel body di `App()`:
```tsx
const { dragOver, dropFeedback, handlers } = useFileDrop()
```

Nel JSX, sostituisci le prop del div root:
```tsx
// Prima:
onDragEnter={handleDragEnter}
onDragLeave={handleDragLeave}
onDragOver={handleDragOver}
onDrop={handleDrop}

// Dopo:
{...handlers}
```

- [ ] **Step 3: Verifica build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Test manuale**

Trascina un file `.json` Postman sull'app. Verifica che la collection venga importata e l'overlay appaia. Trascina un `.har`: deve aprire HAR Viewer.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useFileDrop.ts frontend/src/App.tsx
git commit -m "refactor: extract useFileDrop hook"
```

---

## Task 6: Estrai `DropOverlay` e `DropToast` come micro-componenti

Il JSX inline per l'overlay drag e il toast di feedback va in componenti dedicati.

**Files:**
- Create: `frontend/src/components/layout/DropOverlay.tsx`
- Create: `frontend/src/components/layout/DropToast.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Crea `frontend/src/components/layout/DropOverlay.tsx`**

```tsx
import { UploadCloud } from 'lucide-react'

/**
 * Overlay fullscreen mostrato quando un file è in drag sopra l'app.
 */
export function DropOverlay() {
  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-accent bg-surface-1 p-8 shadow-2xl">
        <UploadCloud size={48} strokeWidth={1.5} className="text-accent" />
        <p className="text-sm font-semibold text-text-1">Drop a file to open it</p>
        <p className="text-[10px] text-text-3">Collections / HAR / WSDL / Java Class</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Crea `frontend/src/components/layout/DropToast.tsx`**

```tsx
import type { DropFeedback } from '@/hooks/useFileDrop'

interface DropToastProps {
  feedback: DropFeedback
}

/**
 * Toast temporaneo che mostra il risultato di un'operazione di drag-and-drop.
 */
export function DropToast({ feedback }: DropToastProps) {
  return (
    <div
      className={[
        'absolute bottom-16 left-1/2 z-[9999] -translate-x-1/2 rounded-md border px-4 py-2 text-xs font-medium shadow-xl transition-all',
        feedback.ok
          ? 'border-success/30 bg-success/15 text-success'
          : 'border-error/30 bg-error/15 text-error',
      ].join(' ')}
    >
      {feedback.msg}
    </div>
  )
}
```

- [ ] **Step 3: Aggiorna `App.tsx`**

Aggiungi import:
```tsx
import { DropOverlay } from '@/components/layout/DropOverlay'
import { DropToast }   from '@/components/layout/DropToast'
```

Nel JSX, sostituisci i blocchi inline:
```tsx
{/* Prima: */}
{dragOver && (
  <div className="absolute inset-0 z-[9999] ...">
    ...
  </div>
)}
{dropFeedback && (
  <div className={`absolute bottom-16 ...`}>
    {dropFeedback.msg}
  </div>
)}

{/* Dopo: */}
{dragOver && <DropOverlay />}
{dropFeedback && <DropToast feedback={dropFeedback} />}
```

Rimuovi l'import di `UploadCloud` da `App.tsx` (ora è in `DropOverlay.tsx`).

- [ ] **Step 4: Verifica build**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/DropOverlay.tsx frontend/src/components/layout/DropToast.tsx frontend/src/App.tsx
git commit -m "refactor: extract DropOverlay and DropToast components"
```

---

## Task 7: Verifica finale — App.tsx ≤ 80 righe

- [ ] **Step 1: Conta le righe di App.tsx**

```bash
wc -l frontend/src/App.tsx
```
Expected: ≤ 80 righe.

- [ ] **Step 2: Verifica che App.tsx contenga solo layout JSX**

Il corpo di `App()` deve essere:
```tsx
export default function App() {
  const { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen } = useAppInit()
  const { dragOver, dropFeedback, handlers } = useFileDrop()
  const devLogVisible  = useAppStore((s) => s.devToolsVisible)
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

- [ ] **Step 3: Build + smoke test completo**

```bash
cd frontend && npm run build
```

In `wails dev` testa:
- [ ] Avvio app e caricamento collection
- [ ] Cambio tema (light/dark)
- [ ] Shortcut Ctrl+K (command palette)
- [ ] Shortcut Ctrl+N (nuovo tab)
- [ ] Drag di un file collection → import
- [ ] Drag di un file HAR → apre HAR Viewer
- [ ] Window chrome (titlebar custom visibile)

- [ ] **Step 4: Commit finale**

```bash
git add frontend/src/App.tsx
git commit -m "refactor: App.tsx finalized as pure layout shell (≤80 lines)"
```

---

## Riepilogo dei file creati

| File | Responsabilità |
|------|---------------|
| `src/components/layout/ErrorBoundary.tsx` | UI error recovery boundary |
| `src/components/layout/DropOverlay.tsx` | Overlay fullscreen durante drag |
| `src/components/layout/DropToast.tsx` | Toast feedback post-drop |
| `src/hooks/useAppearance.ts` | CSS vars per tema, font, density |
| `src/hooks/useAppInit.ts` | Window chrome, store loading, dev logs, welcome routing |
| `src/hooks/useKeyboardShortcuts.ts` | Global keydown + mousedown listeners |
| `src/hooks/useFileDrop.ts` | Drag/drop, file routing, workspace import |

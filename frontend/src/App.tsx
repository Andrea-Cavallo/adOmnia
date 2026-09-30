import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Titlebar } from '@/components/layout/Titlebar'
import { Rail } from '@/components/layout/Rail'
import { MainAreaRouter } from '@/components/layout/MainAreaRouter'
import { StatusBar } from '@/components/layout/StatusBar'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { StorageQuotaBanner } from '@/components/layout/StorageQuotaBanner'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { DropOverlay } from '@/components/layout/DropOverlay'
import { DropToast } from '@/components/layout/DropToast'
import { PluginNotificationToast } from '@/components/plugins/PluginNotificationToast'
import { AICompanionHost } from '@/components/assistant/AICompanionHost'
import { WorkspaceSidebarSkeleton } from '@/components/layout/WorkspaceHydrationShell'
import { useAppStore } from '@/stores/app'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useFileDrop } from '@/hooks/useFileDrop'
import { useSettingsStore } from '@/stores/settings'
import { useUiTranslation } from '@/lib/uiI18n'
import { useWorkspaceHydration, useWorkspaceHydrationShell } from '@/hooks/useWorkspaceHydration'
import { markStartup, reportStartupPerformance } from '@/lib/startupPerformance'
import { useDevLogsStore } from '@/stores/devLogs'
import { RecordStartupPerformance } from '@/wailsjs/go/main/App'
import { saveWorkspaceStartupHint } from '@/lib/startupHints'
import { findSpatialFocusIndex, focusableElements, ownsArrowKey } from '@/lib/accessibility'
import { initialRailFromMemento } from '@/lib/uiSessionMemento'

const SIDEBAR_WIDTH_KEY = 'adomnia.sidebarWidth'
let sidebarModulePromise: Promise<typeof import('@/components/layout/Sidebar')> | undefined
function loadSidebarModule() {
  return sidebarModulePromise ??= import('@/components/layout/Sidebar')
}
const Sidebar = React.lazy(() => loadSidebarModule().then((module) => ({ default: module.Sidebar })))
// Restored API workspaces fetch their sidebar alongside bootstrap, rather than
// waiting for React. A fresh Hub never requests this optional chunk.
if (initialRailFromMemento() === 'collections') void loadSidebarModule().catch(() => undefined)
import { EntityNotice } from '@/components/layout/EntityNotice'
const CommandPalette = React.lazy(() => import('@/components/layout/CommandPalette').then((module) => ({ default: module.CommandPalette })))
// Go Studio (store, API, LSP) resta fuori dal bundle iniziale: la guardia di chiusura serve
// solo con buffer modificati o processi attivi, impossibili prima del primo frame stabile.
const GoStudioCloseGuard = React.lazy(() => import('@/components/goide/GoStudioCloseGuard').then((module) => ({ default: module.GoStudioCloseGuard })))
const DevLogOverlay = React.lazy(() => import('@/components/ui/DevLogOverlay').then((module) => ({ default: module.DevLogOverlay })))
const SIDEBAR_WIDTH_MIN = 180
const SIDEBAR_WIDTH_MAX = 0.40

function clampSidebarWidth(w: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(w, Math.round(window.innerWidth * SIDEBAR_WIDTH_MAX)))
}

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (stored) return clampSidebarWidth(parseInt(stored, 10))
  } catch { /* ignore */ }
  return 256
}

function App() {
  const tr = useUiTranslation()
  const { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen, firstStableFrame } = useAppInit()
  useEffect(() => {
    useAppStore.getState().setAppWindowChrome(activeWindowChrome !== null && activeWindowChrome !== 'system')
  }, [activeWindowChrome])
  const { dragOver, dropPreview, dropFeedback, handlers } = useFileDrop()
  const devLogVisible  = useAppStore((s) => s.devToolsVisible)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)
  const activeRail     = useAppStore((s) => s.activeRail)
  const sidebarCollapsed = useSettingsStore((s) => s.settings.appearance.sidebarCollapsed)
  const showSidebar    = activeRail === 'collections' && !sidebarCollapsed
  const goStudioMaximized = useAppStore((s) => s.goStudioMaximized || s.goStudioZen) && activeRail === 'goide'
  const workspaceHydrated = useWorkspaceHydration()
  const workspaceShellPhase = useWorkspaceHydrationShell(workspaceHydrated)
  const addDevLog = useDevLogsStore((s) => s.addEntry)
  useAppearance()
  useKeyboardShortcuts({ setCommandPaletteOpen })

  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth)
  const appRootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const isDragging = useRef(false)

  useEffect(() => {
    // Dynamic import keeps the gO store out of the startup bundle (check:startup budget).
    let disposers: Array<() => void> = []
    let disposed = false
    void Promise.all([import('@/stores/devcontext'), import('@/lib/entities/openers')]).then(([devcontext, openers]) => {
      if (!disposed) disposers = [devcontext.startDevContextSync(), openers.registerDefaultOpeners()]
    })
    return () => { disposed = true; disposers.forEach((dispose) => dispose()) }
  }, [])
  useEffect(() => {
    markStartup('startup:react-mounted')
  }, [])

  useEffect(() => {
    const handleSpatialNavigation = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (ownsArrowKey(activeElement, event.key)) return
      const controls = appRootRef.current ? focusableElements(appRootRef.current) : []
      const nextIndex = findSpatialFocusIndex(controls.map((control) => control.getBoundingClientRect()), controls.indexOf(activeElement as HTMLElement), event.key)
      if (nextIndex === null) return
      event.preventDefault()
      controls[nextIndex]?.focus()
    }
    window.addEventListener('keydown', handleSpatialNavigation)
    return () => window.removeEventListener('keydown', handleSpatialNavigation)
  }, [])

  useEffect(() => {
    if (!workspaceHydrated) return
    markStartup('startup:workspace-hydrated')
  }, [workspaceHydrated])

  useEffect(() => {
    if (workspaceShellPhase !== 'ready') return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const durations = reportStartupPerformance()
        if (durations.rendererToWorkspaceHydrated !== undefined) {
          saveWorkspaceStartupHint(durations.rendererToWorkspaceHydrated)
        }
        void RecordStartupPerformance(JSON.stringify(durations)).catch(() => undefined)
        if (import.meta.env.DEV) {
          addDevLog('info', 'Startup performance', 'frontend', 'startup', { ...durations })
        }
        window.dispatchEvent(new Event('adomnia:first-stable-frame'))
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [workspaceShellPhase, addDevLog])

  const handleSidebarResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    isDragging.current = true

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const newW = clampSidebarWidth(dragRef.current.startWidth + (me.clientX - dragRef.current.startX))
      setSidebarWidth(newW)
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(newW)) } catch { /* ignore */ }
    }

    const handleUp = () => {
      isDragging.current = false
      dragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [sidebarWidth])

  useEffect(() => {
    const onResize = () => {
      if (!isDragging.current) setSidebarWidth((w) => clampSidebarWidth(w))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div
          ref={appRootRef}
          className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0 relative"
          data-app-shell
          // Wails 3 only forwards native OS file drops that land on an element
          // marked as a drop target. This root covers the whole window, which
          // matches the previous v2 whole-window behaviour.
          data-file-drop-target
          {...handlers}
        >
          {/* Con gO Studio massimizzato la sua toolbar diventa la barra della finestra, come in JetBrains. */}
          {activeWindowChrome !== null && activeWindowChrome !== 'system' && !goStudioMaximized && <Titlebar />}
          <StorageQuotaBanner />
          <div className="flex flex-1 min-h-0">
            {!goStudioMaximized && <Rail />}
            {/* Resizable sidebar wrapper — hidden on welcome hub */}
            {showSidebar && (
              <>
                <div className="shrink-0 flex flex-col min-h-0 overflow-hidden" style={{ width: sidebarWidth }}>
                  <Suspense fallback={<WorkspaceSidebarSkeleton quiet />}><Sidebar /></Suspense>
                </div>
                {/* Sidebar drag handle */}
                <ResizeHandle
                  label={tr('Drag to resize sidebar')}
                  onMouseDown={handleSidebarResizeMouseDown}
                  withLine={false}
                  className="border-r border-border-1"
                />
              </>
            )}
            <ErrorBoundary><MainAreaRouter /></ErrorBoundary>
          </div>
          {!goStudioMaximized && <StatusBar />}
          {dragOver && <DropOverlay preview={dropPreview} />}
          {dropFeedback && <DropToast feedback={dropFeedback} />}
          <PluginNotificationToast />
          <AICompanionHost ready={firstStableFrame} />
        </div>
        {commandPaletteOpen && <Suspense fallback={null}><CommandPalette open onClose={() => setCommandPaletteOpen(false)} /></Suspense>}
        <EntityNotice />
        <ConfirmDialogHost />
        {firstStableFrame && <Suspense fallback={null}><GoStudioCloseGuard /></Suspense>}
        {import.meta.env.DEV && devLogVisible && <Suspense fallback={null}><DevLogOverlay visible onClose={toggleDevTools} /></Suspense>}
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App

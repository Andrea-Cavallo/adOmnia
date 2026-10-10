import React, { Suspense, useEffect, useRef } from 'react'
import { Rail } from '@/components/layout/Rail'
import { MainAreaRouter } from '@/components/layout/MainAreaRouter'
import { StatusBar } from '@/components/layout/StatusBar'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost'
import { EnvironmentManagerHost } from '@/components/environment/EnvironmentManagerHost'
import { StorageQuotaBanner } from '@/components/layout/StorageQuotaBanner'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { DropOverlay } from '@/components/layout/DropOverlay'
import { DropToast } from '@/components/layout/DropToast'
import { PluginNotificationToast } from '@/components/plugins/PluginNotificationToast'
import { WorkspaceSidebarColumn, loadSidebarModule } from '@/components/layout/WorkspaceSidebarColumn'
import { useAppStore } from '@/stores/app'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useFileDrop } from '@/hooks/useFileDrop'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceHydration, useWorkspaceHydrationShell } from '@/hooks/useWorkspaceHydration'
import { markStartup, reportStartupPerformance } from '@/lib/startupPerformance'
import { useDevLogsStore } from '@/stores/devLogs'
import { RecordStartupPerformance } from '@/wailsjs/go/main/App'
import { saveWorkspaceStartupHint } from '@/lib/startupHints'
import { findSpatialFocusIndex, focusableElements, ownsArrowKey } from '@/lib/accessibility'
import { initialRailFromMemento } from '@/lib/uiSessionMemento'

// Restored API workspaces fetch their sidebar alongside bootstrap, rather than
// waiting for React. A fresh Hub never requests this optional chunk.
if (initialRailFromMemento() === 'collections') void loadSidebarModule().catch(() => undefined)
import { EntityNotice } from '@/components/layout/EntityNotice'
const CommandPalette = React.lazy(() => import('@/components/layout/CommandPalette').then((module) => ({ default: module.CommandPalette })))
// Go Studio (store, API, LSP) resta fuori dal bundle iniziale: la guardia di chiusura serve
// solo con buffer modificati o processi attivi, impossibili prima del primo frame stabile.
const GoStudioCloseGuard = React.lazy(() => import('@/components/goide/GoStudioCloseGuard').then((module) => ({ default: module.GoStudioCloseGuard })))
// Live Development Session: the debug bar and its overlays load after the first frame, outside the startup bundle.
const DebugBar = React.lazy(() => import('@/components/devsession/DebugBar').then((module) => ({ default: module.DebugBar })))
const DevSessionHost = React.lazy(() => import('@/components/devsession/DevSessionHost').then((module) => ({ default: module.DevSessionHost })))
const DevLogOverlay = React.lazy(() => import('@/components/ui/DevLogOverlay').then((module) => ({ default: module.DevLogOverlay })))
const UpdateNotice = React.lazy(() => import('@/components/settings/UpdateNotice'))
function App() {
  const { commandPaletteOpen, setCommandPaletteOpen, firstStableFrame } = useAppInit()
  const { dragOver, dropPreview, dropFeedback, handlers } = useFileDrop()
  const devLogVisible  = useAppStore((s) => s.devToolsVisible)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)
  const activeRail     = useAppStore((s) => s.activeRail)
  const sidebarCollapsed = useSettingsStore((s) => s.settings.appearance.sidebarCollapsed)
  const showSidebar    = activeRail === 'collections' && !sidebarCollapsed
  const splitView = useAppStore((s) => s.splitView)
  const goStudioMaximized = useAppStore((s) => s.goStudioMaximized || s.goStudioZen) && activeRail === 'goide' && !splitView
  const workspaceHydrated = useWorkspaceHydration()
  const workspaceShellPhase = useWorkspaceHydrationShell(workspaceHydrated)
  const addDevLog = useDevLogsStore((s) => s.addEntry)
  useAppearance()
  useKeyboardShortcuts({ setCommandPaletteOpen })

  const appRootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!firstStableFrame) return
    let disposed = false
    let stop: (() => void) | undefined
    void import('@/stores/updater').then(({startUpdater}) => { if (!disposed) stop = startUpdater() })
    return () => { disposed = true; stop?.() }
  }, [firstStableFrame])

  useEffect(() => {
    // Dynamic import keeps the gO store out of the startup bundle (check:startup budget).
    let disposers: Array<() => void> = []
    let disposed = false
    void Promise.all([import('@/stores/devcontext'), import('@/lib/entities/openers'), import('@/stores/devSession')]).then(([devcontext, openers, devSession]) => {
      if (!disposed) disposers = [devcontext.startDevContextSync(), openers.registerDefaultOpeners(), devSession.startDevSessionSync()]
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
          {/* Nessuna barra del titolo separata: con "Titlebar app" l'header del pannello (o la toolbar di gO Studio massimizzato) fa da barra della finestra. */}
          <StorageQuotaBanner />
          <div className="flex flex-1 min-h-0">
            {!goStudioMaximized && <Rail />}
            {/* Resizable collections sidebar — hidden on welcome hub */}
            {showSidebar && <WorkspaceSidebarColumn />}
            <ErrorBoundary><MainAreaRouter /></ErrorBoundary>
          </div>
          {!goStudioMaximized && firstStableFrame && <Suspense fallback={null}><DebugBar /></Suspense>}
          {!goStudioMaximized && <StatusBar />}
          {dragOver && <DropOverlay preview={dropPreview} />}
          {dropFeedback && <DropToast feedback={dropFeedback} />}
          <PluginNotificationToast />
        </div>
        <EnvironmentManagerHost />
        {commandPaletteOpen && <Suspense fallback={null}><CommandPalette open onClose={() => setCommandPaletteOpen(false)} /></Suspense>}
        <EntityNotice />
        <ConfirmDialogHost />
        {firstStableFrame && <Suspense fallback={null}><GoStudioCloseGuard /></Suspense>}
        {firstStableFrame && <Suspense fallback={null}><DevSessionHost /></Suspense>}
        {firstStableFrame && <Suspense fallback={null}><UpdateNotice /></Suspense>}
        {import.meta.env.DEV && devLogVisible && <Suspense fallback={null}><DevLogOverlay visible onClose={toggleDevTools} /></Suspense>}
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App

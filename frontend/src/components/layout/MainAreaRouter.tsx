import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { isWorkspaceRail } from '@/lib/protocolModules'
import { AppWindow, ArrowLeft, X } from 'lucide-react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { DRAG, TitlebarWindowControls, WindowControls, useWindowTitlebar } from '@/components/layout/Titlebar'
import { useAppStore, type RailItem } from '@/stores/app'
import { useWorkspaceHydration, useWorkspaceHydrationShell } from '@/hooks/useWorkspaceHydration'
import { WorkspaceContextPickers } from '@/components/layout/WorkspaceContextPickers'
import { WorkspaceMainSkeleton, WorkspacePanelHeaderSkeleton } from '@/components/layout/WorkspaceHydrationShell'
import { useUiTranslation } from '@/lib/uiI18n'
import { initialRailFromMemento } from '@/lib/uiSessionMemento'
import { markStartup } from '@/lib/startupPerformance'
import { PanelActiveContext, PanelVisibleContext } from '@/components/layout/PanelActivity'
import { DetachedPanelPlaceholder } from '@/components/layout/DetachedPanelPlaceholder'
import { usePanelLabel } from '@/components/layout/panelLabel'
import { canDetachPanel, openPanelWindow } from '@/lib/panel-windows-api'
import { usePanelWindowsStore } from '@/stores/panelWindows'
import { startModuleActionListener, useModuleEpoch } from '@/lib/moduleRouting'
import { useSplitViewStore } from '@/lib/api-code-link/splitView'
import { canSplitHere, isInSplit, layoutBack, useWorkspaceLayoutStore } from '@/lib/workspaceLayout'

import { WelcomePanel, RequestHistoryPanel, DailyScenariosPanel, SsePanel, BrokerStudioPanel, MockPanel, ProxyPanel, BrowserDebugPanel, UtilsPanel, FlowsPanel, SoapPanel, LatexStudioPanel, PdfEditorPanel, JsonViewerPanel, LogInspectorPanel, SecurityCenterPanel, ApiDocsPanel, StoragePanel, DatabasePanel, VaultPanel, SettingsPanel, CollabPanel, CodeStudioPanel, KubePanel } from './lazyPanels'

let workspaceModulePromise: ReturnType<typeof importWorkspaceModule> | undefined

function importWorkspaceModule() {
  markStartup('startup:workspace-bundle-requested')
  return import('@/components/layout/MainArea').then((module) => {
    markStartup('startup:workspace-bundle-loaded')
    return module
  })
}

/** Segnaposto della Hub col fondo della finestra, finché il suo chunk non arriva. */
function HubPanel() {
  return <Suspense fallback={<div className="h-full bg-surface-0" />}><WelcomePanel /></Suspense>
}

export function preloadWorkspaceBundle(): void {
  workspaceModulePromise ??= importWorkspaceModule()
}

const RequestWorkspace = React.lazy(() => {
  preloadWorkspaceBundle()
  return workspaceModulePromise!.then((module) => ({ default: module.RequestWorkspace }))
})

// This runs during module evaluation, before React and before bootstrap IPC.
// Only the persisted destination decides whether the workspace chunk is fetched.
if (initialRailFromMemento() === 'collections') preloadWorkspaceBundle()

function PanelSkeleton() {
  const tr = useUiTranslation()
  return (
    <div className="flex-1 flex items-center justify-center text-text-3">
      <div className="flex flex-col items-center gap-2">
        <div className="w-5 h-5 border-2 border-text-3 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">{tr('Loading…')}</span>
      </div>
    </div>
  )
}

/** Moves the module to its own window; errors surface as the usual save-error toast. */
function detachPanel(rail: RailItem, label: string): void {
  openPanelWindow(rail, label).catch((error: unknown) => {
    window.dispatchEvent(new CustomEvent('adomnia:save-error', { detail: error instanceof Error ? error.message : String(error) }))
  })
}

function PanelHeader({ titleKey }: { titleKey?: string }) {
  const tr = useUiTranslation()
  const goBack = useAppStore((s) => s.goBack)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const activeRail = useAppStore((s) => s.activeRail)
  const hasHistory = useAppStore((s) => s.railHistory.length > 0)
  const titlebar = useWindowTitlebar()
  const label = usePanelLabel(activeRail, titleKey)
  const detached = usePanelWindowsStore((s) => s.detached.includes(activeRail))

  return (
    <div {...titlebar.props} className={`h-10 flex items-center gap-2 pl-3 border-b border-border-1 bg-surface-1 flex-shrink-0 ${titlebar.active ? 'app-titlebar' : 'pr-3'}`}>
      <button onClick={goBack} disabled={!hasHistory} title={tr('Back (Alt + ←)')} className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
        <ArrowLeft size={13} />
      </button>
      {activeRail === 'collections'
        ? <><WorkspaceContextPickers /><span className="flex-1" /></>
        : <span className="flex-1 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2">{label}</span>}
      {canDetachPanel(activeRail) && !detached && (
        <button
          onClick={() => detachPanel(activeRail, label)}
          title={tr('Open in a new window')}
          aria-label={tr('Open in a new window')}
          className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-accent hover:bg-surface-3 transition-colors"
        >
          <AppWindow size={13} />
        </button>
      )}
      <button
        onClick={() => hasHistory ? goBack() : setActiveRail(activeRail === 'collections' ? 'welcome' : 'collections')}
        title={tr('Close panel')}
        className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors"
      >
        <X size={12} />
      </button>
      <TitlebarWindowControls />
    </div>
  )
}

export type PanelDef = { component: React.ReactNode; titleKey?: string; overflow?: boolean }

/** Panels that stay mounted once visited: the developer moves between code and API without losing either. */
export const KEEP_ALIVE_PANELS: readonly RailItem[] = ['collections', 'codestudio', 'websocket', 'grpc']

export function panelFor(activeRail: RailItem): PanelDef {
  switch (activeRail) {
    case 'collections': return { component: <RequestWorkspace rail="collections" />, titleKey: 'API Workspace' }
    case 'scenarios': return { component: <DailyScenariosPanel />, titleKey: 'Daily Scenarios', overflow: true }
    case 'history': return { component: <RequestHistoryPanel />, titleKey: 'Request History', overflow: true }
    case 'websocket': return { component: <RequestWorkspace rail="websocket" />, titleKey: 'WebSocket' }
    case 'sse': return { component: <SsePanel />, titleKey: 'SSE Client', overflow: true }
    case 'broker': return { component: <BrokerStudioPanel />, titleKey: 'Broker Studio', overflow: true }
    case 'mock': return { component: <MockPanel />, titleKey: 'mock', overflow: true }
    case 'proxy': return { component: <ProxyPanel />, titleKey: 'proxy', overflow: true }
    case 'grpc': return { component: <RequestWorkspace rail="grpc" />, titleKey: 'gRPC' }
    case 'browser': return { component: <BrowserDebugPanel />, titleKey: 'browser' }
    case 'powertools': return { component: <UtilsPanel />, titleKey: 'Power Tools', overflow: true }
    case 'flows': return { component: <FlowsPanel />, titleKey: 'flows', overflow: true }
    case 'soap': return { component: <SoapPanel />, titleKey: 'soap', overflow: true }
    case 'har': return { component: <UtilsPanel initialTool="harviewer" />, titleKey: 'Power Tools', overflow: true }
    case 'observe': return { component: <UtilsPanel initialTool="observability" />, titleKey: 'Power Tools', overflow: true }
    case 'dockerlab': return { component: <UtilsPanel initialTool="dockerlab" />, titleKey: 'Power Tools', overflow: true }
    case 'latex': return { component: <LatexStudioPanel />, titleKey: 'latex', overflow: true }
    case 'pdfeditor': return { component: <PdfEditorPanel />, titleKey: 'pdfeditor', overflow: true }
    case 'storage': return { component: <StoragePanel />, titleKey: 'storage', overflow: true }
    case 'database': return { component: <DatabasePanel />, titleKey: 'Database Studio', overflow: true }
    case 'jsonviewer': return { component: <JsonViewerPanel />, titleKey: 'JSON Studio', overflow: true }
    case 'loginspector': return { component: <LogInspectorPanel />, titleKey: 'Log Inspector', overflow: true }
    case 'security': return { component: <SecurityCenterPanel />, titleKey: 'Security Center', overflow: true }
    case 'xmltools': return { component: <UtilsPanel initialTool="xmlstudio" />, titleKey: 'Power Tools', overflow: true }
    case 'welcome': return { component: <HubPanel /> }
    case 'vault': return { component: <VaultPanel />, titleKey: 'vault', overflow: true }
    case 'workspace': return { component: <SettingsPanel initialSection="workspace" />, titleKey: 'settings', overflow: true }
    case 'apidocs': return { component: <ApiDocsPanel />, titleKey: 'apidocs', overflow: true }
    case 'themes': return { component: <SettingsPanel initialSection="themes" />, titleKey: 'settings', overflow: true }
    case 'templates': return { component: <SettingsPanel initialSection="templates" />, titleKey: 'settings', overflow: true }
    case 'plugins': return { component: <SettingsPanel initialSection="plugins" />, titleKey: 'settings', overflow: true }
    case 'secretscanner': return { component: <UtilsPanel initialTool="secretscanner" />, titleKey: 'Power Tools', overflow: true }
    case 'collab': return { component: <CollabPanel />, titleKey: 'Live Collaboration', overflow: true }
    case 'codestudio': return { component: <CodeStudioPanel />, titleKey: 'codestudio', overflow: true }
    case 'kube': return { component: <KubePanel />, titleKey: 'Kubernetes', overflow: true }
    case 'settings': return { component: <SettingsPanel />, titleKey: 'settings' }
    default: return { component: <HubPanel /> }
  }
}

const SplitViewHeader = React.lazy(() => import('@/components/layout/SplitViewHeader').then((module) => ({ default: module.SplitViewHeader })))

export function MainAreaRouter() {
  const activeRail = useAppStore((s) => s.activeRail)
  const maximized = useAppStore((s) => s.codeStudioMaximized || s.codeStudioZen) && activeRail === 'codestudio'
  const goBack = useAppStore((s) => s.goBack)
  const workspaceHydrated = useWorkspaceHydration()
  const workspaceShellPhase = useWorkspaceHydrationShell(workspaceHydrated)
  const workspaceHydrating = isWorkspaceRail(activeRail) && workspaceShellPhase !== 'ready'
  const quietWorkspaceShell = workspaceShellPhase === 'quiet'

  useEffect(() => { startModuleActionListener() }, [])
  const activeEpoch = useModuleEpoch(activeRail)
  const detachedPanels = usePanelWindowsStore((s) => s.detached)
  // A module open in its own window is edited there only: here it becomes a placeholder.
  const activeDetached = detachedPanels.includes(activeRail)

  const keptPanels = useAppStore((s) => s.keptPanels)
  const keepPanel = useAppStore((s) => s.keepPanel)
  const activeKept = KEEP_ALIVE_PANELS.includes(activeRail)
  useEffect(() => {
    if (activeKept) keepPanel(activeRail)
  }, [activeKept, activeRail, keepPanel])

  // Code Studio and the API workspace visible together. Both panes stay mounted
  // (also when one is collapsed or maximized), so tabs, scroll and unsaved
  // buffers survive every layout change.
  const splitView = useAppStore((s) => s.splitView)
  const storedAuxiliary = useAppStore((s) => s.splitAuxiliary)
  // A module open in its own window cannot also be the third pane here.
  const auxiliary = storedAuxiliary && !detachedPanels.includes(storedAuxiliary) ? storedAuxiliary : null
  const split = isInSplit(activeRail, splitView, auxiliary) && workspaceShellPhase === 'ready' && canSplitHere()
  // The pane clicked last has the keyboard until another module is brought forward.
  const [focusedClick, setFocusedClick] = useState<{ pane: RailItem; whileActive: RailItem } | null>(null)
  const focusedPane = focusedClick?.whileActive === activeRail ? focusedClick.pane : null
  const setFocusedPane = useCallback((pane: RailItem) => setFocusedClick({ pane, whileActive: useAppStore.getState().activeRail }), [])
  const auxRatio = useWorkspaceLayoutStore((s) => s.auxRatio)
  const setAuxRatio = useWorkspaceLayoutStore((s) => s.setAuxRatio)
  const [maximizedPane, setMaximizedPane] = useState<RailItem | null>(null)
  const [hiddenPane, setHiddenPane] = useState<RailItem | null>(null)
  const splitSide = useSplitViewStore((s) => s.side)
  const splitRatio = useSplitViewStore((s) => s.ratio)
  const reverseSplit = useSplitViewStore((s) => s.reverse)
  const setSplitRatio = useSplitViewStore((s) => s.setRatio)
  const splitRef = useRef<HTMLDivElement>(null)
  const startSplitResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const box = splitRef.current?.getBoundingClientRect()
    if (!box) return
    const move = (e: MouseEvent) => {
      const fromLeft = (e.clientX - box.left) / box.width
      setSplitRatio(splitSide === 'code-left' ? fromLeft : 1 - fromLeft)
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }, [setSplitRatio, splitSide])
  const startAuxResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const box = splitRef.current?.getBoundingClientRect()
    if (!box) return
    const move = (e: MouseEvent) => setAuxRatio((box.right - e.clientX) / box.width)
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }, [setAuxRatio])
  const closeSplit = useCallback(() => {
    setMaximizedPane(null)
    setHiddenPane(null)
    const app = useAppStore.getState()
    // The third pane only exists inside the split: the keyboard goes back to the request.
    if (app.splitAuxiliary && app.activeRail === app.splitAuxiliary) app.setActiveRail('collections')
    app.setSplitView(false)
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    // Un pannello che ha già gestito il tasto (es. Back di Code Studio) o un editor di codice hanno la precedenza.
    if (event.defaultPrevented || target.isContentEditable || target.closest?.('.monaco-editor')) return
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault()
      // A screen the coordinator changed (query beside the paused request…) comes back first.
      if (!layoutBack()) goBack()
    }
  }, [goBack])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const { component, titleKey, overflow } = panelFor(activeRail)
  const fallback = isWorkspaceRail(activeRail)
    ? <WorkspaceMainSkeleton quiet />
    : <PanelSkeleton />

  const renderPanel = (rail: RailItem) => {
    const panel = panelFor(rail).component
    return <Suspense fallback={isWorkspaceRail(rail) ? <WorkspaceMainSkeleton quiet /> : <PanelSkeleton />}>{panel}</Suspense>
  }

  return (
    <main className={`flex-1 flex flex-col min-w-0 relative bg-surface-0${overflow ? ' overflow-hidden' : ''}`}>
      {split ? (
        <Suspense fallback={<div className="h-10 shrink-0 border-b border-border-1 bg-surface-1" />}>
          <SplitViewHeader side={splitSide} auxiliary={auxiliary} maximizedPane={maximizedPane} hiddenPane={hiddenPane} onReverse={reverseSplit}
            onMaximize={setMaximizedPane} onHide={setHiddenPane} onClose={closeSplit} />
        </Suspense>
      ) : workspaceHydrating
        ? <WorkspacePanelHeaderSkeleton quiet={quietWorkspaceShell} />
        : titleKey && !maximized ? <PanelHeader titleKey={titleKey} /> : !maximized && <FloatingWindowControls />}
      {!split && (workspaceHydrating ? (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden panel-enter">
          <WorkspaceMainSkeleton quiet={quietWorkspaceShell} />
        </div>
      ) : activeDetached ? (
        <div key={`${activeRail}-detached`} className="flex-1 flex flex-col min-w-0 overflow-hidden panel-enter">
          <DetachedPanelPlaceholder rail={activeRail} titleKey={titleKey} />
        </div>
      ) : !activeKept && (
        <div key={`${activeRail}:${activeEpoch}`} className="flex-1 flex flex-col min-w-0 overflow-hidden panel-enter">
          <Suspense fallback={fallback}>{component}</Suspense>
        </div>
      ))}
      {/* Same container and same children in both layouts: opening or closing the split never remounts a pane. */}
      <div ref={splitRef} className={split ? 'flex flex-1 min-h-0 min-w-0' : 'contents'}>
        {keptRails(split ? [...keptPanels, 'codestudio', 'collections'] : keptPanels, activeRail).filter((rail) => !detachedPanels.includes(rail)).map((rail) => {
          const shown = split
            ? (rail === 'codestudio' || rail === 'collections') && hiddenPane !== rail && (!maximizedPane || maximizedPane === rail)
            : rail === activeRail && !workspaceHydrating
          // The API workspace needs hydrated collections before it mounts.
          if (isWorkspaceRail(rail) && workspaceShellPhase !== 'ready') return null
          const code = rail === 'codestudio'
          // Hiding the third pane leaves code and request side by side, not one of them alone.
          const solo = maximizedPane !== null || (hiddenPane !== null && hiddenPane !== auxiliary)
          const active = shown && (!split || (focusedPane ?? activeRail) === rail)
          const className = !shown ? 'hidden'
            : split ? `flex flex-col min-w-0 overflow-hidden ${solo ? 'flex-1' : code ? 'shrink-0 grow-0' : 'flex-1'}`
              : 'flex-1 flex flex-col min-w-0 overflow-hidden panel-enter'
          const codeShare = auxiliary && hiddenPane !== auxiliary ? splitRatio * (1 - auxRatio) : splitRatio
          const style = split && !solo
            ? { order: code === (splitSide === 'code-left') ? 0 : 2, ...(code ? { flexBasis: `${codeShare * 100}%` } : {}) }
            : undefined
          return (
            <PanelActiveContext.Provider key={rail} value={active}>
              <PanelVisibleContext.Provider value={shown}>
                <div
                  className={className}
                  style={style}
                  inert={!shown}
                  aria-hidden={!shown}
                  onFocusCapture={split ? () => setFocusedPane(rail) : undefined}
                  onMouseDownCapture={split ? () => setFocusedPane(rail) : undefined}
                >
                  {renderPanel(rail)}
                </div>
              </PanelVisibleContext.Provider>
            </PanelActiveContext.Provider>
          )
        })}
        {split && !maximizedPane && (hiddenPane === null || hiddenPane === auxiliary) && (
          <div className="order-1 flex"><ResizeHandle label="Drag to resize the split view" onMouseDown={startSplitResize} withLine={false} /></div>
        )}
        {split && auxiliary && (
          <SplitAuxiliaryPane rail={auxiliary} ratio={auxRatio} maximizedPane={maximizedPane} hiddenPane={hiddenPane}
            active={(focusedPane ?? activeRail) === auxiliary} onFocus={setFocusedPane} onResize={startAuxResize} render={renderPanel} />
        )}
      </div>
    </main>
  )
}

interface SplitAuxiliaryPaneProps {
  rail: RailItem
  ratio: number
  maximizedPane: RailItem | null
  hiddenPane: RailItem | null
  active: boolean
  onFocus: (rail: RailItem) => void
  onResize: (event: React.MouseEvent) => void
  render: (rail: RailItem) => React.ReactNode
}

/** Third pane of the split (Database, Broker, Logs), on the far side with its own resize handle. */
function SplitAuxiliaryPane({ rail, ratio, maximizedPane, hiddenPane, active, onFocus, onResize, render }: SplitAuxiliaryPaneProps) {
  const epoch = useModuleEpoch(rail)
  const shown = hiddenPane !== rail && (!maximizedPane || maximizedPane === rail)
  const solo = maximizedPane === rail
  return (
    <>
      {shown && !solo && <div className="order-3 flex"><ResizeHandle label="Drag to resize the third pane" onMouseDown={onResize} withLine={false} /></div>}
      <PanelActiveContext.Provider value={shown && active}>
        <PanelVisibleContext.Provider value={shown}>
          <div
            key={`${rail}:${epoch}`}
            className={shown ? `order-4 flex flex-col min-w-0 overflow-hidden border-l border-border-1 ${solo ? 'flex-1' : 'shrink-0 grow-0'}` : 'hidden'}
            style={shown && !solo ? { flexBasis: `${ratio * 100}%` } : undefined}
            inert={!shown}
            aria-hidden={!shown}
            onFocusCapture={() => onFocus(rail)}
            onMouseDownCapture={() => onFocus(rail)}
          >
            {render(rail)}
          </div>
        </PanelVisibleContext.Provider>
      </PanelActiveContext.Provider>
    </>
  )
}

function keptRails(kept: RailItem[], active: RailItem): RailItem[] {
  const rails = [...new Set(kept)].filter((rail) => KEEP_ALIVE_PANELS.includes(rail))
  return KEEP_ALIVE_PANELS.includes(active) && !rails.includes(active) ? [...rails, active] : rails
}

/** Pannelli senza header (Welcome): striscia invisibile su tutta la larghezza per trascinare la finestra, controlli a destra. */
function FloatingWindowControls() {
  const titlebar = useWindowTitlebar()
  if (!titlebar.active) return null
  return (
    <div {...titlebar.props} className="app-titlebar absolute inset-x-0 top-0 z-30 flex h-8 justify-end" style={DRAG}>
      <div className="flex rounded-bl-md border-b border-l border-border-1 bg-surface-1/90 backdrop-blur">
        <WindowControls height="h-8" />
      </div>
    </div>
  )
}

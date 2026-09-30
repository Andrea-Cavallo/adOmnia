import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Columns2, X } from 'lucide-react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useAppStore, type RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useWorkspaceHydration, useWorkspaceHydrationShell } from '@/hooks/useWorkspaceHydration'
import { WorkspaceMainSkeleton, WorkspacePanelHeaderSkeleton } from '@/components/layout/WorkspaceHydrationShell'
import { WelcomePanel } from '@/components/layout/WelcomePanel'
import { useT } from '@/lib/i18n'
import { useNavigationTranslation, useUiTranslation } from '@/lib/uiI18n'
import { initialRailFromMemento } from '@/lib/uiSessionMemento'
import { markStartup } from '@/lib/startupPerformance'
import { PanelActiveContext } from '@/components/layout/PanelActivity'

const WebSocketPanel       = React.lazy(() => import('@/components/websocket/WebSocketPanel').then(m => ({ default: m.WebSocketPanel })))
const RequestHistoryPanel  = React.lazy(() => import('@/components/history/RequestHistoryPanel').then(m => ({ default: m.RequestHistoryPanel })))
const DailyScenariosPanel  = React.lazy(() => import('@/components/scenarios/DailyScenariosPanel').then(m => ({ default: m.DailyScenariosPanel })))
const SsePanel             = React.lazy(() => import('@/components/sse/SsePanel').then(m => ({ default: m.SsePanel })))
const BrokerStudioPanel    = React.lazy(() => import('@/components/kafka/BrokerStudioPanel').then(m => ({ default: m.BrokerStudioPanel })))
const MockPanel            = React.lazy(() => import('@/components/mock/MockPanel').then(m => ({ default: m.MockPanel })))
const ProxyPanel           = React.lazy(() => import('@/components/proxy/ProxyPanel').then(m => ({ default: m.ProxyPanel })))
const GrpcPanel            = React.lazy(() => import('@/components/grpc/GrpcPanel').then(m => ({ default: m.GrpcPanel })))
const BrowserDebugPanel    = React.lazy(() => import('@/components/browser-debug').then(m => ({ default: m.BrowserDebugPanel })))
const UtilsPanel           = React.lazy(() => import('@/components/utils/UtilsPanel').then(m => ({ default: m.UtilsPanel })))
const FlowsPanel           = React.lazy(() => import('@/components/flows/FlowsPanel').then(m => ({ default: m.FlowsPanel })))
const SoapPanel            = React.lazy(() => import('@/components/soap/SoapPanel').then(m => ({ default: m.SoapPanel })))
const MarkdownPanel        = React.lazy(() => import('@/components/markdown/MarkdownPanel').then(m => ({ default: m.MarkdownPanel })))
const MermaidPanel         = React.lazy(() => import('@/components/mermaid/MermaidPanel').then(m => ({ default: m.MermaidPanel })))
const LatexStudioPanel     = React.lazy(() => import('@/components/latex/LatexStudioPanel').then(m => ({ default: m.LatexStudioPanel })))
const PdfEditorPanel       = React.lazy(() => import('@/components/pdfeditor/PdfEditorPanel').then(m => ({ default: m.PdfEditorPanel })))
const JsonViewerPanel      = React.lazy(() => import('@/components/jsonviewer/JsonViewerPanel').then(m => ({ default: m.JsonViewerPanel })))
const LogInspectorPanel    = React.lazy(() => import('@/components/loginspector').then(m => ({ default: m.LogInspectorPanel })))
const ApiDocsPanel         = React.lazy(() => import('@/components/apidocs/ApiDocsPanel').then(m => ({ default: m.ApiDocsPanel })))
const StoragePanel         = React.lazy(() => import('@/components/storage/StoragePanel').then(m => ({ default: m.StoragePanel })))
const DatabasePanel        = React.lazy(() => import('@/components/database/DatabasePanel').then(m => ({ default: m.DatabasePanel })))
const VaultPanel           = React.lazy(() => import('@/components/vault/VaultPanel').then(m => ({ default: m.VaultPanel })))
const SettingsPanel        = React.lazy(() => import('@/components/settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const GitSyncPanel         = React.lazy(() => import('@/components/workspace/GitSyncPanel').then(m => ({ default: m.GitSyncPanel })))
const McpPanel             = React.lazy(() => import('@/components/mcp/McpPanel').then(m => ({ default: m.McpPanel })))
const GoStudioPanel        = React.lazy(() => import('@/components/goide/GoStudioPanel').then(m => ({ default: m.GoStudioPanel })))

let workspaceModulePromise: ReturnType<typeof importWorkspaceModule> | undefined

function importWorkspaceModule() {
  markStartup('startup:workspace-bundle-requested')
  return import('@/components/layout/MainArea').then((module) => {
    markStartup('startup:workspace-bundle-loaded')
    return module
  })
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

function PanelHeader({ titleKey }: { titleKey?: string }) {
  const tr = useUiTranslation()
  const nav = useNavigationTranslation()
  const goBack = useAppStore((s) => s.goBack)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const activeRail = useAppStore((s) => s.activeRail)
  const hasHistory = useAppStore((s) => s.railHistory.length > 0)
  const workspaces = useCollectionsStore((s) => s.workspaces)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const t = useT()
  const label = activeRail === 'collections'
    ? (workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? tr('Workspace'))
    : titleKey && titleKey in t.rail
      ? t.rail[titleKey as keyof typeof t.rail]
      : nav(titleKey || '')

  return (
    <div className="h-10 flex items-center gap-2 px-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
      <button onClick={goBack} disabled={!hasHistory} title={tr('Back (Alt + ←)')} className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
        <ArrowLeft size={13} />
      </button>
      <span className="flex-1 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2">{label}</span>
      <button
        onClick={() => hasHistory ? goBack() : setActiveRail(activeRail === 'collections' ? 'welcome' : 'collections')}
        title={tr('Close panel')}
        className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  )
}

type PanelDef = { component: React.ReactNode; titleKey?: string; overflow?: boolean }

/** Panels that stay mounted once visited: the developer moves between code and API without losing either. */
export const KEEP_ALIVE_PANELS: readonly RailItem[] = ['collections', 'goide']

function panelFor(activeRail: RailItem): PanelDef {
  switch (activeRail) {
    case 'collections': return { component: <RequestWorkspace />, titleKey: 'API Workspace' }
    case 'scenarios': return { component: <DailyScenariosPanel />, titleKey: 'Daily Scenarios', overflow: true }
    case 'history': return { component: <RequestHistoryPanel />, titleKey: 'Request History', overflow: true }
    case 'websocket': return { component: <WebSocketPanel />, titleKey: 'WebSocket', overflow: true }
    case 'sse': return { component: <SsePanel />, titleKey: 'SSE Client', overflow: true }
    case 'broker': return { component: <BrokerStudioPanel />, titleKey: 'Broker Studio', overflow: true }
    case 'mock': return { component: <MockPanel />, titleKey: 'mock', overflow: true }
    case 'proxy': return { component: <ProxyPanel />, titleKey: 'proxy', overflow: true }
    case 'grpc': return { component: <GrpcPanel />, titleKey: 'grpc', overflow: true }
    case 'browser': return { component: <BrowserDebugPanel />, titleKey: 'browser' }
    case 'powertools': return { component: <UtilsPanel />, titleKey: 'Power Tools', overflow: true }
    case 'flows': return { component: <FlowsPanel />, titleKey: 'flows', overflow: true }
    case 'soap': return { component: <SoapPanel />, titleKey: 'soap', overflow: true }
    case 'har': return { component: <UtilsPanel initialTool="harviewer" />, titleKey: 'Power Tools', overflow: true }
    case 'observe': return { component: <UtilsPanel initialTool="observability" />, titleKey: 'Power Tools', overflow: true }
    case 'dockerlab': return { component: <UtilsPanel initialTool="dockerlab" />, titleKey: 'Power Tools', overflow: true }
    case 'markdown': return { component: <MarkdownPanel />, titleKey: 'markdown', overflow: true }
    case 'mermaid': return { component: <MermaidPanel />, titleKey: 'mermaid', overflow: true }
    case 'latex': return { component: <LatexStudioPanel />, titleKey: 'latex', overflow: true }
    case 'pdfeditor': return { component: <PdfEditorPanel />, titleKey: 'pdfeditor', overflow: true }
    case 'storage': return { component: <StoragePanel />, titleKey: 'storage', overflow: true }
    case 'database': return { component: <DatabasePanel />, titleKey: 'Database Studio', overflow: true }
    case 'jsonviewer': return { component: <JsonViewerPanel />, titleKey: 'JSON Studio', overflow: true }
    case 'loginspector': return { component: <LogInspectorPanel />, titleKey: 'Log Inspector', overflow: true }
    case 'xmltools': return { component: <UtilsPanel initialTool="xmlstudio" />, titleKey: 'Power Tools', overflow: true }
    case 'welcome': return { component: <WelcomePanel /> }
    case 'vault': return { component: <VaultPanel />, titleKey: 'vault', overflow: true }
    case 'workspace': return { component: <SettingsPanel initialSection="workspace" />, titleKey: 'settings', overflow: true }
    case 'apidocs': return { component: <ApiDocsPanel />, titleKey: 'apidocs', overflow: true }
    case 'themes': return { component: <SettingsPanel initialSection="themes" />, titleKey: 'settings', overflow: true }
    case 'templates': return { component: <SettingsPanel initialSection="templates" />, titleKey: 'settings', overflow: true }
    case 'plugins': return { component: <SettingsPanel initialSection="plugins" />, titleKey: 'settings', overflow: true }
    case 'secretscanner': return { component: <UtilsPanel initialTool="secretscanner" />, titleKey: 'Power Tools', overflow: true }
    case 'gitsync': return { component: <GitSyncPanel />, titleKey: 'Git Sync', overflow: true }
    case 'mcp': return { component: <McpPanel />, titleKey: 'MCP Client', overflow: true }
    case 'goide': return { component: <GoStudioPanel />, titleKey: 'goide', overflow: true }
    case 'settings': return { component: <SettingsPanel />, titleKey: 'settings' }
    default: return { component: <WelcomePanel /> }
  }
}

export function MainAreaRouter() {
  const activeRail = useAppStore((s) => s.activeRail)
  const maximized = useAppStore((s) => s.goStudioMaximized || s.goStudioZen) && activeRail === 'goide'
  const goBack = useAppStore((s) => s.goBack)
  const workspaceHydrated = useWorkspaceHydration()
  const workspaceShellPhase = useWorkspaceHydrationShell(workspaceHydrated)
  const workspaceHydrating = activeRail === 'collections' && workspaceShellPhase !== 'ready'
  const quietWorkspaceShell = workspaceShellPhase === 'quiet'

  const keptPanels = useAppStore((s) => s.keptPanels)
  const keepPanel = useAppStore((s) => s.keepPanel)
  const activeKept = KEEP_ALIVE_PANELS.includes(activeRail)
  useEffect(() => {
    if (activeKept) keepPanel(activeRail)
  }, [activeKept, activeRail, keepPanel])

  // Split Debug View: Go Studio and the API workspace visible together. The
  // pane that last received focus owns the keyboard shortcuts.
  const splitView = useAppStore((s) => s.splitView)
  const split = splitView && (activeRail === 'collections' || activeRail === 'goide') && workspaceShellPhase === 'ready'
  const [focusedPane, setFocusedPane] = useState<RailItem>('collections')
  const [splitRatio, setSplitRatio] = useState(0.55)
  const splitRef = useRef<HTMLDivElement>(null)
  const startSplitResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const box = splitRef.current?.getBoundingClientRect()
    if (!box) return
    const move = (e: MouseEvent) => setSplitRatio(Math.min(0.75, Math.max(0.25, (e.clientX - box.left) / box.width)))
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    // Un pannello che ha già gestito il tasto (es. Back di Go Studio) o un editor di codice hanno la precedenza.
    if (event.defaultPrevented || target.isContentEditable || target.closest?.('.monaco-editor')) return
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault()
      goBack()
    }
  }, [goBack])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const { component, titleKey, overflow } = panelFor(activeRail)
  const fallback = activeRail === 'collections'
    ? <WorkspaceMainSkeleton quiet />
    : <PanelSkeleton />

  return (
    <main className={`flex-1 flex flex-col min-w-0 relative bg-surface-0${overflow ? ' overflow-hidden' : ''}`}>
      {workspaceHydrating
        ? <WorkspacePanelHeaderSkeleton quiet={quietWorkspaceShell} />
        : split ? <SplitHeader /> : titleKey && !maximized && <PanelHeader titleKey={titleKey} />}
      {workspaceHydrating ? (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden panel-enter">
          <WorkspaceMainSkeleton quiet={quietWorkspaceShell} />
        </div>
      ) : !activeKept && (
        <div key={activeRail} className="flex-1 flex flex-col min-w-0 overflow-hidden panel-enter">
          <Suspense fallback={fallback}>{component}</Suspense>
        </div>
      )}
      <div ref={splitRef} className={split ? 'flex flex-1 min-h-0 min-w-0' : 'contents'}>
        {keptRails(split ? [...keptPanels, 'goide', 'collections'] : keptPanels, activeRail).map((rail) => {
          const shown = split ? (rail === 'goide' || rail === 'collections') : rail === activeRail && !workspaceHydrating
          // The API workspace needs hydrated collections before it mounts.
          if (rail === 'collections' && workspaceShellPhase !== 'ready') return null
          const active = shown && (!split || focusedPane === rail)
          const className = !shown ? 'hidden'
            : split ? `flex flex-col min-w-0 overflow-hidden ${rail === 'goide' ? 'order-0 border-r border-border-1' : 'order-2 flex-1'}`
              : 'flex-1 flex flex-col min-w-0 overflow-hidden panel-enter'
          return (
            <PanelActiveContext.Provider key={rail} value={active}>
              <div
                className={className}
                style={split && rail === 'goide' ? { flexBasis: `${splitRatio * 100}%` } : undefined}
                inert={!shown}
                aria-hidden={!shown}
                onFocusCapture={split ? () => setFocusedPane(rail) : undefined}
                onMouseDownCapture={split ? () => setFocusedPane(rail) : undefined}
              >
                <Suspense fallback={rail === 'collections' ? <WorkspaceMainSkeleton quiet /> : <PanelSkeleton />}>{panelFor(rail).component}</Suspense>
              </div>
            </PanelActiveContext.Provider>
          )
        })}
        {split && <div className="order-1 flex"><ResizeHandle label="Drag to resize the split view" onMouseDown={startSplitResize} withLine={false} /></div>}
      </div>
    </main>
  )
}

function keptRails(kept: RailItem[], active: RailItem): RailItem[] {
  const rails = [...new Set(kept)].filter((rail) => KEEP_ALIVE_PANELS.includes(rail))
  return KEEP_ALIVE_PANELS.includes(active) && !rails.includes(active) ? [...rails, active] : rails
}

function SplitHeader() {
  const setSplitView = useAppStore((s) => s.setSplitView)
  return (
    <div className="h-10 flex items-center gap-2 px-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
      <Columns2 size={13} className="text-accent" aria-hidden="true" />
      <span className="flex-1 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2">Split Debug View · Go Studio ↔ API request</span>
      <button onClick={() => setSplitView(false)} title="Close split view" aria-label="Close split view"
        className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors">
        <X size={12} />
      </button>
    </div>
  )
}

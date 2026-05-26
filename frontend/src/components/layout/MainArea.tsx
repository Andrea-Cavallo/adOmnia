import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { useSettingsStore } from '@/stores/settings'
import { Composer } from '@/components/composer/Composer'
import { ApiToolsBar } from '@/components/collections/ApiToolsBar'
import { ResponsePanel } from '@/components/response/ResponsePanel'
import { TabBar } from '@/components/layout/TabBar'
import { EnvBar } from '@/components/environment/EnvBar'
import { HostBar } from '@/components/hosts/HostBar'
import { WelcomePanel } from '@/components/layout/WelcomePanel'
import { LoadTestDrawer } from '@/components/loadtest/LoadTestDrawer'
import { executeRequest } from '@/lib/executeRequest'
import { uid, type EnvVariable } from '@/lib/types'
import { useT } from '@/lib/i18n'
import { safeSetItem } from '@/lib/safeLocalStorage'

// ─── Lazy-loaded panels (loaded on first navigation) ──────────────────────────

const WebSocketPanel       = React.lazy(() => import('@/components/websocket/WebSocketPanel').then(m => ({ default: m.WebSocketPanel })))
const SsePanel             = React.lazy(() => import('@/components/sse/SsePanel').then(m => ({ default: m.SsePanel })))
const KafkaPanel           = React.lazy(() => import('@/components/kafka/KafkaPanel').then(m => ({ default: m.KafkaPanel })))
const BrokerStudioPanel    = React.lazy(() => import('@/components/kafka/BrokerStudioPanel').then(m => ({ default: m.BrokerStudioPanel })))
const MockPanel            = React.lazy(() => import('@/components/mock/MockPanel').then(m => ({ default: m.MockPanel })))
const ProxyPanel           = React.lazy(() => import('@/components/proxy/ProxyPanel').then(m => ({ default: m.ProxyPanel })))
const GrpcPanel            = React.lazy(() => import('@/components/grpc/GrpcPanel').then(m => ({ default: m.GrpcPanel })))
const NetToolsPanel        = React.lazy(() => import('@/components/nettools/NetToolsPanel').then(m => ({ default: m.NetToolsPanel })))
const BrowserDebugPanel    = React.lazy(() => import('@/components/browser-debug').then(m => ({ default: m.BrowserDebugPanel })))
const UtilsPanel           = React.lazy(() => import('@/components/utils/UtilsPanel').then(m => ({ default: m.UtilsPanel })))
const FlowsPanel           = React.lazy(() => import('@/components/flows/FlowsPanel').then(m => ({ default: m.FlowsPanel })))
const RunnerPanel          = React.lazy(() => import('@/components/runner/RunnerPanel').then(m => ({ default: m.RunnerPanel })))
const MatrixPanel          = React.lazy(() => import('@/components/matrix/MatrixPanel').then(m => ({ default: m.MatrixPanel })))
const SoapPanel            = React.lazy(() => import('@/components/soap/SoapPanel').then(m => ({ default: m.SoapPanel })))
const TestDataStudio       = React.lazy(() => import('@/components/testdata/TestDataStudio').then(m => ({ default: m.TestDataStudio })))
const HarViewerPanel       = React.lazy(() => import('@/components/har/HarViewerPanel').then(m => ({ default: m.HarViewerPanel })))
const ObservabilityPanel   = React.lazy(() => import('@/components/observe').then(m => ({ default: m.ObservabilityPanel })))
const DockerLabPanel       = React.lazy(() => import('@/components/dockerlab/DockerLabPanel').then(m => ({ default: m.DockerLabPanel })))
const MarkdownPanel        = React.lazy(() => import('@/components/markdown/MarkdownPanel').then(m => ({ default: m.MarkdownPanel })))
const StoragePanel         = React.lazy(() => import('@/components/storage/StoragePanel').then(m => ({ default: m.StoragePanel })))
const DatabasePanel        = React.lazy(() => import('@/components/database/DatabasePanel').then(m => ({ default: m.DatabasePanel })))
const JsonToolsPanel       = React.lazy(() => import('@/components/utils/JsonToolsPanel').then(m => ({ default: m.JsonToolsPanel })))
const XmlToolsPanel        = React.lazy(() => import('@/components/utils/XmlToolsPanel').then(m => ({ default: m.XmlToolsPanel })))
const VaultPanel           = React.lazy(() => import('@/components/vault/VaultPanel').then(m => ({ default: m.VaultPanel })))
const WorkspacePanel       = React.lazy(() => import('@/components/workspace/WorkspacePanel').then(m => ({ default: m.WorkspacePanel })))
const ThemePanel           = React.lazy(() => import('@/components/themes/ThemePanel').then(m => ({ default: m.ThemePanel })))
const TemplateMarketplace  = React.lazy(() => import('@/components/templates/TemplateMarketplace').then(m => ({ default: m.TemplateMarketplace })))
const PluginManager        = React.lazy(() => import('@/components/plugins/PluginManager').then(m => ({ default: m.PluginManager })))
const SecretScannerPanel   = React.lazy(() => import('@/components/secretscanner').then(m => ({ default: m.SecretScannerPanel })))
const SettingsPanel        = React.lazy(() => import('@/components/settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })))

function PanelSkeleton() {
  return (
    <div className="flex-1 flex items-center justify-center text-text-3">
      <div className="flex flex-col items-center gap-2">
        <div className="w-5 h-5 border-2 border-text-3 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Loading…</span>
      </div>
    </div>
  )
}

function PanelHeader({ titleKey }: { titleKey?: string }) {
  const goBack = useAppStore((s) => s.goBack)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const hasHistory = useAppStore((s) => s.railHistory.length > 0)
  const t = useT()
  const label = titleKey && titleKey in t.rail
    ? t.rail[titleKey as keyof typeof t.rail]
    : titleKey || ''
  return (
    <div className="h-8 flex items-center gap-1 px-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
      <button
        onClick={goBack}
        disabled={!hasHistory}
        title="Back (Alt + ←)"
        className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ArrowLeft size={13} />
      </button>
      <span className="text-xs text-text-3 font-medium flex-1 px-1">{label}</span>
      <button
        onClick={() => { if (hasHistory) goBack(); else setActiveRail('collections') }}
        title="Close panel"
        className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  )
}

// Pending close action: single tab, or a group of tabs (to-right / to-left)
type PendingClose =
  | { kind: 'single'; tabId: string }
  | { kind: 'right'; tabId: string }
  | { kind: 'left'; tabId: string }

// ─── Resizable divider between Composer and ResponsePanel ────────────────────

const RESPONSE_HEIGHT_KEY = 'adomnia.responseHeight'
const RESPONSE_HEIGHT_MIN  = 80
const RESPONSE_HEIGHT_MAX  = 0.88  // fraction of window.innerHeight

function clampResponseHeight(h: number): number {
  return Math.max(RESPONSE_HEIGHT_MIN, Math.min(h, Math.round(window.innerHeight * RESPONSE_HEIGHT_MAX)))
}

function loadResponseHeight(): number {
  try {
    const stored = localStorage.getItem(RESPONSE_HEIGHT_KEY)
    if (stored) return clampResponseHeight(parseInt(stored, 10))
  } catch { /* ignore */ }
  return Math.round(window.innerHeight * 0.38)
}

// ─── RequestWorkspace ─────────────────────────────────────────────────────────

function RequestWorkspace() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const closeTabsToRight = useTabsStore((s) => s.closeTabsToRight)
  const closeTabsToLeft = useTabsStore((s) => s.closeTabsToLeft)
  const newTab = useTabsStore((s) => s.newTab)
  const duplicateTab = useTabsStore((s) => s.duplicateTab)
  const updateRequest = useTabsStore((s) => s.updateRequest)
  const setLoading = useTabsStore((s) => s.setLoading)
  const setResponse = useTabsStore((s) => s.setResponse)
  const markClean = useTabsStore((s) => s.markClean)
  const updateCollectionRequest = useCollectionsStore((s) => s.updateRequest)
  const collections = useCollectionsStore((s) => s.collections)
  const confirmBeforeClosingDirtyTabs = useSettingsStore((s) => s.settings.general.confirmBeforeClosingDirtyTabs)

  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const setActiveEnv = useEnvironmentsStore((s) => s.setActiveEnv)
  const addEnvironment = useEnvironmentsStore((s) => s.addEnvironment)
  const deleteEnvironment = useEnvironmentsStore((s) => s.deleteEnvironment)
  const renameEnvironment = useEnvironmentsStore((s) => s.renameEnvironment)
  const updateVariables = useEnvironmentsStore((s) => s.updateVariables)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)

  const hostsProfiles = useHostsStore((s) => s.profiles)
  const activeHostProfileId = useHostsStore((s) => s.activeProfileId)
  const setActiveHostProfile = useHostsStore((s) => s.setActiveProfile)
  const addHostProfile = useHostsStore((s) => s.addProfile)
  const deleteHostProfile = useHostsStore((s) => s.deleteProfile)
  const renameHostProfile = useHostsStore((s) => s.renameProfile)
  const updateHostEntries = useHostsStore((s) => s.updateEntries)

  const [showLoadTest, setShowLoadTest] = useState(false)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)

  // ── Resizable response panel ────────────────────────────────────────────────
  const [responseHeight, setResponseHeight] = useState<number>(loadResponseHeight)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const isDraggingRef = useRef(false)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startHeight: responseHeight }
    isDraggingRef.current = true

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      // Dragging UP → delta > 0 → taller response panel
      const delta = dragRef.current.startY - me.clientY
      const newH = clampResponseHeight(dragRef.current.startHeight + delta)
      setResponseHeight(newH)
      safeSetItem(RESPONSE_HEIGHT_KEY, String(newH))
    }

    const handleUp = () => {
      isDraggingRef.current = false
      dragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [responseHeight])

  // Clamp height on window resize
  useEffect(() => {
    const onResize = () => {
      if (!isDraggingRef.current) {
        setResponseHeight((h) => clampResponseHeight(h))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // ── End resizable panel ─────────────────────────────────────────────────────

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const oaSpec =
    activeTab?.collectionId
      ? collections.find((c) => c.id === activeTab.collectionId)?._openapiSpec
      : undefined
  const oaPath = activeTab?.request?._openapiPath
  const oaMethod = activeTab?.request?.method

  useEffect(() => {
    setShowLoadTest(false)
  }, [activeTabId])

  const handleSend = async () => {
    if (!activeTab) return
    setLoading(activeTab.id, true)
    const vars = getResolvedVars()
    const result = await executeRequest(activeTab.request, vars)
    if (activeEnvId && Object.keys(result.mutations).length > 0) {
      const env = environments.find((e) => e.id === activeEnvId)
      if (env) updateVariables(activeEnvId, applyEnvironmentMutations(env.variables, result.mutations))
    }
    const response = result.response
    setResponse(activeTab.id, response)
  }

  const saveTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || !tab.collectionId) return
    updateCollectionRequest(tab.collectionId, tab.request)
    markClean(tab.id)
  }, [tabs, updateCollectionRequest, markClean])

  const handleSave = () => {
    if (!activeTab || !activeTab.collectionId) return
    updateCollectionRequest(activeTab.collectionId, activeTab.request)
    markClean(activeTab.id)
  }

  useEffect(() => {
    const onSave = () => handleSave()
    document.addEventListener('adomnia:save-active-tab', onSave)
    return () => document.removeEventListener('adomnia:save-active-tab', onSave)
  })

  // Returns the dirty tabs affected by a pending close action
  const getDirtyTabsForPending = useCallback((pending: PendingClose): typeof tabs => {
    if (pending.kind === 'single') {
      const t = tabs.find((tab) => tab.id === pending.tabId)
      return t?.dirty ? [t] : []
    }
    const idx = tabs.findIndex((t) => t.id === pending.tabId)
    if (idx === -1) return []
    const affected = pending.kind === 'right'
      ? tabs.filter((_, i) => i > idx)
      : tabs.filter((_, i) => i < idx)
    return affected.filter((t) => t.dirty)
  }, [tabs])

  // Attempt close — show dialog if there are dirty tabs
  const attemptClose = useCallback((pending: PendingClose) => {
    const dirty = getDirtyTabsForPending(pending)
    if (confirmBeforeClosingDirtyTabs && dirty.length > 0) {
      setPendingClose(pending)
    } else {
      executePendingClose(pending, false)
    }
  }, [confirmBeforeClosingDirtyTabs, getDirtyTabsForPending]) // eslint-disable-line react-hooks/exhaustive-deps

  const executePendingClose = useCallback((pending: PendingClose, doSave: boolean) => {
    if (doSave) {
      const dirty = getDirtyTabsForPending(pending)
      dirty.forEach((t) => saveTab(t.id))
    }
    if (pending.kind === 'single') closeTab(pending.tabId)
    else if (pending.kind === 'right') closeTabsToRight(pending.tabId)
    else closeTabsToLeft(pending.tabId)
    setPendingClose(null)
  }, [getDirtyTabsForPending, saveTab, closeTab, closeTabsToRight, closeTabsToLeft])

  const dirtyInDialog = pendingClose ? getDirtyTabsForPending(pendingClose) : []

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-surface-0 select-none">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="text-text-4 mb-1">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.17 10.8 19.79 19.79 0 01.1 2.18 2 2 0 012.07.01h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
        </svg>
        <p className="text-[13px] font-medium text-text-3">No request open</p>
        <p className="text-[11px] text-text-4">
          Select one from the sidebar or press{' '}
          <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border-2 rounded text-[10px] font-mono text-text-3">Ctrl+N</kbd>
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex">
        <div className="flex-1">
          <EnvBar
            environments={environments}
            activeEnvId={activeEnvId}
            onSetActive={setActiveEnv}
            onAdd={(name) => addEnvironment(name)}
            onDelete={deleteEnvironment}
            onRename={renameEnvironment}
            onUpdateVars={updateVariables}
          />
        </div>
        <div className="flex-1 border-l border-border-1">
          <HostBar
            profiles={hostsProfiles}
            activeProfileId={activeHostProfileId}
            onSetActive={setActiveHostProfile}
            onAdd={(name) => addHostProfile(name)}
            onDelete={deleteHostProfile}
            onRename={renameHostProfile}
            onUpdateEntries={updateHostEntries}
          />
        </div>
      </div>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={(id) => attemptClose({ kind: 'single', tabId: id })}
        onCloseToRight={(id) => attemptClose({ kind: 'right', tabId: id })}
        onCloseToLeft={(id) => attemptClose({ kind: 'left', tabId: id })}
        onNewTab={newTab}
        onDuplicate={duplicateTab}
      />
      <ApiToolsBar
        activeRequest={activeTab?.request ?? null}
        onApplyRequest={(request) => activeTab && updateRequest(activeTab.id, request)}
      />

      {activeTab ? (
        /* ── Split layout: Composer (flex-1, scrollable) + drag handle + ResponsePanel ── */
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Composer area — grows to fill remaining space; scrolls when content overflows */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Composer
              request={activeTab.request}
              onChange={(req) => updateRequest(activeTab.id, req)}
              onSend={handleSend}
              onSave={handleSave}
              onLoadTest={() => setShowLoadTest((v) => !v)}
              loading={activeTab.loading}
            />
          </div>

          {showLoadTest ? (
            <LoadTestDrawer
              request={activeTab.request}
              onClose={() => setShowLoadTest(false)}
            />
          ) : (
            <>
              {/* ── Drag handle ────────────────────────────────────────────── */}
              <div
                role="separator"
                aria-label="Resize response panel"
                title="Drag to resize response panel"
                onMouseDown={handleResizeMouseDown}
                className="h-[6px] shrink-0 flex items-center justify-center cursor-ns-resize group hover:bg-accent/10 transition-colors border-y border-border-1"
              >
                {/* Grip dots */}
                <div className="flex gap-[3px] items-center opacity-40 group-hover:opacity-80 transition-opacity">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-[3px] h-[3px] rounded-full bg-text-3 group-hover:bg-accent transition-colors" />
                  ))}
                </div>
              </div>

              {/* ── Response panel — explicit height, internally scrollable ── */}
              <div
                className="shrink-0 flex flex-col min-h-0 overflow-hidden"
                style={{ height: responseHeight }}
              >
                <ResponsePanel
                  response={activeTab.response}
                  loading={activeTab.loading}
                  oaSpec={oaSpec}
                  oaPath={oaPath}
                  oaMethod={oaMethod}
                  assertions={activeTab.request.assertions}
                />
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Save-before-close dialog */}
      {pendingClose && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-1 border border-border-1 rounded-xl shadow-2xl w-[420px] p-5 space-y-4">
            <h2 className="text-sm font-semibold text-text-1">Unsaved Changes</h2>
            <p className="text-xs text-text-3">
              {dirtyInDialog.length === 1
                ? <>Tab <span className="text-text-1 font-medium">"{dirtyInDialog[0].request.name || dirtyInDialog[0].request.url || 'Untitled'}"</span> has unsaved changes.</>
                : <>{dirtyInDialog.length} tabs have unsaved changes.</>
              }
            </p>
            {dirtyInDialog.length > 1 && (
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {dirtyInDialog.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs text-text-2 px-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    {t.request.name || t.request.url || 'Untitled'}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setPendingClose(null)}
                className="px-3 py-1.5 text-xs text-text-3 hover:text-text-1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => executePendingClose(pendingClose, false)}
                className="px-3 py-1.5 text-xs font-medium text-error hover:text-red-300 bg-surface-2 hover:bg-surface-3 rounded-md transition-colors"
              >
                Discard & Close
              </button>
              {dirtyInDialog.some((t) => t.collectionId) && (
                <button
                  onClick={() => executePendingClose(pendingClose, true)}
                  className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 transition-colors"
                >
                  Save & Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function applyEnvironmentMutations(
  variables: EnvVariable[],
  mutations: Record<string, string | null>,
): EnvVariable[] {
  let next = [...variables]
  for (const [key, value] of Object.entries(mutations)) {
    if (!key) continue
    if (value === null) {
      next = next.filter((v) => v.key !== key)
      continue
    }
    const idx = next.findIndex((v) => v.key === key)
    if (idx >= 0) {
      next[idx] = { ...next[idx], value, enabled: true }
    } else {
      next.push({ id: uid(), key, value, enabled: true, type: 'text' })
    }
  }
  return next
}

type PanelDef = {
  component: React.ReactNode
  titleKey?: string
  overflow?: boolean
}

function panelFor(activeRail: RailItem): PanelDef {
  switch (activeRail) {
    case 'collections': return { component: <RequestWorkspace /> }
    case 'websocket':   return { component: <WebSocketPanel />,       titleKey: 'WebSocket',     overflow: true }
    case 'sse':         return { component: <SsePanel />,             titleKey: 'SSE Client',    overflow: true }
    case 'kafka':       return { component: <KafkaPanel />,          titleKey: 'kafka',         overflow: true }
    case 'broker':      return { component: <BrokerStudioPanel />,    titleKey: 'Broker Studio', overflow: true }
    case 'mock':        return { component: <MockPanel />,            titleKey: 'mock',      overflow: true }
    case 'proxy':       return { component: <ProxyPanel />,           titleKey: 'proxy',     overflow: true }
    case 'grpc':        return { component: <GrpcPanel />,            titleKey: 'grpc',      overflow: true }
    case 'nettools':    return { component: <NetToolsPanel />,        titleKey: 'nettools',  overflow: true }
    case 'browser':     return { component: <BrowserDebugPanel />,    titleKey: 'browser' }
    case 'utils':
    case 'powertools':  return { component: <UtilsPanel />,           titleKey: 'Power Tools', overflow: true }
    case 'flows':     return { component: <FlowsPanel />,              titleKey: 'flows',     overflow: true }
    case 'runner':    return { component: <RunnerPanel />,            titleKey: 'runner',    overflow: true }
    case 'matrix':    return { component: <MatrixPanel />,            titleKey: 'Env Matrix', overflow: true }
    case 'soap':      return { component: <SoapPanel />,             titleKey: 'soap',      overflow: true }
    case 'testdata':  return { component: <TestDataStudio />,        titleKey: 'testdata',  overflow: true }
    case 'har':         return { component: <HarViewerPanel />,       titleKey: 'HAR Viewer', overflow: true }
    case 'observe':     return { component: <ObservabilityPanel />,   titleKey: 'Observability', overflow: true }
    case 'dockerlab':   return { component: <DockerLabPanel />,       titleKey: 'Docker Lab', overflow: true }
    case 'markdown':    return { component: <MarkdownPanel />,        titleKey: 'markdown',  overflow: true }
    case 'storage':     return { component: <StoragePanel />,         titleKey: 'storage',   overflow: true }
    case 'database':    return { component: <DatabasePanel />,        titleKey: 'Database Studio', overflow: true }
    case 'jsontools':   return { component: <JsonToolsPanel />,       titleKey: 'jsontools', overflow: true }
    case 'xmltools':    return { component: <XmlToolsPanel />,        titleKey: 'xmltools',  overflow: true }
    case 'welcome':     return { component: <WelcomePanel /> }
    case 'vault':       return { component: <VaultPanel />,           titleKey: 'vault',     overflow: true }
    case 'workspace':   return { component: <WorkspacePanel />,       titleKey: 'workspace', overflow: true }
    case 'themes':      return { component: <ThemePanel />,           titleKey: 'themes' }
    case 'templates':   return { component: <TemplateMarketplace />,  titleKey: 'templates' }
    case 'plugins':     return { component: <PluginManager />,        titleKey: 'plugins' }
    case 'secretscanner': return { component: <SecretScannerPanel />,  titleKey: 'secretscanner', overflow: true }
    case 'settings':    return { component: <SettingsPanel />,        titleKey: 'settings' }
    default:            return { component: <WelcomePanel /> }
  }
}

export function MainArea() {
  const activeRail = useAppStore((s) => s.activeRail)
  const goBack = useAppStore((s) => s.goBack)

  // Alt+← to go back, Escape to close secondary panels
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault()
      goBack()
    }
  }, [goBack])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const { component, titleKey, overflow } = panelFor(activeRail)

  return (
    <main className={`flex-1 flex flex-col min-w-0 relative bg-surface-0${overflow ? ' overflow-hidden' : ''}`}>
      {titleKey && <PanelHeader titleKey={titleKey} />}
      <div key={activeRail} className="flex-1 flex flex-col min-w-0 overflow-hidden panel-enter">
        <Suspense fallback={<PanelSkeleton />}>
          {component}
        </Suspense>
      </div>
    </main>
  )
}

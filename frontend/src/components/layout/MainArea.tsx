import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { ArrowLeft, Check, Save, Send, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { Composer } from '@/components/composer/Composer'
import { ApiToolsBar } from '@/components/collections/ApiToolsBar'
import { ResponsePanel } from '@/components/response/ResponsePanel'
import { TabBar } from '@/components/layout/TabBar'
import { WelcomePanel } from '@/components/layout/WelcomePanel'
import { LoadTestDrawer } from '@/components/loadtest/LoadTestDrawer'
import { executeRequest } from '@/lib/executeRequest'
import { uid, type EnvVariable, type HttpMethod, type RequestItem } from '@/lib/types'
import { useT } from '@/lib/i18n'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { VarHighlightInput } from '@/components/ui/VarHighlightInput'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RequestValidationDialog } from '@/components/composer/RequestValidationDialog'
import { validateRequestParams, type RequestParamIssue } from '@/lib/requestParamValidation'

// ─── Lazy-loaded panels (loaded on first navigation) ──────────────────────────

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
const ApiDocsPanel         = React.lazy(() => import('@/components/apidocs/ApiDocsPanel').then(m => ({ default: m.ApiDocsPanel })))
const StoragePanel         = React.lazy(() => import('@/components/storage/StoragePanel').then(m => ({ default: m.StoragePanel })))
const DatabasePanel        = React.lazy(() => import('@/components/database/DatabasePanel').then(m => ({ default: m.DatabasePanel })))
const VaultPanel           = React.lazy(() => import('@/components/vault/VaultPanel').then(m => ({ default: m.VaultPanel })))
const ThemePanel           = React.lazy(() => import('@/components/themes/ThemePanel').then(m => ({ default: m.ThemePanel })))
const TemplatesWorkspace   = React.lazy(() => import('@/components/templates/TemplatesWorkspace').then(m => ({ default: m.TemplatesWorkspace })))
const PluginManager        = React.lazy(() => import('@/components/plugins/PluginManager').then(m => ({ default: m.PluginManager })))
const SettingsPanel        = React.lazy(() => import('@/components/settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const GitSyncPanel         = React.lazy(() => import('@/components/workspace/GitSyncPanel').then(m => ({ default: m.GitSyncPanel })))
const McpPanel             = React.lazy(() => import('@/components/mcp/McpPanel').then(m => ({ default: m.McpPanel })))

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
  const activeRail = useAppStore((s) => s.activeRail)
  const hasHistory = useAppStore((s) => s.railHistory.length > 0)
  const workspaces = useCollectionsStore((s) => s.workspaces)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const t = useT()
  // The API Workspace home shows the live workspace name; other panels use their i18n title.
  const label = activeRail === 'collections'
    ? (workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? 'Workspace')
    : titleKey && titleKey in t.rail
      ? t.rail[titleKey as keyof typeof t.rail]
      : titleKey || ''
  return (
    <div className="h-10 flex items-center gap-2 px-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
      <button
        onClick={goBack}
        disabled={!hasHistory}
        title="Back (Alt + ←)"
        className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ArrowLeft size={13} />
      </button>
      <span className="flex-1 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2">{label}</span>
      <button
        onClick={() => {
          if (hasHistory) goBack()
          // The API Workspace is the default home, so close it to the Welcome
          // screen; every other panel closes back to the API Workspace.
          else setActiveRail(activeRail === 'collections' ? 'welcome' : 'collections')
        }}
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
  | { kind: 'all'; tabId: string }

// ─── Resizable divider between Composer (left) and ResponsePanel (right) ─────

const COMPOSER_WIDTH_KEY = 'adomnia.composerWidth'
const COMPOSER_WIDTH_MIN  = 280

function composerWidthMaxRatio(): number {
  if (window.innerWidth < 1180) return 0.60
  if (window.innerWidth < 1440) return 0.66
  return 0.74
}

function defaultComposerWidthRatio(): number {
  if (window.innerWidth < 1180) return 0.54
  if (window.innerWidth < 1440) return 0.60
  return 0.66
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-head',
  CONNECT: 'text-warning',
  TRACE: 'text-info',
  WS: 'text-info',
  SOAP: 'text-method-post',
}

function clampComposerWidth(w: number): number {
  return Math.max(COMPOSER_WIDTH_MIN, Math.min(w, Math.round(window.innerWidth * composerWidthMaxRatio())))
}

function loadComposerWidth(): number {
  try {
    const stored = localStorage.getItem(COMPOSER_WIDTH_KEY)
    if (stored) return clampComposerWidth(parseInt(stored, 10))
  } catch { /* ignore */ }
  return Math.round(window.innerWidth * defaultComposerWidthRatio())
}

function ActiveRequestBar({
  request,
  isDirty,
  loading,
  vars,
  hasActiveEnv,
  onChange,
  onSend,
  onCancel,
  onSave,
  onDelete,
  apiToolsOpen,
  onToggleApiTools,
}: {
  request: RequestItem
  isDirty: boolean
  loading?: boolean
  vars: Record<string, string>
  hasActiveEnv: boolean
  onChange: (request: RequestItem) => void
  onSend: () => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
  apiToolsOpen: boolean
  onToggleApiTools: () => void
}) {
  const [savedFlash, setSavedFlash] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusUrl = () => urlInputRef.current?.focus()
    document.addEventListener('adomnia:focus-url', focusUrl)
    return () => document.removeEventListener('adomnia:focus-url', focusUrl)
  }, [])

  const handleSave = () => {
    onSave()
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1000)
  }

  return (
    <div className="border-b border-border-1 bg-surface-1/95 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <select
          value={request.method}
          onChange={(e) => onChange({ ...request, method: e.target.value as HttpMethod })}
          className={cn(
            'h-[var(--ui-control-h)] w-[82px] rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] font-bold outline-none transition-colors focus:border-accent',
            METHOD_COLORS[request.method] ?? 'text-text-1',
          )}
          title="HTTP method"
        >
          {METHODS.map((method) => (
            <option key={method} value={method}>{method}</option>
          ))}
        </select>

        <div className="h-[var(--ui-control-h)] min-w-0 flex-1 overflow-hidden rounded-md border border-border-2 bg-surface-2 transition-colors focus-within:border-accent">
          <VarHighlightInput
            value={request.url}
            onChange={(url) => onChange({ ...request, url })}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend() }}
            resolvedVars={vars}
            hasActiveEnv={hasActiveEnv}
            placeholder="https://api.your-domain.com/v1/users or {{base_url}}/health"
            className="h-full"
            inputRef={urlInputRef}
          />
        </div>

        {loading ? (
          <button
            onClick={onCancel}
            title="Cancel request"
            className="flex h-[var(--ui-control-h)] min-w-[88px] items-center justify-center gap-1.5 rounded-md bg-error px-3 text-[11px] font-bold text-white transition-colors hover:bg-error/85"
          >
            <X size={14} />
            Cancel
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!request.url}
            className="flex h-[var(--ui-control-h)] min-w-[88px] items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-bold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={14} />
            Send
          </button>
        )}

        <button
          onClick={onToggleApiTools}
          title={apiToolsOpen ? 'Hide API tools' : 'Show API tools (redirects, timeout, cURL, encode…)'}
          className={cn(
            'grid h-[var(--ui-control-h)] w-[var(--ui-control-h)] place-items-center rounded-md transition-colors',
            apiToolsOpen
              ? 'border border-accent/40 bg-accent/15 text-accent'
              : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
          )}
        >
          <SlidersHorizontal size={14} />
        </button>

        <button
          onClick={handleSave}
          title={isDirty ? 'Unsaved changes - Save to collection (Ctrl+S)' : 'Save to collection (Ctrl+S)'}
          className={cn(
            'grid h-[var(--ui-control-h)] w-[var(--ui-control-h)] place-items-center rounded-md transition-all',
            savedFlash
              ? 'bg-success/10 text-success'
              : isDirty
                ? 'border border-warning/30 bg-warning/15 text-warning hover:bg-warning/25'
                : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
          )}
        >
          {savedFlash ? <Check size={15} /> : <Save size={15} />}
        </button>

        <button
          onClick={onDelete}
          title="Delete request"
          className="grid h-[var(--ui-control-h)] w-[var(--ui-control-h)] place-items-center rounded-md text-text-3 transition-colors hover:bg-error/10 hover:text-error"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── RequestWorkspace ─────────────────────────────────────────────────────────

function RequestWorkspace() {
  const allTabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const closeRequestTabs = useTabsStore((s) => s.closeRequestTabs)
  const closeTabsToRight = useTabsStore((s) => s.closeTabsToRight)
  const closeTabsToLeft = useTabsStore((s) => s.closeTabsToLeft)
  const closeAllTabs = useTabsStore((s) => s.closeAllTabs)
  const reorderTab = useTabsStore((s) => s.reorderTab)
  const newTab = useTabsStore((s) => s.newTab)
  const duplicateTab = useTabsStore((s) => s.duplicateTab)
  const updateRequest = useTabsStore((s) => s.updateRequest)
  const setLoading = useTabsStore((s) => s.setLoading)
  const setResponse = useTabsStore((s) => s.setResponse)
  const markClean = useTabsStore((s) => s.markClean)
  const updateViewState = useTabsStore((s) => s.updateViewState)
  const updateCollectionRequest = useCollectionsStore((s) => s.updateRequest)
  const deleteCollectionNode = useCollectionsStore((s) => s.deleteNode)
  const collections = useCollectionsStore((s) => s.collections)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const tabs = useMemo(
    () => allTabs.filter((tab) => (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId),
    [activeWorkspaceId, allTabs],
  )
  const confirmBeforeClosingDirtyTabs = useSettingsStore((s) => s.settings.general.confirmBeforeClosingDirtyTabs)

  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const updateVariables = useEnvironmentsStore((s) => s.updateVariables)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)

  const [showLoadTest, setShowLoadTest] = useState(false)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const sendAbortRef = useRef<AbortController | null>(null)
  const [apiToolsOpen, setApiToolsOpen] = useState(() => {
    try { return localStorage.getItem('adomnia.apiToolsOpen') === '1' } catch { return false }
  })
  const toggleApiTools = useCallback(() => {
    setApiToolsOpen((v) => {
      const next = !v
      try { localStorage.setItem('adomnia.apiToolsOpen', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const [paramIssues, setParamIssues] = useState<RequestParamIssue[]>([])
  const [deleteRequestTarget, setDeleteRequestTarget] = useState<{
    requestId: string
    collectionId?: string
    name: string
  } | null>(null)
  const composerScrollRef = useRef<HTMLDivElement>(null)

  // ── Resizable horizontal split: Composer (left) | drag | Response (right) ──
  const [composerWidth, setComposerWidth] = useState<number>(loadComposerWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const isDraggingRef = useRef(false)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: composerWidth }
    isDraggingRef.current = true

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const delta = me.clientX - dragRef.current.startX
      const newW = clampComposerWidth(dragRef.current.startWidth + delta)
      setComposerWidth(newW)
      safeSetItem(COMPOSER_WIDTH_KEY, String(newW))
    }

    const handleUp = () => {
      isDraggingRef.current = false
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
  }, [composerWidth])

  // Clamp width on window resize
  useEffect(() => {
    const onResize = () => {
      if (!isDraggingRef.current) {
        setComposerWidth((w) => clampComposerWidth(w))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // ── End resizable split ─────────────────────────────────────────────────────

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

  useEffect(() => {
    if (activeTab && composerScrollRef.current) {
      composerScrollRef.current.scrollTop = useTabsStore.getState().getViewState(activeTab.id).composerScrollTop
    }
  }, [activeTab?.id])

  const handleSend = async () => {
    if (!activeTab || activeTab.loading) return
    const issues = validateRequestParams(activeTab.request)
    if (issues.length > 0) {
      setParamIssues(issues)
      return
    }
    setParamIssues([])
    const controller = new AbortController()
    sendAbortRef.current = controller
    setLoading(activeTab.id, true)
    const vars = getResolvedVars()
    const result = await executeRequest(activeTab.request, vars, { signal: controller.signal })
    if (activeEnvId && Object.keys(result.mutations).length > 0) {
      const env = environments.find((e) => e.id === activeEnvId)
      if (env) updateVariables(activeEnvId, applyEnvironmentMutations(env.variables, result.mutations))
    }
    const response = result.response
    setResponse(activeTab.id, response)
    sendAbortRef.current = null
  }

  const handleCancel = () => {
    sendAbortRef.current?.abort()
  }

  useEffect(() => {
    const onSendActiveRequest = (event: Event) => {
      const command = event as CustomEvent<{ handled: boolean }>
      command.detail.handled = true
      void handleSend()
    }
    document.addEventListener('adomnia:send-active-request', onSendActiveRequest)
    return () => document.removeEventListener('adomnia:send-active-request', onSendActiveRequest)
  })

  const saveTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || !tab.collectionId) return
    updateCollectionRequest(tab.collectionId, tab.request)
    markClean(tab.id)
  }, [tabs, updateCollectionRequest, markClean])

  const handleRenameTab = useCallback((tabId: string, name: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    const renamed = { ...tab.request, name }
    updateRequest(tabId, renamed)
    if (tab.collectionId) {
      updateCollectionRequest(tab.collectionId, renamed)
      markClean(tabId)
    }
  }, [tabs, updateRequest, updateCollectionRequest, markClean])

  const handleSave = () => {
    if (!activeTab || !activeTab.collectionId) return
    updateCollectionRequest(activeTab.collectionId, activeTab.request)
    markClean(activeTab.id)
  }

  const confirmDeleteActiveRequest = () => {
    if (!activeTab) return
    setDeleteRequestTarget({
      requestId: activeTab.request.id,
      collectionId: activeTab.collectionId,
      name: activeTab.request.name || activeTab.request.url || 'Untitled',
    })
  }

  const deleteActiveRequest = () => {
    if (!deleteRequestTarget) return
    if (deleteRequestTarget.collectionId) {
      deleteCollectionNode(deleteRequestTarget.collectionId, deleteRequestTarget.requestId)
    }
    closeRequestTabs(deleteRequestTarget.requestId)
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
    if (pending.kind === 'all') {
      return tabs.filter((t) => t.dirty)
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
    else if (pending.kind === 'left') closeTabsToLeft(pending.tabId)
    else closeAllTabs()
    setPendingClose(null)
  }, [getDirtyTabsForPending, saveTab, closeTab, closeTabsToRight, closeTabsToLeft, closeAllTabs])

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
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={(id) => attemptClose({ kind: 'single', tabId: id })}
        onCloseToRight={(id) => attemptClose({ kind: 'right', tabId: id })}
        onCloseToLeft={(id) => attemptClose({ kind: 'left', tabId: id })}
        onCloseAll={(id) => attemptClose({ kind: 'all', tabId: id })}
        onReorder={reorderTab}
        onNewTab={newTab}
        onDuplicate={duplicateTab}
        onRenameTab={handleRenameTab}
      />
      {activeTab && (
        <ActiveRequestBar
          request={activeTab.request}
          isDirty={activeTab.dirty}
          loading={activeTab.loading}
          vars={getResolvedVars()}
          hasActiveEnv={activeEnvId !== null}
          onChange={(request) => updateRequest(activeTab.id, request)}
          onSend={handleSend}
          onCancel={handleCancel}
          onSave={handleSave}
          onDelete={confirmDeleteActiveRequest}
          apiToolsOpen={apiToolsOpen}
          onToggleApiTools={toggleApiTools}
        />
      )}
      <ApiToolsBar
        activeRequest={activeTab?.request ?? null}
        onChangeRequest={(request) => activeTab && updateRequest(activeTab.id, request)}
        onApplyRequest={(request) => activeTab && updateRequest(activeTab.id, request)}
        onLoadTest={() => setShowLoadTest((v) => !v)}
        open={apiToolsOpen}
      />

      {activeTab ? (
        /* ── Horizontal split: Composer (left, fixed width) | drag | Response (right, flex-1) ── */
        <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
          {/* Composer pane — left side, fixed width, independently scrollable */}
          <div
            ref={composerScrollRef}
            onScroll={(e) => updateViewState(activeTab.id, { composerScrollTop: e.currentTarget.scrollTop })}
            className="shrink-0 min-h-0 overflow-hidden flex flex-col border-r border-border-1"
            style={{ width: composerWidth }}
          >
            <Composer
              key={activeTab.id}
              tabId={activeTab.id}
              request={activeTab.request}
              onChange={(req) => updateRequest(activeTab.id, req)}
              onSend={handleSend}
              onSave={handleSave}
              onLoadTest={() => setShowLoadTest((v) => !v)}
              loading={activeTab.loading}
              hideRequestBar
            />
          </div>

          {showLoadTest ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <LoadTestDrawer
                request={activeTab.request}
                onClose={() => setShowLoadTest(false)}
              />
            </div>
          ) : (
            <>
              {/* ── Vertical drag handle ────────────────────────────────────── */}
              <ResizeHandle
                label="Drag to resize panels"
                onMouseDown={handleResizeMouseDown}
                withLine={false}
              />

              {/* ── Response pane — right side, fills remaining space ── */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <ResponsePanel
                  key={activeTab.id}
                  tabId={activeTab.id}
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

      <RequestValidationDialog issues={paramIssues} onClose={() => setParamIssues([])} />

      <ConfirmDialog
        open={Boolean(deleteRequestTarget)}
        title="Delete request?"
        message={deleteRequestTarget?.collectionId
          ? `Are you sure you want to delete "${deleteRequestTarget.name}"? The request will be removed from its collection and all open tabs.`
          : `Are you sure you want to delete "${deleteRequestTarget?.name ?? 'Untitled'}"? This unsaved request will be discarded.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={deleteActiveRequest}
        onCancel={() => setDeleteRequestTarget(null)}
      />
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
    case 'collections': return { component: <RequestWorkspace />, titleKey: 'API Workspace' }
    case 'scenarios':   return { component: <DailyScenariosPanel />, titleKey: 'Daily Scenarios', overflow: true }
    case 'history':     return { component: <RequestHistoryPanel />,  titleKey: 'Request History', overflow: true }
    case 'websocket':   return { component: <WebSocketPanel />,       titleKey: 'WebSocket',     overflow: true }
    case 'sse':         return { component: <SsePanel />,             titleKey: 'SSE Client',    overflow: true }
    case 'broker':      return { component: <BrokerStudioPanel />,    titleKey: 'Broker Studio', overflow: true }
    case 'mock':        return { component: <MockPanel />,            titleKey: 'mock',      overflow: true }
    case 'proxy':       return { component: <ProxyPanel />,           titleKey: 'proxy',     overflow: true }
    case 'grpc':        return { component: <GrpcPanel />,            titleKey: 'grpc',      overflow: true }
    case 'browser':     return { component: <BrowserDebugPanel />,    titleKey: 'browser' }
    case 'powertools':  return { component: <UtilsPanel />,           titleKey: 'Power Tools', overflow: true }
    case 'flows':     return { component: <FlowsPanel />,              titleKey: 'flows',     overflow: true }
    case 'soap':      return { component: <SoapPanel />,             titleKey: 'soap',      overflow: true }
    case 'har':         return { component: <UtilsPanel initialTool="harviewer" />, titleKey: 'Power Tools', overflow: true }
    case 'observe':     return { component: <UtilsPanel initialTool="observability" />, titleKey: 'Power Tools', overflow: true }
    case 'dockerlab':   return { component: <UtilsPanel initialTool="dockerlab" />, titleKey: 'Power Tools', overflow: true }
    case 'markdown':    return { component: <MarkdownPanel />,        titleKey: 'markdown',  overflow: true }
    case 'mermaid':     return { component: <MermaidPanel />,         titleKey: 'mermaid',   overflow: true }
    case 'latex':       return { component: <LatexStudioPanel />,      titleKey: 'latex',     overflow: true }
    case 'pdfeditor':   return { component: <PdfEditorPanel />,        titleKey: 'pdfeditor', overflow: true }
    case 'storage':     return { component: <StoragePanel />,         titleKey: 'storage',   overflow: true }
    case 'database':    return { component: <DatabasePanel />,        titleKey: 'Database Studio', overflow: true }
    case 'jsonviewer':  return { component: <JsonViewerPanel />,      titleKey: 'JSON Studio', overflow: true }
    case 'xmltools':    return { component: <UtilsPanel initialTool="xmlstudio" />, titleKey: 'Power Tools', overflow: true }
    case 'welcome':     return { component: <WelcomePanel /> }
    case 'vault':       return { component: <VaultPanel />,           titleKey: 'vault',     overflow: true }
    case 'workspace':   return { component: <SettingsPanel initialSection="workspace" />, titleKey: 'settings', overflow: true }
    case 'apidocs':     return { component: <ApiDocsPanel />,          titleKey: 'apidocs', overflow: true }
    case 'themes':      return { component: <ThemePanel />,           titleKey: 'themes' }
    case 'templates':   return { component: <TemplatesWorkspace />,   titleKey: 'templates' }
    case 'plugins':     return { component: <PluginManager />,        titleKey: 'plugins' }
    case 'secretscanner': return { component: <UtilsPanel initialTool="secretscanner" />, titleKey: 'Power Tools', overflow: true }
    case 'gitsync':     return { component: <GitSyncPanel />,         titleKey: 'Git Sync', overflow: true }
    case 'mcp':         return { component: <McpPanel />,             titleKey: 'MCP Client', overflow: true }
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

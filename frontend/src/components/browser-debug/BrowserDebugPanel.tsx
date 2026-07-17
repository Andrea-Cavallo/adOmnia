import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useBrowserDebugStore, type TypeFilter } from '@/stores/browser-debug'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import { blankRequest, uid } from '@/lib/types'
import { appendMockEndpoints } from '@/lib/mockEndpointStore'
import type { RequestItem, HttpMethod } from '@/lib/types'
import {
  DEFAULT_FLOW_SETTINGS,
  loadFlowDefinitions,
  saveFlowDefinitions,
  type SavedFlowDefinition,
} from '@/lib/flowStorage'
import { graphFromMermaid, type ApiCatalogRequest } from '@/lib/flowMermaid'
import {
  launchBrowserForDebug,
  inspectablePageTargets,
  discoverEndpoints,
  connectToTarget,
  disconnectDebugger,
  getTraffic,
  clearTraffic,
  enableConsole,
  type DebugTarget,
  type DebugEndpoint,
} from '@/lib/browser-debug-api'
import { NetworkList } from './NetworkList'
import { NetworkDetail } from './NetworkDetail'
import { ConsolePanel } from './ConsolePanel'
import { DebuggerPanel } from './DebuggerPanel'
import { DOMInspectorPanel } from './DOMInspectorPanel'
import { StoragePanel } from './StoragePanel'
import { ThrottlingPanel } from './ThrottlingPanel'
import { NetToolsPanel } from '@/components/nettools/NetToolsPanel'
import {
  Globe,
  Unplug,
  Trash2,
  Search,
  Network,
  Terminal,
  Bug,
  Code2,
  Database,
  Gauge,
  RefreshCw,
  X,
  MonitorCheck,
  ChevronDown,
} from 'lucide-react'

type DebugTab = 'network' | 'console' | 'debugger' | 'dom' | 'storage' | 'throttling' | 'nettools'

const DEBUG_TABS: { id: DebugTab; label: string; icon: typeof Network }[] = [
  { id: 'network',    label: 'Network',    icon: Network },
  { id: 'console',    label: 'Console',    icon: Terminal },
  { id: 'debugger',   label: 'Debugger',   icon: Bug },
  { id: 'dom',        label: 'DOM',        icon: Code2 },
  { id: 'storage',    label: 'Storage',    icon: Database },
  { id: 'throttling', label: 'Throttling', icon: Gauge },
  { id: 'nettools',   label: 'Net Tools',  icon: Globe },
]

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all',   label: 'All' },
  { id: 'xhr',   label: 'XHR' },
  { id: 'doc',   label: 'Doc' },
  { id: 'css',   label: 'CSS' },
  { id: 'js',    label: 'JS' },
  { id: 'img',   label: 'Img' },
  { id: 'font',  label: 'Font' },
  { id: 'other', label: 'Other' },
]

const CAPTURED_BROWSER_FLOW_NAME = 'Browser captured flow'

function mimeMatchesType(mime: string, type: TypeFilter): boolean {
  if (type === 'all') return true
  if (type === 'xhr')  return mime.includes('json') || mime.includes('xml')
  if (type === 'doc')  return mime.includes('html')
  if (type === 'css')  return mime.includes('css')
  if (type === 'js')   return mime.includes('javascript') || mime.includes('ecmascript')
  if (type === 'img')  return mime.includes('image')
  if (type === 'font') return mime.includes('font') || mime.includes('woff')
  return !mime.includes('json') && !mime.includes('xml') && !mime.includes('html') &&
    !mime.includes('css') && !mime.includes('javascript') && !mime.includes('image') && !mime.includes('font')
}

function safeHttpMethod(method: string): HttpMethod {
  const safe = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','CONNECT','TRACE']
  return safe.includes(method.toUpperCase()) ? method.toUpperCase() as HttpMethod : 'GET'
}

function requestFromCapture(data: { method: string; url: string; headers: Record<string, string>; body: string }): RequestItem {
  const method = safeHttpMethod(data.method)
  const request = blankRequest(method, `${method} ${data.url}`)
  return {
    ...request,
    url: data.url,
    headers: Object.entries(data.headers).map(([key, value]) => ({ id: uid(), key, value, enabled: true })),
    bodies: [{ id: uid(), name: 'Body 1', type: data.body ? 'raw' : 'none', raw: data.body, lang: 'json', form: [] }],
    activeBodyIdx: 0,
  }
}

function capturedRequestLabel(request: RequestItem) {
  try {
    const url = new URL(request.url)
    return `${request.method} ${url.pathname || '/'}`
  } catch {
    return `${request.method} ${request.url || request.name}`
  }
}

function mermaidQuote(label: string) {
  return label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function capturedRequestsFromFlow(flow: SavedFlowDefinition | undefined): RequestItem[] {
  if (!flow) return []
  return flow.graph.nodes
    .filter((node) => node.type === 'request' && node.config.request)
    .map((node) => node.config.request as RequestItem)
}

function capturedCatalog(requests: RequestItem[]): ApiCatalogRequest[] {
  return requests.map((request, index) => ({
    id: `browser-capture-${index + 1}`,
    label: capturedRequestLabel(request),
    source: 'Browser Debug',
    request,
  }))
}

function capturedMermaid(requests: RequestItem[]) {
  const lines = ['flowchart TD', '  S((Start))']
  requests.forEach((request, index) => {
    const key = `R${index + 1}`
    const previous = index === 0 ? 'S' : `R${index}`
    lines.push(`  ${key}["${mermaidQuote(capturedRequestLabel(request))}"]`)
    lines.push(`  ${previous} -->${index === 0 ? '' : '|success|'} ${key}`)
    lines.push(`  ${key} -->|error| ERR["Show Error / Stop Flow"]`)
  })
  if (requests.length > 0) lines.push(`  R${requests.length} -->|success| OK((End success))`)
  return lines.join('\n')
}

function createCapturedFlow(requests: RequestItem[], existing?: SavedFlowDefinition): SavedFlowDefinition {
  const mermaidSource = capturedMermaid(requests)
  return {
    id: existing?.id ?? uid(),
    name: CAPTURED_BROWSER_FLOW_NAME,
    graph: { ...graphFromMermaid(mermaidSource, capturedCatalog(requests)), settings: DEFAULT_FLOW_SETTINGS },
    mermaidSource,
    updatedAt: new Date().toISOString(),
    version: 3,
  }
}

// Tab picker panel

interface TabPickerProps {
  onConnect: (target: DebugTarget) => void
  onCancel: () => void
  connectionError?: string
}

function TabPicker({ onConnect, onCancel, connectionError }: TabPickerProps) {
  const [launchUrl, setLaunchUrl]         = useState('https://')
  const [scanning, setScanning]           = useState(false)
  const [launching, setLaunching]         = useState(false)
  const [endpoints, setEndpoints]         = useState<DebugEndpoint[]>([])
  const [launchTargets, setLaunchTargets] = useState<DebugTarget[]>([])
  const [error, setError]                 = useState('')

  const scan = useCallback(async () => {
    setScanning(true)
    setError('')
    setLaunchTargets([])
    try {
      const result = await discoverEndpoints()
      const safe = result ?? []
      setEndpoints(safe)
      if (safe.length === 0) {
        setError('No browser found with remote debugging enabled. Launch a new one below, or start Chrome/Edge with --remote-debugging-port=9222')
      }
    } catch (err: unknown) {
      setEndpoints([])
      setError(err instanceof Error ? err.message : 'Failed to scan browser debug endpoints')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => { scan() }, [scan])

  const handleLaunch = useCallback(async () => {
    setLaunching(true)
    setError('')
    try {
      const targets = inspectablePageTargets(await launchBrowserForDebug(launchUrl, 9223))
      if (targets.length > 0) {
        setLaunchTargets(targets)
        setEndpoints([])
      } else {
        setError('Browser launched but no tabs found yet. Scan again in a moment.')
        await scan()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to launch browser')
    } finally {
      setLaunching(false)
    }
  }, [launchUrl, scan])

  const allTargets: { endpoint: string; target: DebugTarget }[] = [
    ...inspectablePageTargets(launchTargets).map((t) => ({ endpoint: 'Launched browser', target: t })),
    ...(endpoints ?? []).flatMap((ep) =>
      inspectablePageTargets(ep.targets)
        .map((t) => ({ endpoint: `${ep.browserName} - port ${ep.port}`, target: t }))
    ),
  ]

  return (
    <div className="flex flex-col h-full bg-surface-1 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MonitorCheck size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-1">Connect to a browser tab</span>
        </div>
        <button onClick={onCancel} className="text-text-3 hover:text-text-1 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-5 min-h-0 overflow-auto">

        {/* Scan results */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-text-3 uppercase tracking-wider">
              Open browser tabs with CDP
            </span>
            <button
              onClick={scan}
              disabled={scanning}
              className="flex items-center gap-1 h-6 px-2 rounded bg-surface-2 border border-border-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={10} className={scanning ? 'animate-spin' : ''} />
              {scanning ? 'Scanning...' : 'Scan again'}
            </button>
          </div>

          {(connectionError || error) && (
            <p className="text-[10px] text-text-3 bg-surface-2 border border-border-1 rounded px-3 py-2 mb-2 leading-relaxed">
              {connectionError || error}
            </p>
          )}

          {allTargets.length > 0 && (
            <div className="flex flex-col gap-1">
              {allTargets.map(({ endpoint, target }) => (
                <button
                  key={target.id}
                  onClick={() => onConnect(target)}
                  disabled={target.attached}
                  className={cn(
                    'w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors',
                    target.attached
                      ? 'border-border-1 bg-surface-0 opacity-40 cursor-not-allowed'
                      : 'border-border-1 bg-surface-0 hover:border-accent/40 hover:bg-accent/5 cursor-pointer'
                  )}
                >
                  <Globe size={14} className="text-text-3 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text-1 truncate">
                      {target.title || '(no title)'}
                    </div>
                    <div className="text-[10px] text-text-3 truncate mt-0.5">{target.url}</div>
                    <div className="text-[9px] text-text-4 mt-0.5">{endpoint}</div>
                  </div>
                  {target.attached && (
                    <span className="text-[9px] text-text-4 flex-shrink-0 mt-0.5">already attached</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!scanning && allTargets.length === 0 && !error && (
            <p className="text-[10px] text-text-4 italic">No tabs found.</p>
          )}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border-1" />
          <span className="text-[10px] text-text-4">or launch a new browser</span>
          <div className="flex-1 h-px bg-border-1" />
        </div>

        {/* Launch browser */}
        <div>
          <span className="text-[11px] font-semibold text-text-3 uppercase tracking-wider block mb-2">
            Launch debug browser
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={launchUrl}
              onChange={(e) => setLaunchUrl(e.target.value)}
              placeholder="https://your-site.com"
              className="flex-1 h-8 px-2 rounded bg-surface-0 border border-border-1 text-xs text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
              onKeyDown={(e) => { if (e.key === 'Enter') handleLaunch() }}
            />
            <button
              onClick={handleLaunch}
              disabled={launching}
              className="h-8 px-3 rounded bg-accent text-white text-xs font-medium hover:bg-accent/80 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {launching ? 'Launching...' : 'Launch'}
            </button>
          </div>
          <p className="text-[10px] text-text-4 mt-1.5 leading-relaxed">
            Opens Edge/Chrome with remote debugging on port 9223.
            To use your own browser: close it, then run it with{' '}
            <code className="font-mono bg-surface-2 px-1 rounded">--remote-debugging-port=9222</code>,
            then click Scan.
          </p>
        </div>
      </div>
    </div>
  )
}

// Connected toolbar

interface ConnectedToolbarProps {
  connectedTab: DebugTarget | null
  filter: string
  typeFilter: TypeFilter
  activeTab: DebugTab
  onDisconnect: () => void
  onFilterChange: (v: string) => void
  onTypeFilterChange: (v: TypeFilter) => void
  onClear: () => void
}

function ConnectedToolbar({
  connectedTab, filter, typeFilter, activeTab,
  onDisconnect, onFilterChange, onTypeFilterChange, onClear,
}: ConnectedToolbarProps) {
  const [showTabInfo, setShowTabInfo] = useState(false)

  return (
    <div className="flex items-center h-10 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
      {/* Connected indicator + tab info */}
      <button
        onClick={() => setShowTabInfo((v) => !v)}
        className="flex items-center gap-1.5 h-7 px-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs hover:bg-emerald-500/20 transition-colors flex-shrink-0 max-w-[200px]"
        title={connectedTab?.url ?? ''}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
        <span className="truncate">{connectedTab?.title ?? 'Connected'}</span>
        <ChevronDown size={10} className="flex-shrink-0" />
      </button>

      {/* Disconnect */}
      <button
        onClick={onDisconnect}
        title="Disconnect"
        className="h-7 px-2 rounded border border-border-1 bg-surface-2 text-xs text-text-3 hover:text-red-400 hover:border-red-400/40 transition-colors flex items-center gap-1 flex-shrink-0"
      >
        <Unplug size={12} />
      </button>

      <div className="w-px h-5 bg-border-1 flex-shrink-0" />

      {/* Network-specific controls */}
      {activeTab === 'network' && (
        <>
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              type="text"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Filter URLs..."
              className="h-7 w-full pl-7 pr-2 rounded bg-surface-1 border border-border-1 text-xs text-text-1 placeholder:text-text-3 focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-0.5">
            {TYPE_FILTERS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => onTypeFilterChange(id)}
                className={cn(
                  'h-6 px-2 rounded text-[10px] font-medium transition-colors',
                  typeFilter === id ? 'bg-accent/20 text-accent' : 'text-text-3 hover:text-text-2 hover:bg-surface-2'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={onClear}
            title="Clear"
            className="h-7 px-2 rounded bg-surface-2 border border-border-1 text-xs text-text-3 hover:text-text-1 transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <Trash2 size={12} />
          </button>
        </>
      )}

      {/* Tab URL tooltip */}
      {showTabInfo && connectedTab && (
        <div
          className="absolute top-10 left-3 z-50 bg-surface-2 border border-border-1 rounded-lg px-3 py-2 shadow-xl max-w-sm"
          onMouseLeave={() => setShowTabInfo(false)}
        >
          <div className="text-[10px] text-text-3 mb-0.5">Intercepting</div>
          <div className="text-xs text-text-1 font-mono break-all">{connectedTab.url}</div>
        </div>
      )}
    </div>
  )
}

// Main panel

export function BrowserDebugPanel({ initialTab = 'network' }: { initialTab?: DebugTab }) {
  const {
    connected, entries, selectedEntry, filter, typeFilter,
    setConnected, setEntries, setFilter, setTypeFilter, clearEntries,
  } = useBrowserDebugStore()
  const setBrowserRunning = useAppStore((s) => s.setBrowserRunning)

  const [showPicker, setShowPicker]       = useState(!connected)
  const [connectedTab, setConnectedTab]   = useState<DebugTarget | null>(null)
  const [activeTab, setActiveTab]         = useState<DebugTab>(initialTab)
  const [connectionError, setConnectionError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Command-palette deep links select a tab via this event (see commandPalette.ts).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: DebugTab; nettoolsTab?: string; handled?: boolean }
      if (detail?.tab && DEBUG_TABS.some((t) => t.id === detail.tab)) {
        setActiveTab(detail.tab)
        if (detail.tab === 'nettools' && detail.nettoolsTab) {
          window.requestAnimationFrame(() => {
            document.dispatchEvent(new CustomEvent('adomnia:nettools-tab', {
              detail: { tab: detail.nettoolsTab, handled: false },
            }))
          })
        }
        detail.handled = true
      }
    }
    document.addEventListener('adomnia:browser-tab', handler)
    return () => document.removeEventListener('adomnia:browser-tab', handler)
  }, [])

  const handleConnect = useCallback(async (target: DebugTarget) => {
    setConnectionError('')
    try {
      if (inspectablePageTargets([target]).length === 0) {
        throw new Error('Select a browser page. Workers and extension targets do not expose an inspectable DOM.')
      }
      await connectToTarget(target.webSocketDebuggerUrl)
      await enableConsole()
      setConnectedTab(target)
      setConnected(true)
      setShowPicker(false)
    } catch (err: unknown) {
      setConnectionError(err instanceof Error ? err.message : 'Connection failed')
    }
  }, [setConnected])

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectDebugger()
      setConnectionError('')
    } catch (err: unknown) {
      setConnectionError(err instanceof Error ? err.message : 'Disconnect failed')
    }
    setConnected(false)
    setConnectedTab(null)
    setShowPicker(true)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [setConnected])

  const handleClear = useCallback(async () => {
    try {
      await clearTraffic()
      clearEntries()
      setConnectionError('')
    } catch (err: unknown) {
      setConnectionError(err instanceof Error ? err.message : 'Failed to clear browser traffic')
    }
  }, [clearEntries])

  // Poll traffic while connected
  useEffect(() => {
    if (connected) {
      const poll = async () => {
        try {
          const traffic = await getTraffic()
          if (traffic.length > 0) {
            setEntries(traffic)
            setConnectionError('')
          }
        } catch (err: unknown) {
          setConnectionError(err instanceof Error ? err.message : 'Failed to read browser traffic')
        }
      }
      poll()
      pollRef.current = setInterval(poll, 1000)
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [connected, setEntries])

  useEffect(() => { setBrowserRunning(connected) }, [connected, setBrowserRunning])
  useEffect(() => () => { setBrowserRunning(false) }, [setBrowserRunning])

  const handleSendToComposer = useCallback(
    (data: { method: string; url: string; headers: Record<string, string>; body: string }) => {
      const method = safeHttpMethod(data.method)
      const request: RequestItem = {
        id: uid(), name: '', type: 'request', method, url: data.url,
        params: [{ id: uid(), key: '', value: '', enabled: true }],
        headers: Object.entries(data.headers).map(([key, value]) => ({ id: uid(), key, value, enabled: true })),
        bodies: [{ id: uid(), name: 'Body 1', type: data.body ? 'raw' : 'none', raw: data.body, lang: 'json', form: [] }],
        activeBodyIdx: 0,
        auth: { type: 'none', token: '', username: '', password: '' },
        timeout: 0, followRedirects: true,
      }
      useTabsStore.getState().openTab(request)
      useAppStore.getState().setActiveRail('collections')
    }, []
  )

  const handleAddToFlow = useCallback(
    async (data: { method: string; url: string; headers: Record<string, string>; body: string }) => {
      const request = requestFromCapture(data)
      const flows = await loadFlowDefinitions()
      const existing = flows.find((flow) => flow.name === CAPTURED_BROWSER_FLOW_NAME)
      const saved = createCapturedFlow([...capturedRequestsFromFlow(existing), request], existing)

      await saveFlowDefinitions([saved, ...flows.filter((flow) => flow.id !== saved.id)])
      useAppStore.getState().setActiveRail('flows')
    }, []
  )

  const handleAddAsMock = useCallback(
    async (data: { url: string; status: number; headers: Record<string, string>; body: string }) => {
      let path = '/'
      try { path = new URL(data.url).pathname } catch { /* use default */ }
      const newEndpoint = {
        id: uid(), path, method: 'GET', description: `Captured from ${data.url}`,
        responses: [{ id: uid(), name: `Status ${data.status}`, status: data.status, headers: data.headers, body: data.body, delayMs: 0, isActive: true }],
        mode: 'first_active',
      }
      try {
        await appendMockEndpoints([newEndpoint])
        useAppStore.getState().setActiveRail('mock')
        setConnectionError('')
      } catch (err: unknown) {
        setConnectionError(err instanceof Error ? err.message : 'Failed to add captured response as mock')
      }
    }, []
  )

  const filteredEntries = useMemo(() => entries.filter((e) => {
    const matchText = !filter || e.url.toLowerCase().includes(filter.toLowerCase())
    return matchText && mimeMatchesType(e.mimeType, typeFilter)
  }), [entries, filter, typeFilter])

  // Show picker if not connected
  const debugTabBar = (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border-1 bg-surface-0 px-3">
      {DEBUG_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          className={cn(
            'h-6 px-2.5 rounded text-[10px] font-medium flex items-center gap-1.5 transition-colors',
            activeTab === id ? 'bg-accent/20 text-accent' : 'text-text-3 hover:text-text-2 hover:bg-surface-2'
          )}
        >
          <Icon size={10} />
          {label}
        </button>
      ))}
    </div>
  )

  if (activeTab === 'nettools' && !connected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface-1">
        {debugTabBar}
        <div className="flex-1 min-h-0 overflow-hidden"><NetToolsPanel /></div>
      </div>
    )
  }

  if (showPicker || !connected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface-1">
        {debugTabBar}
        <TabPicker
          onConnect={handleConnect}
          onCancel={connected ? () => setShowPicker(false) : () => {}}
          connectionError={connectionError}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1 relative">
      <ConnectedToolbar
        connectedTab={connectedTab}
        filter={filter}
        typeFilter={typeFilter}
        activeTab={activeTab}
        onDisconnect={handleDisconnect}
        onFilterChange={setFilter}
        onTypeFilterChange={setTypeFilter}
        onClear={handleClear}
      />
      {connectionError && (
        <div className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {connectionError}
        </div>
      )}

      {/* Debug tab bar */}
      {debugTabBar}

      {/* Content */}
      {activeTab === 'network' && (
        <div className="flex flex-1 min-h-0">
          <div className="w-[60%] border-r border-border-1 overflow-hidden">
            <NetworkList entries={filteredEntries} />
          </div>
          <div className="w-[40%] overflow-hidden bg-surface-1">
            {selectedEntry
              ? <NetworkDetail entry={selectedEntry} onSendToComposer={handleSendToComposer} onAddAsMock={handleAddAsMock} onAddToFlow={handleAddToFlow} />
              : <div className="flex items-center justify-center h-full text-text-3 text-sm">Select a request to view details</div>
            }
          </div>
        </div>
      )}
      {activeTab === 'console'    && <div className="flex-1 min-h-0"><ConsolePanel /></div>}
      {activeTab === 'debugger'   && <div className="flex-1 min-h-0"><DebuggerPanel /></div>}
      {activeTab === 'dom'        && <div className="flex-1 min-h-0"><DOMInspectorPanel /></div>}
      {activeTab === 'storage'    && <div className="flex-1 min-h-0"><StoragePanel /></div>}
      {activeTab === 'throttling' && <div className="flex-1 min-h-0"><ThrottlingPanel /></div>}
      {activeTab === 'nettools'   && <div className="flex-1 min-h-0 overflow-hidden"><NetToolsPanel /></div>}
    </div>
  )
}

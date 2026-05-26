import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BarChart2,
  Braces,
  Bug,
  ChevronDown,
  Clock,
  Code2,
  Container,
  Database,
  FileCode,
  FileText,
  FolderOpen,
  GitBranch,
  HardDrive,
  Layers,
  Lock,
  Network,
  Play,
  Radio,
  Send,
  Server,
  Shield,
  Zap,
} from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useTabsStore } from '@/stores/tabs'
import { inferThemeMode } from '@/lib/themeCatalog'
import { useAppIcon } from '@/lib/brandAssets'
import type { TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { applyWorkspaceState, type WorkspaceState } from '@/lib/workspaceState'
import { loadRecentWorkspaces, rememberRecentWorkspace, type RecentWorkspace } from '@/lib/workspaceRecents'

type LayerId = 'network' | 'logic' | 'storage' | 'observability'

type HubTool = {
  id: RailItem
  icon: React.ElementType
  title: string
  desc: string
  foot: string
}

type HubLayer = {
  id: LayerId
  index: string
  title: string
  tag: string
  accent: string
  stats: { value: string; label: string; live?: boolean }[]
  desc: string
  flow: string[]
  tools: HubTool[]
}

const HUB_LAYERS: Array<Omit<HubLayer, 'stats'>> = [
  {
    id: 'network',
    index: 'L1 / 04',
    title: 'Network',
    tag: 'transport / protocols / wire format',
    accent: '#b794ff',
    desc: 'Everything that speaks over the wire. Compose requests, inspect frames and work with REST, SOAP, gRPC and streaming from one desktop surface.',
    flow: ['request', 'auth', 'transport', 'response'],
    tools: [
      { id: 'collections', icon: Network, title: 'API Workspace', desc: 'REST, HTTP and GraphQL with collections, scripts, environments and assertions.', foot: 'core workflow' },
      { id: 'soap', icon: FileCode, title: 'SOAP Studio', desc: 'WSDL parser, envelope builder, XML tools and WS-Security workflows.', foot: 'enterprise ready' },
      { id: 'grpc', icon: Send, title: 'gRPC Client', desc: 'Server reflection, metadata, TLS and unary or streaming invocation.', foot: 'service calls' },
      { id: 'websocket', icon: Zap, title: 'Streaming', desc: 'WebSocket and Server-Sent Events with live frame inspection.', foot: 'realtime' },
    ],
  },
  {
    id: 'logic',
    index: 'L2 / 05',
    title: 'Logic',
    tag: 'route / transform / simulate / verify',
    accent: '#6ee7b7',
    desc: 'The behavioural middle. Route messages, mock services you do not have yet, run suites, compare environments and generate realistic data.',
    flow: ['input', 'simulate', 'assert', 'report'],
    tools: [
      { id: 'broker', icon: Radio, title: 'Broker Studio', desc: 'Kafka, RabbitMQ, MQTT, Redis Pub/Sub and NATS in one console.', foot: 'multi-broker' },
      { id: 'mock', icon: Server, title: 'Mock Server', desc: 'Stub APIs with dynamic templates, path params, hit logs and scenarios.', foot: 'local simulation' },
      { id: 'proxy', icon: Shield, title: 'Proxy Interceptor', desc: 'Capture, inspect, rewrite and export traffic without leaving the app.', foot: 'traffic control' },
      { id: 'runner', icon: Play, title: 'Runner', desc: 'Run collections with datasets, retries, assertions and local reports.', foot: 'suite execution' },
      { id: 'matrix', icon: GitBranch, title: 'Environment Matrix', desc: 'Compare requests, collections and flows across environments.', foot: 'diff reports' },
    ],
  },
  {
    id: 'storage',
    index: 'L3 / 05',
    title: 'Storage',
    tag: 'persist / query / secrets / workspace',
    accent: '#5eead4',
    desc: 'Where things rest. Browse databases, encrypt secrets, inspect local storage and keep complete workspaces exportable as files.',
    flow: ['workspace', 'vault', 'database', 'export'],
    tools: [
      { id: 'database', icon: Database, title: 'Database Studio', desc: 'SQLite, PostgreSQL, MySQL and MongoDB with history and export.', foot: 'query locally' },
      { id: 'vault', icon: Lock, title: 'Vault', desc: 'Encrypted local secrets, certificates and tokens that stay on the machine.', foot: 'private by design' },
      { id: 'workspace', icon: FolderOpen, title: 'Workspaces', desc: 'Portable .adomnia bundles, import/export and demo reset.', foot: 'file based' },
      { id: 'storage', icon: HardDrive, title: 'Storage Inspector', desc: 'Browse and repair raw app storage with clear warnings.', foot: 'maintenance' },
      { id: 'markdown', icon: FileText, title: 'Markdown Notes', desc: 'Local notes and API documentation with live preview.', foot: 'docs nearby' },
    ],
  },
  {
    id: 'observability',
    index: 'L4 / 08',
    title: 'Observability',
    tag: 'cross-cutting / inspects every layer',
    accent: '#fb923c',
    desc: 'The vertical layer. Anything happening in Network, Logic or Storage can show up here: browser debug, HAR, logs, secrets and developer utilities.',
    flow: ['capture', 'inspect', 'diagnose', 'fix'],
    tools: [
      { id: 'browser', icon: Bug, title: 'Browser Debug', desc: 'Chrome DevTools Protocol, network capture, console and page context.', foot: 'unique pillar' },
      { id: 'har', icon: BarChart2, title: 'HAR Viewer', desc: 'Import captures, inspect waterfalls and create requests or mocks.', foot: 'traffic evidence' },
      { id: 'observe', icon: Activity, title: 'Trace Waterfall', desc: 'Read local JSONL logs, inspect traces and filter correlated events.', foot: 'local logs' },
      { id: 'history', icon: Clock, title: 'Request History', desc: 'Search saved responses and reopen a previous HTTP request with its captured result.', foot: 'local evidence' },
      { id: 'secretscanner', icon: Shield, title: 'Secret Scanner', desc: 'Scan workspaces for tokens, API keys and high entropy strings.', foot: 'safety pass' },
      { id: 'jsontools', icon: Braces, title: 'JSON Tools', desc: 'Query, format, diff and inspect JSON with tree views.', foot: 'data analysis' },
      { id: 'xmltools', icon: FileCode, title: 'XML Tools', desc: 'Format, diff, XPath query and encode XML entities.', foot: 'legacy data' },
      { id: 'utils', icon: Code2, title: 'Power Tools', desc: 'Base64, URL codecs, JWT inspector, UUIDs, hashes and more.', foot: 'daily utilities' },
      { id: 'dockerlab', icon: Container, title: 'Docker Lab', desc: 'Generate local compose labs and open matching tools.', foot: 'local infra' },
    ],
  },
]

function countRequests(nodes: TreeNode[]): number {
  return nodes.reduce((total, node) => total + (node.type === 'folder' ? countRequests(node.children) : 1), 0)
}

export function WelcomePanel() {
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const port = useServerPort()
  const mockRunning = useAppStore((s) => s.mockRunning)
  const proxyRunning = useAppStore((s) => s.proxyRunning)
  const websocketRunning = useAppStore((s) => s.websocketRunning)
  const sseRunning = useAppStore((s) => s.sseRunning)
  const browserRunning = useAppStore((s) => s.browserRunning)
  const collections = useCollectionsStore((s) => s.collections)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const tabs = useTabsStore((s) => s.tabs)
  const responseHistory = useTabsStore((s) => s.responseHistory)
  const [openLayers, setOpenLayers] = useState<Set<LayerId>>(() => new Set())
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>(loadRecentWorkspaces)
  const [workspaceLoading, setWorkspaceLoading] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState('')
  const legacyTheme = useSettingsStore((s) => s.settings.appearance.theme)
  const themes = useThemesStore((s) => s.themes)
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  const activeTheme = themes.find((t) => t.id === activeThemeId)
  const isLight = activeTheme ? inferThemeMode(activeTheme) === 'light' : legacyTheme === 'light'
  const appIcon = useAppIcon()
  const requestCount = useMemo(
    () => collections.reduce((total, collection) => total + countRequests(collection.children), 0),
    [collections],
  )
  const activeEnvironment = environments.find((environment) => environment.id === activeEnvId)
  const runningServices = [
    mockRunning && 'Mock',
    proxyRunning && 'Proxy',
    websocketRunning && 'WebSocket',
    sseRunning && 'SSE',
    browserRunning && 'Browser Debug',
  ].filter(Boolean) as string[]
  const runningServiceCount = runningServices.length
  const layerStats: Record<LayerId, HubLayer['stats']> = {
    network: [
      { value: String(requestCount), label: 'requests', live: true },
      { value: String(tabs.length), label: 'open tabs' },
      { value: activeEnvironment?.name ?? 'none', label: 'active env' },
    ],
    logic: [
      { value: String(runningServiceCount), label: 'services live', live: runningServiceCount > 0 },
      { value: mockRunning ? 'running' : 'idle', label: 'mock', live: mockRunning },
      { value: proxyRunning ? 'running' : 'idle', label: 'proxy', live: proxyRunning },
    ],
    storage: [
      { value: String(collections.length), label: 'collections', live: true },
      { value: String(environments.length), label: 'environments' },
      { value: activeEnvironment ? 'selected' : 'none', label: 'active env' },
    ],
    observability: [
      { value: String(responseHistory.length), label: 'saved responses', live: responseHistory.length > 0 },
      { value: browserRunning ? 'live' : 'idle', label: 'browser debug', live: browserRunning },
      { value: '0', label: 'telemetry' },
    ],
  }

  const toggleLayer = (id: LayerId) => {
    setOpenLayers((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openRecentWorkspace = async (workspace: RecentWorkspace) => {
    const url = serverUrl(port, `/workspace/load?name=${encodeURIComponent(workspace.name)}`)
    if (!url) {
      setWorkspaceError('Workspace backend is not ready yet.')
      return
    }
    setWorkspaceLoading(workspace.name)
    setWorkspaceError('')
    try {
      const response = await sidecarFetch(url)
      const text = await response.text()
      if (!response.ok) throw new Error(text || response.statusText)
      await applyWorkspaceState((text ? JSON.parse(text) : {}) as WorkspaceState)
      setRecentWorkspaces(rememberRecentWorkspace(workspace))
      setActiveRail('collections')
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkspaceLoading(null)
    }
  }

  return (
    <div
      className="relative flex-1 overflow-auto bg-surface-0 text-text-1 select-none"
      style={{
        background: isLight
          ? 'radial-gradient(900px 600px at 88% 8%, rgba(124,58,237,.06), transparent 55%), radial-gradient(700px 500px at 4% 92%, rgba(91,33,182,.04), transparent 55%), var(--color-surface-0)'
          : 'radial-gradient(900px 600px at 88% 8%, rgba(124,58,237,.16), transparent 55%), radial-gradient(700px 500px at 4% 92%, rgba(91,33,182,.13), transparent 55%), #07050b',
      }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ opacity: isLight ? 0.22 : 0.4 }}>
        <div className="absolute inset-0" style={{
          background: isLight
            ? 'linear-gradient(118deg, transparent 0 38%, rgba(124,58,237,.15) 38.2%, transparent 38.6%), linear-gradient(118deg, transparent 0 62%, rgba(124,58,237,.08) 62.2%, transparent 62.5%)'
            : 'linear-gradient(118deg, transparent 0 38%, rgba(183,148,255,.38) 38.2%, transparent 38.6%), linear-gradient(118deg, transparent 0 62%, rgba(183,148,255,.2) 62.2%, transparent 62.5%)',
          maskImage: 'linear-gradient(180deg, transparent 0, #000 12%, #000 78%, transparent 100%)',
        }} />
      </div>

      <div className="relative z-10 mx-auto max-w-[1280px] px-8 py-7">
        <main className="min-w-0">
          <header className="relative mb-5 flex min-h-[200px] items-center gap-6 border-b border-dashed border-border-2 pb-5 lg:pr-[310px]">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                <Layers size={12} />
                Local developer toolbox
              </div>
              <h1 className="m-0 font-sans text-[34px] font-semibold leading-none tracking-[-0.02em] text-text-1">
                Build, test and debug APIs from one private desktop workspace.
              </h1>
              <p className="mt-3 max-w-2xl font-mono text-[12px] leading-relaxed text-text-3">
                adOmnia brings API clients, mocks, brokers, proxy inspection, browser debugging and local data tools into a single offline-first environment. Your collections, secrets, traffic captures and workspaces stay on your machine.
              </p>
              <div className="mt-5 hidden items-center gap-3 xl:flex">
                <MetricPill label="collections" value={String(collections.length)} />
                <MetricPill label="requests" value={String(requestCount)} />
                <MetricPill label="environments" value={String(environments.length)} />
                <MetricPill label="services live" value={String(runningServiceCount)} />
              </div>
            </div>

            <div className="pointer-events-none absolute right-0 top-1/2 hidden -translate-y-1/2 h-[280px] w-[290px] place-items-center lg:grid">
              {isLight ? (
                <>
                  <div className="absolute inset-0 rounded-full bg-violet-500/10 blur-[56px]" />
                  <div className="absolute h-[210px] w-[210px] rounded-full bg-violet-400/8 blur-2xl" />
                  <div
                    className="absolute h-[252px] w-[252px] animate-spin rounded-full border border-violet-300/18"
                    style={{ animationDuration: '20s' }}
                  />
                  <div
                    className="absolute h-[224px] w-[224px] animate-spin rounded-full border border-violet-400/10"
                    style={{ animationDuration: '14s', animationDirection: 'reverse' }}
                  />
                  <div className="absolute h-[160px] w-[160px] rounded-full border border-violet-300/12 bg-violet-300/[0.05] blur-sm" />
                  <div className="absolute h-[120px] w-[120px] rounded-full bg-surface-0/80 backdrop-blur-sm" />
                </>
              ) : (
                <>
                  <div className="absolute inset-0 rounded-full bg-violet-600/25 blur-[56px]" />
                  <div className="absolute h-[210px] w-[210px] rounded-full bg-violet-500/20 blur-2xl" />
                  <div
                    className="absolute h-[252px] w-[252px] animate-spin rounded-full border border-violet-300/20"
                    style={{ animationDuration: '20s' }}
                  />
                  <div
                    className="absolute h-[224px] w-[224px] animate-spin rounded-full border border-violet-400/12"
                    style={{ animationDuration: '14s', animationDirection: 'reverse' }}
                  />
                  <div className="absolute h-[160px] w-[160px] rounded-full border border-violet-200/15 bg-violet-300/[0.07] blur-sm" />
                </>
              )}
              <img
                src={appIcon}
                alt="adOmnia"
                className="icon-glow-breathe relative z-10 h-[215px] w-[215px] object-contain"
              />
            </div>
          </header>

          <section className="mb-5 overflow-hidden rounded-2xl border border-border-1 bg-surface-1 shadow-lg shadow-black/5">
            <div className="flex items-center justify-between gap-4 border-b border-border-1 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-accent" />
                <div>
                  <h2 className="text-sm font-semibold text-text-1">Recent Workspaces</h2>
                  <p className="font-mono text-[10px] text-text-4">Reopen a local workspace without hunting through menus.</p>
                </div>
              </div>
              <button
                onClick={() => setActiveRail('workspace')}
                className="flex items-center gap-1 rounded-lg border border-border-2 px-3 py-1.5 text-[11px] font-medium text-text-3 transition-colors hover:border-accent/40 hover:text-text-1"
              >
                Manage <ArrowRight size={11} />
              </button>
            </div>
            {recentWorkspaces.length === 0 ? (
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <p className="font-mono text-[11px] text-text-4">No recently opened workspaces. Load one once and it will stay within reach here.</p>
                <button
                  onClick={() => setActiveRail('workspace')}
                  className="shrink-0 rounded-lg bg-accent/12 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                >
                  Open Workspaces
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
                {recentWorkspaces.slice(0, 3).map((workspace) => (
                  <button
                    key={workspace.name}
                    onClick={() => void openRecentWorkspace(workspace)}
                    disabled={workspaceLoading !== null}
                    className="group flex min-w-0 items-center gap-3 rounded-xl border border-border-1 bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent/35 hover:bg-surface-3 disabled:opacity-55"
                  >
                    <FolderOpen size={16} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-xs font-semibold text-text-1">{workspace.name}</b>
                      <span className="block truncate font-mono text-[10px] text-text-4">
                        {workspaceLoading === workspace.name
                          ? 'Opening workspace...'
                          : `${workspace.tabs} tab${workspace.tabs === 1 ? '' : 's'} / opened ${new Date(workspace.openedAt).toLocaleString()}`}
                      </span>
                    </span>
                    <ArrowRight size={12} className="shrink-0 text-text-4 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                  </button>
                ))}
              </div>
            )}
            {workspaceError && (
              <div className="border-t border-error/20 bg-error/10 px-5 py-2 text-[11px] text-error">{workspaceError}</div>
            )}
          </section>

          <div className="flex flex-col gap-3">
            {HUB_LAYERS.map((layer) => (
              <LayerBand
                key={layer.id}
                layer={{ ...layer, stats: layerStats[layer.id] }}
                open={openLayers.has(layer.id)}
                onToggle={() => toggleLayer(layer.id)}
                onOpenTool={setActiveRail}
                isLight={isLight}
              />
            ))}
          </div>

          <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-1 pt-4 font-mono text-[10px] text-text-4">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]" />
              Ready
            </span>
            <span className="h-3 w-px bg-border-2" />
            <span>stack mode: <b className="text-text-2">layers</b></span>
            <span className="h-3 w-px bg-border-2" />
            <span>{runningServices.length > 0 ? `${runningServices.join(', ')} running locally` : 'no local services running'}</span>
            <span className="ml-auto hidden text-text-4 md:inline">local-first / no account / no telemetry</span>
          </footer>
        </main>
      </div>
    </div>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-border-1 bg-surface-1 px-3 py-1.5 font-mono">
      <span className="mr-2 text-[10px] uppercase tracking-[0.12em] text-text-4">{label}</span>
      <b className="text-[11px] text-text-2">{value}</b>
    </div>
  )
}

function LayerBand({
  layer,
  open,
  onToggle,
  onOpenTool,
  isLight,
}: {
  layer: HubLayer
  open: boolean
  onToggle: () => void
  onOpenTool: (id: RailItem) => void
  isLight: boolean
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border shadow-lg transition-colors',
        isLight
          ? 'bg-surface-1 shadow-black/5'
          : 'bg-surface-1 shadow-[0_24px_60px_-38px_rgba(0,0,0,.75)]',
      )}
      style={{ borderColor: open ? `${layer.accent}55` : `var(--color-border-2)` }}
    >
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: layer.accent }} />
      <button
        onClick={onToggle}
        className={cn(
          'grid w-full grid-cols-[70px_minmax(180px,240px)_1fr_32px] items-center gap-4 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset max-lg:grid-cols-[58px_1fr_32px] hover:bg-surface-2/60',
        )}
        style={{ ['--tw-ring-color' as string]: `${layer.accent}88` }}
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
          {layer.index.split('/')[0]} / <b style={{ color: layer.accent }}>{layer.index.split('/')[1]?.trim()}</b>
        </div>
        <div className="min-w-0">
          <p className="font-sans text-[18px] font-semibold uppercase tracking-[0.06em] text-text-1">{layer.title}</p>
          <p className="mt-0.5 font-mono text-[10.5px] text-text-3">{layer.tag}</p>
        </div>
        <div className="flex items-center gap-6 max-lg:hidden">
          {layer.stats.map((stat) => (
            <div key={stat.label} className="font-mono">
              <b className={cn('block text-[13px] font-semibold', stat.live ? '' : 'text-text-2')} style={stat.live ? { color: layer.accent } : undefined}>
                {stat.value}
              </b>
              <span className="text-[9px] uppercase tracking-[0.12em] text-text-4">{stat.label}</span>
            </div>
          ))}
        </div>
        <ChevronDown
          size={16}
          className={cn('justify-self-end text-text-4 transition-transform', !open && '-rotate-90')}
        />
      </button>

      <div className={cn('grid overflow-hidden transition-all duration-300 ease-out', open ? 'max-h-[960px] opacity-100' : 'max-h-0 opacity-0')}>
        <div className="grid grid-cols-[296px_1fr] border-t border-border-2 max-xl:grid-cols-1">
          <aside className={cn(
            'border-r border-dashed border-border-1 p-5 max-xl:border-b max-xl:border-r-0',
            isLight ? 'bg-surface-0/50' : 'bg-surface-2',
          )}>
            <p className="font-mono text-[11px] leading-relaxed text-text-3">{layer.desc}</p>
            <div className="mt-4 rounded-xl border border-border-1 bg-surface-2 p-3 font-mono text-[10px] text-text-4">
              {layer.flow.map((step, index) => (
                <span key={step}>
                  <b style={{ color: layer.accent }}>{step}</b>
                  {index < layer.flow.length - 1 && <span className="px-1 text-text-4">-&gt;</span>}
                </span>
              ))}
            </div>
          </aside>

          <div className="grid grid-cols-2 gap-3 p-4 2xl:grid-cols-4">
            {layer.tools.map((tool) => (
              <ToolTile key={tool.id} tool={tool} accent={layer.accent} isLight={isLight} onClick={() => onOpenTool(tool.id)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ToolTile({ tool, accent, isLight, onClick }: { tool: HubTool; accent: string; isLight: boolean; onClick: () => void }) {
  const Icon = tool.icon

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex min-h-[132px] flex-col rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-1',
        isLight
          ? 'bg-surface-1 border-border-1 hover:bg-surface-2 hover:border-accent/30 shadow-sm'
          : 'bg-surface-2 border-border-2 hover:bg-surface-3',
      )}
      style={{ ['--tile-accent' as string]: accent, ['--tw-ring-color' as string]: `${accent}88` }}
      onMouseEnter={(event) => { event.currentTarget.style.borderColor = `${accent}55` }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = isLight ? 'var(--color-border-1)' : 'var(--color-border-2)'
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg border" style={{ color: accent, borderColor: `${accent}33`, background: `${accent}18` }}>
          <Icon size={15} />
        </span>
        <h3 className="font-sans text-[14px] font-semibold text-text-1">{tool.title}</h3>
      </div>
      <p className="line-clamp-3 flex-1 font-mono text-[10.5px] leading-relaxed text-text-3">{tool.desc}</p>
      <div className="mt-3 flex items-center justify-between border-t border-border-2 pt-3 font-mono text-[10px]">
        <span className="text-text-4">{tool.foot}</span>
        <b style={{ color: accent }}>open -&gt;</b>
      </div>
    </button>
  )
}

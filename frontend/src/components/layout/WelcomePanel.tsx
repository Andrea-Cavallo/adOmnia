import { useState } from 'react'
import {
  Activity,
  BarChart2,
  Braces,
  Bug,
  ChevronDown,
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
import { cn } from '@/lib/utils'

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

const HUB_LAYERS: HubLayer[] = [
  {
    id: 'network',
    index: 'L1 / 04',
    title: 'Network',
    tag: 'transport / protocols / wire format',
    accent: '#b794ff',
    stats: [
      { value: 'REST', label: 'http core', live: true },
      { value: '04', label: 'protocols' },
      { value: '<30ms', label: 'local UX' },
    ],
    desc: 'Everything that speaks over the wire. Compose requests, inspect frames and work with REST, SOAP, gRPC and streaming from one desktop surface.',
    flow: ['request', 'auth', 'transport', 'response'],
    tools: [
      { id: 'collections', icon: Network, title: 'API Workspace', desc: 'REST, HTTP and GraphQL with collections, scripts, environments and assertions.', foot: 'core workflow' },
      { id: 'soap', icon: FileCode, title: 'SOAP Studio', desc: 'WSDL parser, envelope builder, XML tools and WS-Security workflows.', foot: 'enterprise ready' },
      { id: 'grpc', icon: Send, title: 'gRPC Client', desc: 'Server reflection, metadata, TLS and unary service invocation.', foot: 'service calls' },
      { id: 'websocket', icon: Zap, title: 'Streaming', desc: 'WebSocket and Server-Sent Events with live frame inspection.', foot: 'realtime' },
    ],
  },
  {
    id: 'logic',
    index: 'L2 / 05',
    title: 'Logic',
    tag: 'route / transform / simulate / verify',
    accent: '#6ee7b7',
    stats: [
      { value: '5', label: 'engines', live: true },
      { value: '0', label: 'cloud deps' },
      { value: '100%', label: 'local' },
    ],
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
    stats: [
      { value: '5', label: 'stores', live: true },
      { value: '.adomnia', label: 'portable' },
      { value: 'age', label: 'vault' },
    ],
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
    stats: [
      { value: 'live', label: 'debug', live: true },
      { value: 'HAR', label: 'captures' },
      { value: '0', label: 'telemetry' },
    ],
    desc: 'The vertical layer. Anything happening in Network, Logic or Storage can show up here: browser debug, HAR, logs, secrets and developer utilities.',
    flow: ['capture', 'inspect', 'diagnose', 'fix'],
    tools: [
      { id: 'browser', icon: Bug, title: 'Browser Debug', desc: 'Chrome DevTools Protocol, network capture, console and page context.', foot: 'unique pillar' },
      { id: 'har', icon: BarChart2, title: 'HAR Viewer', desc: 'Import captures, inspect waterfalls and create requests or mocks.', foot: 'traffic evidence' },
      { id: 'observe', icon: Activity, title: 'Trace Waterfall', desc: 'Read local JSONL logs, inspect traces and filter correlated events.', foot: 'local logs' },
      { id: 'secretscanner', icon: Shield, title: 'Secret Scanner', desc: 'Scan workspaces for tokens, API keys and high entropy strings.', foot: 'safety pass' },
      { id: 'jsontools', icon: Braces, title: 'JSON Tools', desc: 'Query, format, diff and inspect JSON with tree views.', foot: 'data analysis' },
      { id: 'xmltools', icon: FileCode, title: 'XML Tools', desc: 'Format, diff, XPath query and encode XML entities.', foot: 'legacy data' },
      { id: 'utils', icon: Code2, title: 'Power Tools', desc: 'Base64, URL codecs, JWT inspector, UUIDs, hashes and more.', foot: 'daily utilities' },
      { id: 'dockerlab', icon: Container, title: 'Docker Lab', desc: 'Generate local compose labs and open matching tools.', foot: 'local infra' },
    ],
  },
]

export function WelcomePanel() {
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const [openLayers, setOpenLayers] = useState<Set<LayerId>>(() => new Set())

  const toggleLayer = (id: LayerId) => {
    setOpenLayers((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className="relative flex-1 overflow-auto bg-[#07050b] text-[#f4f1fb] select-none"
      style={{
        background:
          'radial-gradient(900px 600px at 88% 8%, rgba(124,58,237,.16), transparent 55%), radial-gradient(700px 500px at 4% 92%, rgba(91,33,182,.13), transparent 55%), #07050b',
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-0" style={{
          background:
            'linear-gradient(118deg, transparent 0 38%, rgba(183,148,255,.38) 38.2%, transparent 38.6%), linear-gradient(118deg, transparent 0 62%, rgba(183,148,255,.2) 62.2%, transparent 62.5%)',
          maskImage: 'linear-gradient(180deg, transparent 0, #000 12%, #000 78%, transparent 100%)',
        }} />
      </div>

      <div className="relative z-10 mx-auto max-w-[1280px] px-8 py-7">
        <main className="min-w-0">
          <header className="relative mb-5 flex min-h-[168px] items-start gap-6 border-b border-dashed border-white/10 pb-5 lg:pr-[230px]">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200">
                <Layers size={12} />
                Local developer toolbox
              </div>
              <h1 className="m-0 font-sans text-[34px] font-semibold leading-none tracking-[-0.02em] text-white">
                Build, test and debug APIs from one private desktop workspace.
              </h1>
              <p className="mt-3 max-w-2xl font-mono text-[12px] leading-relaxed text-white/55">
                adOmnia brings API clients, mocks, brokers, proxy inspection, browser debugging and local data tools into a single offline-first environment. Your collections, secrets, traffic captures and workspaces stay on your machine.
              </p>
              <div className="mt-5 hidden items-center gap-3 xl:flex">
                <MetricPill label="modules" value="28" />
                <MetricPill label="features" value="444+" />
                <MetricPill label="cloud sync" value="0" />
              </div>
            </div>
            <div className="pointer-events-none absolute right-0 top-[-10px] hidden h-[190px] w-[210px] place-items-center lg:grid">
              <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-3xl" />
              <div className="absolute h-[128px] w-[128px] rounded-full border border-violet-200/15 bg-violet-300/10 blur-sm" />
              <img
                src="/icon.png"
                alt=""
                className="relative h-[170px] w-[170px] object-contain drop-shadow-[0_0_28px_rgba(168,85,247,.65)]"
              />
            </div>
          </header>

          <div className="flex flex-col gap-3">
            {HUB_LAYERS.map((layer) => (
              <LayerBand
                key={layer.id}
                layer={layer}
                open={openLayers.has(layer.id)}
                onToggle={() => toggleLayer(layer.id)}
                onOpenTool={setActiveRail}
              />
            ))}
          </div>

          <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 font-mono text-[10px] text-white/38">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]" />
              Ready
            </span>
            <span className="h-3 w-px bg-white/10" />
            <span>stack mode: <b className="text-white/70">layers</b></span>
            <span className="h-3 w-px bg-white/10" />
            <span>select a layer to open its tools</span>
            <span className="ml-auto hidden text-white/30 md:inline">local-first / no account / no telemetry</span>
          </footer>
        </main>
      </div>
    </div>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono">
      <span className="mr-2 text-[10px] uppercase tracking-[0.12em] text-white/35">{label}</span>
      <b className="text-[11px] text-white/75">{value}</b>
    </div>
  )
}

function LayerBand({
  layer,
  open,
  onToggle,
  onOpenTool,
}: {
  layer: HubLayer
  open: boolean
  onToggle: () => void
  onOpenTool: (id: RailItem) => void
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border bg-[#16121f]/88 shadow-[0_24px_60px_-38px_rgba(0,0,0,.75)] transition-colors"
      style={{ borderColor: open ? `${layer.accent}55` : 'rgba(255,255,255,.07)' }}
    >
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: layer.accent }} />
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-[70px_minmax(180px,240px)_1fr_32px] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.025] focus:outline-none focus-visible:ring-1 focus-visible:ring-inset max-lg:grid-cols-[58px_1fr_32px]"
        style={{ ['--tw-ring-color' as string]: `${layer.accent}88` }}
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/25">
          {layer.index.split('/')[0]} / <b style={{ color: layer.accent }}>{layer.index.split('/')[1]?.trim()}</b>
        </div>
        <div className="min-w-0">
          <p className="font-sans text-[18px] font-semibold uppercase tracking-[0.06em] text-white">{layer.title}</p>
          <p className="mt-0.5 font-mono text-[10.5px] text-white/45">{layer.tag}</p>
        </div>
        <div className="flex items-center gap-6 max-lg:hidden">
          {layer.stats.map((stat) => (
            <div key={stat.label} className="font-mono">
              <b className={cn('block text-[13px] font-semibold', stat.live ? '' : 'text-white/80')} style={stat.live ? { color: layer.accent } : undefined}>
                {stat.value}
              </b>
              <span className="text-[9px] uppercase tracking-[0.12em] text-white/32">{stat.label}</span>
            </div>
          ))}
        </div>
        <ChevronDown
          size={16}
          className={cn('justify-self-end text-white/35 transition-transform', !open && '-rotate-90')}
        />
      </button>

      <div className={cn('grid overflow-hidden transition-all duration-300 ease-out', open ? 'max-h-[620px] opacity-100' : 'max-h-0 opacity-0')}>
        <div className="grid grid-cols-[296px_1fr] border-t border-white/[0.06] max-xl:grid-cols-1">
          <aside className="border-r border-dashed border-white/10 bg-white/[0.015] p-5 max-xl:border-b max-xl:border-r-0">
            <p className="font-mono text-[11px] leading-relaxed text-white/55">{layer.desc}</p>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-white/35">
              {layer.flow.map((step, index) => (
                <span key={step}>
                  <b style={{ color: layer.accent }}>{step}</b>
                  {index < layer.flow.length - 1 && <span className="px-1 text-white/20">-&gt;</span>}
                </span>
              ))}
            </div>
          </aside>

          <div className="grid grid-cols-2 gap-3 p-4 2xl:grid-cols-4">
            {layer.tools.map((tool) => (
              <ToolTile key={tool.id} tool={tool} accent={layer.accent} onClick={() => onOpenTool(tool.id)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ToolTile({ tool, accent, onClick }: { tool: HubTool; accent: string; onClick: () => void }) {
  const Icon = tool.icon

  return (
    <button
      onClick={onClick}
      className="group flex min-h-[132px] flex-col rounded-xl border border-white/[0.07] bg-[#110d1a]/90 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-[#1c1729] focus:outline-none focus-visible:ring-1"
      style={{ ['--tile-accent' as string]: accent, ['--tw-ring-color' as string]: `${accent}88` }}
      onMouseEnter={(event) => { event.currentTarget.style.borderColor = `${accent}55` }}
      onMouseLeave={(event) => { event.currentTarget.style.borderColor = 'rgba(255,255,255,.07)' }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg border" style={{ color: accent, borderColor: `${accent}33`, background: `${accent}18` }}>
          <Icon size={15} />
        </span>
        <h3 className="font-sans text-[14px] font-semibold text-white">{tool.title}</h3>
      </div>
      <p className="line-clamp-3 flex-1 font-mono text-[10.5px] leading-relaxed text-white/48">{tool.desc}</p>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3 font-mono text-[10px]">
        <span className="text-white/30">{tool.foot}</span>
        <b style={{ color: accent }}>open -&gt;</b>
      </div>
    </button>
  )
}

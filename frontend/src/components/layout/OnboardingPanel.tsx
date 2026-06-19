import { useAppStore, type RailItem } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { useCollectionsStore, migrateCollections } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { createAdomniaLabWorkspace } from '@/lib/adomniaLabWorkspace'
import { useServerPort, serverUrl } from '@/lib/useServerPort'
import {
  LayoutList, Radio, Shield, Server, Send, Bug, Braces, FileCode, Wrench, Lock,
  Database, FileText, GitBranch, ArrowRight, FileDown, Download, Keyboard,
  Container, Zap, BarChart2, Puzzle,
  Code2, Layers, Box, Activity, HardDrive,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeSetItem } from '@/lib/safeLocalStorage'

export const ONBOARDED_KEY = 'adomnia.onboarded'

type ToolStatus = 'Stable' | 'Beta' | 'Preview' | 'Unique'

type ToolDef = {
  id: RailItem
  icon: React.ElementType
  color: string
  label: string
  desc: string
  status: ToolStatus
}

// ─── Tool catalogue ────────────────────────────────────────────────────────

const COLLECTIONS: ToolDef = {
  id: 'collections', icon: LayoutList, color: '#60a5fa', status: 'Stable',
  label: 'API Workspace',
  desc: 'Build and send requests with folders, variables, auth, pre/post scripts and response assertions.',
}

const API_CORE: ToolDef[] = [
  { id: 'flows',    icon: GitBranch,   color: '#c084fc', status: 'Stable',  label: 'Flows',              desc: 'Generate executable API flows from Mermaid diagrams with conditions and run reports.' },
]

const PROTOCOLS: ToolDef[] = [
  { id: 'grpc',      icon: Send,     color: '#a78bfa', status: 'Stable', label: 'gRPC Client',    desc: 'Call services via reflection with unary, server, client and bidirectional streaming.' },
  { id: 'soap',      icon: FileCode, color: '#38bdf8', status: 'Stable', label: 'SOAP Studio',    desc: 'SOAP, WSDL and XML workflows with WS-Security support.' },
  { id: 'websocket', icon: Zap,      color: '#22c55e', status: 'Stable', label: 'WebSocket',      desc: 'Open live sockets, send messages and inspect frames.' },
  { id: 'sse',       icon: Radio,    color: '#fb7185', status: 'Stable', label: 'SSE Client',     desc: 'Subscribe to event streams, filter by type and export JSONL.' },
  { id: 'broker',    icon: Radio,    color: '#fb923c', status: 'Stable', label: 'Broker Studio',  desc: 'Kafka, RabbitMQ, MQTT, Redis Pub/Sub and NATS in one console.' },
]

const INFRA: ToolDef[] = [
  { id: 'mock',      icon: Server,    color: '#4ade80', status: 'Stable', label: 'Mock Server',        desc: 'Stub endpoints with templated responses, path params and hit logs.' },
  { id: 'proxy',     icon: Shield,    color: '#facc15', status: 'Stable', label: 'Proxy Interceptor',  desc: 'Capture, inspect and rewrite traffic. Map remote calls locally.' },
]

const DEBUG: ToolDef[] = [
  { id: 'browser',   icon: Bug,       color: '#f472b6', status: 'Unique',   label: 'Browser Debug',  desc: 'Attach to running browsers, inspect pages like F12 — network, console, DOM, storage.' },
]

const POWER: ToolDef[] = [
  { id: 'jsontools', icon: Braces,    color: '#34d399', status: 'Stable',   label: 'JSON Tools',     desc: 'Query, format, diff and inspect JSON with tree views.' },
  { id: 'xmltools',  icon: FileCode,  color: '#fbbf24', status: 'Stable',   label: 'XML Tools',      desc: 'Format, diff, XPath query and encode XML entities.' },
  { id: 'utils',     icon: Wrench,    color: '#f87171', status: 'Stable',   label: 'Power Tools',    desc: 'Base64, URL codecs, JWT inspector, UUIDs, hashes and more.' },
  { id: 'dockerlab', icon: Container, color: '#0ea5e9', status: 'Stable', label: 'Docker Lab',       desc: 'Generate local compose labs and open matching Database or Broker tooling.' },
  { id: 'har',       icon: BarChart2, color: '#f97316', status: 'Stable',   label: 'HAR Viewer',     desc: 'Import HAR, compare captures, inspect waterfalls, and create requests or mocks.' },
  { id: 'observe',   icon: Activity,  color: '#38bdf8', status: 'Stable',   label: 'Observability',  desc: 'Read local JSONL logs, inspect trace waterfalls and filter correlated requests.' },
  { id: 'secretscanner', icon: Shield, color: '#ef4444', status: 'Stable', label: 'Secret Scanner', desc: 'Scan workspace for exposed secrets: API keys, tokens, passwords, high-entropy strings.' },
]

const DATA: ToolDef[] = [
  { id: 'database',  icon: Database,    color: '#6366f1', status: 'Stable',  label: 'Database Studio',    desc: 'SQLite, PostgreSQL, MySQL and MongoDB with history and export.' },
  { id: 'vault',     icon: Lock,        color: '#eab308', status: 'Stable',  label: 'Vault',              desc: 'Encrypt local secrets and workspace exports with age/scrypt.' },
  { id: 'storage',   icon: Database,    color: '#94a3b8', status: 'Stable',  label: 'Storage Inspector',  desc: 'Browse, edit, search, export and import raw local storage with warnings.' },
  { id: 'markdown',  icon: FileText,    color: '#a3a3a3', status: 'Stable',  label: 'Document Studio',     desc: 'Write Markdown notes, render Mermaid diagrams, draft LaTeX CVs and edit or sign PDFs locally.' },
]

const EXT: ToolDef[] = [
  { id: 'plugins', icon: Puzzle, color: '#f59e0b', status: 'Stable', label: 'Plugins', desc: 'WASM and JS plugin manifests with hooks, storage and local extension points.' },
]

// ─── Status badge styles ───────────────────────────────────────────────────

const STATUS_BADGE: Record<ToolStatus, string> = {
  Stable:  'text-success  border-success/25  bg-success/10',
  Beta:    'text-warning  border-warning/25  bg-warning/10',
  Preview: 'text-text-3   border-border-2    bg-surface-2',
  Unique:  'text-accent   border-accent/30   bg-accent/10',
}

const SHORTCUTS = [
  { keys: ['Ctrl', 'N'],     label: 'New request' },
  { keys: ['Ctrl', 'Enter'], label: 'Send' },
  { keys: ['Ctrl', 'K'],     label: 'Import / export' },
  { keys: ['Alt', '←'],      label: 'Back' },
]

// ─── Sub-components ────────────────────────────────────────────────────────

function SectionHeader({ letter, icon: Icon, title, count }: {
  letter: string
  icon: React.ElementType
  title: string
  count: number
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/10 font-mono text-[10px] font-bold leading-none text-accent">
        {letter}
      </span>
      <Icon size={11} className="flex-shrink-0 text-text-3" />
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-3">{title}</span>
      <div className="h-px flex-1 bg-border-2" />
      <span className="rounded border border-border-2 bg-surface-2 px-1.5 py-0.5 text-[9px] tabular-nums text-text-4">{count}</span>
    </div>
  )
}

function FeaturedCard({ tool, onClick }: { tool: ToolDef; onClick: () => void }) {
  const { icon: Icon, color, label, desc } = tool
  return (
    <button
      onClick={onClick}
      className="group relative row-span-2 flex flex-col overflow-hidden rounded-xl text-left transition-all"
      style={{ border: `1px solid ${color}28`, background: `linear-gradient(140deg, ${color}18 0%, var(--color-surface-1) 52%)` }}
    >
      {/* Radial glow blob */}
      <div
        className="pointer-events-none absolute -left-8 -top-8 h-44 w-44 rounded-full blur-3xl"
        style={{ background: `${color}20` }}
      />

      <div className="relative flex flex-1 flex-col gap-4 p-5">
        {/* Icon */}
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${color}20` }}
        >
          <Icon size={24} style={{ color }} />
        </div>

        {/* Text */}
        <div className="flex-1">
          <p className="mb-1.5 text-[15px] font-bold leading-tight text-text-1">{label}</p>
          <p className="text-[11px] leading-relaxed text-text-4">{desc}</p>
        </div>

        {/* CTA pill */}
        <span
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all group-hover:brightness-125"
          style={{ borderColor: `${color}40`, background: `${color}14`, color }}
        >
          Open workspace
          <ArrowRight size={11} />
        </span>
      </div>
    </button>
  )
}

function ToolCard({ tool, onClick, topAccent = false }: {
  tool: ToolDef
  onClick: () => void
  topAccent?: boolean
}) {
  const { icon: Icon, color, label, desc, status } = tool
  const isUnique = status === 'Unique'

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-2.5 rounded-xl border p-3.5 text-left transition-all',
        isUnique
          ? 'border-accent/25 bg-accent/5 hover:border-accent/40 hover:bg-accent/8'
          : 'border-border-2 bg-surface-1 hover:border-accent/25 hover:bg-surface-2',
      )}
      style={topAccent ? { borderTop: `2px solid ${color}55` } : undefined}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${color}22` }}
        >
          <Icon size={16} style={{ color }} />
        </div>
        {status !== 'Stable' && (
          <span className={cn('flex-shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold', STATUS_BADGE[status])}>
            {status}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-tight text-text-1 transition-colors group-hover:text-accent">
          {label}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-text-4">{desc}</p>
      </div>
    </button>
  )
}

// ─── Main panel ────────────────────────────────────────────────────────────

export function OnboardingPanel() {
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const newTab = useTabsStore((s) => s.newTab)
  const saveEnvironments = useEnvironmentsStore((s) => s.save)
  const port = useServerPort()

  const openTool = (id: RailItem) => {
    safeSetItem(ONBOARDED_KEY, '1')
    setActiveRail(id)
    if (id === 'collections') newTab()
  }

  const loadDemo = async () => {
    const demo = createAdomniaLabWorkspace(serverUrl(port, ''))
    useCollectionsStore.getState().replaceCollections(migrateCollections(demo.collections))
    useEnvironmentsStore.setState({ environments: demo.environments, activeEnvId: demo.activeEnvId, loaded: true })
    await saveEnvironments()
    safeSetItem(ONBOARDED_KEY, '1')
    setActiveRail('collections')
  }

  return (
    <div className="flex-1 overflow-auto relative bg-surface-0">

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-6 py-7">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center border-b border-border-2 pb-6">
          <img
            src="/adOmnia-noback.png"
            alt="adOmnia"
            className="h-20 object-contain"
            draggable={false}
          />
        </div>

        {/* ── A  API Core ────────────────────────────────────────────── */}
        <section>
          <SectionHeader letter="A" icon={Code2} title="API Core" count={2} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-[2fr_1fr_1fr]">
            <FeaturedCard tool={COLLECTIONS} onClick={() => openTool('collections')} />
            {API_CORE.map((t) => <ToolCard key={t.id} tool={t} onClick={() => openTool(t.id)} />)}
          </div>
        </section>

        {/* ── B  Protocols & Streaming ───────────────────────────────── */}
        <section>
          <SectionHeader letter="B" icon={Layers} title="Protocols & Streaming" count={5} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PROTOCOLS.map((t) => <ToolCard key={t.id} tool={t} onClick={() => openTool(t.id)} topAccent />)}
          </div>
        </section>

        {/* ── C + F  Infrastructure  /  Extensibility ────────────────── */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <SectionHeader letter="C" icon={Box} title="Infrastructure & Simulation" count={2} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INFRA.map((t) => <ToolCard key={t.id} tool={t} onClick={() => openTool(t.id)} />)}
            </div>
          </section>
          <section>
            <SectionHeader letter="F" icon={Puzzle} title="Extensibility" count={3} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {EXT.map((t) => <ToolCard key={t.id} tool={t} onClick={() => openTool(t.id)} />)}
            </div>
          </section>
        </div>

        {/* ── D  Debugging ───────────────────────────────────────────── */}
        <section>
          <SectionHeader letter="D" icon={Activity} title="Debugging" count={1} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DEBUG.map((t) => <ToolCard key={t.id} tool={t} onClick={() => openTool(t.id)} />)}
          </div>
        </section>

        {/* ── E  Local Data ──────────────────────────────────────────── */}
        <section>
          <SectionHeader letter="P" icon={Wrench} title="Power Tools" count={7} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {POWER.map((t) => <ToolCard key={t.id} tool={t} onClick={() => openTool(t.id)} />)}
          </div>
        </section>

        <section>
          <SectionHeader letter="E" icon={HardDrive} title="Local Data" count={4} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DATA.map((t) => <ToolCard key={t.id} tool={t} onClick={() => openTool(t.id)} />)}
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 border-t border-border-2 pt-5 lg:grid-cols-[1fr_auto]">
          <div className="flex items-center gap-2 text-text-4">
            <Keyboard size={11} className="flex-shrink-0" />
            <div className="flex flex-wrap items-center gap-4">
              {SHORTCUTS.map(({ keys, label }) => (
                <span key={label} className="flex items-center gap-1 text-[10px]">
                  {keys.map((k) => (
                    <kbd key={k} className="rounded border border-border-2 bg-surface-2 px-1 py-0.5 text-[9px] text-text-3">{k}</kbd>
                  ))}
                  <span>{label}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { localStorage.setItem(ONBOARDED_KEY, '1'); setActiveRail('workspace') }}
              className="flex items-center gap-1.5 rounded-xl border border-border-2 bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-3 transition-colors hover:border-accent/25 hover:text-text-1"
            >
              <Download size={12} />
              Import workspace
            </button>
            <button
              onClick={loadDemo}
              className="flex items-center gap-1.5 rounded-xl border border-dashed border-border-2 bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-3 transition-colors hover:border-accent/30 hover:text-text-1"
            >
              <FileDown size={12} />
              Load demo
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

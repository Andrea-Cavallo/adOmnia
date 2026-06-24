import { useEffect, useMemo, useRef, useState, type ElementType, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Activity,
  BookOpen,
  Braces,
  Bug,
  CircleDot,
  Container,
  Database,
  FileCode,
  FileText,
  GitBranch,
  HardDrive,
  Lock,
  Network,
  PenLine,
  Radio,
  Search,
  Send,
  Server,
  Shield,
  Wrench,
  Zap,
  ChevronDown,
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

type HubTool = {
  id: RailItem
  icon: ElementType
  title: string
  subtitle?: string
  desc: string
  tags?: string[]
  featured?: boolean
  accent?: 'violet' | 'orange'
}

type HubSection = {
  index: string
  title: string
  kicker: string
  accent: 'violet' | 'orange' | 'muted'
  tools: HubTool[]
}

const API_TOOLS: HubTool[] = [
  {
    id: 'collections',
    icon: Send,
    title: 'API Workspace',
    subtitle: 'core workflow',
    desc: 'REST, HTTP and GraphQL collections, scripts, environments and assertions.',
    tags: ['REST', 'GraphQL', 'Auth', 'Tests'],
    featured: true,
  },
  { id: 'soap', icon: FileCode, title: 'SOAP Studio', desc: 'WSDL parser, envelopes, XML tools and WS-Security.', tags: ['WSDL', 'WS-Security'] },
  { id: 'grpc', icon: Network, title: 'gRPC Client', desc: 'Reflection, metadata, TLS and unary or streaming calls.', tags: ['TLS', 'Streaming'] },
  { id: 'mcp', icon: Network, title: 'MCP Client', desc: 'Inspect tools, resources and prompts from MCP servers.', tags: ['AI', 'Tools'] },
  { id: 'websocket', icon: Zap, title: 'Streaming', desc: 'WebSocket and Server-Sent Events with live frames.', tags: ['WS', 'SSE'] },
]

const DOC_TOOLS: HubTool[] = [
  {
    id: 'pdfeditor',
    icon: PenLine,
    title: 'PDF Editor & Sign',
    subtitle: 'flagship document workflow',
    desc: 'Annotate, fill forms, search text, reorder pages, export and apply real cryptographic PDF signatures.',
    tags: ['PKCS#12', 'JKS', 'RFC 3161', 'LTV'],
    featured: true,
  },
  { id: 'latex', icon: FileCode, title: 'LaTeX Studio', desc: 'Resume and CV presets with live A4 preview and .tex export.', tags: ['CV', 'Live preview'] },
  { id: 'markdown', icon: FileText, title: 'Markdown Notes', desc: 'Markdown workspace with backlinks, outline and graph view.', tags: ['Notes', 'Graph'] },
  { id: 'mermaid', icon: GitBranch, title: 'Mermaid Diagrams', desc: 'Flow, sequence and class diagrams from text with colors and export.', tags: ['MMD', 'SVG', 'PNG'] },
  { id: 'apidocs', icon: BookOpen, title: 'API Docs', desc: 'OpenAPI and Swagger documentation viewer.', tags: ['OpenAPI', 'Docs'] },
]

const MORE_SECTIONS: HubSection[] = [
  {
    index: '03',
    title: 'Version Control',
    kicker: 'local-first Git',
    accent: 'orange',
    tools: [
      {
        id: 'gitsync',
        icon: GitBranch,
        title: 'Git Command Center',
        subtitle: 'commit · branch · diff · merge · stash · push',
        desc: 'Compare workspace changes, inspect modified files and synchronize with your repository.',
        tags: ['Diff', 'Commit', 'Push', 'Stash'],
        featured: true,
        accent: 'orange',
      },
    ],
  },
  {
    index: '04',
    title: 'Infra · Debug · Data · Power',
    kicker: 'everything else within reach',
    accent: 'muted',
    tools: [
      { id: 'mock', icon: Server, title: 'Mock Server', desc: 'Stub endpoints and inspect hit logs.' },
      { id: 'proxy', icon: Shield, title: 'Proxy', desc: 'Capture, inspect and rewrite traffic.' },
      { id: 'browser', icon: Bug, title: 'Browser Debug', desc: 'CDP network and console debugging.' },
      { id: 'har', icon: Activity, title: 'HAR Viewer', desc: 'Waterfalls and capture replay.' },
      { id: 'database', icon: Database, title: 'Database', desc: 'SQLite, Postgres, MySQL and MongoDB.' },
      { id: 'vault', icon: Lock, title: 'Vault', desc: 'Encrypted local secrets.' },
      { id: 'flows', icon: GitBranch, title: 'API Flows', desc: 'Executable Mermaid flows.' },
      { id: 'broker', icon: Radio, title: 'Broker Studio', desc: 'Kafka, MQTT, Redis and NATS.' },
      { id: 'storage', icon: HardDrive, title: 'Storage', desc: 'Inspect and repair raw app storage.' },
      { id: 'secretscanner', icon: Shield, title: 'Secret Scanner', desc: 'Find exposed API keys and tokens.' },
      { id: 'jsontools', icon: Braces, title: 'JSON Tools', desc: 'Format, query and diff JSON.' },
      { id: 'xmltools', icon: FileCode, title: 'XML Tools', desc: 'Format, diff and XPath XML.' },
      { id: 'dockerlab', icon: Container, title: 'Docker Lab', desc: 'Generate local compose labs.' },
      { id: 'utils', icon: Wrench, title: 'Power Tools', desc: 'JWT, hashes, codecs and UUIDs.' },
    ],
  },
]

const HUB_SECTIONS: HubSection[] = [
  {
    index: '01',
    title: 'API & Protocols',
    kicker: 'compose / stream / invoke',
    accent: 'violet',
    tools: API_TOOLS,
  },
  {
    index: '02',
    title: 'Documents',
    kicker: 'create / sign / publish',
    accent: 'violet',
    tools: DOC_TOOLS,
  },
  MORE_SECTIONS[0],
  MORE_SECTIONS[1],
]

function countRequests(nodes: TreeNode[]): number {
  return nodes.reduce((total, node) => total + (node.type === 'folder' ? countRequests(node.children) : 1), 0)
}

function themeVars(isLight: boolean) {
  return {
    page: isLight
      ? 'radial-gradient(1100px 720px at 82% -10%, rgba(124,58,237,.16), transparent 58%), linear-gradient(180deg, #f8fafc, #eef2f7)'
      : 'radial-gradient(1100px 720px at 82% -10%, rgba(124,58,237,.18), transparent 58%), #07080d',
    panel: isLight ? 'rgba(255,255,255,.84)' : '#0b0d14',
    card: isLight ? 'linear-gradient(180deg,#ffffff,#f4f7fb)' : 'linear-gradient(180deg,#0f121b,#0b0d13)',
    cardBorder: isLight ? '#d9e1ee' : '#1f2433',
    muted: isLight ? '#64748b' : '#a3adbd',
    faint: isLight ? '#94a3b8' : '#6b7280',
    title: isLight ? '#0f172a' : '#ffffff',
    shadow: isLight ? '0 38px 90px -58px rgba(15,23,42,.35)' : '0 50px 100px -58px rgba(0,0,0,.95)',
  }
}

function pointerAngle(event: ReactPointerEvent<HTMLElement>, element: HTMLElement): number {
  const rect = element.getBoundingClientRect()
  return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2))
}

function shortestAngleDelta(next: number, previous: number): number {
  let delta = next - previous
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function FidgetLogo({ src }: { src: string }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<number | null>(null)
  const rotationRef = useRef(0)
  const velocityRef = useRef(0)
  const lastAngleRef = useRef(0)
  const lastTimeRef = useRef(0)
  const lastMoveRef = useRef(0)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const paint = () => {
    if (imageRef.current) imageRef.current.style.transform = `rotate(${rotationRef.current}rad) scale(${draggingRef.current ? 1.035 : 1})`
  }

  const stopAnimation = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  const releaseWithInertia = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    if (performance.now() - lastMoveRef.current > 90) velocityRef.current = 0
    velocityRef.current *= 1.18
    let previousFrame = performance.now()
    const animate = (now: number) => {
      const elapsed = Math.min(32, now - previousFrame)
      previousFrame = now
      rotationRef.current += velocityRef.current * elapsed
      velocityRef.current *= Math.exp(-elapsed * 0.00115)
      paint()
      if (Math.abs(velocityRef.current) > 0.00006) frameRef.current = requestAnimationFrame(animate)
      else frameRef.current = null
    }
    if (Math.abs(velocityRef.current) > 0.00006) frameRef.current = requestAnimationFrame(animate)
    else paint()
  }

  useEffect(() => () => stopAnimation(), [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    stopAnimation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    setDragging(true)
    velocityRef.current = 0
    lastAngleRef.current = pointerAngle(event, event.currentTarget)
    lastTimeRef.current = event.timeStamp
    lastMoveRef.current = performance.now()
    paint()
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const nextAngle = pointerAngle(event, event.currentTarget)
    const delta = shortestAngleDelta(nextAngle, lastAngleRef.current)
    const elapsed = Math.max(4, event.timeStamp - lastTimeRef.current)
    const instantaneousVelocity = Math.max(-0.09, Math.min(0.09, delta / elapsed))
    rotationRef.current += delta
    velocityRef.current = velocityRef.current * 0.28 + instantaneousVelocity * 0.72
    lastAngleRef.current = nextAngle
    lastTimeRef.current = event.timeStamp
    lastMoveRef.current = performance.now()
    paint()
    event.preventDefault()
  }

  const nudge = () => {
    stopAnimation()
    velocityRef.current = Math.min(0.055, Math.abs(velocityRef.current) + 0.022)
    let previousFrame = performance.now()
    const animate = (now: number) => {
      const elapsed = Math.min(32, now - previousFrame)
      previousFrame = now
      rotationRef.current += velocityRef.current * elapsed
      velocityRef.current *= Math.exp(-elapsed * 0.00115)
      paint()
      if (velocityRef.current > 0.00006) frameRef.current = requestAnimationFrame(animate)
      else frameRef.current = null
    }
    frameRef.current = requestAnimationFrame(animate)
  }

  return (
    <button
      type="button"
      aria-label="Spin the adOmnia logo"
      title="Drag the logo to spin it — faster gestures create more momentum"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={releaseWithInertia}
      onPointerCancel={releaseWithInertia}
      onLostPointerCapture={releaseWithInertia}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); nudge() } }}
      className={cn(
        'group relative grid h-[250px] w-[250px] touch-none select-none place-items-center rounded-full outline-none max-sm:h-[200px] max-sm:w-[200px]',
        'cursor-grab focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent',
        dragging && 'cursor-grabbing',
      )}
    >
      <span className={cn('pointer-events-none absolute inset-7 rounded-full bg-violet-500/10 blur-2xl transition-opacity', dragging ? 'opacity-90' : 'opacity-45 group-hover:opacity-70')} />
      <img
        ref={imageRef}
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none h-[240px] w-[240px] object-contain drop-shadow-[0_18px_34px_rgba(124,58,237,.38)] will-change-transform max-sm:h-[190px] max-sm:w-[190px]"
      />
    </button>
  )
}

export function WelcomePanel() {
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const mockRunning = useAppStore((s) => s.mockRunning)
  const proxyRunning = useAppStore((s) => s.proxyRunning)
  const websocketRunning = useAppStore((s) => s.websocketRunning)
  const sseRunning = useAppStore((s) => s.sseRunning)
  const browserRunning = useAppStore((s) => s.browserRunning)
  const collections = useCollectionsStore((s) => s.collections)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const allTabs = useTabsStore((s) => s.tabs)
  const responseHistory = useTabsStore((s) => s.responseHistory)
  const legacyTheme = useSettingsStore((s) => s.settings.appearance.theme)
  const themes = useThemesStore((s) => s.themes)
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  const activeTheme = themes.find((t) => t.id === activeThemeId)
  const isLight = activeTheme ? inferThemeMode(activeTheme) === 'light' : legacyTheme === 'light'
  const colors = themeVars(isLight)
  const appIcon = useAppIcon()
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const requestCount = useMemo(
    () => collections.reduce((total, collection) => total + countRequests(collection.children), 0),
    [collections],
  )
  const openTabCount = allTabs.filter((tab) => (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId).length
  const activeEnvironment = environments.find((environment) => environment.id === activeEnvId)
  const liveServices = [
    mockRunning && 'Mock',
    proxyRunning && 'Proxy',
    websocketRunning && 'WebSocket',
    sseRunning && 'SSE',
    browserRunning && 'Browser',
  ].filter(Boolean) as string[]

  return (
    <div
      className="min-h-full overflow-auto px-6 py-6 text-text-1"
      style={{
        background: colors.page,
        color: colors.title,
      }}
    >
      <div
        className="mx-auto max-w-[1380px] overflow-hidden rounded-[14px] border"
        style={{
          borderColor: colors.cardBorder,
          background: colors.panel,
          boxShadow: colors.shadow,
        }}
      >
        <header
          className="flex min-h-[300px] items-center justify-between gap-10 border-b px-8 py-8 max-lg:flex-col max-lg:items-start"
          style={{
            borderColor: colors.cardBorder,
            background: isLight
              ? 'radial-gradient(760px 420px at 94% 5%, rgba(124,58,237,.14), transparent 58%)'
              : 'radial-gradient(760px 420px at 94% 5%, rgba(124,58,237,.18), transparent 58%)',
          }}
        >
          <div className="min-w-0">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-violet-300">
              <Search size={12} />
              <span>
                Press <kbd className="rounded border border-violet-500/40 bg-violet-500/15 px-1 py-px text-[9px] text-violet-200">Ctrl/Cmd&nbsp;+&nbsp;F</kbd> to search any feature
              </span>
            </div>
            <h1 className="max-w-[720px] text-[38px] font-semibold leading-[1.04] tracking-normal max-sm:text-[32px] max-sm:leading-[1.08]" style={{ color: colors.title }}>
              <span className={isLight ? 'text-violet-700' : 'text-violet-200'}>Build & debug APIs.</span>
              <br />
              Then document, sign and version it all.
            </h1>
            <p className="mt-4 max-w-[680px] font-mono text-[12px] leading-7" style={{ color: colors.muted }}>
              API clients and protocols come first, with documents, signed PDFs and a full local Git surface one click away. Everything stays on your machine.
            </p>
          </div>

          <div className="flex w-[320px] shrink-0 items-center justify-center self-stretch max-lg:order-first max-lg:w-full max-lg:self-auto">
            <FidgetLogo src={appIcon} />
          </div>
        </header>

        <main className="space-y-5 px-8 py-7">
          <div className="space-y-3">
            {HUB_SECTIONS.map((section) => {
              const isExpanded = expandedSection === section.index
              return (
                <CompactHubSection
                  key={section.index}
                  section={section}
                  colors={colors}
                  isLight={isLight}
                  expanded={isExpanded}
                  requestCount={requestCount}
                  openTabCount={openTabCount}
                  activeEnvironment={activeEnvironment?.name ?? 'none'}
                  liveServices={liveServices}
                  onToggle={() => setExpandedSection(isExpanded ? null : section.index)}
                  onOpen={setActiveRail}
                />
              )
            })}
          </div>

          <footer className="flex flex-wrap items-center gap-3 border-t pt-4 font-mono text-[10px]" style={{ borderColor: colors.cardBorder, color: colors.faint }}>
            <span className="inline-flex items-center gap-2 text-emerald-400">
              <CircleDot size={10} />
              ready
            </span>
            <span className="h-3 w-px" style={{ background: colors.cardBorder }} />
            <span>active env: <b style={{ color: colors.title }}>{activeEnvironment?.name ?? 'none'}</b></span>
            <span className="h-3 w-px" style={{ background: colors.cardBorder }} />
            <span>{responseHistory.length} saved responses</span>
            <span className="ml-auto max-md:ml-0">local-first / no account / no telemetry</span>
          </footer>
        </main>
      </div>
    </div>
  )
}

function SectionTitle({ index, title, kicker, accent, colors }: {
  index: string
  title: string
  kicker: string
  accent: 'violet' | 'orange' | 'muted'
  colors: ReturnType<typeof themeVars>
}) {
  const accentColor = accent === 'orange' ? '#fb923c' : accent === 'muted' ? colors.faint : '#a855f7'
  return (
    <div className="mb-3 flex items-center gap-3">
      <span
        className="rounded-lg border px-2.5 py-1 font-mono text-xs font-bold"
        style={{ color: accentColor, borderColor: `${accentColor}55`, background: `${accentColor}18` }}
      >
        {index}
      </span>
      <h2 className="m-0 text-base font-semibold tracking-normal" style={{ color: colors.title }}>{title}</h2>
      <span className="font-mono text-[10.5px]" style={{ color: colors.faint }}>{kicker}</span>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${colors.cardBorder}, transparent)` }} />
    </div>
  )
}

function ToolSection({
  index,
  title,
  kicker,
  accent,
  tools,
  colors,
  isLight,
  onOpen,
}: {
  index: string
  title: string
  kicker: string
  accent: 'violet' | 'orange' | 'muted'
  tools: HubTool[]
  colors: ReturnType<typeof themeVars>
  isLight: boolean
  onOpen: (id: RailItem) => void
}) {
  return (
    <section>
      <SectionTitle index={index} title={title} kicker={kicker} accent={accent} colors={colors} />
      <div className="grid grid-cols-[1.75fr_repeat(4,1fr)] gap-3 max-2xl:grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} colors={colors} isLight={isLight} onClick={() => onOpen(tool.id)} />
        ))}
      </div>
    </section>
  )
}

function ToolCard({ tool, colors, isLight, onClick }: {
  tool: HubTool
  colors: ReturnType<typeof themeVars>
  isLight: boolean
  onClick: () => void
}) {
  const Icon = tool.icon
  const accent = tool.accent === 'orange' ? '#fb923c' : '#a855f7'
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex min-h-[172px] flex-col rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-1',
        tool.featured ? 'max-2xl:col-span-1' : '',
      )}
      style={{
        borderColor: tool.featured ? `${accent}66` : colors.cardBorder,
        background: tool.featured
          ? `linear-gradient(160deg, ${accent}24, ${isLight ? 'rgba(255,255,255,.76)' : 'rgba(15,18,27,.72)'} 62%)`
          : colors.card,
        color: colors.title,
        boxShadow: tool.featured ? `inset 0 1px 0 rgba(255,255,255,.05), 0 20px 55px -42px ${accent}` : 'inset 0 1px 0 rgba(255,255,255,.03)',
        ['--tw-ring-color' as string]: `${accent}88`,
      }}
    >
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border"
          style={{ color: accent, borderColor: `${accent}55`, background: `${accent}1f` }}
        >
          <Icon size={18} />
        </span>
        <span className="min-w-0">
          <b className="block truncate text-[15px] font-semibold" style={{ color: colors.title }}>{tool.title}</b>
          {tool.subtitle && <span className="block truncate font-mono text-[9.5px]" style={{ color: accent }}>{tool.subtitle}</span>}
        </span>
      </div>
      <p className="m-0 flex-1 font-mono text-[10.5px] leading-6" style={{ color: colors.muted }}>{tool.desc}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(tool.tags ?? []).slice(0, 4).map((tag) => (
          <span key={tag} className="rounded border px-1.5 py-0.5 font-mono text-[9px]" style={{ color: accent, borderColor: `${accent}44` }}>{tag}</span>
        ))}
      </div>
      <span className="mt-3 font-mono text-[10px] font-semibold" style={{ color: accent }}>open -&gt;</span>
    </button>
  )
}

function CompactHubSection({
  section,
  colors,
  isLight,
  expanded,
  requestCount,
  openTabCount,
  activeEnvironment,
  liveServices,
  onToggle,
  onOpen,
}: {
  section: HubSection
  colors: ReturnType<typeof themeVars>
  isLight: boolean
  expanded: boolean
  requestCount: number
  openTabCount: number
  activeEnvironment: string
  liveServices: string[]
  onToggle: () => void
  onOpen: (id: RailItem) => void
}) {
  const accent = section.accent === 'orange' ? '#fb923c' : section.accent === 'muted' ? '#6ee7b7' : '#a855f7'
  const featured = section.tools.find((tool) => tool.featured) ?? section.tools[0]
  const sectionStats = {
    '01': [
      [String(requestCount), 'requests'],
      [String(openTabCount), 'open tabs'],
      [activeEnvironment, 'active env'],
    ],
    '02': [
      [String(section.tools.length), 'studios'],
      ['PDF', 'signature'],
      ['local', 'exports'],
    ],
    '03': [
      ['local', 'mode'],
      ['main', 'branch'],
      [activeEnvironment, 'active env'],
    ],
    '04': [
      [String(liveServices.length), 'services live'],
      [liveServices.length ? liveServices.join(', ') : 'idle', 'runtime'],
      [String(section.tools.length), 'tools'],
    ],
  }[section.index] ?? [[String(section.tools.length), 'tools']]

  return (
    <section className="overflow-hidden rounded-2xl border" style={{ borderColor: colors.cardBorder, background: colors.card }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group grid w-full grid-cols-[76px_minmax(220px,1fr)_minmax(360px,1.25fr)_32px] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-violet-500/5 max-xl:grid-cols-[68px_1fr_32px] max-xl:gap-3"
        style={{ color: colors.title }}
      >
        <div className="flex items-center gap-2 font-mono text-[11px]" style={{ color: colors.faint }}>
          <span>L{Number(section.index)}</span>
          <span>/</span>
          <b style={{ color: accent }}>{section.index}</b>
        </div>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[20px] font-semibold uppercase tracking-normal" style={{ color: colors.title }}>{section.title}</h2>
          <p className="mt-1 truncate font-mono text-[10.5px]" style={{ color: colors.faint }}>{section.kicker}</p>
        </div>
        <div className="grid grid-cols-3 gap-4 max-xl:hidden">
          {sectionStats.slice(0, 3).map(([value, label]) => (
            <div key={label} className="min-w-0">
              <b className="block truncate text-[13px] font-semibold" style={{ color: label === 'runtime' && liveServices.length ? '#6ee7b7' : colors.title }}>{value}</b>
              <span className="block truncate font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: colors.faint }}>{label}</span>
            </div>
          ))}
        </div>
        <ChevronDown
          size={18}
          className={cn('justify-self-end transition-transform group-hover:text-violet-400', expanded && 'rotate-180')}
          style={{ color: expanded ? accent : colors.faint }}
        />
      </button>

      {expanded && (
        <div className="border-t px-5 py-5" style={{ borderColor: colors.cardBorder }}>
          {section.index === '03' ? (
            <GitCommandCard
              colors={colors}
              isLight={isLight}
              requestCount={requestCount}
              activeEnvironment={activeEnvironment}
              onOpen={() => onOpen('gitsync')}
            />
          ) : section.index === '04' ? (
            <MoreToolsCard section={section} colors={colors} isLight={isLight} onOpen={onOpen} />
          ) : (
            <ToolSection
              index={section.index}
              title={section.title}
              kicker={featured.subtitle ?? section.kicker}
              accent={section.accent}
              tools={section.tools}
              colors={colors}
              isLight={isLight}
              onOpen={onOpen}
            />
          )}
        </div>
      )}
    </section>
  )
}

function GitCommandCard({
  colors,
  isLight,
  requestCount,
  activeEnvironment,
  onOpen,
}: {
  colors: ReturnType<typeof themeVars>
  isLight: boolean
  requestCount: number
  activeEnvironment: string
  onOpen: () => void
}) {
  return (
    <section>
      <SectionTitle index="03" title="Version Control" kicker="local-first Git" accent="orange" colors={colors} />
      <button
        onClick={onOpen}
        className="group w-full overflow-hidden rounded-2xl border text-left transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-400"
        style={{
          borderColor: 'rgba(251,146,60,.38)',
          background: isLight ? 'linear-gradient(180deg, rgba(255,247,237,.95), rgba(255,255,255,.84))' : 'linear-gradient(180deg, rgba(251,146,60,.07), rgba(11,13,19,.95) 45%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)',
        }}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: colors.cardBorder }}>
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-orange-400/35 bg-orange-400/15 text-orange-400">
            <GitBranch size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <b className="block text-[13px] font-semibold" style={{ color: colors.title }}>Git Command Center</b>
            <span className="font-mono text-[9.5px]" style={{ color: colors.muted }}>commit · branch · diff · merge · stash · push</span>
          </div>
          <span className="rounded-lg border border-orange-400/30 bg-orange-400/10 px-2.5 py-1 font-mono text-[10px] text-orange-400">open -&gt;</span>
        </div>
        <div className="grid grid-cols-[1.1fr_1fr] max-md:grid-cols-1">
          <div className="border-r p-4 max-md:border-b max-md:border-r-0" style={{ borderColor: colors.cardBorder }}>
            <div className="mb-2 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: colors.faint }}>
              <span>Workspace context</span>
              <span>{requestCount} req</span>
            </div>
            {[
              ['M', 'frontend/src/components/layout/WelcomePanel.tsx', '#fbbf24'],
              ['A', 'docs/release-notes.md', '#6ee7b7'],
              ['?', 'notes/roadmap.md', colors.faint],
            ].map(([status, file, color]) => (
              <div key={file} className="mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[10.5px]" style={{ background: isLight ? '#f8fafc' : '#0b0d14' }}>
                <b className="w-3" style={{ color }}>{status}</b>
                <span className="min-w-0 flex-1 truncate" style={{ color: colors.muted }}>{file}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col p-4">
            <span className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: colors.faint }}>Quick state</span>
            <div className="space-y-2 font-mono text-[10.5px]">
              <div className="flex justify-between"><span style={{ color: colors.muted }}>branch</span><b className="text-orange-400">main</b></div>
              <div className="flex justify-between"><span style={{ color: colors.muted }}>active env</span><b style={{ color: colors.title }}>{activeEnvironment}</b></div>
              <div className="flex justify-between"><span style={{ color: colors.muted }}>mode</span><b className="text-orange-400">local</b></div>
            </div>
            <div className="mt-auto flex gap-2 pt-5">
              <span className="flex-1 rounded-lg bg-orange-400 px-3 py-2 text-center text-xs font-semibold text-[#1a0f04]">Open Git</span>
              <span className="rounded-lg border border-orange-400/35 px-3 py-2 font-mono text-[11px] text-orange-400">Diff</span>
            </div>
          </div>
        </div>
      </button>
    </section>
  )
}

function MoreToolsCard({
  section,
  colors,
  isLight,
  onOpen,
}: {
  section: HubSection
  colors: ReturnType<typeof themeVars>
  isLight: boolean
  onOpen: (id: RailItem) => void
}) {
  return (
    <section>
      <SectionTitle index={section.index} title={section.title} kicker={section.kicker} accent={section.accent} colors={colors} />
      <div className="grid grid-cols-2 gap-2 rounded-2xl border p-3" style={{ borderColor: colors.cardBorder, background: colors.card }}>
        {section.tools.map((tool) => {
          const Icon = tool.icon
          return (
            <button
              key={tool.id}
              onClick={() => onOpen(tool.id)}
              className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-violet-500/50"
              style={{ borderColor: colors.cardBorder, background: isLight ? '#ffffff99' : '#0b0d14', color: colors.title }}
              title={tool.desc}
            >
              <Icon size={13} className="shrink-0 text-violet-400" />
              <span className="min-w-0 truncate font-mono text-[10.5px]" style={{ color: colors.muted }}>{tool.title}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}


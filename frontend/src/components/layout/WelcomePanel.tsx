import { useMemo, useState, type ElementType } from 'react'
import { ArrowRight, BookOpen, Box, CircleDot, Code2, Database, GitBranch, Globe, Play, Search, Send, SlidersVertical, SquareTerminal } from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import type { RequestHistoryEntry, TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useNavigationTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import { HubMascot } from './HubMascot'
import { HubGoStudioPreview } from './HubGoStudioPreview'
import aoMark from './assets/ao-mark.png'
import goMark from './assets/go-mark.png'
import './WelcomePanel.css'

/**
 * The hub: a hero that introduces the aO → gO ecosystem, Go Studio as the
 * featured workspace, four studio rows and the latest requests. Structure and
 * copy stay token-driven so every theme gets the same page; skin-sketch.css
 * still dresses the shared data-hub-* hooks.
 */

type HubLink = { label: string; id: RailItem }

type HubCard = {
  index: string
  /** Hover treatment key (data-hub-card-kind in WelcomePanel.css). */
  pose: string
  title: string
  icon: ElementType
  links: HubLink[]
  action: { label: string; id: RailItem }
}

type HubCardTarget = string | null

const HUB_CARDS: HubCard[] = [
  {
    index: '02',
    pose: '01',
    title: 'API & Protocols',
    icon: Globe,
    links: [
      { label: 'REST', id: 'collections' },
      { label: 'SOAP', id: 'soap' },
      { label: 'gRPC', id: 'grpc' },
      { label: 'Streaming', id: 'websocket' },
      { label: 'Browser', id: 'browser' },
    ],
    action: { label: 'Open API Studio', id: 'collections' },
  },
  {
    index: '03',
    pose: '02',
    title: 'Payloads & Docs',
    icon: BookOpen,
    links: [
      { label: 'JSON', id: 'jsonviewer' },
      { label: 'OpenAPI', id: 'apidocs' },
      { label: 'Markdown', id: 'markdown' },
      { label: 'PDF', id: 'pdfeditor' },
    ],
    action: { label: 'Open Docs Studio', id: 'jsonviewer' },
  },
  {
    index: '04',
    pose: '03',
    title: 'Version Control',
    icon: GitBranch,
    links: [
      { label: 'Repositories', id: 'gitsync' },
      { label: 'Branches', id: 'gitsync' },
      { label: 'Diff', id: 'gitsync' },
    ],
    action: { label: 'Open Git Studio', id: 'gitsync' },
  },
  {
    index: '05',
    pose: '04',
    title: 'Infra · Data · Tools',
    icon: Database,
    links: [
      { label: 'Databases', id: 'database' },
      { label: 'Brokers', id: 'broker' },
      { label: 'Mock', id: 'mock' },
      { label: 'Proxy', id: 'proxy' },
      { label: 'Vault', id: 'vault' },
    ],
    action: { label: 'Open Infra Studio', id: 'database' },
  },
]

const GO_FEATURES: Array<{ icon: ElementType; label: string }> = [
  { icon: Code2, label: 'Intelligent code editing' },
  { icon: Play, label: 'Run & debug on local' },
  { icon: Box, label: 'Go modules & tooling' },
  { icon: SquareTerminal, label: 'Integrated terminal' },
  { icon: SlidersVertical, label: 'Built-in testing' },
]

function countRequests(nodes: TreeNode[]): number {
  return nodes.reduce((total, node) => total + (node.type === 'folder' ? countRequests(node.children) : 1), 0)
}

function noteTime(recordedAt: string | null): string {
  if (!recordedAt) return ''
  const date = new Date(recordedAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function notePath(entry: RequestHistoryEntry): string {
  const url = entry.request?.url ?? ''
  try {
    return new URL(url).pathname || url
  } catch {
    return url || 'request'
  }
}

export function WelcomePanel() {
  const tr = useUiTranslation()
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const collections = useCollectionsStore((s) => s.collections)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const responseHistory = useTabsStore((s) => s.responseHistory)
  const [hoveredCard, setHoveredCard] = useState<HubCardTarget>(null)
  const [focusedCard, setFocusedCard] = useState<HubCardTarget>(null)
  const activeCard = hoveredCard ?? focusedCard

  const requestCount = useMemo(
    () => collections.reduce((total, collection) => total + countRequests(collection.children), 0),
    [collections],
  )
  const activeEnvironment = environments.find((environment) => environment.id === activeEnvId)
  const recentActivity = responseHistory.slice(0, 5)

  return (
    <div className="relative min-h-full overflow-auto text-text-1" data-hub-page>
      <span aria-hidden className="pointer-events-none absolute inset-0" data-hub-glow />

      <div className="relative mx-auto max-w-[1600px] px-8 py-4 max-lg:px-5">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 max-xl:grid-cols-1">
          <div className="min-w-0">
            <span data-hub-tape className="inline-block text-[13px] font-bold uppercase tracking-[0.24em] text-accent-light">
              {tr('adOmnia hub' as UiMessage)}
            </span>
            <h1 className="mt-2 text-[46px] font-bold leading-[1.08] tracking-[-0.01em] max-lg:text-[36px] max-sm:text-[28px]">
              {tr('Build, debug and ship APIs.')}
              <br />
              <span className="text-accent-light">{tr('Now code in Go.' as UiMessage)}</span>
            </h1>
            <p className="mt-2 max-w-[560px] text-[16px] leading-snug text-text-2">
              {tr('Everything you need for modern development.' as UiMessage)}
              <br />
              {tr('Local-first. Flexible. Powerful.' as UiMessage)}
            </p>

            <button
              type="button"
              onClick={() => document.dispatchEvent(new CustomEvent('adomnia:open-palette'))}
              data-hub-search
              className="mt-4 flex w-full max-w-[720px] items-center gap-3 rounded-xl border border-border-1 bg-surface-1/70 px-4 py-2.5 text-left transition-colors hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Search size={17} className="shrink-0 text-text-2" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-text-3">
                {tr('Search tools, requests, docs, code...' as UiMessage)}
              </span>
              <kbd className="shrink-0 rounded-md border border-border-1 px-2 py-0.5 text-[12px] text-text-2">Ctrl/Cmd + K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-2 max-xl:hidden">
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-1">
                <img src={aoMark} alt="aO" draggable={false} className="h-[112px] w-[112px] object-contain" data-brand-mark />
                <ArrowRight size={40} strokeWidth={2.6} className="text-accent-light drop-shadow-[0_0_10px_var(--color-accent)]" />
                <img src={goMark} alt="gO" draggable={false} className="h-[112px] w-[112px] object-contain" />
              </div>
              <span className="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-info">
                {tr('Same ecosystem. More possibilities.' as UiMessage)}
              </span>
            </div>
            <HubMascot />
          </div>
        </header>

        <GoStudioHero onOpen={() => setActiveRail('goide')} />

        <div className="mt-3 grid grid-cols-4 gap-4 max-2xl:grid-cols-2 max-md:grid-cols-1">
          {HUB_CARDS.map((card) => (
            <HubCardView
              key={card.index}
              card={card}
              stat={card.index === '02' && requestCount ? `${requestCount} ${tr('requests')}` : ''}
              onOpen={setActiveRail}
              active={activeCard === card.pose}
              onHover={setHoveredCard}
              onFocus={setFocusedCard}
            />
          ))}
        </div>

        <section className="mt-4">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-[14px] font-bold uppercase tracking-[0.12em] text-text-1" data-hub-underline>
              {tr('Recent activity' as UiMessage)}
            </h2>
            <button
              type="button"
              onClick={() => setActiveRail('history')}
              className="border-none bg-transparent p-0 text-[12px] text-info transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-info/60"
            >
              {tr('View all' as UiMessage)} →
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-5 gap-3 max-2xl:grid-cols-3 max-md:grid-cols-1">
            {recentActivity.length === 0 && (
              <p className="col-span-full m-0 text-[12px] text-text-3">
                {tr('No saved responses yet. Send a request and it lands here.' as UiMessage)}
              </p>
            )}
            {recentActivity.map((entry) => (
              <ActivityCard key={entry.id} entry={entry} onOpen={() => setActiveRail('history')} />
            ))}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-1 pt-3 text-[12px] text-text-2">
          <span className="inline-flex items-center gap-2 font-semibold text-success">
            <CircleDot size={10} />
            {tr('ready')}
          </span>
          <span className="h-3 w-px bg-border-1" />
          <span>{activeEnvironment?.name ?? tr('none')}</span>
          <span className="h-3 w-px bg-border-1" />
          <span>{responseHistory.length} {tr('saved responses')}</span>
          <span className="ml-auto max-md:ml-0" data-hub-underline>
            {tr('local-first · no account · no telemetry' as UiMessage)}
          </span>
        </footer>
      </div>
    </div>
  )
}

function GoStudioHero({ onOpen }: { onOpen: () => void }) {
  const tr = useUiTranslation()
  return (
    <section
      data-hub-go-hero
      className="relative mt-3 grid grid-cols-[minmax(0,560px)_minmax(0,1fr)] gap-6 rounded-2xl px-5 py-4 max-xl:grid-cols-1"
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-bold text-accent-light">01</span>
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold uppercase text-white shadow-[0_0_14px_var(--color-accent)]">
            {tr('New' as UiMessage)}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-5">
          <img src={goMark} alt="" draggable={false} className="h-[124px] w-[124px] shrink-0 object-contain max-sm:h-20 max-sm:w-20" />
          <div className="min-w-0">
            <h2 className="m-0 text-[52px] font-bold leading-none max-sm:text-[34px]">
              gO <span className="text-accent-light">Studio</span>
            </h2>
            <p className="mt-2 text-[14px] font-semibold text-info">
              {tr('Full-featured Go IDE. Local, fast, powerful.' as UiMessage)}
            </p>
          </div>
        </div>

        <ul className="m-0 mt-3 grid list-none grid-cols-5 gap-3 p-0 max-sm:grid-cols-3">
          {GO_FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex flex-col items-start gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-accent/60 text-accent-light">
                <Icon size={19} strokeWidth={1.7} />
              </span>
              <span className="text-[12px] leading-snug text-text-2">{tr(label as UiMessage)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-center gap-7 pt-4">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-3 rounded-full border border-accent-light/70 bg-accent/40 px-8 py-3 text-[15px] font-bold text-white shadow-[0_0_22px_-4px_var(--color-accent)] transition-[background-color,box-shadow,transform] hover:bg-accent/60 hover:shadow-[0_0_30px_-2px_var(--color-accent)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-light"
          >
            <ArrowRight size={17} /> {tr('Open gO Studio' as UiMessage)}
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="border-none bg-transparent p-0 text-[14px] text-info underline underline-offset-4 transition-colors hover:text-accent-light focus:outline-none focus-visible:ring-2 focus-visible:ring-info/60"
          >
            {tr('Learn more' as UiMessage)} →
          </button>
        </div>
      </div>

      <div className="min-h-[280px] max-xl:hidden">
        <HubGoStudioPreview />
      </div>
    </section>
  )
}

function ActivityCard({ entry, onOpen }: { entry: RequestHistoryEntry; onOpen: () => void }) {
  const ok = entry.response.status >= 200 && entry.response.status < 400
  const Icon = entry.request?.method === 'GET' ? Play : Send
  return (
    <button
      type="button"
      onClick={onOpen}
      data-hub-note
      className="flex min-w-0 items-center gap-3 rounded-xl border border-border-1 bg-surface-1/70 px-4 py-3 text-left transition-colors hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Icon size={22} strokeWidth={1.7} className={cn('shrink-0', ok ? 'text-success' : 'text-accent-light')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <b className="truncate text-[12.5px] font-semibold text-text-1">
            {entry.request?.method ?? 'GET'} {notePath(entry)}
          </b>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-text-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-success' : 'bg-error')} />
            {entry.response.ms}ms
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-3">
          <span className="truncate">{entry.response.status}</span>
          <span className="shrink-0">{noteTime(entry.recordedAt)}</span>
        </span>
      </span>
    </button>
  )
}

function HubCardView({ card, stat, onOpen, active, onHover, onFocus }: {
  card: HubCard
  stat: string
  onOpen: (id: RailItem) => void
  active: boolean
  onHover: (target: HubCardTarget) => void
  onFocus: (target: HubCardTarget) => void
}) {
  const nav = useNavigationTranslation()
  const tr = useUiTranslation()
  const Icon = card.icon

  return (
    <article
      data-hub-card
      data-hub-card-kind={card.pose}
      data-hub-card-active={active ? 'true' : undefined}
      onPointerEnter={() => onHover(card.pose)}
      onPointerLeave={() => onHover(null)}
      onFocusCapture={() => onFocus(card.pose)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFocus(null)
      }}
      className={cn(
        'relative flex items-center gap-4 rounded-xl border border-border-1 bg-surface-1/70 px-4 py-4 transition-[border-color,background-color,box-shadow] hover:border-accent/50',
        active && 'border-accent/50 shadow-[0_14px_30px_-26px_var(--color-accent)]',
      )}
    >
      <span className="absolute left-3 top-1.5 text-[12px] font-bold text-accent-light">{card.index}</span>

      <span data-hub-card-icon className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-accent/50 text-accent-light">
        <Icon size={24} strokeWidth={1.6} />
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="m-0 truncate text-[17px] font-bold uppercase tracking-[0.02em] text-accent-light">
          {nav(card.title)}
        </h2>
        <p className="m-0 mt-1 flex flex-wrap items-center gap-y-0.5 text-[11.5px] text-text-2">
          {card.links.map((link, index) => (
            <span key={`${link.id}-${link.label}`} className="inline-flex items-center">
              <button
                type="button"
                data-hub-link
                onClick={() => onOpen(link.id)}
                className="rounded border-none bg-transparent p-0 text-[11.5px] text-text-2 underline-offset-4 transition-colors hover:text-accent-light hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {nav(link.label)}
              </button>
              {index < card.links.length - 1 && <span className="pr-1.5 text-text-4">,</span>}
            </span>
          ))}
        </p>
        {stat && <span className="mt-0.5 block text-[11px] text-text-3">{stat}</span>}
      </div>

      <button
        type="button"
        aria-label={tr(card.action.label as UiMessage)}
        title={tr(card.action.label as UiMessage)}
        onClick={() => onOpen(card.action.id)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border-2 bg-transparent text-text-1 transition-colors hover:border-accent hover:bg-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <ArrowRight size={16} />
      </button>
    </article>
  )
}

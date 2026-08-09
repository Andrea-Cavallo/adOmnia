import { useEffect, useMemo, useRef, useState, type ElementType, type PointerEvent as ReactPointerEvent } from 'react'
import { BookOpen, CircleDot, Database, GitBranch, Globe, Search } from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { useAppIcon } from '@/lib/brandAssets'
import type { RequestHistoryEntry, TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useNavigationTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'

/**
 * The hub is a page of an engineering notebook: four index cards clipped into
 * the binding, a taped photo of the app icon, and the last few requests jotted
 * down at the bottom. Structure and copy stay token-driven so every theme gets
 * the same page; the paper, the rings and the tape are added by
 * styles/skin-sketch.css, which is the only place that knows about pencil.
 */

type HubLink = { label: string; id: RailItem }

type HubCard = {
  index: string
  title: string
  icon: ElementType
  links: HubLink[]
  action: { label: string; id: RailItem }
}

const HUB_CARDS: HubCard[] = [
  {
    index: '01',
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
    index: '02',
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
    index: '03',
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
    index: '04',
    title: 'Infra · Data · Tools',
    icon: Database,
    links: [
      { label: 'Databases', id: 'database' },
      { label: 'Brokers', id: 'broker' },
      { label: 'Mock', id: 'mock' },
      { label: 'Proxy', id: 'proxy' },
      { label: 'Vault', id: 'vault' },
      { label: 'Utilities', id: 'powertools' },
    ],
    action: { label: 'Open Infra Studio', id: 'database' },
  },
]

const NOTE_PIN_COLORS = ['var(--color-accent)', 'var(--color-info)', 'var(--color-warning)']

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

function FidgetLogo({ src, size }: { src: string; size: number }) {
  const tr = useUiTranslation()
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
      aria-label={tr('Spin the adOmnia logo')}
      title={tr('Drag the logo to spin it — faster gestures create more momentum')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={releaseWithInertia}
      onPointerCancel={releaseWithInertia}
      onLostPointerCapture={releaseWithInertia}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); nudge() } }}
      data-hub-logo
      style={{ width: size, height: size }}
      className={cn(
        'group relative grid touch-none select-none place-items-center rounded-full border-none bg-transparent outline-none',
        'cursor-grab focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        dragging && 'cursor-grabbing',
      )}
    >
      <img
        ref={imageRef}
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full object-contain will-change-transform"
      />
    </button>
  )
}

export function WelcomePanel() {
  const tr = useUiTranslation()
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const mockRunning = useAppStore((s) => s.mockRunning)
  const proxyRunning = useAppStore((s) => s.proxyRunning)
  const websocketRunning = useAppStore((s) => s.websocketRunning)
  const sseRunning = useAppStore((s) => s.sseRunning)
  const browserRunning = useAppStore((s) => s.browserRunning)
  const collections = useCollectionsStore((s) => s.collections)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const responseHistory = useTabsStore((s) => s.responseHistory)
  const appIcon = useAppIcon()

  const requestCount = useMemo(
    () => collections.reduce((total, collection) => total + countRequests(collection.children), 0),
    [collections],
  )
  const activeEnvironment = environments.find((environment) => environment.id === activeEnvId)
  const liveServices = [mockRunning, proxyRunning, websocketRunning, sseRunning, browserRunning].filter(Boolean).length
  const recentNotes = responseHistory.slice(0, 3)

  const cardStats: Record<string, string> = {
    '01': `${requestCount} ${tr('requests')}`,
    '02': `${HUB_CARDS[1].links.length} ${tr('studios' as UiMessage)}`,
    '03': `main ${tr('branch')}`,
    '04': liveServices ? `${liveServices} ${tr('live' as UiMessage)}` : `${HUB_CARDS[3].links.length} ${tr('tools' as UiMessage)}`,
  }

  return (
    <div className="relative min-h-full overflow-auto text-text-1" data-hub-page>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-9 w-px" data-hub-margin />

      <div className="mx-auto max-w-[1200px] px-10 py-8 max-lg:px-6">
        <header className="mb-8">
          <span
            data-hub-tape
            className="inline-block -rotate-1 px-4 py-1 text-[12px] font-bold uppercase tracking-[0.22em] text-accent"
          >
            {tr('adOmnia hub' as UiMessage)}
          </span>

          <div className="mt-6 flex items-start justify-between gap-10 max-lg:flex-col">
            <div className="min-w-0 flex-1">
              <h1 className="max-w-[760px] text-[44px] font-semibold leading-[1.12] max-lg:text-[36px] max-sm:text-[28px]">
                <span className="relative inline-block text-accent">
                  {tr('Build, debug and ship APIs.')}
                  <svg
                    aria-hidden
                    viewBox="0 0 300 10"
                    preserveAspectRatio="none"
                    className="absolute -bottom-1 right-0 h-[9px] w-[24%] text-accent"
                  >
                    <path
                      d="M2 6.4C46 2.6 122 1.6 186 3.2c40 1 78 2.6 112 4.4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <br />
                {tr('Everything stays local.' as UiMessage)}
              </h1>

              <button
                type="button"
                onClick={() => document.dispatchEvent(new CustomEvent('adomnia:open-palette'))}
                data-hub-search
                className="mt-7 flex w-full max-w-[680px] items-center gap-3 rounded-xl border border-border-1 bg-surface-1 px-4 py-3 text-left transition-colors hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Search size={17} className="shrink-0 text-text-3" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-text-3">
                  {tr('Search tools, requests, docs…' as UiMessage)}
                </span>
                <kbd className="shrink-0 rounded border border-border-1 px-2 py-0.5 text-[11px] text-text-3">
                  Ctrl/Cmd + K
                </kbd>
              </button>
            </div>

            <figure
              data-hub-polaroid
              className="m-0 shrink-0 rotate-2 rounded-xl border border-border-1 bg-surface-2 px-5 pb-4 pt-5 max-lg:self-center"
            >
              <FidgetLogo src={appIcon} size={168} />
              <figcaption className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-text-3">
                <svg aria-hidden viewBox="0 0 24 20" className="h-4 w-4 text-text-4">
                  <path d="M3 17C7 6 13 3 20 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M20 3l-5 1M20 3l-1 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {tr('your local toolbox' as UiMessage)}
              </figcaption>
            </figure>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-6 max-xl:grid-cols-1">
          {HUB_CARDS.map((card) => (
            <HubCardView
              key={card.index}
              card={card}
              stat={cardStats[card.index] ?? ''}
              onOpen={setActiveRail}
            />
          ))}
        </div>

        <section className="mt-9">
          <h2 className="m-0 inline-block text-[12px] font-bold uppercase tracking-[0.2em] text-text-2" data-hub-underline>
            {tr('Recent notes' as UiMessage)}
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-5 max-xl:grid-cols-1">
            {recentNotes.length === 0 && (
              <p className="col-span-full m-0 text-[12px] text-text-3">
                {tr('No saved responses yet. Send a request and it lands here.' as UiMessage)}
              </p>
            )}
            {recentNotes.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setActiveRail('history')}
                data-hub-note
                className="relative w-full rounded-lg border border-border-1 bg-surface-1 px-4 py-3 text-left transition-colors hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <span
                  aria-hidden
                  className="absolute -top-2 right-5 h-3.5 w-3.5 rounded-full"
                  style={{ background: NOTE_PIN_COLORS[index % NOTE_PIN_COLORS.length] }}
                />
                <b className="block truncate text-[13px] font-semibold text-accent">
                  {entry.request?.method ?? 'GET'} {notePath(entry)}
                </b>
                <span className="mt-1 flex items-center justify-between gap-3 text-[11px] text-text-3">
                  <span className="truncate">
                    {entry.response.status} · {entry.response.ms}ms
                  </span>
                  <span className="shrink-0">{noteTime(entry.recordedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <footer
          className="mt-10 flex flex-wrap items-center gap-3 border-t border-border-1 pt-4 text-[11px] text-text-3"
        >
          <span className="inline-flex items-center gap-2 text-success">
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

function HubCardView({ card, stat, onOpen }: { card: HubCard; stat: string; onOpen: (id: RailItem) => void }) {
  const nav = useNavigationTranslation()
  const tr = useUiTranslation()
  const Icon = card.icon

  return (
    <article
      data-hub-card
      className="relative rounded-xl border border-border-1 bg-surface-1 px-6 py-5 transition-colors hover:border-accent/40"
    >
      <span className="text-[13px] font-bold text-accent">{card.index}</span>

      <div className="mt-3 flex items-start gap-5 max-sm:gap-3">
        <span
          data-hub-card-icon
          className="grid h-14 w-14 shrink-0 -rotate-2 place-items-center rounded-xl border border-accent/40 text-accent max-sm:h-11 max-sm:w-11"
        >
          <Icon size={26} strokeWidth={1.6} />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[21px] font-semibold uppercase tracking-[0.02em] text-accent max-sm:text-[17px]">
            {nav(card.title)}
          </h2>

          <p className="mt-1 flex flex-wrap items-center gap-y-1 text-[13px] text-text-2">
            {card.links.map((link, index) => (
              <span key={`${link.id}-${link.label}`} className="inline-flex items-center">
                <button
                  type="button"
                  data-hub-link
                  onClick={() => onOpen(link.id)}
                  className="rounded border-none bg-transparent p-0 text-[13px] text-text-2 underline-offset-4 transition-colors hover:text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {nav(link.label)}
                </button>
                {index < card.links.length - 1 && <span className="pr-1.5 text-text-4">,</span>}
              </span>
            ))}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onOpen(card.action.id)}
              className="rounded-lg border border-info/50 bg-transparent px-3 py-1.5 text-[12px] text-info transition-colors hover:bg-info/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-info/60"
            >
              → {tr(card.action.label as UiMessage)}
            </button>
            <span className="text-[12px] text-text-3">{stat}</span>
          </div>
        </div>
      </div>
    </article>
  )
}

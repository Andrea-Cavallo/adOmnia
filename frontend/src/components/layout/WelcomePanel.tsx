import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowRight, ArrowUpRight, ChevronRight, Plus, Layers, CircleDot, BarChart3 } from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { DAILY_STATS_EVENT, readDailyStats } from '@/lib/dailyStats'
import { FoldMark } from './FoldMark'
import { DotArcade, pickGame } from './arcade/DotArcade'
import type { GameId } from './arcade/types'
import { useNavigationTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import '@fontsource/doto/latin-800.css'
import './WelcomePanel.css'

const cards = [
  { title: 'gO Studio', description: 'Your code, in focus', target: 'goide' },
  { title: 'API & Protocols', description: 'Requests and flows', target: 'collections' },
  { title: 'Data & Messaging', description: 'Connections and streams', target: 'database' },
  { title: 'Docs & Payloads', description: 'Schemas and specifications', target: 'jsonviewer' },
  { title: 'Version Control', description: 'Branches and changes', target: 'gitsync' },
  { title: 'Power Tools', description: 'Inspect and transform', target: 'powertools' },
] as const

function StudioIcon({ target }: { target: string }) {
  const id = `hub-metal-${target}`
  return <svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop style={{ stopColor: 'color-mix(in srgb, var(--color-accent) 35%, #ffffff)' }}/><stop offset=".5" style={{ stopColor: 'var(--color-accent)' }}/><stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--color-accent) 55%, #0b1020)' }}/></linearGradient></defs>
    <g fill={`url(#${id})`}>
      {target === 'goide' && <><path d="M26 23v23c0 8-5 12-13 12-4 0-7-1-10-3l3-4c2 2 4 2 7 2 5 0 8-2 8-7v-3a12 12 0 1 1 0-18v-2zm-5 11a7 7 0 1 0-14 0 7 7 0 0 0 14 0" fillRule="evenodd"/><circle cx="44" cy="31" r="17" fill="none" stroke={`url(#${id})`} strokeWidth="5"/></>}
      {target === 'collections' && <><path d="M32 4a28 28 0 0 0-15 52l7-12a15 15 0 0 1 8-28z"/><path d="M36 8a25 25 0 0 1 0 50V45a12 12 0 0 0 0-24z"/></>}
      {target === 'database' && <><ellipse cx="32" cy="14" rx="24" ry="11"/><path d="M8 22q24 16 48 0v10q-24 18-48 0zM8 37q24 16 48 0v10q-24 18-48 0z"/></>}
      {target === 'jsonviewer' && <><path d="m32 3 28 16-28 16L4 19zM4 32l9-5 19 11 19-11 9 5-28 16zM4 45l9-5 19 11 19-11 9 5-28 16z"/></>}
      {target === 'gitsync' && <><path d="m20 48 13-28M25 46l20 4" fill="none" stroke={`url(#${id})`} strokeWidth="3" strokeDasharray="5 4"/><circle cx="35" cy="12" r="8"/><circle cx="13" cy="53" r="9"/><circle cx="52" cy="53" r="9"/></>}
      {target === 'powertools' && <><path d="m32 3 27 15v30L32 63 5 48V18zm0 15L18 26v16l14 8 14-8V26z" fillRule="evenodd"/><path d="M32 3v15M5 18l13 8M59 18l-13 8M5 48l13-6M59 48l-13-6M32 50v13" fill="none" style={{ stroke: 'color-mix(in srgb, var(--color-accent) 50%, #0b1020)' }} strokeWidth="1"/></>}
    </g>
  </svg>
}

// 5x7 dot-matrix glyphs for the Nothing-style clock face; '1' is a lit dot.
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
}

function DotClock({ text }: { text: string }) {
  const step = 10
  let x = 0
  const dots: ReactElement[] = []
  ;[...text].forEach((ch, i) => {
    const glyph = GLYPHS[ch] ?? GLYPHS['0']
    glyph.forEach((row, r) => [...row].forEach((on, c) => {
      if (on === '1') dots.push(<circle key={`${i}-${r}-${c}`} cx={x + c * step + 4} cy={r * step + 4} r={3.7}/>)
    }))
    x += glyph[0].length * step + step
  })
  return <svg className="hub-clock" viewBox={`0 0 ${x - step - 2} ${7 * step - 2}`} role="img" aria-label={text}><g fill="currentColor">{dots}</g></svg>
}

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function useDailyStats(day: string) {
  const [stats, setStats] = useState(() => readDailyStats())
  useEffect(() => {
    const update = () => setStats(readDailyStats())
    update() // `day` changes at midnight: re-read so the counter starts from zero
    window.addEventListener(DAILY_STATS_EVENT, update)
    return () => window.removeEventListener(DAILY_STATS_EVENT, update)
  }, [day])
  return stats
}

function timeZoneLabel(now: Date) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? ''
  const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? ''
  return [city, short].filter(Boolean).join(' • ')
}

function TodayPanel() {
  const tr = useUiTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const open = useAppStore(s => s.setActiveRail)
  const workspaces = useCollectionsStore(s => s.workspaces)
  const workspaceId = useCollectionsStore(s => s.activeWorkspaceId)
  const tabs = useTabsStore(s => s.tabs)
  const history = useTabsStore(s => s.responseHistory)
  const newTab = useTabsStore(s => s.newTab)
  const now = useNow()
  // Clicking the FOLD wordmark opens a random dot-matrix mini game in the same box.
  const [game, setGame] = useState<GameId | null>(null)
  const lastGame = useRef<GameId | null>(null)
  const openGame = () => { const id = pickGame(lastGame.current); lastGame.current = id; setGame(id) }
  const stats = useDailyStats(now.toDateString())
  const workspace = workspaces.find(w => w.id === workspaceId)
  const openTabs = tabs.filter(tab => tab.workspaceId === workspaceId).length
  const lastAt = history.find(h => h.recordedAt)?.recordedAt
  const lastMinutes = lastAt ? Math.max(0, Math.floor((now.getTime() - new Date(lastAt).getTime()) / 60000)) : null
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const date = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '').toUpperCase()
  const actions: { title: string; detail: string; run: () => void }[] = [
    { title: 'Open project', detail: 'Open a project from your machine', run: () => open('goide') },
    { title: 'New request', detail: 'Create and send an API request', run: () => { newTab(); open('collections') } },
    { title: 'Add connection', detail: 'Open Database Studio', run: () => open('database') },
  ]
  return <aside className="hub-today">
    <p className="hub-eyebrow hub-today-eyebrow"><i/>{t('Today')}</p>
    <div className="hub-clock-wrap">{game
      ? <DotArcade key={game} id={game} onExit={() => setGame(null)}/>
      : <FoldMark busy={tabs.some(tab => tab.loading)} fallback={<DotClock text={clock}/>} onWordClick={openGame}/>}</div>
    <p className="hub-date"><time dateTime={now.toISOString()}>{clock}</time><span>{date}</span></p>
    <p className="hub-zone">{timeZoneLabel(now)}</p>
    <button className="hub-ws" onClick={() => open('collections')}>
      <Layers size={36} strokeWidth={1.3}/>
      <span><strong>{workspace?.name ?? 'adOmnia'}</strong>
        <small>{openTabs} {t('open tabs')} <b>•</b> {t('Local-first ready')}</small>
        <small>{lastMinutes === null ? t('No requests yet') : `${t('Last request')} ${lastMinutes < 1 ? t('just now') : `${lastMinutes} ${t('min ago')}`}`}</small>
      </span><ChevronRight size={18}/>
    </button>
    <button className="hub-open-ws" onClick={() => open('collections')}><span>{t('Open workspace')}</span><ArrowRight size={19}/></button>
    <div className="hub-signals">
      <button onClick={() => open('history')}>
        <BarChart3 size={28} strokeWidth={1.3}/><span><strong>{t("Today's requests")}</strong><small>{stats.requests} {t('requests')} <b>•</b> <em data-error={stats.errors > 0}>{stats.errors} {t('errors')}</em></small></span><i data-on={stats.requests > 0} data-error={stats.errors > 0}/>
      </button>
    </div>
    <div className="hub-start"><p className="hub-eyebrow">{t('Start something new')}</p>{actions.map(action => <button key={action.title} onClick={action.run}><Plus size={23} strokeWidth={1.3}/><span><strong>{t(action.title)}</strong><small>{t(action.detail)}</small></span><ArrowUpRight size={17}/></button>)}</div>
  </aside>
}

export function WelcomePanel() {
  const tr = useUiTranslation()
  const nav = useNavigationTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const open = useAppStore(s => s.setActiveRail)
  const history = useTabsStore(s => s.responseHistory)
  const openHistory = useTabsStore(s => s.openHistoryEntry)
  const [filter, setFilter] = useState<'all' | 'success' | 'errors'>('all')
  const recent = history.filter(h => filter === 'all' || (filter === 'errors' ? !!h.response.error || h.response.status >= 400 : !h.response.error && h.response.status < 400)).slice(0, 4)
  useEffect(() => {
    // Hub has no visible search bar: Ctrl/Cmd+F opens the command palette.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('adomnia:open-palette'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return <div data-hub-page>
    <main className="hub-content">
      <section className="hub-left">
        <div className="hub-studios">
          <p className="hub-eyebrow">{t('Workspace')}</p>
          <h1>{t('Make your next move.')}</h1>
          <p className="hub-lede">{t('Code. Connect. Build.')}</p>
          <div className="hub-grid">{cards.map(({ title, description, target }) => <button key={target} className="hub-studio" onClick={() => open(target as RailItem)}>
            <span className="hub-studio-icon" aria-hidden="true"><StudioIcon target={target}/></span>
            <span><strong>{nav(title)}</strong><small>{t(description)}</small></span><ArrowUpRight size={21}/>
          </button>)}</div>
        </div>
        <div className="hub-activity">
          <p className="hub-eyebrow">{t('Recent activity')}</p>
          <div className="hub-filters" role="group" aria-label={t('Recent activity')}>{(['all', 'success', 'errors'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(f === 'all' ? 'All' : f === 'success' ? 'Successful' : 'Errors')}</button>)}</div>
          {recent.length ? recent.map(entry => <button className="hub-history-row" key={entry.id} onClick={() => { openHistory(entry.id); open('collections') }}>
            <span className="hub-method">{entry.request?.method ?? 'HTTP'}</span><span className="hub-history-url">{entry.request?.url || entry.request?.name || t('Request')}</span>
            <span className="hub-status" data-error={!!entry.response.error || entry.response.status >= 400}><i/>{entry.response.error ? t('Error') : entry.response.status}</span>
            <time>{entry.recordedAt ? new Date(entry.recordedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</time>
          </button>) : <div className="hub-empty"><CircleDot size={24}/><strong>{t('No recent requests')}</strong><span>{t('Send a request to see your activity here.')}</span></div>}
          {history.length > 0 && <button className="hub-history-more" onClick={() => open('history')}>{t('View all history')}<ArrowRight size={14}/></button>}
        </div>
      </section>
      <TodayPanel/>
    </main>
  </div>
}

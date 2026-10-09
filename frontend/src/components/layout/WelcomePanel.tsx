import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'
import { ArrowRight, ArrowUpRight, Plus, CircleDot, X, SlidersHorizontal, ArrowLeftRight, RotateCcw, Check } from 'lucide-react'
import { FEATURE_REGISTRY, getFeatureLabel } from '@/lib/featureRegistry'
import { DEFAULT_HUB_LAYOUT, HUB_EXCLUDED, loadHubLayout, moveTile, saveHubLayout, type HubLayout } from './hubLayout'
import { useAppStore, type RailItem } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { FoldMark } from './FoldMark'
import type { GameId } from './arcade/types'
import { GAME_IDS } from './arcade/gameCatalog'
import { useNavigationTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import '@fontsource/doto/latin-800.css'
import './WelcomePanel.css'

const ArcadeMenu = lazy(() => import('./arcade/ArcadeMenu').then(module => ({ default: module.ArcadeMenu })))

const TileIcon = lazy(() => import('./HubStudioIcon').then(module => ({ default: module.TileIcon })))

const DotArcade = lazy(() => import('./arcade/DotArcade').then(module => ({ default: module.DotArcade })))

// Curated copy for the default studios; any other rail falls back to the feature registry.
const CARD_COPY: Partial<Record<RailItem, { title: string; description: string }>> = {
  goide: { title: 'gO Studio', description: 'Your code, in focus' },
  collections: { title: 'API & Protocols', description: 'Requests and flows' },
  database: { title: 'Data & Messaging', description: 'Connections and streams' },
  jsonviewer: { title: 'Docs & Payloads', description: 'Schemas and specifications' },
  gitsync: { title: 'Version Control', description: 'Branches and changes' },
  powertools: { title: 'Power Tools', description: 'Inspect and transform' },
}
const HUB_CANDIDATES = FEATURE_REGISTRY.filter(f => f.maturity !== 'deprecated' && !HUB_EXCLUDED.has(f.id))

function cardCopy(id: RailItem) {
  const feature = HUB_CANDIDATES.find(f => f.id === id)
  return CARD_COPY[id] ?? { title: getFeatureLabel(id), description: feature?.description ?? feature?.group ?? '' }
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
  const tabs = useTabsStore(s => s.tabs)
  const newTab = useTabsStore(s => s.newTab)
  const now = useNow()
  const [game, setGame] = useState<GameId | null>(null)
  const [arcadeOpen, setArcadeOpen] = useState(false)
  const openGame = () => setArcadeOpen(true)
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const date = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '').toUpperCase()
  const actions: { title: string; detail: string; run: () => void }[] = [
    { title: 'Open project', detail: 'Open a project from your machine', run: () => open('goide') },
    { title: 'New request', detail: 'Create and send an API request', run: () => { newTab(); open('collections') } },
    { title: 'Add connection', detail: 'Open Database Studio', run: () => open('database') },
  ]
  return <aside className="hub-today">
    <p className="hub-eyebrow hub-today-eyebrow"><i/>{t('Today')}</p>
    <div className="hub-clock-wrap">{arcadeOpen
      ? game
        ? <Suspense fallback={<p className="hub-eyebrow">{t('Loading…')}</p>}><DotArcade key={game} id={game} onSelect={setGame} onExit={() => setGame(null)}/></Suspense>
        : <Suspense fallback={null}><ArcadeMenu onSelect={setGame} onClose={() => setArcadeOpen(false)}/></Suspense>
      : <><FoldMark busy={tabs.some(tab => tab.loading)} fallback={<DotClock text={clock}/>} onWordClick={openGame}/><button className="hub-arcade-open" type="button" onClick={openGame}>{t('Arcade')} <span>{String(GAME_IDS.length).padStart(2, '0')} ↗</span></button></>}</div>
    <p className="hub-date"><time dateTime={now.toISOString()}>{clock}</time><span>{date}</span></p>
    <p className="hub-zone">{timeZoneLabel(now)}</p>
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
  const [layout, setLayout] = useState<HubLayout>(loadHubLayout)
  const [editing, setEditing] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const update = (next: HubLayout) => { setLayout(next); saveHubLayout(next) }
  const setTiles = (tiles: RailItem[]) => update({ ...layout, tiles })
  const addable = HUB_CANDIDATES.filter(f => !layout.tiles.includes(f.id))
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
    <main className="hub-content" data-today-side={layout.todaySide}>
      <section className="hub-left">
        <div className="hub-studios">
          <div className="hub-studios-head"><p className="hub-eyebrow">{t('Workspace')}</p>
            <div className="hub-customize">{editing && <>
              <button type="button" onClick={() => update({ ...layout, todaySide: layout.todaySide === 'right' ? 'left' : 'right' })}><ArrowLeftRight size={13}/>{t('Swap sides')}</button>
              <button type="button" onClick={() => update(DEFAULT_HUB_LAYOUT)}><RotateCcw size={13}/>{t('Reset')}</button>
            </>}
              <button type="button" aria-pressed={editing} onClick={() => setEditing(v => !v)}>{editing ? <><Check size={13}/>{t('Done')}</> : <><SlidersHorizontal size={13}/>{t('Customize')}</>}</button>
            </div>
          </div>
          <h1>{t('Make your next move.')}</h1>
          <p className="hub-lede">{t('Code. Connect. Build.')}</p>
          <div className="hub-grid" data-editing={editing || undefined}>{layout.tiles.map((target, index) => {
            const { title, description } = cardCopy(target)
            return <button key={target} className="hub-studio" data-drop={dropAt === index || undefined}
              draggable={editing}
              onClick={() => { if (!editing) open(target) }}
              onKeyDown={e => {
                if (!editing) return
                const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 } as Record<string, number>)[e.key]
                if (delta) { e.preventDefault(); setTiles(moveTile(layout.tiles, index, index + delta)) }
                if (e.key === 'Delete' || e.key === 'Backspace') setTiles(layout.tiles.filter(id => id !== target))
              }}
              onDragStart={e => { setDragFrom(index); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={e => { if (dragFrom === null) return; e.preventDefault(); setDropAt(index) }}
              onDragLeave={() => setDropAt(null)}
              onDrop={e => { e.preventDefault(); if (dragFrom !== null) setTiles(moveTile(layout.tiles, dragFrom, index)); setDragFrom(null); setDropAt(null) }}
              onDragEnd={() => { setDragFrom(null); setDropAt(null) }}>
              <span className="hub-studio-icon" aria-hidden="true"><Suspense fallback={null}><TileIcon target={target}/></Suspense></span>
              <span><strong>{nav(title)}</strong><small>{t(description)}</small></span>
              {editing
                ? <span className="hub-tile-remove" role="button" aria-label={`${t('Remove')} ${nav(title)}`} onClick={e => { e.stopPropagation(); setTiles(layout.tiles.filter(id => id !== target)) }}><X size={16}/></span>
                : <ArrowUpRight size={21}/>}
            </button>
          })}
          {editing && <div className="hub-studio hub-tile-add">{addable.length
            ? <><Plus size={22} strokeWidth={1.3}/><select aria-label={t('Add module')} value="" onChange={e => { const id = e.target.value as RailItem; if (id) setTiles([...layout.tiles, id]) }}>
                <option value="">{t('Add module')}…</option>
                {addable.map(f => <option key={f.id} value={f.id}>{nav(getFeatureLabel(f.id))}</option>)}
              </select></>
            : <small>{t('All modules added')}</small>}</div>}
          </div>
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

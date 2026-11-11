import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronRight, Code2, Database, FileText, Info, Send, Settings, Wrench, type LucideIcon } from 'lucide-react'
import { getFeatureLabel, isFeatureVisible, visibleRailCategories } from '@/lib/featureRegistry'
import { minuteAlignedTimeout } from '@/lib/visiblePolling'
import { loadRecentFiles, recentFileFolder, timeAgo, type RecentFile } from '@/lib/recentFiles'
import { recentRequests, type RecentRequest } from '@/lib/recentRequests'
import { useAppStore, type RailItem } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { useNavigationTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import { CATEGORY_ICONS, FEATURE_ICONS } from './Rail'
import { loadHubPhrase } from './hubPhrases'
import { HubLaser } from './HubLaser'
import '@fontsource/doto/latin-800.css'
import '@fontsource/geist-mono/latin-400.css'
import './WelcomePanel.css'


// Code Studio stays lazy: the file icon set loads only when the Hub shows a recent file.
const HubGame = lazy(() => import('./HubGame').then((module) => ({ default: module.HubGame })))
const FileIcon = lazy(() => import('@/components/code-studio/CodeStudioFileIcon').then((module) => ({ default: module.CodeStudioFileIcon })))

// Start actions on the Hub page; the sidebar reads the full rail registry.
const START_ACTIONS: ReadonlyArray<{ id: RailItem; label: string; icon: LucideIcon }> = [
  { id: 'codestudio', label: 'Code Studio', icon: Code2 },
  { id: 'collections', label: 'API Client', icon: Send },
  { id: 'database', label: 'Database', icon: Database },
]
const RECENT_ROWS = 5

function useNow() {
  const [now, setNow] = useState(() => new Date())
  // Solo ore e minuti: il tick è allineato al cambio di minuto.
  useEffect(() => minuteAlignedTimeout(() => setNow(new Date())), [])
  return now
}

function zoneLabel(now: Date) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? ''
  const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(now).find((part) => part.type === 'timeZoneName')?.value ?? ''
  return [city, short].filter(Boolean)
}

function openSettings(section?: 'about') {
  // La sezione richiesta sopravvive al montaggio lazy del pannello Settings.
  if (section) try { sessionStorage.setItem('adomnia.settings.requested-section', section) } catch { /* solo navigazione */ }
  useAppStore.getState().setActiveRail('settings')
  if (section) window.requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('adomnia:open-settings-section', { detail: section })))
}

/** Riapre il progetto del file (se serve) e il file stesso in Code Studio. */
async function openRecentFile(file: RecentFile) {
  useAppStore.getState().setActiveRail('codestudio')
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  const studio = useCodeStudioStore.getState()
  const session = studio.sessions.find((item) => item.project.rootPath === file.projectRoot)
  if (session) await studio.selectSession(session.id)
  else await studio.openProject(file.projectRoot)
  await useCodeStudioStore.getState().openDocument(file.relativePath)
}

/** Riapre una richiesta salvata dalla history e porta all'API client. */
function openRecentRequest(entry: RecentRequest) {
  useTabsStore.getState().openHistoryEntry(entry.id)
  useAppStore.getState().setActiveRail('collections')
}

/** Same categories and tools as the app rail, so every feature is reachable from the Hub too. */
function HubSidebar() {
  const tr = useUiTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const nav = useNavigationTranslation()
  const open = useAppStore((state) => state.setActiveRail)
  const flags = useSettingsStore((state) => state.settings.features)
  const categories = useMemo(() => visibleRailCategories(flags), [flags])
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <aside className="hub-side">
      <nav className="hub-nav" aria-label={t('Primary navigation')}>
        {categories.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.key] ?? Wrench
          const items = cat.groups.flatMap((group) => group.items)
          const direct = cat.directItem ?? (items.length === 1 ? items[0].id : undefined)
          if (direct) return (
            <button key={cat.key} type="button" onClick={() => open(direct)}><Icon size={20} strokeWidth={1.6} />{nav(cat.label)}</button>
          )
          const isOpen = expanded === cat.key
          return (
            <div key={cat.key} className="hub-nav-group">
              <button type="button" aria-expanded={isOpen} aria-controls={`hub-nav-${cat.key}`} onClick={() => setExpanded(isOpen ? null : cat.key)}>
                <Icon size={20} strokeWidth={1.6} />{nav(cat.label)}<ChevronRight aria-hidden="true" size={14} className="hub-nav-chevron" />
              </button>
              {isOpen && (
                <ul id={`hub-nav-${cat.key}`} className="hub-nav-items">
                  {items.map((item) => {
                    const ItemIcon = FEATURE_ICONS[item.id] ?? Wrench
                    return (
                      <li key={item.id}>
                        <button type="button" onClick={() => open(item.id)}><ItemIcon size={15} strokeWidth={1.6} />{nav(item.label ?? getFeatureLabel(item.id))}</button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
      <nav className="hub-nav hub-nav-foot" aria-label={t('Settings')}>
        <button type="button" onClick={() => openSettings()}><Settings size={20} strokeWidth={1.6} />{t('Settings')}</button>
        <button type="button" onClick={() => openSettings('about')}><Info size={20} strokeWidth={1.6} />{t('About')}</button>
      </nav>
    </aside>
  )
}

export function WelcomePanel() {
  const tr = useUiTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const open = useAppStore((state) => state.setActiveRail)
  const now = useNow()
  const [recent] = useState(loadRecentFiles)
  const history = useTabsStore((state) => state.responseHistory)
  const requests = useMemo(() => recentRequests(history, RECENT_ROWS), [history])
  const [phrase] = useState(loadHubPhrase)
  const flags = useSettingsStore((state) => state.settings.features)
  const [gameOpen, setGameOpen] = useState(false)
  const gameDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (gameOpen && flags.hubGameEnabled) gameDialog.current?.showModal()
    else gameDialog.current?.close()
    if (!flags.hubGameEnabled) setGameOpen(false)
  }, [gameOpen, flags.hubGameEnabled])
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/[.,]/g, '').toUpperCase()
  const zone = zoneLabel(now)

  useEffect(() => {
    // La Hub non ha una barra di ricerca visibile: Ctrl/Cmd+F apre la command palette.
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.dispatchEvent(new CustomEvent('adomnia:open-palette'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div data-hub-page>
      <HubSidebar />
      <HubLaser />
      <main className="hub-main">
        <header className="hub-hero">
          <div className="hub-greeting">
            <p className="hub-eyebrow hub-workspace-label"><span className="hub-workspace-mark" aria-hidden="true" />{t('Workspace')}</p>
            <h1>{t(phrase.title)}</h1>
            <p className="hub-lede">{t(phrase.subtitle)}</p>
          </div>
          <div className="hub-clock">
            <time dateTime={now.toISOString()}>{clock}</time>
            <p>{date}</p>
            <p className="hub-zone">{zone.map((part, index) => <span key={part}>{index > 0 && <i>•</i>}{part}</span>)}</p>
          </div>
        </header>

        {recent.length === 0 && <section className="hub-start" aria-labelledby="hub-start-title">
          <h2 id="hub-start-title" className="hub-eyebrow">{t('Start here')}</h2>
          <div className="hub-start-actions">
            {START_ACTIONS.filter((item) => isFeatureVisible(item.id, flags)).map(({ id, label, icon: Icon }) => (
              <button type="button" key={id} onClick={() => open(id)}>
                <Icon size={22} strokeWidth={1.5} />
                <span><strong>{t(label)}</strong><small>{t(id === 'codestudio' ? 'Open a folder or create a project.' : id === 'collections' ? 'Send a request or import a collection.' : 'Connect to a database.')}</small></span>
              </button>
            ))}
          </div>
        </section>}

        <section className="hub-recent" aria-labelledby="hub-recent-title">
          <header>
            <p id="hub-recent-title" className="hub-eyebrow">{t('Recent')}</p>
            {recent.length > 0 && <button type="button" onClick={() => open('codestudio')}>{t('View all')}<ArrowRight size={16} strokeWidth={1.5} /></button>}
          </header>
          {recent.length > 0
            ? <ul>{recent.slice(0, RECENT_ROWS).map((file) => (
                <li key={`${file.projectRoot}:${file.relativePath}`}>
                  <button type="button" onClick={() => void openRecentFile(file)} title={`${file.projectRoot}/${file.relativePath}`}>
                    <span className="hub-file-icon"><Suspense fallback={<FileText size={22} strokeWidth={1.4} />}><FileIcon name={file.name} relativePath={file.relativePath} size={28} /></Suspense></span>
                    <span className="hub-file-name">{file.name}</span>
                    <span className="hub-file-path">{recentFileFolder(file)}</span>
                    <time dateTime={new Date(file.openedAt).toISOString()}>{timeAgo(file.openedAt, now.getTime())}</time>
                  </button>
                </li>
              ))}</ul>
            : <p className="hub-empty">{t('Files you open in Code Studio appear here.')}</p>}
        </section>

        {requests.length > 0 && (
          <section className="hub-recent hub-requests" aria-labelledby="hub-requests-title">
            <header>
              <p id="hub-requests-title" className="hub-eyebrow">{t('Recent requests')}</p>
              <button type="button" onClick={() => open('history')}>{t('History')}<ArrowRight size={16} strokeWidth={1.5} /></button>
            </header>
            <ul>
              {requests.map((entry) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => openRecentRequest(entry)} title={`${entry.method} ${entry.url}`}>
                    <span className="hub-request-method">{entry.method}</span>
                    <span className="hub-file-name">{entry.name}</span>
                    <span className="hub-file-path">{entry.url}</span>
                    <span className="hub-request-meta">
                      <b className={entry.failed ? 'is-error' : 'is-ok'}>{entry.status || 'ERR'}</b>
                      <time dateTime={entry.recordedAt ? new Date(entry.recordedAt).toISOString() : undefined}>{entry.recordedAt ? timeAgo(entry.recordedAt, now.getTime()) : '—'}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      {flags.hubGameEnabled && <>
        <button type="button" className="hub-play" onClick={() => setGameOpen(true)}>{t("LET'S PLAY!")}<ArrowRight size={20} aria-hidden="true" /></button>
        <dialog ref={gameDialog} className="hub-game-dialog" aria-label={t('Hub game')} onCancel={() => setGameOpen(false)} onClose={() => setGameOpen(false)}>
          {gameOpen && <>
            <header className="hub-game-header"><span>{t("LET'S PLAY!")}</span><button type="button" onClick={() => setGameOpen(false)}>{t('Back to Hub')}</button></header>
            <Suspense fallback={<p role="status">{t('Loading game…')}</p>}><HubGame /></Suspense>
          </>}
        </dialog>
      </>}
    </div>
  )
}

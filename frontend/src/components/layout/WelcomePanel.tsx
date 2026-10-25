import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowRight, Code2, Database, FileText, Hexagon, House, Info, Radio, Send, Settings, type LucideIcon } from 'lucide-react'
import { isFeatureVisible } from '@/lib/featureRegistry'
import { minuteAlignedTimeout } from '@/lib/visiblePolling'
import { loadRecentFiles, recentFileFolder, timeAgo, type RecentFile } from '@/lib/recentFiles'
import { useAppStore, type RailItem } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import { greeting } from './hubGreeting'
import '@fontsource/doto/latin-800.css'
import '@fontsource/geist-mono/latin-400.css'
import './WelcomePanel.css'
import { useActivityStore } from '@/stores/activity'

const Threads = lazy(() => import('./react-bits/Threads'))

// Code Studio stays lazy: the file icon set loads only when the Hub shows a recent file.
const FileIcon = lazy(() => import('@/components/code-studio/CodeStudioFileIcon').then((module) => ({ default: module.CodeStudioFileIcon })))

const NAV: ReadonlyArray<{ id: RailItem; label: string; icon: LucideIcon }> = [
  { id: 'codestudio', label: 'Code Studio', icon: Code2 },
  { id: 'collections', label: 'API Client', icon: Send },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'broker', label: 'Messaging', icon: Radio },
  { id: 'powertools', label: 'Tools', icon: Hexagon },
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

function HubSidebar() {
  const tr = useUiTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const open = useAppStore((state) => state.setActiveRail)
  const flags = useSettingsStore((state) => state.settings.features)
  return (
    <aside className="hub-side">
      <nav className="hub-nav" aria-label={t('Primary navigation')}>
        <button type="button" aria-current="page"><House size={20} strokeWidth={1.6} />{t('Home')}</button>
        {NAV.filter((item) => isFeatureVisible(item.id, flags)).map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => open(id)}><Icon size={20} strokeWidth={1.6} />{t(label)}</button>
        ))}
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
  const animationPaused = useActivityStore((state) => state.phase !== 'Active')
  const [recent] = useState(loadRecentFiles)
  const [greetingVariant] = useState(() => Math.floor(Math.random() * 3))
  const flags = useSettingsStore((state) => state.settings.features)
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
      <main className="hub-main">
        <header className="hub-hero">
          <div className="hub-greeting">
            <p className="hub-eyebrow hub-workspace-label"><span className="hub-workspace-mark" aria-hidden="true" />{t('Workspace')}</p>
            <h1>{t(greeting(now.getHours(), greetingVariant))}</h1>
            <p className="hub-lede">{t(recent.length ? 'Pick up where you left off.' : 'Choose where to start.')}</p>
          </div>
          <div className="hub-clock">
            <time dateTime={now.toISOString()}>{clock}</time>
            <p>{date}</p>
            <p className="hub-zone">{zone.map((part, index) => <span key={part}>{index > 0 && <i>•</i>}{part}</span>)}</p>
          </div>
        </header>

        <div className="hub-threads" aria-hidden="true">
          <Suspense fallback={null}>
            <Threads color="currentColor" lineCount={24} thickness={1.6} softness={1}
              amplitude={1.2} distance={0.12} waves={1.3} speed={0.45} split={0.3}
              fray={0.15} angle={0} taper={0.4} brightness={1.5} enableMouseInteraction paused={animationPaused} />
          </Suspense>
        </div>

        {recent.length === 0 && <section className="hub-start" aria-labelledby="hub-start-title">
          <h2 id="hub-start-title" className="hub-eyebrow">{t('Start here')}</h2>
          <div className="hub-start-actions">
            {NAV.filter((item) => ['codestudio', 'collections', 'database'].includes(item.id) && isFeatureVisible(item.id, flags)).map(({ id, label, icon: Icon }) => (
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
      </main>
    </div>
  )
}

import { useState } from 'react'
import { ArrowRight, ArrowUpRight, Search, Plus, Layers, CircleDot } from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { useNavigationTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'
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
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e5ecf8"/><stop offset=".5" stopColor="#b1bfd5"/><stop offset="1" stopColor="#75849b"/></linearGradient></defs>
    <g fill={`url(#${id})`}>
      {target === 'goide' && <><path d="M26 23v23c0 8-5 12-13 12-4 0-7-1-10-3l3-4c2 2 4 2 7 2 5 0 8-2 8-7v-3a12 12 0 1 1 0-18v-2zm-5 11a7 7 0 1 0-14 0 7 7 0 0 0 14 0" fillRule="evenodd"/><circle cx="44" cy="31" r="17" fill="none" stroke={`url(#${id})`} strokeWidth="5"/></>}
      {target === 'collections' && <><path d="M32 4a28 28 0 0 0-15 52l7-12a15 15 0 0 1 8-28z"/><path d="M36 8a25 25 0 0 1 0 50V45a12 12 0 0 0 0-24z"/></>}
      {target === 'database' && <><ellipse cx="32" cy="14" rx="24" ry="11"/><path d="M8 22q24 16 48 0v10q-24 18-48 0zM8 37q24 16 48 0v10q-24 18-48 0z"/></>}
      {target === 'jsonviewer' && <><path d="m32 3 28 16-28 16L4 19zM4 32l9-5 19 11 19-11 9 5-28 16zM4 45l9-5 19 11 19-11 9 5-28 16z"/></>}
      {target === 'gitsync' && <><path d="m20 48 13-28M25 46l20 4" fill="none" stroke={`url(#${id})`} strokeWidth="3" strokeDasharray="5 4"/><circle cx="35" cy="12" r="8"/><circle cx="13" cy="53" r="9"/><circle cx="52" cy="53" r="9"/></>}
      {target === 'powertools' && <><path d="m32 3 27 15v30L32 63 5 48V18zm0 15L18 26v16l14 8 14-8V26z" fillRule="evenodd"/><path d="M32 3v15M5 18l13 8M59 18l-13 8M5 48l13-6M59 48l-13-6M32 50v13" fill="none" stroke="#65748b" strokeWidth="1"/></>}
    </g>
  </svg>
}

export function WelcomePanel() {
  const tr = useUiTranslation()
  const nav = useNavigationTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const open = useAppStore(s => s.setActiveRail)
  const workspaces = useCollectionsStore(s => s.workspaces)
  const workspaceId = useCollectionsStore(s => s.activeWorkspaceId)
  const history = useTabsStore(s => s.responseHistory)
  const openHistory = useTabsStore(s => s.openHistoryEntry)
  const newTab = useTabsStore(s => s.newTab)
  const tabs = useTabsStore(s => s.tabs)
  const [filter, setFilter] = useState<'all' | 'success' | 'errors'>('all')
  const workspace = workspaces.find(w => w.id === workspaceId)
  const recent = history.filter(h => filter === 'all' || (filter === 'errors' ? !!h.response.error || h.response.status >= 400 : !h.response.error && h.response.status < 400)).slice(0, 4)
  const actions: { title: string; detail: string; run: () => void }[] = [
    { title: 'Open project', detail: 'Open a project from your machine', run: () => open('goide') },
    { title: 'New request', detail: 'Create and send an API request', run: () => { newTab(); open('collections') } },
    { title: 'Add connection', detail: 'Open Database Studio', run: () => open('database') },
  ]
  return <div data-hub-page>
    <header className="hub-topbar">
      <span className="hub-breadcrumb">adOmnia <span>/</span> <strong>{t('Overview')}</strong></span>
      <button className="hub-search" onClick={() => document.dispatchEvent(new CustomEvent('adomnia:open-palette'))}><Search size={18}/><span>{t('Search tools, requests, docs, code...')}</span><kbd>Ctrl K</kbd></button>
      <span className="hub-local">{t('Local')} <i/></span>
    </header>
    <main className="hub-content">
      <section className="hub-primary">
        <div className="hub-studios">
          <p className="hub-eyebrow">{t('Workspace')}</p>
          <h1>{t('Make your next move.')}</h1>
          <p className="hub-lede">{t('Code. Connect. Build.')}</p>
          <div className="hub-grid">{cards.map(({ title, description, target }) => <button key={target} className="hub-studio" onClick={() => open(target as RailItem)}>
            <span className="hub-studio-icon" aria-hidden="true"><StudioIcon target={target}/></span>
            <span><strong>{nav(title)}</strong><small>{t(description)}</small></span><ArrowUpRight size={21}/>
          </button>)}</div>
        </div>
        <aside className="hub-resume">
          <p className="hub-eyebrow">{t('Continue working')}</p>
          <h2>{workspace?.name ?? 'adOmnia'}</h2>
          <p className="hub-muted">{t('Your local workspace')}</p>
          <div className="hub-workspace-meta"><Layers size={18}/><span>{t('Workspace')}</span><span className="hub-meta-divider"/><span>{tabs.filter(tab => tab.workspaceId === workspaceId).length} {t('open tabs')}</span></div>
          <button className="hub-resume-button" onClick={() => open('collections')}>{t('Resume workspace')}<ArrowRight size={21}/></button>
          <div className="hub-resume-note"><i/>{t('Local-first. Ready.')}<small>{t('Your data stays on your machine.')}</small></div>
        </aside>
      </section>
      <section className="hub-secondary">
        <div className="hub-activity">
          <p className="hub-eyebrow">{t('Recent activity')}</p>
          <div className="hub-filters" role="group" aria-label={t('Recent activity')}>{(['all', 'success', 'errors'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(f === 'all' ? 'All' : f === 'success' ? 'Successful' : 'Errors')}</button>)}</div>
          {recent.length ? recent.map(entry => <button className="hub-history-row" key={entry.id} onClick={() => { openHistory(entry.id); open('collections') }}>
            <span className="hub-method">{entry.request?.method ?? 'HTTP'}</span><span className="hub-history-url">{entry.request?.url || entry.request?.name || t('Request')}</span>
            <span className="hub-status" data-error={!!entry.response.error || entry.response.status >= 400}><i/>{entry.response.error ? t('Error') : entry.response.status}</span>
            <time>{entry.recordedAt ? new Date(entry.recordedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</time>
          </button>) : <div className="hub-empty"><CircleDot size={24}/><strong>{t('No recent requests')}</strong><span>{t('Send a request to see your activity here.')}</span></div>}
          {history.length > 4 && <button className="hub-history-more" onClick={() => open('history')}>{t('View all history')}<ArrowRight size={14}/></button>}
        </div>
        <aside className="hub-start"><p className="hub-eyebrow">{t('Start something new')}</p>{actions.map(action => <button key={action.title} onClick={action.run}><Plus size={23}/><span><strong>{t(action.title)}</strong><small>{t(action.detail)}</small></span><ArrowUpRight size={17}/></button>)}</aside>
      </section>
    </main>
  </div>
}

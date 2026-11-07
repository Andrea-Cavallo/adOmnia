import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Code2, RefreshCw, Search, Send, X } from 'lucide-react'
import { useUiTranslation } from '@/lib/uiI18n'
import { cn } from '@/lib/utils'
import { endpointCatalog, filterCatalog, groupCatalog, type CatalogEndpoint, type CatalogSource } from '@/lib/api-code-link/catalog'

const OPEN_KEY = 'adomnia.endpoints.open'
const MAX_VISIBLE = 400

const METHOD_TONE: Record<string, string> = {
  GET: 'text-success', POST: 'text-accent', PUT: 'text-warning', PATCH: 'text-accent',
  DELETE: 'text-error', HEAD: 'text-text-3', OPTIONS: 'text-text-3', ANY: 'text-text-3',
}

function initialOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true }
}

function openRequest(item: CatalogEndpoint): void {
  void import('@/lib/devsession/codeToApi').then(({ openLinkedRequest }) => openLinkedRequest(item.sessionId, item.route))
}

function openInCodeStudio(item: CatalogEndpoint): void {
  void import('@/lib/api-code-link/actions').then((module) => module.showLinkedRoute(item.sessionId, item.route))
}

/**
 * API navigation tree: every route discovered in the open Code Studio projects,
 * grouped by project and controller/package. The request is generated from the
 * handler, so testing an endpoint never requires leaving the API workspace.
 */
export function EndpointBrowser() {
  const tr = useUiTranslation()
  const [open, setOpen] = useState(initialOpen)
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState<CatalogSource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)

  const readSources = useCallback(async (): Promise<CatalogSource[]> => {
    const [{ useDevContextStore }, { listGoIDESessions }] = await Promise.all([
      import('@/stores/devcontext'),
      import('@/lib/code-studio-api'),
    ])
    const sessions = await listGoIDESessions()
    await Promise.all(sessions.map((session) => useDevContextStore.getState().ensure(session.id)))
    const snapshots = useDevContextStore.getState().snapshots
    return sessions.map((session) => ({
      sessionId: session.id,
      projectName: session.project.name || session.project.rootPath.split(/[\\/]/).filter(Boolean).pop() || session.id,
      root: session.project.rootPath,
      snapshot: snapshots[session.id],
    }))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await readSources()
      if (mounted.current) setSources(next)
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [readSources])

  useEffect(() => {
    mounted.current = true
    let disposed = false
    let unsubscribe = () => {}
    // The endpoint index is optional context: let the workspace paint first.
    const timer = window.setTimeout(() => { void refresh() }, 250)
    void import('@/stores/devcontext').then(({ useDevContextStore }) => {
      const off = useDevContextStore.subscribe((state) => {
        if (!mounted.current) return
        setSources((current) => current.map((source) => ({ ...source, snapshot: state.snapshots[source.sessionId] })))
      })
      if (disposed) off()
      else unsubscribe = off
    })
    return () => {
      disposed = true
      mounted.current = false
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [refresh])

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0') } catch { /* ignore */ }
  }

  const items = useMemo(() => endpointCatalog(sources), [sources])
  const filtered = useMemo(() => filterCatalog(items, query), [items, query])
  const visible = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered])
  const groups = useMemo(() => groupCatalog(visible), [visible])

  return (
    <section className="flex shrink-0 flex-col border-b border-border-1" aria-label={tr('Endpoints')}>
      <div className="flex h-8 shrink-0 items-center gap-1 px-1.5">
        <button type="button" onClick={toggle} aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3 hover:text-text-1">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="truncate">{tr('Endpoints')}</span>
          {items.length > 0 && <span className="shrink-0 rounded bg-surface-3 px-1 text-[9px] font-medium text-text-3">{filtered.length}</span>}
        </button>
        <button type="button" onClick={() => void refresh()} disabled={loading} title={tr('Refresh endpoints')} aria-label={tr('Refresh endpoints')}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40">
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {open && (
        <div className="flex min-h-0 flex-col pb-1.5">
          {items.length > 0 && (
            <div className="mx-1.5 mb-1 flex h-6 shrink-0 items-center gap-1 rounded border border-border-2 bg-surface-2 px-1.5 focus-within:border-accent">
              <Search size={10} className="shrink-0 text-text-4" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('Filter endpoints…')} aria-label={tr('Filter endpoints')}
                className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-4" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={tr('Clear filter')} className="shrink-0 text-text-4 hover:text-text-1"><X size={10} /></button>}
            </div>
          )}
          <div className="max-h-[min(38vh,340px)] min-h-0 overflow-y-auto">
            {sources.length === 0 && !loading && (
              <p className="px-2 py-1.5 text-[11px] leading-4 text-text-4">{tr('Open a project in Code Studio to browse its endpoints.')}</p>
            )}
            {sources.length > 0 && items.length === 0 && !loading && (
              <p className="px-2 py-1.5 text-[11px] leading-4 text-text-4">{tr('No HTTP endpoints detected in the open projects.')}</p>
            )}
            {error && <p className="px-2 py-1.5 text-[11px] text-error">{error}</p>}
            {groups.map((project) => (
              <div key={project.projectName} className="pb-1">
                <div className="px-2 pb-0.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-text-4">{project.projectName}</div>
                {project.groups.map((group) => (
                  <div key={`${project.projectName}:${group.name}`}>
                    <div className="px-2 py-0.5 text-[10px] text-text-4">{group.name}</div>
                    {group.items.map((item) => (
                      <EndpointRow key={item.id} item={item} onOpen={() => openRequest(item)} onCode={() => openInCodeStudio(item)} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {filtered.length > MAX_VISIBLE && (
              <p className="px-2 py-1 text-[10px] text-text-4">{tr('Showing the first 400 endpoints; refine the filter.')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function EndpointRow({ item, onOpen, onCode }: { item: CatalogEndpoint; onOpen: () => void; onCode: () => void }) {
  const tr = useUiTranslation()
  return (
    <div className="group flex h-6 items-center gap-1 rounded px-1.5 hover:bg-surface-2/70">
      <button type="button" onClick={onOpen} title={`${item.method} ${item.path} · ${item.handler} · ${item.file}:${item.line}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span className={cn('w-10 shrink-0 font-mono text-[9px] font-bold', METHOD_TONE[item.method] ?? 'text-text-3')}>{item.method === 'ANY' ? 'ANY' : item.method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2">{item.path}</span>
        <Send size={9} className="shrink-0 text-text-4 opacity-0 group-hover:opacity-70" aria-hidden="true" />
      </button>
      <button type="button" onClick={onCode} title={tr('Open in Code Studio')} aria-label={tr('Open in Code Studio')}
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:bg-surface-3 hover:text-accent group-hover:opacity-100 focus:opacity-100">
        <Code2 size={10} />
      </button>
    </div>
  )
}

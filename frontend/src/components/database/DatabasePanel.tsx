import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Database, X } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { confirm } from '@/lib/confirmDialog'
import { useEnvironmentsStore } from '@/stores/environments'
import { useAppStore } from '@/stores/app'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { safeStorageGet, safeStoragePut } from '@/lib/wailsStorage'
import { ConnectionsSidebar } from './ConnectionsSidebar'
import { QueryEditor } from './QueryEditor'
import { ResultsView } from './ResultsView'
import { RightRail } from './RightRail'
import {
  CONNECTIONS_KEY, DRIVER_META, FAVORITES_KEY, HISTORY_KEY, MONGO_DEFAULT_QUERY,
  SQL_DEFAULT_QUERY, STORAGE_BUCKET, WORKSPACE_KEY,
  blankConnection, blankTab, browseQuery, countQuery, csvEscape, download,
  createObjectQuery, defaultConnectionName, extractCount, extractNames, introspectionQuery,
  isDangerous, isDangerousMongo, nextQueryName, normalizeConnection, substituteVars, validateConnection,
  type DbConnection, type DbDriver, type DbResult, type HistoryItem, type QueryTab, type SchemaItem,
} from './dbShared'

interface QueryWorkspaceState {
  tabs: QueryTab[]
  activeTabId: string
  limit: number
  timeoutMs: number
}

export function DatabasePanel() {
  const port = useServerPort()
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const vars = getResolvedVars()

  const [connections, setConnections] = useState<DbConnection[]>([])
  const [activeId, setActiveId] = useState('')
  const [tabs, setTabs] = useState<QueryTab[]>([blankTab('Query 1')])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  const [limit, setLimit] = useState(200)
  const [timeoutMs, setTimeoutMs] = useState(30000)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [result, setResult] = useState<DbResult | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [focusToken, setFocusToken] = useState(0)

  const [schemaItems, setSchemaItems] = useState<SchemaItem[]>([])
  const [schemaDb, setSchemaDb] = useState('')
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState('')
  const [schemaSearch, setSchemaSearch] = useState('')
  const [createObjectOpen, setCreateObjectOpen] = useState(false)
  const [createObjectName, setCreateObjectName] = useState('')
  const [createObjectError, setCreateObjectError] = useState('')

  const active = connections.find((c) => c.id === activeId) ?? connections[0] ?? blankConnection()
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const query = activeTab?.query ?? ''
  const isMongo = active.driver === 'mongodb'
  const renderedQuery = useMemo(() => substituteVars(query, vars), [query, vars])
  const dangerous = isMongo ? isDangerousMongo(renderedQuery) : isDangerous(renderedQuery)

  // ── auto-dismiss success toast ────────────────────────────────────────────
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(t)
  }, [message])

  // ── load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [rawConnections, rawHistory, rawFavorites, rawWorkspace] = await Promise.all([
        safeStorageGet(STORAGE_BUCKET, CONNECTIONS_KEY),
        safeStorageGet(STORAGE_BUCKET, HISTORY_KEY),
        safeStorageGet(STORAGE_BUCKET, FAVORITES_KEY),
        safeStorageGet(STORAGE_BUCKET, WORKSPACE_KEY),
      ])
      let nextConnections = [blankConnection()]
      if (rawConnections) {
        try {
          const loaded = JSON.parse(rawConnections) as Partial<DbConnection>[]
          if (Array.isArray(loaded) && loaded.length) nextConnections = loaded.map(normalizeConnection)
        } catch {
          setError('Saved database connections could not be read; a clean local connection was created.')
        }
      }
      const pendingRaw = localStorage.getItem('adomnia.database.pendingConnection')
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw) as Partial<DbConnection>
          const pendingConn = normalizeConnection({ ...pending, id: crypto.randomUUID() })
          nextConnections = [pendingConn, ...nextConnections]
          await safeStoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, JSON.stringify(nextConnections))
          setMessage(`Docker Lab connection "${pendingConn.name}" added`)
        } catch {
          setError('Could not import Docker Lab database connection')
        } finally {
          localStorage.removeItem('adomnia.database.pendingConnection')
        }
      }
      setConnections(nextConnections)
      setActiveId(nextConnections[0]?.id ?? '')
      try { setFavorites(rawFavorites ? JSON.parse(rawFavorites) : []) } catch { setFavorites([]) }
      // migrate legacy history (string[]) → HistoryItem[]
      if (rawHistory) {
        try {
          const parsed = JSON.parse(rawHistory) as unknown[]
          const items: HistoryItem[] = parsed.map((h) =>
            typeof h === 'string' ? { query: h, ts: 0 } : (h as HistoryItem)
          )
          setHistory(items)
        } catch { setHistory([]) }
      }
      const first = nextConnections[0]
      let restored = false
      if (rawWorkspace) {
        try {
          const workspace = JSON.parse(rawWorkspace) as Partial<QueryWorkspaceState>
          if (Array.isArray(workspace.tabs) && workspace.tabs.length) {
            const restoredTabs = workspace.tabs.filter((tab) => tab && typeof tab.id === 'string' && typeof tab.name === 'string' && typeof tab.query === 'string')
            if (restoredTabs.length) {
              setTabs(restoredTabs)
              setActiveTabId(restoredTabs.some((tab) => tab.id === workspace.activeTabId) ? workspace.activeTabId! : restoredTabs[0].id)
              if (Number.isFinite(workspace.limit)) setLimit(Math.max(1, Math.min(5000, Number(workspace.limit))))
              if (Number.isFinite(workspace.timeoutMs)) setTimeoutMs(Math.max(1000, Number(workspace.timeoutMs)))
              restored = true
            }
          }
        } catch { /* use a clean query workspace */ }
      }
      if (!restored && first?.driver === 'mongodb') setTabs([blankTab('Mongo JSON Runner', MONGO_DEFAULT_QUERY)])
      setHydrated(true)
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => {
      void safeStoragePut(STORAGE_BUCKET, WORKSPACE_KEY, JSON.stringify({ tabs, activeTabId, limit, timeoutMs } satisfies QueryWorkspaceState))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [activeTabId, hydrated, limit, tabs, timeoutMs])

  useEffect(() => { if (tabs[0]) setActiveTabId((id) => (tabs.some((t) => t.id === id) ? id : tabs[0].id)) }, [tabs])

  // ── persistence helpers ─────────────────────────────────────────────────
  const persistConnections = async (next: DbConnection[]) => {
    setConnections(next)
    await safeStoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, JSON.stringify(next))
  }

  const updateActive = (patch: Partial<DbConnection>) => {
    void persistConnections(connections.map((c) => c.id === active.id ? { ...c, ...patch } : c))
  }

  const setQuery = (q: string) => {
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, query: q } : t))
  }

  const setDriver = (driver: DbDriver) => {
    const automaticName = active.name === 'Local SQLite' || /^(SQLite|PostgreSQL|MySQL|MongoDB) Connection$/i.test(active.name)
    updateActive({ driver, port: DRIVER_META[driver].port, ...(automaticName ? { name: defaultConnectionName(driver) } : {}) })
    setResult(null)
    setError('')
    setSchemaError('')
    setSchemaItems([])
    if (driver === 'mongodb' && !query.trim().startsWith('{')) setQuery(MONGO_DEFAULT_QUERY)
    else if (driver !== 'mongodb' && query.trim().startsWith('{')) setQuery(SQL_DEFAULT_QUERY)
  }

  const selectConnection = (id: string) => {
    setActiveId(id)
    setResult(null)
    setError('')
    setSchemaItems([])
    setSchemaError('')
  }

  const addConnection = () => {
    const conn = { ...blankConnection(), name: `Local SQLite ${connections.length + 1}` }
    void persistConnections([...connections, conn])
    setActiveId(conn.id)
  }

  const deleteConnection = (id: string) => {
    if (connections.length <= 1) return
    const next = connections.filter((c) => c.id !== id)
    void persistConnections(next)
    if (activeId === id) setActiveId(next[0]?.id ?? '')
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  const addTab = () => {
    const tab = blankTab(nextQueryName(tabs), '')
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setResult(null)
    setError('')
    setLogs([])
    setMessage(`${tab.name} opened`)
    setFocusToken((token) => token + 1)
  }

  // A .sql dropped anywhere in the app opens here as a new query tab (see useFileDrop / globalFileRouter).
  const consumeFileImport = useAppStore((s) => s.consumeFileImport)
  const pendingFileImport = useAppStore((s) => s.pendingFileImport)
  useEffect(() => {
    const routed = consumeFileImport('sql')
    if (routed?.kind !== 'sql') return
    const tab = blankTab(routed.name.replace(/\.sql$/i, '') || nextQueryName(tabs), routed.text)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setResult(null)
    setError('')
    setLogs([])
    setMessage(`${routed.name} imported`)
    setFocusToken((token) => token + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeFileImport, pendingFileImport])

  const selectTab = (id: string) => {
    if (id === activeTabId) return
    setActiveTabId(id)
    setResult(null)
    setError('')
    setLogs([])
    setFocusToken((token) => token + 1)
  }

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    setTabs(next)
    if (activeTabId === id) setActiveTabId(next[Math.max(0, idx - 1)].id)
    setResult(null)
    setError('')
    setLogs([])
  }

  // ── backend ───────────────────────────────────────────────────────────────
  const api = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) throw new Error('Backend not ready')
    const res = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) throw new Error(text.trim() || res.statusText)
    return text ? JSON.parse(text) : {}
  }

  const runQuery = async (explain = false, confirmed = false) => {
    setError('')
    const connectionError = validateConnection(active)
    if (connectionError) { setError(connectionError); return }
    if (!renderedQuery.trim()) { setError('Write a query before running it.'); return }
    if (isMongo) {
      try { JSON.parse(renderedQuery) } catch { setError('MongoDB queries must be valid JSON.'); return }
    }
    if (dangerous && !confirmed) {
      const ok = await confirm({
        title: isMongo ? 'Confirm write operation' : 'Confirm dangerous query',
        message: isMongo
          ? 'MongoDB write operation detected. updateMany/deleteMany change local or remote data. Continue?'
          : 'Dangerous query detected. DROP/TRUNCATE or DELETE/UPDATE without WHERE changes data. Continue?',
        confirmLabel: 'Run query',
        variant: 'danger',
      })
      if (!ok) return
      confirmed = true
    }
    setRunning(true)
    try {
      const data = await api('/database/query', { connection: active, query: renderedQuery, limit, timeoutMs, explain, confirm: confirmed }) as DbResult
      setResult(data)
      const item: HistoryItem = { query, ts: Date.now(), label: activeTab?.name }
      const nextHistory = [item, ...history.filter((h) => h.query !== query)].slice(0, 50)
      setHistory(nextHistory)
      await safeStoragePut(STORAGE_BUCKET, HISTORY_KEY, JSON.stringify(nextHistory))
      setLogs([
        `[${new Date().toLocaleTimeString()}] ${explain ? 'EXPLAIN ' : ''}${data.statementType || 'query'} on ${data.driver}`,
        `→ ${data.columns?.length ? `${data.rows.length} rows` : `${data.rowsAffected} affected`} in ${data.durationMs} ms${data.limited ? ` (auto-limited to ${limit})` : ''}`,
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLogs([`[${new Date().toLocaleTimeString()}] error: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setRunning(false)
    }
  }

  const testConnection = async () => {
    setError('')
    const connectionError = validateConnection(active)
    if (connectionError) { setError(connectionError); return }
    setRunning(true)
    try {
      const data = await api('/database/test', active) as { driver: string; durationMs: number }
      setMessage(`Connected to ${data.driver} in ${data.durationMs} ms`)
      void refreshSchema(active)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const refreshSchema = async (target = active) => {
    const connectionError = validateConnection(target)
    if (connectionError) { setSchemaError(connectionError); setSchemaItems([]); return }
    const introspection = introspectionQuery(target.driver)
    if (!introspection) { setSchemaItems([]); return }
    setSchemaLoading(true)
    setSchemaError('')
    try {
      const data = await api('/database/query', { connection: target, query: introspection, limit: 1000, timeoutMs, explain: false, confirm: false }) as DbResult
      const names = extractNames(data)
      const baseItems: SchemaItem[] = names.map((name) => ({ name, count: null }))
      setSchemaItems(baseItems)
      setSchemaDb(target.database || (target.driver === 'sqlite' ? target.sqlitePath.split(/[\\/]/).pop() || 'SQLite' : DRIVER_META[target.driver].short))
      const capped = names.slice(0, 30)
      const counts = await Promise.allSettled(
        capped.map((n) => api('/database/query', { connection: target, query: countQuery(target.driver, n), limit: 1, timeoutMs, explain: false, confirm: false }) as Promise<DbResult>)
      )
      setSchemaItems(baseItems.map((item, idx) => {
        const r = counts[idx]
        return r && r.status === 'fulfilled' ? { ...item, count: extractCount(r.value) } : item
      }))
    } catch (e) {
      setSchemaItems([])
      setSchemaError(e instanceof Error ? e.message : String(e))
    } finally {
      setSchemaLoading(false)
    }
  }

  const createLocalSQLite = async () => {
    setError('')
    setRunning(true)
    try {
      const created = await api('/database/sqlite/create-local', { name: `adomnia-${active.id.slice(0, 8)}` }) as { path: string }
      const nextActive: DbConnection = {
        ...active,
        driver: 'sqlite',
        name: active.name.trim() && active.name !== 'Local SQLite' ? active.name : 'Local SQLite',
        port: 0,
        dsn: '',
        sqlitePath: created.path,
      }
      await persistConnections(connections.map((connection) => connection.id === active.id ? nextActive : connection))
      setMessage(`Local database ready: ${created.path}`)
      await refreshSchema(nextActive)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const createSchemaObject = async () => {
    setCreateObjectError('')
    let statement = ''
    try {
      statement = createObjectQuery(active.driver, createObjectName)
    } catch (e) {
      setCreateObjectError(e instanceof Error ? e.message : String(e))
      return
    }
    const connectionError = validateConnection(active)
    if (connectionError) { setCreateObjectError(connectionError); return }
    setRunning(true)
    try {
      await api('/database/query', { connection: active, query: statement, limit: 1, timeoutMs, explain: false, confirm: false })
      setCreateObjectOpen(false)
      setCreateObjectName('')
      setMessage(`${active.driver === 'mongodb' ? 'Collection' : 'Table'} created`)
      await refreshSchema(active)
    } catch (e) {
      setCreateObjectError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const formatQuery = () => {
    if (isMongo) {
      try { setQuery(JSON.stringify(JSON.parse(query), null, 2)) } catch { /* leave invalid JSON untouched */ }
    } else {
      setQuery(query.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim())
    }
  }

  const saveQuery = () => {
    if (!query.trim() || favorites.includes(query)) { setMessage('Query already saved'); return }
    const next = [query, ...favorites].slice(0, 30)
    setFavorites(next)
    void safeStoragePut(STORAGE_BUCKET, FAVORITES_KEY, JSON.stringify(next))
    setMessage('Query saved to favorites')
  }

  const toggleFavorite = () => {
    const next = favorites.includes(query) ? favorites.filter((f) => f !== query) : [query, ...favorites].slice(0, 30)
    setFavorites(next)
    void safeStoragePut(STORAGE_BUCKET, FAVORITES_KEY, JSON.stringify(next))
  }

  const clearHistory = () => {
    setHistory([])
    void safeStoragePut(STORAGE_BUCKET, HISTORY_KEY, JSON.stringify([]))
  }

  const sendConnectionSecretToVault = () => {
    const value = active.dsn || active.password
    if (!value) { setError('No DSN or password to send to Vault'); return }
    safeSetItem('adomnia.vault.pendingSecret', JSON.stringify({
      name: `${active.name} ${active.dsn ? 'DSN' : 'password'}`,
      value,
      note: `Database ${DRIVER_META[active.driver].label} credential. Original connection remains in Database Studio until you remove or mask it.`,
    }))
    updateActive({ savedInVault: true })
    useAppStore.getState().setActiveRail('vault')
  }

  const exportJson = () => {
    if (!result) return
    download('database-result.json', JSON.stringify({ columns: result.columns, rows: result.rows, durationMs: result.durationMs }, null, 2), 'application/json')
  }

  const exportCsv = () => {
    if (!result) return
    const lines = [result.columns.map(csvEscape).join(','), ...result.rows.map((row) => result.columns.map((col) => csvEscape(row[col])).join(','))]
    download('database-result.csv', lines.join('\n'), 'text/csv')
  }

  const pickQuery = (value: string) => {
    setQuery(value)
    setResult(null)
    setError('')
    setLogs([])
    setFocusToken((token) => token + 1)
  }

  // ── render ──────────────────────────────────────────────────────────────
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-surface-0">
      <ConnectionsSidebar
        connections={connections}
        active={active}
        running={running}
        onSelect={selectConnection}
        onAdd={addConnection}
        onDelete={deleteConnection}
        onUpdate={updateActive}
        onSetDriver={setDriver}
        onTest={testConnection}
        onVault={sendConnectionSecretToVault}
        onCreateLocalSQLite={() => void createLocalSQLite()}
      />

      <section className="grid min-w-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <QueryEditor
          tabs={tabs}
          activeTabId={activeTabId}
          query={query}
          isMongo={isMongo}
          dangerous={dangerous}
          varsCount={Object.keys(vars).length}
          limit={limit}
          timeoutMs={timeoutMs}
          running={running}
          focusToken={focusToken}
          onSelectTab={selectTab}
          onAddTab={addTab}
          onCloseTab={closeTab}
          onChangeQuery={setQuery}
          onSetLimit={setLimit}
          onSetTimeout={setTimeoutMs}
          onRun={(explain) => void runQuery(explain)}
          onFormat={formatQuery}
          onSave={saveQuery}
        />
        <ResultsView
          result={result}
          isMongo={isMongo}
          error={error}
          logs={logs}
          onExportJson={exportJson}
          onExportCsv={exportCsv}
          onRerun={() => void runQuery(false)}
        />
      </section>

      <RightRail
        isMongo={isMongo}
        favorites={favorites}
        history={history}
        schemaItems={schemaItems}
        schemaDb={schemaDb}
        schemaLoading={schemaLoading}
        schemaError={schemaError}
        schemaSearch={schemaSearch}
        currentQuery={query}
        onAddFavorite={toggleFavorite}
        onPickQuery={pickQuery}
        onClearHistory={clearHistory}
        onRefreshSchema={() => void refreshSchema()}
        onSchemaSearch={setSchemaSearch}
        onPickCollection={(name) => pickQuery(browseQuery(active.driver, name))}
        onCreateObject={() => { setCreateObjectName(''); setCreateObjectError(''); setCreateObjectOpen(true) }}
      />

      {createObjectOpen && (
        <div className="fixed inset-0 z-[260] grid place-items-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateObjectOpen(false) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="database-create-title" className="w-full max-w-sm rounded-md border border-border-2 bg-surface-2 shadow-2xl">
            <div className="flex h-11 items-center gap-2 border-b border-border-1 px-3.5">
              <Database size={14} className="text-accent" />
              <h3 id="database-create-title" className="text-[13px] font-semibold text-text-1">Create {isMongo ? 'collection' : 'table'}</h3>
              <button onClick={() => setCreateObjectOpen(false)} className="ml-auto grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1" aria-label="Close create database object dialog"><X size={14} /></button>
            </div>
            <div className="space-y-3 p-3.5">
              <label className="block text-[11px] font-medium text-text-2">
                Name
                <input
                  autoFocus
                  value={createObjectName}
                  onChange={(event) => { setCreateObjectName(event.target.value); setCreateObjectError('') }}
                  onKeyDown={(event) => { if (event.key === 'Enter') void createSchemaObject(); if (event.key === 'Escape') setCreateObjectOpen(false) }}
                  placeholder={isMongo ? 'audit_events' : 'users'}
                  className="mt-1.5 h-8 w-full rounded-md border border-border-2 bg-surface-0 px-2.5 font-mono text-[12px] text-text-1 outline-none focus:border-accent"
                />
              </label>
              <p className="text-[10.5px] leading-4 text-text-4">A minimal {isMongo ? 'collection' : 'table with a primary key'} will be created on the active connection.</p>
              {createObjectError && <div className="rounded border border-error/30 bg-error/10 px-2.5 py-2 text-[11px] text-error">{createObjectError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-1 px-3.5 py-3">
              <button onClick={() => setCreateObjectOpen(false)} className="h-8 rounded-md border border-border-2 px-3 text-[11.5px] text-text-2 hover:bg-surface-3">Cancel</button>
              <button onClick={() => void createSchemaObject()} disabled={running || !createObjectName.trim()} className="h-8 rounded-md bg-accent px-3 text-[11.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* success toast */}
      {message && !error && (
        <div className="absolute bottom-4 left-[352px] z-40 flex items-center gap-2 rounded-lg border border-success/30 bg-surface-2 px-3.5 py-2 text-[11.5px] text-success shadow-xl">
          <CheckCircle2 size={14} /> {message}
        </div>
      )}
    </div>
  )
}

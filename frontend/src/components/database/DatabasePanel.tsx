import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
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
  SQL_DEFAULT_QUERY, STORAGE_BUCKET,
  blankConnection, blankTab, browseQuery, countQuery, csvEscape, download,
  extractCount, extractNames, introspectionQuery, isDangerous, isDangerousMongo, substituteVars,
  type DbConnection, type DbDriver, type DbResult, type HistoryItem, type QueryTab, type SchemaItem,
} from './dbShared'

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

  const [schemaItems, setSchemaItems] = useState<SchemaItem[]>([])
  const [schemaDb, setSchemaDb] = useState('')
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaSearch, setSchemaSearch] = useState('')

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
      const [rawConnections, rawHistory, rawFavorites] = await Promise.all([
        safeStorageGet(STORAGE_BUCKET, CONNECTIONS_KEY),
        safeStorageGet(STORAGE_BUCKET, HISTORY_KEY),
        safeStorageGet(STORAGE_BUCKET, FAVORITES_KEY),
      ])
      const loaded = rawConnections ? JSON.parse(rawConnections) as DbConnection[] : [blankConnection()]
      let nextConnections = loaded.length ? loaded : [blankConnection()]
      const pendingRaw = localStorage.getItem('adomnia.database.pendingConnection')
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw) as Partial<DbConnection>
          const pendingConn: DbConnection = { ...blankConnection(), ...pending, id: crypto.randomUUID() }
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
      setFavorites(rawFavorites ? JSON.parse(rawFavorites) : [])
      // migrate legacy history (string[]) → HistoryItem[]
      if (rawHistory) {
        const parsed = JSON.parse(rawHistory) as unknown[]
        const items: HistoryItem[] = parsed.map((h) =>
          typeof h === 'string' ? { query: h, ts: 0 } : (h as HistoryItem)
        )
        setHistory(items)
      }
      // seed first tab to match driver
      const first = nextConnections[0]
      if (first?.driver === 'mongodb') {
        setTabs([blankTab('Mongo JSON Runner', MONGO_DEFAULT_QUERY)])
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    updateActive({ driver, port: DRIVER_META[driver].port })
    setResult(null)
    setError('')
    if (driver === 'mongodb' && !query.trim().startsWith('{')) setQuery(MONGO_DEFAULT_QUERY)
    else if (driver !== 'mongodb' && query.trim().startsWith('{')) setQuery(SQL_DEFAULT_QUERY)
  }

  const selectConnection = (id: string) => {
    setActiveId(id)
    setResult(null)
    setError('')
    setSchemaItems([])
  }

  const addConnection = () => {
    const conn = { ...blankConnection(), name: `Connection ${connections.length + 1}` }
    void persistConnections([...connections, conn])
    setActiveId(conn.id)
  }

  const deleteConnection = () => {
    if (connections.length <= 1) return
    const next = connections.filter((c) => c.id !== active.id)
    void persistConnections(next)
    setActiveId(next[0]?.id ?? '')
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  const addTab = () => {
    const tab = blankTab(`Query ${tabs.length + 1}`, isMongo ? MONGO_DEFAULT_QUERY : SQL_DEFAULT_QUERY)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    setTabs(next)
    if (activeTabId === id) setActiveTabId(next[Math.max(0, idx - 1)].id)
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
    setRunning(true)
    try {
      const data = await api('/database/test', active) as { driver: string; durationMs: number }
      setMessage(`Connected to ${data.driver} in ${data.durationMs} ms`)
      void refreshSchema()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const refreshSchema = async () => {
    const introspection = introspectionQuery(active.driver)
    if (!introspection) { setSchemaItems([]); return }
    setSchemaLoading(true)
    try {
      const data = await api('/database/query', { connection: active, query: introspection, limit: 1000, timeoutMs, explain: false, confirm: false }) as DbResult
      const names = extractNames(data)
      const baseItems: SchemaItem[] = names.map((name) => ({ name, count: null }))
      setSchemaItems(baseItems)
      setSchemaDb(active.database || DRIVER_META[active.driver].short)
      const capped = names.slice(0, 30)
      const counts = await Promise.allSettled(
        capped.map((n) => api('/database/query', { connection: active, query: countQuery(active.driver, n), limit: 1, timeoutMs, explain: false, confirm: false }) as Promise<DbResult>)
      )
      setSchemaItems(baseItems.map((item, idx) => {
        const r = counts[idx]
        return r && r.status === 'fulfilled' ? { ...item, count: extractCount(r.value) } : item
      }))
    } catch {
      // schema is best-effort; ignore failures silently
    } finally {
      setSchemaLoading(false)
    }
  }

  const toggleMongo = () => setDriver(isMongo ? 'postgres' : 'mongodb')

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
          onSelectTab={setActiveTabId}
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
        limit={limit}
        timeoutMs={timeoutMs}
        isMongo={isMongo}
        mongoToggleDisabled={false}
        favorites={favorites}
        history={history}
        schemaItems={schemaItems}
        schemaDb={schemaDb}
        schemaLoading={schemaLoading}
        schemaSearch={schemaSearch}
        currentQuery={query}
        onSetLimit={setLimit}
        onSetTimeout={setTimeoutMs}
        onToggleMongo={toggleMongo}
        onAddFavorite={toggleFavorite}
        onPickQuery={setQuery}
        onClearHistory={clearHistory}
        onRefreshSchema={() => void refreshSchema()}
        onSchemaSearch={setSchemaSearch}
        onPickCollection={(name) => setQuery(browseQuery(active.driver, name))}
      />

      {/* success toast */}
      {message && !error && (
        <div className="absolute bottom-4 left-[352px] z-40 flex items-center gap-2 rounded-lg border border-success/30 bg-surface-2 px-3.5 py-2 text-[11.5px] text-success shadow-xl">
          <CheckCircle2 size={14} /> {message}
        </div>
      )}
    </div>
  )
}

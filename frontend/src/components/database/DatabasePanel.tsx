import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Bookmark, CheckCircle2, Clock, Database, Download, Play, Plus, RefreshCw, Save, Shield, Trash2 } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { useEnvironmentsStore } from '@/stores/environments'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'

type DbDriver = 'sqlite' | 'postgres' | 'mysql' | 'db2' | 'mongodb'

interface DbConnection {
  id: string
  name: string
  driver: DbDriver
  dsn: string
  host: string
  port: number
  database: string
  collection: string
  user: string
  password: string
  sslMode: string
  sqlitePath: string
  savedInVault?: boolean
}

interface DbResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowsAffected: number
  durationMs: number
  driver: string
  limited: boolean
  destructive: boolean
  statementType: string
  warning?: string
}

const STORAGE_BUCKET = 'database'
const CONNECTIONS_KEY = 'connections'
const HISTORY_KEY = 'history'
const FAVORITES_KEY = 'favorites'

const DRIVER_META: Record<DbDriver, { label: string; port: number; tone: string }> = {
  sqlite: { label: 'SQLite', port: 0, tone: 'text-success border-success/25 bg-success/8' },
  postgres: { label: 'PostgreSQL', port: 5432, tone: 'text-info border-info/25 bg-info/8' },
  mysql: { label: 'MySQL / MariaDB', port: 3306, tone: 'text-warning border-warning/25 bg-warning/8' },
  db2: { label: 'IBM Db2', port: 50000, tone: 'text-accent border-accent/25 bg-accent/8' },
  mongodb: { label: 'MongoDB', port: 27017, tone: 'text-success border-success/25 bg-success/8' },
}

const MONGO_DEFAULT_QUERY = `{
  "operation": "find",
  "collection": "users",
  "filter": {},
  "sort": { "_id": -1 },
  "limit": 100
}`

const SQL_DEFAULT_QUERY = 'SELECT 1 AS ok'

const blankConnection = (): DbConnection => ({
  id: crypto.randomUUID(),
  name: 'Local SQLite',
  driver: 'sqlite',
  dsn: '',
  host: '127.0.0.1',
  port: 0,
  database: '',
  collection: '',
  user: '',
  password: '',
  sslMode: 'disable',
  sqlitePath: '',
  savedInVault: false,
})

function substituteVars(input: string, vars: Record<string, string>) {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

function isDangerous(query: string) {
  const upper = query.trim().toUpperCase()
  return upper.startsWith('DROP ') || upper.startsWith('TRUNCATE ') || (upper.startsWith('DELETE ') && !upper.includes(' WHERE ')) || (upper.startsWith('UPDATE ') && !upper.includes(' WHERE '))
}

function isDangerousMongo(query: string) {
  try {
    const parsed = JSON.parse(query) as { operation?: string }
    const op = parsed.operation?.toLowerCase()
    return op === 'updatemany' || op === 'deletemany' || op === 'deleteone' || op === 'updateone' || op === 'insertone' || op === 'insertmany' || op === 'dropcollection' || op === 'dropdatabase'
  } catch {
    return false
  }
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'LIMIT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'HAVING', 'RETURNING',
])

function highlightedSql(query: string): ReactNode[] {
  return query.split(/(\s+|--.*?$|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:\\"|[^"])*"|\b\d+(?:\.\d+)?\b|[(),;=*<>+-])/gm).map((token, index) => {
    if (!token) return null
    const upper = token.toUpperCase()
    if (/^--|^\/\*/.test(token)) return <span key={index} className="text-text-4">{token}</span>
    if (/^'.*'$|^".*"$/.test(token)) return <span key={index} className="text-success">{token}</span>
    if (/^\d/.test(token)) return <span key={index} className="text-warning">{token}</span>
    if (SQL_KEYWORDS.has(upper)) return <span key={index} className="font-semibold text-accent">{token}</span>
    if (/^[(),;=*<>+-]$/.test(token)) return <span key={index} className="text-text-4">{token}</span>
    return <span key={index}>{token}</span>
  })
}

function highlightedJson(query: string): ReactNode {
  try {
    const pretty = JSON.stringify(JSON.parse(query), null, 2)
    return pretty.split(/("(?:\\"|[^"])*"\s*:|"(?:\\"|[^"])*"|true|false|null|-?\d+(?:\.\d+)?)/g).map((token, index) => {
      if (!token) return null
      if (/^".*"\s*:$/.test(token)) return <span key={index} className="text-accent">{token}</span>
      if (/^"/.test(token)) return <span key={index} className="text-success">{token}</span>
      if (/^(true|false|null)$/.test(token)) return <span key={index} className="text-warning">{token}</span>
      if (/^-?\d/.test(token)) return <span key={index} className="text-info">{token}</span>
      return <span key={index}>{token}</span>
    })
  } catch {
    return <span className="text-error">Invalid JSON. Runner will show the exact parser error when executed.</span>
  }
}

export function DatabasePanel() {
  const port = useServerPort()
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const vars = getResolvedVars()
  const [connections, setConnections] = useState<DbConnection[]>([])
  const [activeId, setActiveId] = useState('')
  const [query, setQuery] = useState(SQL_DEFAULT_QUERY)
  const [limit, setLimit] = useState(200)
  const [timeoutMs, setTimeoutMs] = useState(30000)
  const [history, setHistory] = useState<string[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [result, setResult] = useState<DbResult | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  const active = connections.find((c) => c.id === activeId) ?? connections[0] ?? blankConnection()
  const renderedQuery = useMemo(() => substituteVars(query, vars), [query, vars])
  const dangerous = active.driver === 'mongodb' ? isDangerousMongo(renderedQuery) : isDangerous(renderedQuery)
  const isMongo = active.driver === 'mongodb'

  useEffect(() => {
    const load = async () => {
      const [rawConnections, rawHistory, rawFavorites] = await Promise.all([
        StorageGet(STORAGE_BUCKET, CONNECTIONS_KEY).catch(() => ''),
        StorageGet(STORAGE_BUCKET, HISTORY_KEY).catch(() => ''),
        StorageGet(STORAGE_BUCKET, FAVORITES_KEY).catch(() => ''),
      ])
      const loaded = rawConnections ? JSON.parse(rawConnections) as DbConnection[] : [blankConnection()]
      let nextConnections = loaded.length ? loaded : [blankConnection()]
      const pendingRaw = localStorage.getItem('adomnia.database.pendingConnection')
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw) as Partial<DbConnection>
          const pendingConn: DbConnection = { ...blankConnection(), ...pending, id: crypto.randomUUID() }
          nextConnections = [pendingConn, ...nextConnections]
          await StoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, JSON.stringify(nextConnections))
          setMessage(`Docker Lab connection "${pendingConn.name}" added`)
        } catch {
          setError('Could not import Docker Lab database connection')
        } finally {
          localStorage.removeItem('adomnia.database.pendingConnection')
        }
      }
      setConnections(nextConnections)
      setActiveId(nextConnections[0]?.id ?? '')
      setHistory(rawHistory ? JSON.parse(rawHistory) : [])
      setFavorites(rawFavorites ? JSON.parse(rawFavorites) : [])
    }
    void load()
  }, [])

  const persistConnections = async (next: DbConnection[]) => {
    setConnections(next)
    await StoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, JSON.stringify(next))
  }

  const updateActive = (patch: Partial<DbConnection>) => {
    const next = connections.map((conn) => conn.id === active.id ? { ...conn, ...patch } : conn)
    void persistConnections(next)
  }

  const setDriver = (driver: DbDriver) => {
    updateActive({ driver, port: DRIVER_META[driver].port })
    setResult(null)
    setMessage('')
    setError('')
    if (driver === 'mongodb' && !query.trim().startsWith('{')) {
      setQuery(MONGO_DEFAULT_QUERY)
    } else if (driver !== 'mongodb' && query.trim().startsWith('{')) {
      setQuery(SQL_DEFAULT_QUERY)
    }
  }

  const addConnection = () => {
    const conn = { ...blankConnection(), name: `Connection ${connections.length + 1}` }
    void persistConnections([...connections, conn])
    setActiveId(conn.id)
  }

  const deleteConnection = () => {
    if (connections.length <= 1) return
    const next = connections.filter((conn) => conn.id !== active.id)
    void persistConnections(next)
    setActiveId(next[0]?.id ?? '')
  }

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
    setMessage('')
    if (dangerous && !confirmed) {
      const ok = window.confirm(isMongo
        ? 'MongoDB write operation detected. updateMany/deleteMany require explicit confirmation, and writes change local or remote data. Continue?'
        : 'Dangerous query detected. DROP/TRUNCATE or DELETE/UPDATE without WHERE requires confirmation. Continue?')
      if (!ok) return
      confirmed = true
    }
    setRunning(true)
    try {
      const data = await api('/database/query', { connection: active, query: renderedQuery, limit, timeoutMs, explain, confirm: confirmed }) as DbResult
      setResult(data)
      const nextHistory = [query, ...history.filter((item) => item !== query)].slice(0, 50)
      setHistory(nextHistory)
      await StoragePut(STORAGE_BUCKET, HISTORY_KEY, JSON.stringify(nextHistory))
      setMessage(`${data.statementType || 'Query'} completed in ${data.durationMs} ms${data.limited ? ` · auto limited to ${limit}` : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const testConnection = async () => {
    setError('')
    setMessage('')
    setRunning(true)
    try {
      const data = await api('/database/test', active)
      setMessage(`Connected to ${data.driver} in ${data.durationMs} ms`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const toggleFavorite = async () => {
    const next = favorites.includes(query) ? favorites.filter((item) => item !== query) : [query, ...favorites].slice(0, 30)
    setFavorites(next)
    await StoragePut(STORAGE_BUCKET, FAVORITES_KEY, JSON.stringify(next))
  }

  const sendConnectionSecretToVault = () => {
    const value = active.dsn || active.password
    if (!value) {
      setError('No DSN or password to send to Vault')
      return
    }
    localStorage.setItem('adomnia.vault.pendingSecret', JSON.stringify({
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

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] overflow-hidden bg-surface-0">
      <aside className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1">
        <div className="border-b border-border-1 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-accent/25 bg-accent/10">
              <Database size={16} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-text-1">Database Studio</h2>
              <p className="text-[10px] text-text-4">Local SQL client, vault-aware presets</p>
            </div>
            <button onClick={addConnection} className="grid h-7 w-7 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1"><Plus size={13} /></button>
          </div>
          <div className="space-y-2">
            <select value={activeId} onChange={(e) => setActiveId(e.target.value)} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none">
              {connections.map((conn) => <option key={conn.id} value={conn.id}>{conn.name}</option>)}
            </select>
            <input value={active.name} onChange={(e) => updateActive({ name: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none" placeholder="Connection name" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 grid grid-cols-2 gap-2">
            {(Object.keys(DRIVER_META) as DbDriver[]).map((driver) => (
              <button
                key={driver}
                onClick={() => setDriver(driver)}
                className={cn('rounded border px-2 py-2 text-left text-[11px] transition-colors', active.driver === driver ? DRIVER_META[driver].tone : 'border-border-2 bg-surface-2 text-text-3 hover:text-text-1')}
              >
                {DRIVER_META[driver].label}
              </button>
            ))}
          </div>

          {active.driver === 'sqlite' ? (
            <label className="mb-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">SQLite file path</span>
              <input value={active.sqlitePath} onChange={(e) => updateActive({ sqlitePath: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none" placeholder="C:\data\app.db" />
            </label>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_72px] gap-2">
                <label>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Host</span>
                  <input value={active.host} onChange={(e) => updateActive({ host: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Port</span>
                  <input type="number" value={active.port} onChange={(e) => updateActive({ port: Number(e.target.value) })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Database</span>
                <input value={active.database} onChange={(e) => updateActive({ database: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none" />
              </label>
              {active.driver === 'mongodb' && (
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Default collection</span>
                  <input value={active.collection ?? ''} onChange={(e) => updateActive({ collection: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none" placeholder="users" />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input value={active.user} onChange={(e) => updateActive({ user: e.target.value })} className="h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none" placeholder="User" />
                <input type="password" value={active.password} onChange={(e) => updateActive({ password: e.target.value, savedInVault: false })} className="h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none" placeholder="Password" />
              </div>
            </div>
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Raw DSN override</span>
            <textarea value={active.dsn} onChange={(e) => updateActive({ dsn: e.target.value })} rows={3} className="w-full resize-none rounded border border-border-2 bg-surface-2 px-2 py-1.5 font-mono text-xs text-text-1 outline-none" placeholder="Optional full connection string" />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={testConnection} disabled={running} className="flex h-8 items-center justify-center gap-1.5 rounded border border-border-2 text-xs text-text-3 hover:text-text-1 disabled:opacity-40"><RefreshCw size={12} /> Test</button>
            <button onClick={sendConnectionSecretToVault} className="flex h-8 items-center justify-center gap-1.5 rounded border border-border-2 text-xs text-text-3 hover:text-text-1"><Shield size={12} /> Send to Vault</button>
          </div>
          {active.savedInVault && <div className="mt-2 rounded border border-success/25 bg-success/8 px-2 py-1.5 text-[10px] text-success">Credential handoff sent to Vault. Remove plaintext here after encrypting if you do not want it stored in this connection preset.</div>}
          {active.driver === 'db2' && <div className="mt-2 rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">Db2 needs IBM CLI/ODBC client libraries on the machine. Portable bundled driver is not enabled yet.</div>}
          {active.driver === 'mongodb' && (
            <div className="mt-2 rounded border border-success/25 bg-success/8 px-2 py-1.5 text-[10px] text-success">
              MongoDB runner enabled. Use JSON operations: find, aggregate, insertOne/Many, updateOne/Many, deleteOne/Many, count, listCollections, runCommand.
            </div>
          )}
          <button onClick={deleteConnection} disabled={connections.length <= 1} className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded border border-error/25 text-xs text-error hover:bg-error/10 disabled:opacity-40"><Trash2 size={12} /> Delete connection</button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-col">
        <div className="grid grid-cols-[1fr_280px] gap-3 border-b border-border-1 bg-surface-1 p-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider text-text-4">{isMongo ? 'Mongo JSON Runner' : 'SQL Editor'}</span>
              {dangerous && <span className="flex items-center gap-1 rounded border border-error/30 bg-error/10 px-2 py-1 text-[10px] text-error"><AlertTriangle size={11} /> destructive</span>}
              <span className="ml-auto text-[10px] text-text-4">Variables: {Object.keys(vars).length}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <textarea value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} className="h-44 w-full resize-none rounded-lg border border-border-1 bg-surface-0 p-3 font-mono text-xs leading-5 text-text-1 outline-none focus:border-accent" />
              <pre className="h-44 overflow-auto rounded-lg border border-border-1 bg-surface-0 p-3 font-mono text-xs leading-5 text-text-2">
                {isMongo ? highlightedJson(renderedQuery) : highlightedSql(renderedQuery)}
              </pre>
            </div>
            {isMongo && (
    <div className="mt-2 rounded border border-border-2 bg-surface-2 px-2 py-1.5 text-[10px] leading-relaxed text-text-4">
                Examples: <span className="font-mono text-text-3">{'{"operation":"listDatabases"}'}</span>, <span className="font-mono text-text-3">{'{"operation":"listCollections"}'}</span>, <span className="font-mono text-text-3">{'{"operation":"count","collection":"users","filter":{}}'}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="grid grid-cols-[1fr_80px] items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-[10px] uppercase tracking-wider text-text-4">
              Auto limit
              <input type="number" min={1} max={5000} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 200)} className="h-8 bg-transparent text-right text-xs text-text-1 outline-none" />
            </label>
            <label className="grid grid-cols-[1fr_80px] items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-[10px] uppercase tracking-wider text-text-4">
              Timeout ms
              <input type="number" min={1000} value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value) || 30000)} className="h-8 bg-transparent text-right text-xs text-text-1 outline-none" />
            </label>
            <button onClick={() => void runQuery(false)} disabled={running} className="flex h-9 items-center justify-center gap-2 rounded bg-accent text-xs font-semibold text-white disabled:opacity-40"><Play size={13} /> Run query</button>
            <button onClick={() => void runQuery(true)} disabled={running || isMongo} className="flex h-8 items-center justify-center gap-2 rounded border border-border-2 text-xs text-text-3 hover:text-text-1 disabled:opacity-40"><Clock size={12} /> Explain plan</button>
            <button onClick={toggleFavorite} className="flex h-8 items-center justify-center gap-2 rounded border border-border-2 text-xs text-text-3 hover:text-text-1"><Bookmark size={12} /> {favorites.includes(query) ? 'Unfavorite' : 'Favorite'}</button>
          </div>
        </div>

        {(message || error) && (
          <div className={cn('flex items-center gap-2 border-b px-3 py-2 text-xs', error ? 'border-error/25 bg-error/8 text-error' : 'border-success/20 bg-success/8 text-success')}>
            {error ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            {error || message}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px]">
          <div className="min-w-0 overflow-hidden">
            <div className="flex h-9 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Result grid</span>
              {result && <span className="text-[10px] text-text-4">{result.rows.length} rows · {result.durationMs} ms</span>}
              <button onClick={exportJson} disabled={!result} className="ml-auto rounded px-2 py-1 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Download size={11} className="mr-1 inline" />JSON</button>
              <button onClick={exportCsv} disabled={!result} className="rounded px-2 py-1 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Download size={11} className="mr-1 inline" />CSV</button>
            </div>
            <div className="h-full overflow-auto">
              {result?.columns?.length ? (
                <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] uppercase tracking-wider text-text-4">
                    <tr>{result.columns.map((col) => <th key={col} className="border-b border-border-1 px-3 py-2 font-semibold">{col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-surface-1">
                        {result.columns.map((col) => <td key={col} className="max-w-[360px] truncate border-b border-border-1/50 px-3 py-2 font-mono text-[11px] text-text-2">{row[col] == null ? <span className="text-text-4">NULL</span> : String(row[col])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : result ? (
                <div className="flex h-full items-center justify-center text-xs text-text-4">Statement executed. Rows affected: {result.rowsAffected}</div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-text-4">Run a query to see results.</div>
              )}
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto border-l border-border-1 bg-surface-1">
            <QueryList title="Favorites" items={favorites} onPick={setQuery} empty="No favorites yet." />
            <QueryList title="History" items={history} onPick={setQuery} empty="Query history is empty." />
          </aside>
        </div>
      </section>
    </div>
  )
}

function QueryList({ title, items, onPick, empty }: { title: string; items: string[]; onPick: (query: string) => void; empty: string }) {
  return (
    <div className="border-b border-border-1 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Save size={12} className="text-text-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">{title}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-border-1 bg-surface-0 px-2 py-3 text-center text-[10px] text-text-4">{empty}</div>
      ) : (
        <div className="space-y-1">
          {items.slice(0, 12).map((item) => (
            <button key={item} onClick={() => onPick(item)} className="w-full rounded border border-border-1 bg-surface-0 px-2 py-1.5 text-left font-mono text-[10px] leading-4 text-text-3 hover:border-accent/30 hover:text-text-1">
              <span className="line-clamp-2">{item}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Bookmark, CheckCircle2, Clock, Database, Download, Play, Plus, RefreshCw, Shield, Trash2 } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { useEnvironmentsStore } from '@/stores/environments'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import { safeSetItem } from '@/lib/safeLocalStorage'

type DbDriver = 'sqlite' | 'postgres' | 'mysql' | 'db2' | 'mongodb'
type SelectableDbDriver = Exclude<DbDriver, 'db2'>

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
  sqlite:   { label: 'SQLite',        port: 0,     tone: 'text-success border-success/35 bg-success/9' },
  postgres: { label: 'PostgreSQL',    port: 5432,  tone: 'text-info border-info/35 bg-info/9' },
  mysql:    { label: 'MySQL',         port: 3306,  tone: 'text-warning border-warning/35 bg-warning/9' },
  db2:      { label: 'IBM Db2',       port: 50000, tone: 'text-accent border-accent/25 bg-accent/8' },
  mongodb:  { label: 'MongoDB',       port: 27017, tone: 'text-success border-success/35 bg-success/9' },
}
const SELECTABLE_DRIVERS: SelectableDbDriver[] = ['sqlite', 'postgres', 'mysql', 'mongodb']

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

// ── type-detection helpers ─────────────────────────────────────────────────
function detectColType(col: string): string {
  const l = col.toLowerCase()
  if (l === 'id' || l.endsWith('_id') || l.endsWith('id')) return 'id'
  if (l.includes('_at') || l.includes('date') || l.includes('time') || l.includes('created') || l.includes('updated')) return 'date'
  return 'text'
}

function detectCellType(value: unknown): 'null' | 'num' | 'bool' | 'date' | 'text' {
  if (value == null) return 'null'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return 'num'
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date'
  if (!isNaN(Number(s)) && s.trim() !== '') return 'num'
  return 'text'
}

function CellValue({ value, colType }: { value: unknown; colType: string }) {
  const type = detectCellType(value)
  if (type === 'null') return <span className="italic text-text-4">NULL</span>
  if (type === 'bool') {
    const b = value === true || value === 'true'
    return (
      <span className={cn('inline-flex items-center gap-1 font-ui text-[10px]', b ? 'text-success' : 'text-text-4')}>
        <span className={cn('inline-grid h-3 w-3 place-items-center rounded-sm border', b ? 'border-success bg-success/15' : 'border-text-4')}>
          {b && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-2 w-2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        {b ? 'true' : 'false'}
      </span>
    )
  }
  const s = String(value)
  if (type === 'date') return <span className="text-info">{s}</span>
  if (type === 'num' || colType === 'id') return <span className={cn('tabular-nums', colType === 'id' ? 'text-text-3' : 'text-warning')}>{s}</span>
  return <span>{s}</span>
}

// ── SQL syntax highlight ───────────────────────────────────────────────────
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'LIMIT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'HAVING', 'RETURNING',
  'TRUE', 'FALSE', 'ASC', 'DESC', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'UNION', 'ALL', 'EXISTS',
])

function highlightedSql(query: string): ReactNode[] {
  return query.split(/(\s+|--.*?$|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:\\"|[^"])*"|\b\d+(?:\.\d+)?\b|[(),;=*<>+-])/gm).map((token, index) => {
    if (!token) return null
    const upper = token.toUpperCase()
    if (/^--|^\/\*/.test(token)) return <span key={index} style={{ color: '#4B5563' }}>{token}</span>
    if (/^'.*'$|^".*"$/.test(token)) return <span key={index} style={{ color: '#A8F0A8' }}>{token}</span>
    if (/^\d/.test(token)) return <span key={index} style={{ color: '#FFD280' }}>{token}</span>
    if (SQL_KEYWORDS.has(upper)) return <span key={index} style={{ color: '#C8A8FF', fontWeight: 600 }}>{token}</span>
    if (/^[(),;=*<>+-]$/.test(token)) return <span key={index} style={{ color: '#4B5563' }}>{token}</span>
    return <span key={index} style={{ color: '#C8E6FF' }}>{token}</span>
  })
}

function highlightedJson(query: string): ReactNode {
  try {
    const pretty = JSON.stringify(JSON.parse(query), null, 2)
    return pretty.split(/("(?:\\"|[^"])*"\s*:|"(?:\\"|[^"])*"|true|false|null|-?\d+(?:\.\d+)?)/g).map((token, index) => {
      if (!token) return null
      if (/^".*"\s*:$/.test(token)) return <span key={index} style={{ color: '#C8E6FF' }}>{token}</span>
      if (/^"/.test(token)) return <span key={index} style={{ color: '#A8F0A8' }}>{token}</span>
      if (/^(true|false|null)$/.test(token)) return <span key={index} style={{ color: '#C8A8FF', fontWeight: 600 }}>{token}</span>
      if (/^-?\d/.test(token)) return <span key={index} style={{ color: '#FFD280' }}>{token}</span>
      return <span key={index}>{token}</span>
    })
  } catch {
    return <span style={{ color: 'var(--color-error)' }}>Invalid JSON. Runner will show the exact parser error when executed.</span>
  }
}

// ── main component ─────────────────────────────────────────────────────────
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
  const lineCount = query.split('\n').length

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
      const data = await api('/database/test', active) as { driver: string; durationMs: number }
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
    <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] overflow-hidden bg-surface-0">

      {/* ── Connections sidebar ──────────────────────────────────────── */}
      <aside className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1">
        {/* header */}
        <div className="border-b border-border-1 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-accent/25 bg-accent/10">
              <Database size={16} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[13px] font-semibold text-text-1">Connections</h2>
              <p className="mt-px text-[10px] text-text-4">Local SQL client, vault-aware presets</p>
            </div>
            <button onClick={addConnection} title="New connection" className="grid h-7 w-7 flex-none place-items-center rounded border border-border-2 text-text-3 hover:border-border-3 hover:text-text-1">
              <Plus size={13} />
            </button>
          </div>
          <div className="space-y-2">
            <select
              value={activeId}
              onChange={(e) => setActiveId(e.target.value)}
              className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60"
              style={{ appearance: 'none', WebkitAppearance: 'none', backgroundImage: 'linear-gradient(45deg,transparent 50%,#6B7280 50%),linear-gradient(135deg,#6B7280 50%,transparent 50%)', backgroundPosition: 'calc(100% - 14px) calc(50% - 1px),calc(100% - 9px) calc(50% - 1px)', backgroundRepeat: 'no-repeat', backgroundSize: '5px 5px,5px 5px', paddingRight: 26 }}
            >
              {connections.map((conn) => <option key={conn.id} value={conn.id}>{conn.name} · {DRIVER_META[conn.driver]?.label ?? conn.driver}</option>)}
            </select>
            <input
              value={active.name}
              onChange={(e) => updateActive({ name: e.target.value })}
              className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60"
              placeholder="Connection name"
            />
          </div>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* driver grid */}
          <div className="mb-3.5 grid grid-cols-2 gap-2">
            {SELECTABLE_DRIVERS.map((driver) => {
              const isActive = active.driver === driver
              return (
                <button
                  key={driver}
                  onClick={() => setDriver(driver)}
                  className={cn(
                    'flex items-center gap-1.5 rounded border px-2.5 py-[9px] text-left text-[11px] font-ui transition-colors',
                    isActive ? DRIVER_META[driver].tone : 'border-border-2 bg-surface-2 text-text-3 hover:text-text-1'
                  )}
                >
                  <span
                    className="h-[7px] w-[7px] flex-none rounded-full"
                    style={{
                      background: 'currentColor',
                      opacity: isActive ? 1 : 0.55,
                      boxShadow: isActive ? '0 0 6px currentColor' : 'none',
                    }}
                  />
                  {DRIVER_META[driver].label}
                </button>
              )
            })}
          </div>

          {/* connection fields */}
          {active.driver === 'sqlite' ? (
            <label className="mb-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">SQLite file path</span>
              <input value={active.sqlitePath} onChange={(e) => updateActive({ sqlitePath: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 font-mono text-xs text-text-1 outline-none focus:border-accent/60" placeholder="C:\data\app.db" />
            </label>
          ) : (
            <div className="space-y-2.5">
              <div className="grid grid-cols-[1fr_72px] gap-2">
                <label>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Host</span>
                  <input value={active.host} onChange={(e) => updateActive({ host: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Port</span>
                  <input type="number" value={active.port} onChange={(e) => updateActive({ port: Number(e.target.value) })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Database</span>
                <input value={active.database} onChange={(e) => updateActive({ database: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60" />
              </label>
              {active.driver === 'mongodb' && (
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Default collection</span>
                  <input value={active.collection ?? ''} onChange={(e) => updateActive({ collection: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60" placeholder="users" />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">User</span>
                  <input value={active.user} onChange={(e) => updateActive({ user: e.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Password</span>
                  <input type="password" value={active.password} onChange={(e) => updateActive({ password: e.target.value, savedInVault: false })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-1 outline-none focus:border-accent/60" />
                </label>
              </div>
            </div>
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Raw DSN override</span>
            <textarea
              value={active.dsn}
              onChange={(e) => updateActive({ dsn: e.target.value })}
              rows={2}
              className="w-full resize-none rounded border border-border-2 bg-surface-2 px-2.5 py-2 font-mono text-xs leading-relaxed text-text-1 outline-none focus:border-accent/60"
              placeholder="Optional full connection string"
            />
          </label>

          {/* actions */}
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <button onClick={testConnection} disabled={running} className="flex h-8 items-center justify-center gap-1.5 rounded border border-border-2 bg-surface-2 text-xs text-text-3 hover:border-border-3 hover:text-text-1 disabled:opacity-40">
              <RefreshCw size={12} /> Test
            </button>
            <button onClick={sendConnectionSecretToVault} className="flex h-8 items-center justify-center gap-1.5 rounded border border-border-2 bg-surface-2 text-xs text-text-3 hover:border-border-3 hover:text-text-1">
              <Shield size={12} /> Vault
            </button>
          </div>

          {/* status notes */}
          {message && !error && (
            <div className="mt-2.5 rounded border border-success/25 bg-success/8 px-2.5 py-2 text-[10px] leading-relaxed text-success">
              {message}. Credential can be encrypted to Vault from here.
            </div>
          )}
          {active.savedInVault && (
            <div className="mt-2 rounded border border-success/25 bg-success/8 px-2.5 py-1.5 text-[10px] text-success">
              Credential handoff sent to Vault. Remove plaintext here after encrypting.
            </div>
          )}
          {active.driver === 'db2' && (
            <div className="mt-2 rounded border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[10px] text-warning">
              This saved Db2 preset is retained for compatibility, but Db2 is not available in this portable build. Select a supported driver to continue.
            </div>
          )}
          {active.driver === 'mongodb' && (
            <div className="mt-2 rounded border border-success/25 bg-success/8 px-2.5 py-1.5 text-[10px] text-success">
              MongoDB runner enabled. Use JSON operations: find, aggregate, insertOne/Many, updateOne/Many, deleteOne/Many, count, listCollections, runCommand.
            </div>
          )}

          <button
            onClick={deleteConnection}
            disabled={connections.length <= 1}
            className="mt-3.5 flex h-8 w-full items-center justify-center gap-1.5 rounded border border-error/25 text-xs text-error hover:bg-error/10 disabled:opacity-40"
          >
            <Trash2 size={12} /> Delete connection
          </button>
        </div>
      </aside>

      {/* ── Editor + Results ──────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col">

        {/* editor region */}
        <div className="grid grid-cols-[1fr_280px] gap-3.5 border-b border-border-1 bg-surface-1 p-3.5">

          {/* left: editor */}
          <div className="min-w-0">
            {/* meta bar */}
            <div className="mb-2.5 flex items-center gap-2">
              <span className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider text-text-4">
                {isMongo ? 'Mongo JSON Runner' : 'SQL Editor'}
              </span>
              {result && (
                <span className="flex items-center gap-1.5 rounded border border-success/30 px-2 py-1 text-[10px] text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" style={{ boxShadow: '0 0 6px currentColor' }} />
                  {DRIVER_META[active.driver]?.label ?? active.driver}
                </span>
              )}
              {dangerous && (
                <span className="flex items-center gap-1 rounded border border-error/30 bg-error/10 px-2 py-1 text-[10px] text-error">
                  <AlertTriangle size={11} /> destructive
                </span>
              )}
              <span className="ml-auto text-[10px] text-text-4">
                Variables: <b className="font-semibold text-accent">{Object.keys(vars).length}</b>
              </span>
            </div>

            {/* editor with gutter */}
            <div
              className="flex overflow-hidden rounded-lg border border-border-1 bg-surface-0"
              style={{ height: 188 }}
            >
              {/* gutter */}
              <div
                className="w-[42px] flex-none select-none border-r border-border-1 bg-surface-1 pt-3"
                style={{ fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 12, lineHeight: '20px' }}
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className="pr-[11px] text-right text-text-4">{i + 1}</div>
                ))}
              </div>

              {/* mirror: pre (highlight) + textarea (input) */}
              <div className="relative flex-1 overflow-auto">
                <pre
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-visible whitespace-pre p-3 font-mono text-[12.5px] leading-5"
                  style={{ tabSize: 2 }}
                >
                  {isMongo ? highlightedJson(query) : highlightedSql(query)}
                  {'\n'}
                </pre>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  spellCheck={false}
                  className="absolute inset-0 h-full w-full resize-none bg-transparent p-3 font-mono text-[12.5px] leading-5 text-transparent outline-none"
                  style={{ tabSize: 2, caretColor: '#A855F7' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const t = e.currentTarget
                      const start = t.selectionStart
                      const end = t.selectionEnd
                      const next = query.slice(0, start) + '  ' + query.slice(end)
                      setQuery(next)
                      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = start + 2 })
                    }
                  }}
                />
              </div>
            </div>

            {isMongo && (
              <div className="mt-2 rounded border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[10px] leading-relaxed text-text-4">
                Examples: <span className="font-mono text-text-3">{'{"operation":"listDatabases"}'}</span>, <span className="font-mono text-text-3">{'{"operation":"listCollections"}'}</span>, <span className="font-mono text-text-3">{'{"operation":"count","collection":"users","filter":{}}'}</span>
              </div>
            )}
          </div>

          {/* right: controls */}
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_80px] items-center gap-2 rounded border border-border-2 bg-surface-2 px-2.5 text-[10px] uppercase tracking-wider text-text-4">
              Auto limit
              <input type="number" min={1} max={5000} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 200)} className="h-8 bg-transparent text-right font-mono text-xs text-text-1 outline-none" />
            </div>
            <div className="grid grid-cols-[1fr_80px] items-center gap-2 rounded border border-border-2 bg-surface-2 px-2.5 text-[10px] uppercase tracking-wider text-text-4">
              Timeout ms
              <input type="number" min={1000} value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value) || 30000)} className="h-8 bg-transparent text-right font-mono text-xs text-text-1 outline-none" />
            </div>
            <div className="flex-1" />
            <button
              onClick={() => void runQuery(false)}
              disabled={running}
              className="flex h-9 items-center justify-center gap-2 rounded bg-accent text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-40"
              style={{ boxShadow: '0 0 14px rgba(139,61,255,0.18)' }}
            >
              <Play size={13} fill="currentColor" /> Run query
            </button>
            <button onClick={() => void runQuery(true)} disabled={running || isMongo} className="flex h-8 items-center justify-center gap-2 rounded border border-border-2 bg-surface-2 text-xs text-text-3 hover:border-border-3 hover:text-text-1 disabled:opacity-40">
              <Clock size={12} /> Explain plan
            </button>
            <button onClick={toggleFavorite} className="flex h-8 items-center justify-center gap-2 rounded border border-border-2 bg-surface-2 text-xs text-text-3 hover:border-border-3 hover:text-text-1">
              <Bookmark size={12} /> {favorites.includes(query) ? 'Unfavorite' : 'Favorite'}
            </button>
          </div>
        </div>

        {/* status banner */}
        {(message || error) && (
          <div className={cn('flex items-center gap-2 border-b px-3.5 py-2 text-xs', error ? 'border-error/25 bg-error/8 text-error' : 'border-success/20 bg-success/8 text-success')}>
            {error ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            <span>{error || message}</span>
          </div>
        )}

        {/* result region */}
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px]">

          {/* result grid */}
          <div className="flex min-w-0 flex-col overflow-hidden">
            <div className="flex h-9 flex-none items-center gap-2.5 border-b border-border-1 bg-surface-1 px-3.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">Result grid</span>
              {result && (
                <span className="font-mono text-[10px] text-text-4">
                  <b className="font-semibold text-text-2">{result.rows.length}</b> rows ·{' '}
                  <b className="font-semibold text-text-2">{result.durationMs}</b> ms
                </span>
              )}
              <button onClick={exportJson} disabled={!result} className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30">
                <Download size={12} /> JSON
              </button>
              <button onClick={exportCsv} disabled={!result} className="flex items-center gap-1 rounded px-2 py-1 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30">
                <Download size={12} /> CSV
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {result?.columns?.length ? (
                <table className="min-w-full border-separate border-spacing-0 text-left">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {/* row-number header */}
                      <th className="sticky left-0 z-20 w-11 min-w-[44px] border-b border-r border-border-2 bg-surface-2" style={{ height: 30 }} />
                      {result.columns.map((col, ci) => {
                        const isPk = ci === 0 && (col === 'id' || col.endsWith('_id') || col === '_id')
                        const colType = detectColType(col)
                        return (
                          <th key={col} className="border-b border-r border-border-2 bg-surface-2 px-3 text-left" style={{ height: 30 }}>
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              {isPk && (
                                <span className="text-warning">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-[11px] w-[11px]">
                                    <circle cx="7.5" cy="15.5" r="4.5" />
                                    <path d="M10.5 12.5 19 4l2 2-3 3 2 2" />
                                  </svg>
                                </span>
                              )}
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">{col}</span>
                              {colType === 'id' && <span className="font-mono text-[9px] normal-case tracking-normal text-text-4 opacity-70">int8</span>}
                              {colType === 'date' && <span className="font-mono text-[9px] normal-case tracking-normal text-text-4 opacity-70">ts</span>}
                            </div>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, idx) => (
                      <tr key={idx} className="group">
                        {/* row number */}
                        <td
                          className="sticky left-0 w-11 min-w-[44px] border-b border-r border-border-2 bg-surface-1 pr-2.5 text-right font-mono text-[10px] text-text-4 group-hover:bg-surface-2"
                          style={{ height: 29 }}
                        >
                          {idx + 1}
                        </td>
                        {result.columns.map((col) => {
                          const colType = detectColType(col)
                          const isRight = colType === 'id' || detectCellType(row[col]) === 'num'
                          return (
                            <td
                              key={col}
                              className={cn(
                                'max-w-[360px] truncate border-b border-r border-border-1 px-3 font-mono text-[11px] text-text-2 group-hover:bg-surface-1',
                                isRight && 'text-right'
                              )}
                              style={{ height: 29 }}
                            >
                              <CellValue value={row[col]} colType={colType} />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : result ? (
                <div className="flex h-full items-center justify-center text-xs text-text-4">
                  Statement executed. Rows affected: {result.rowsAffected}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-text-4">
                  Run a query to see results.
                </div>
              )}
            </div>
          </div>

          {/* favorites + history */}
          <aside className="min-h-0 overflow-y-auto border-l border-border-1 bg-surface-1">
            <QueryList title="Favorites" items={favorites} onPick={setQuery} empty="No favorites yet." />
            <QueryList title="History" items={history} onPick={setQuery} empty="Query history is empty." />
          </aside>
        </div>
      </section>
    </div>
  )
}

// ── QueryList ──────────────────────────────────────────────────────────────
function QueryList({ title, items, onPick, empty }: { title: string; items: string[]; onPick: (query: string) => void; empty: string }) {
  const Icon = title === 'Favorites' ? Bookmark : Clock
  return (
    <div className="border-b border-border-1 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={12} className="text-text-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">{title}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-border-1 bg-surface-0 px-2 py-3 text-center text-[10px] text-text-4">{empty}</div>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 12).map((item) => (
            <button
              key={item}
              onClick={() => onPick(item)}
              className="block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded border border-border-1 bg-surface-0 px-2 py-1.5 text-left font-mono text-[10px] leading-5 text-text-3 hover:border-accent/30 hover:text-text-1"
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

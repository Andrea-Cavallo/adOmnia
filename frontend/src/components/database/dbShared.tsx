import type { ReactNode } from 'react'
import { Database } from 'lucide-react'
import { BrandIcon } from '@/components/ui/BrandIcon'
import type { BrandIconSlug } from '@/lib/brandIcons.generated'
import { cn } from '@/lib/utils'
import type { EntityRef } from '@/lib/entities/types'

// ── types ──────────────────────────────────────────────────────────────────
export type DbDriver = 'sqlite' | 'postgres' | 'mysql' | 'db2' | 'mongodb' | 'redis'
export type SelectableDbDriver = Exclude<DbDriver, 'db2'>

export interface DbConnection {
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
  /** MongoDB: extra URI options (authSource=admin&tls=true) and SRV lookup. */
  options?: string
  srv?: boolean
}

export interface DbResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowsAffected: number
  durationMs: number
  driver: string
  limited: boolean
  destructive: boolean
  statementType: string
  warning?: string
  /** Set when the rows are an execution plan (EXPLAIN / EXPLAIN ANALYZE). */
  explain?: 'plan' | 'analyze'
  /** Ordered canonical Extended JSON documents (Mongo commands sent with canonical: true). */
  documents?: Record<string, unknown>[]
}

export interface QueryTab {
  id: string
  name: string
  query: string
}

export interface QueryWorkspaceState {
  tabs: QueryTab[]
  activeTabId: string
  limit?: number
  timeoutMs?: number
}

export interface HistoryItem {
  query: string
  ts: number
  label?: string
}

export interface SchemaItem {
  name: string
  count: number | null
}

export interface SchemaColumn {
  name: string
  type: string
}

// ── storage keys ───────────────────────────────────────────────────────────
export const STORAGE_BUCKET = 'database'
export const CONNECTIONS_KEY = 'connections'
export const HISTORY_KEY = 'history'
export const FAVORITES_KEY = 'favorites'
export const WORKSPACE_KEY = 'query-workspace-v1'

// ── driver metadata ────────────────────────────────────────────────────────
// icon: Simple Icons slug (scripts/generate-brand-icons.mjs); Db2 has none, so it falls back to a generic glyph.
export const DRIVER_META: Record<DbDriver, { label: string; short: string; port: number; accent: string; icon?: BrandIconSlug }> = {
  sqlite:   { label: 'SQLite',     short: 'SQLite',     port: 0,     accent: '#3FB950', icon: 'sqlite' },
  postgres: { label: 'PostgreSQL', short: 'PostgreSQL', port: 5432,  accent: '#38BDF8', icon: 'postgresql' },
  mysql:    { label: 'MySQL',      short: 'MySQL',      port: 3306,  accent: '#E3B341', icon: 'mysql' },
  db2:      { label: 'IBM Db2',    short: 'Db2',        port: 50000, accent: '#8B3DFF' },
  mongodb:  { label: 'MongoDB',    short: 'MongoDB',    port: 27017, accent: '#3FB950', icon: 'mongodb' },
  redis:    { label: 'Redis',      short: 'Redis',      port: 6379,  accent: '#FF4438', icon: 'redis' },
}

/** Logo of a database driver, or a generic database glyph when it has no brand icon. */
export function DbDriverIcon({ driver, size = 15, mono = false }: { driver: DbDriver; size?: number; mono?: boolean }) {
  const meta = DRIVER_META[driver]
  if (meta.icon) return <BrandIcon slug={meta.icon} size={size} mono={mono} />
  return <Database size={size} style={mono ? undefined : { color: meta.accent }} />
}
export const SELECTABLE_DRIVERS: SelectableDbDriver[] = ['sqlite', 'postgres', 'mysql', 'mongodb', 'redis']
export const REDIS_DEFAULT_QUERY = JSON.stringify({ command: 'PING', args: [] }, null, 2)

export const MONGO_DEFAULT_QUERY = `{
  "operation": "find",
  "collection": "users",
  "filter": {},
  "sort": { "_id": -1 },
  "limit": 100
}`

export const SQL_DEFAULT_QUERY = 'SELECT 1 AS ok'

export const blankConnection = (): DbConnection => ({
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

export const blankTab = (name = 'Query 1', query = SQL_DEFAULT_QUERY): QueryTab => ({
  id: crypto.randomUUID(),
  name,
  query,
})

export function defaultConnectionName(driver: DbDriver): string {
  return driver === 'sqlite' ? 'Local SQLite' : `${DRIVER_META[driver].short} Connection`
}

export function normalizeConnection(value: Partial<DbConnection>): DbConnection {
  const fallback = blankConnection()
  const driver = value.driver && DRIVER_META[value.driver] ? value.driver : fallback.driver
  const currentName = typeof value.name === 'string' ? value.name.trim() : ''
  const mismatchedLegacyName = currentName === 'Local SQLite' && driver !== 'sqlite'
  return {
    ...fallback,
    ...value,
    id: typeof value.id === 'string' && value.id ? value.id : fallback.id,
    driver,
    name: !currentName || mismatchedLegacyName ? defaultConnectionName(driver) : currentName,
    port: Number.isFinite(value.port) ? Number(value.port) : DRIVER_META[driver].port,
  }
}

export function validateConnection(connection: DbConnection): string | null {
  if (connection.driver === 'sqlite') {
    if (!connection.sqlitePath.trim() && !connection.dsn.trim()) return 'Choose or create a local SQLite database first.'
    return null
  }
  if (connection.dsn.trim()) return null
  if (!connection.host.trim()) return 'Host is required.'
  if (!(connection.driver === 'mongodb' && connection.srv) && (!Number.isInteger(connection.port) || connection.port <= 0 || connection.port > 65535)) return 'Port must be between 1 and 65535.'
  if ((connection.driver === 'postgres' || connection.driver === 'mysql') && !connection.database.trim()) return 'Database name is required.'
  if (connection.driver === 'redis' && connection.database.trim() && !/^\d+$/.test(connection.database.trim())) return 'Redis database index must be a non-negative integer.'
  return null
}

export function nextQueryName(tabs: QueryTab[]): string {
  const max = tabs.reduce((current, tab) => {
    const match = tab.name.match(/^Query\s+(\d+)$/i)
    return match ? Math.max(current, Number(match[1])) : current
  }, 0)
  return `Query ${max + 1}`
}

export function parseQueryWorkspace(raw: string): QueryWorkspaceState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<QueryWorkspaceState>
    if (!Array.isArray(parsed.tabs)) return null
    const tabs = parsed.tabs.filter((tab) => tab && typeof tab.id === 'string' && typeof tab.name === 'string' && typeof tab.query === 'string')
    if (!tabs.length) return null
    return {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId! : tabs[0].id,
      ...(Number.isFinite(parsed.limit) ? { limit: Math.max(1, Math.min(5000, Number(parsed.limit))) } : {}),
      ...(Number.isFinite(parsed.timeoutMs) ? { timeoutMs: Math.max(1000, Number(parsed.timeoutMs)) } : {}),
    }
  } catch {
    return null
  }
}

export function isValidDbObjectName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())
}

export function createObjectQuery(driver: DbDriver, rawName: string): string {
  const name = rawName.trim()
  if (driver === 'redis') {
    if (!name) throw new Error('Enter a Redis key name.')
    return JSON.stringify({ command: 'SET', args: [name, ''] }, null, 2)
  }
  if (!isValidDbObjectName(name)) throw new Error('Use letters, numbers and underscores; the name cannot start with a number.')
  if (driver === 'mongodb') return JSON.stringify({ operation: 'createCollection', collection: name }, null, 2)
  if (driver === 'mysql') return `CREATE TABLE \`${name}\` (\n  id BIGINT AUTO_INCREMENT PRIMARY KEY\n)`
  if (driver === 'postgres') return `CREATE TABLE "${name}" (\n  id BIGSERIAL PRIMARY KEY\n)`
  return `CREATE TABLE "${name}" (\n  id INTEGER PRIMARY KEY AUTOINCREMENT\n)`
}

// ── query analysis ─────────────────────────────────────────────────────────
export function substituteVars(input: string, vars: Record<string, string>) {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

export function isDangerous(query: string) {
  const upper = query.trim().toUpperCase()
  return upper.startsWith('DROP ') || upper.startsWith('TRUNCATE ') || (upper.startsWith('DELETE ') && !upper.includes(' WHERE ')) || (upper.startsWith('UPDATE ') && !upper.includes(' WHERE '))
}

export function isDangerousMongo(query: string) {
  try {
    const parsed = JSON.parse(query) as { operation?: string }
    const op = parsed.operation?.toLowerCase()
    return op === 'updatemany' || op === 'deletemany' || op === 'deleteone' || op === 'updateone' || op === 'insertone' || op === 'insertmany' || op === 'dropcollection' || op === 'dropdatabase'
  } catch {
    return false
  }
}

export function isDangerousRedis(query: string): boolean {
  try {
    const parsed = JSON.parse(query) as { command?: string; operation?: string }
    if (parsed.operation === 'scan' || parsed.operation === 'inspect') return false
    return !new Set('PING GET MGET EXISTS TYPE TTL PTTL STRLEN GETRANGE HGET HMGET HGETALL HLEN HEXISTS HKEYS HVALS HSCAN LRANGE LLEN LINDEX SMEMBERS SCARD SISMEMBER SSCAN ZRANGE ZREVRANGE ZCARD ZSCORE ZCOUNT ZSCAN XRANGE XREVRANGE XLEN DBSIZE INFO SCAN'.split(' ')).has((parsed.command ?? '').trim().toUpperCase())
  } catch { return false }
}

export function jsonValidity(query: string): { ok: boolean; message: string } {
  try {
    JSON.parse(query)
    return { ok: true, message: 'JSON is valid' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'Invalid JSON' }
  }
}

export function caretPosition(value: string, caret: number): { line: number; col: number } {
  const upto = value.slice(0, caret)
  const lines = upto.split('\n')
  return { line: lines.length, col: lines[lines.length - 1].length + 1 }
}

// ── introspection ──────────────────────────────────────────────────────────
export function introspectionQuery(driver: DbDriver): string {
  switch (driver) {
    case 'redis':    return JSON.stringify({ operation: 'scan', pattern: '*' })
    case 'mongodb':  return JSON.stringify({ operation: 'listCollections' })
    case 'sqlite':   return "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    case 'postgres': return "SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    case 'mysql':    return "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name"
    default:         return ''
  }
}

/** One query listing every table column, for schema-aware completion. Empty for Mongo. */
export function columnsQuery(driver: DbDriver): string {
  switch (driver) {
    case 'sqlite':   return "SELECT m.name AS table_name, p.name AS column_name, p.type AS data_type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid"
    case 'postgres': return "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position"
    case 'mysql':    return "SELECT table_name AS table_name, column_name AS column_name, column_type AS data_type FROM information_schema.columns WHERE table_schema=DATABASE() ORDER BY table_name, ordinal_position"
    default:         return ''
  }
}

export function extractColumns(result: DbResult): Record<string, SchemaColumn[]> {
  const out: Record<string, SchemaColumn[]> = {}
  for (const row of result?.rows ?? []) {
    const table = String(row.table_name ?? row.TABLE_NAME ?? '')
    const name = String(row.column_name ?? row.COLUMN_NAME ?? '')
    const type = String(row.data_type ?? row.DATA_TYPE ?? '')
    if (table && name) out[table] = [...(out[table] ?? []), { name, type }]
  }
  return out
}

export function countQuery(driver: DbDriver, name: string): string {
  if (driver === 'redis') return JSON.stringify({ command: 'EXISTS', args: [name] })
  if (driver === 'mongodb') return JSON.stringify({ operation: 'count', collection: name, filter: {} })
  const ident = driver === 'mysql' ? `\`${name.replace(/`/g, '')}\`` : `"${name.replace(/"/g, '')}"`
  return `SELECT COUNT(*) AS n FROM ${ident}`
}

export function browseQuery(driver: DbDriver, name: string): string {
  if (driver === 'redis') return JSON.stringify({ operation: 'inspect', key: name }, null, 2)
  if (driver === 'mongodb') {
    return JSON.stringify({ operation: 'find', collection: name, filter: {}, sort: { _id: -1 }, limit: 100 }, null, 2)
  }
  const ident = driver === 'mysql' ? `\`${name.replace(/`/g, '')}\`` : `"${name.replace(/"/g, '')}"`
  return `SELECT * FROM ${ident} LIMIT 100`
}

export function extractNames(result: DbResult): string[] {
  if (!result?.rows?.length) return []
  const cols = result.columns || []
  const key = cols.find((c) => /^name$/i.test(c)) ?? cols.find((c) => /(table_name|collection)/i.test(c)) ?? cols[0]
  if (!key) return []
  return result.rows.map((r) => String(r[key] ?? '')).filter(Boolean)
}

export function extractCount(result: DbResult): number | null {
  const cell = result?.rows?.[0]
  if (!cell) return null
  const first = Object.values(cell)[0]
  const n = Number(first)
  return Number.isFinite(n) ? n : null
}

// ── export ─────────────────────────────────────────────────────────────────
export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// ── time ───────────────────────────────────────────────────────────────────
export function relativeTime(ts: number): string {
  if (!ts) return 'earlier'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ── value / column typing ──────────────────────────────────────────────────
export function detectCellType(value: unknown): 'null' | 'num' | 'bool' | 'date' | 'text' {
  if (value == null) return 'null'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return 'num'
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date'
  if (!isNaN(Number(s)) && s.trim() !== '') return 'num'
  return 'text'
}

export function inferColumnKind(col: string, rows: Record<string, unknown>[]): string {
  if (col === '_id') return 'ObjectId'
  const sample = rows.find((r) => r[col] != null)?.[col]
  if (sample === undefined) return /(_id$|^id$)/i.test(col) ? 'ObjectId' : 'String'
  if (typeof sample === 'boolean') return 'Boolean'
  if (typeof sample === 'number') return 'Number'
  const s = String(sample)
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return 'Date'
  if (/^[0-9a-f]{24}$/i.test(s)) return 'ObjectId'
  if (/^-?\d+(\.\d+)?$/.test(s)) return 'Number'
  return 'String'
}

export function CellValue({ value }: { value: unknown }) {
  const type = detectCellType(value)
  if (type === 'null') return <span className="italic text-text-4">null</span>
  if (type === 'bool') {
    const b = value === true || value === 'true'
    return (
      <span className={cn(
        'inline-flex items-center rounded px-1.5 py-px font-mono text-[10.5px] font-medium',
        b ? 'bg-success/12 text-success' : 'bg-surface-3 text-text-3'
      )}>
        {b ? 'true' : 'false'}
      </span>
    )
  }
  const s = String(value)
  if (type === 'date') return <span className="text-info">{s}</span>
  if (type === 'num') return <span className="tabular-nums text-warning">{s}</span>
  return <span className="text-text-2">{s}</span>
}

// ── syntax highlight ───────────────────────────────────────────────────────
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'LIMIT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'HAVING', 'RETURNING',
  'TRUE', 'FALSE', 'ASC', 'DESC', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'UNION', 'ALL', 'EXISTS', 'LIKE',
])

export function highlightedSql(query: string): ReactNode[] {
  return query.split(/(\s+|--.*?$|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:\\"|[^"])*"|\b\d+(?:\.\d+)?\b|[(),;=*<>+-])/gm).map((token, index) => {
    if (!token) return null
    const upper = token.toUpperCase()
    if (/^--|^\/\*/.test(token)) return <span key={index} style={{ color: '#4B5563' }}>{token}</span>
    if (/^'.*'$|^".*"$/.test(token)) return <span key={index} style={{ color: '#7EE787' }}>{token}</span>
    if (/^\d/.test(token)) return <span key={index} style={{ color: '#FFCB6B' }}>{token}</span>
    if (SQL_KEYWORDS.has(upper)) return <span key={index} style={{ color: '#C792EA', fontWeight: 600 }}>{token}</span>
    if (/^[(),;=*<>+-]$/.test(token)) return <span key={index} style={{ color: '#5B6270' }}>{token}</span>
    return <span key={index} style={{ color: '#C8D3E6' }}>{token}</span>
  })
}

export function highlightedJson(query: string): ReactNode {
  return query.split(/("(?:\\"|[^"])*"\s*:|"(?:\\"|[^"])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?)/g).map((token, index) => {
    if (!token) return null
    if (/^".*"\s*:$/.test(token)) return <span key={index} style={{ color: '#82AAFF' }}>{token}</span>
    if (/^"/.test(token)) return <span key={index} style={{ color: '#7EE787' }}>{token}</span>
    if (/^(true|false|null)$/.test(token)) return <span key={index} style={{ color: '#C792EA', fontWeight: 600 }}>{token}</span>
    if (/^-?\d/.test(token)) return <span key={index} style={{ color: '#FFCB6B' }}>{token}</span>
    return <span key={index} style={{ color: '#C8D3E6' }}>{token}</span>
  })
}

/** Reuse a connection to the same server/database, or append a new one (no password). */
export function upsertConnectionFromRef(connections: DbConnection[], ref: EntityRef): { connections: DbConnection[]; id: string; created: boolean } {
  const driver = ref.attrs.type as DbDriver
  const host = ref.attrs.host === 'localhost' ? '127.0.0.1' : (ref.attrs.host ?? '127.0.0.1')
  const port = Number(ref.attrs.port) || 0
  const database = ref.attrs.database ?? ''
  const match = connections.find((c) => c.driver === driver && c.port === port && c.database === database && (c.host === host || c.host === ref.attrs.host))
  if (match) return { connections, id: match.id, created: false }
  const conn: DbConnection = { ...blankConnection(), name: ref.label, driver, host, port, database, user: ref.attrs.user ?? '', password: '' }
  return { connections: [...connections, conn], id: conn.id, created: true }
}

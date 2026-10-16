// Saved queries for the Database console (FIX.md DB-3.4): records instead of bare strings, a
// loader migration from the old favorites list, filters, personal templates and a file export
// that never carries connection ids or obvious secrets. Pure: no React, no storage calls.

import type { ConsoleCategory } from './consoleTemplates'
import { interpret, type DbKind } from './queryInterpreter'
import type { HistoryItem } from './dbShared'

export const SAVED_QUERIES_KEY = 'savedQueries.v2'
export const MAX_SAVED_QUERIES = 200
export const MAX_SAVED_QUERY_CHARS = 20_000
export const SAVED_EXPORT_FORMAT = 'adomnia-saved-queries'

export type QueryFamily = 'sql' | 'mongodb' | 'redis'

export interface SavedQuery {
  id: string
  name: string
  category: ConsoleCategory
  /** `sql` covers postgres/mysql/sqlite; a record is usable by every connection of its family. */
  family: QueryFamily
  /** Set when the query was saved for one connection; null = every connection of the family. */
  connectionId: string | null
  query: string
  ts: number
  /** A personal template: listed with the built-in ones in its category. */
  personal?: boolean
}

export interface SavedFilter {
  category?: ConsoleCategory
  family?: QueryFamily
  /** Only records for this connection or for every connection. */
  connectionId?: string
  text?: string
  personalOnly?: boolean
}

export function queryFamily(driver: string): QueryFamily {
  return driver === 'mongodb' ? 'mongodb' : driver === 'redis' ? 'redis' : 'sql'
}

const READ_KINDS = new Set(['select', 'find', 'count', 'countDocuments', 'estimatedCount', 'scan', 'inspect', 'get', 'mget', 'listCollections', 'listDatabases'])
const SCHEMA_KINDS = new Set(['create', 'alter', 'drop', 'truncate', 'createCollection', 'dropCollection', 'dropDatabase', 'runCommand', 'grant', 'revoke'])

/** The console category a query belongs to, from what the interpreter makes of it. */
export function categorizeQuery(driver: string, query: string): ConsoleCategory {
  if (driver === 'db2') return 'search'
  const kind = interpret(driver as DbKind, query).kind
  if (READ_KINDS.has(kind)) return 'search'
  if (kind.startsWith('insert') || ['lpush', 'rpush', 'sadd', 'zadd', 'hset'].includes(kind)) return 'insert'
  if (kind.startsWith('delete') || ['del', 'unlink', 'hdel', 'srem', 'zrem', 'flushdb', 'flushall'].includes(kind)) return 'delete'
  if (kind === 'aggregate') return 'aggregate'
  if (SCHEMA_KINDS.has(kind)) return 'schema'
  if (kind === 'unknown') return 'search'
  return 'update'
}

/** Best-effort family of an old bare-string favorite, which never recorded its driver. */
function guessFamily(query: string): QueryFamily {
  try {
    const doc = JSON.parse(query) as Record<string, unknown>
    if (doc && typeof doc === 'object') {
      if ('command' in doc && !('collection' in doc) && !('operation' in doc && 'collection' in doc)) return 'redis'
      if (doc.operation === 'scan' || doc.operation === 'inspect') return 'redis'
      return 'mongodb'
    }
  } catch { /* not JSON: SQL */ }
  return 'sql'
}

function toDriver(family: QueryFamily): string {
  return family === 'sql' ? 'postgres' : family
}

function nameFor(query: string): string {
  const flat = query.replace(/\s+/g, ' ').trim()
  return flat.length > 48 ? `${flat.slice(0, 47)}…` : flat
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createSavedQuery(input: { query: string; driver: string; connectionId?: string | null; name?: string; personal?: boolean; ts?: number }): SavedQuery {
  const family = queryFamily(input.driver)
  return {
    id: newId(),
    name: (input.name ?? '').trim() || nameFor(input.query),
    category: categorizeQuery(toDriver(family), input.query),
    family,
    connectionId: input.connectionId ?? null,
    query: input.query.slice(0, MAX_SAVED_QUERY_CHARS),
    ts: input.ts ?? Date.now(),
    ...(input.personal ? { personal: true } : {}),
  }
}

const CATEGORIES: readonly string[] = ['search', 'insert', 'update', 'delete', 'aggregate', 'schema']

/** Accepts anything a stored value or an imported file may contain and keeps only well-formed records. */
export function normalizeSavedQueries(raw: unknown): SavedQuery[] {
  if (!Array.isArray(raw)) return []
  const out: SavedQuery[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Partial<SavedQuery>
    if (typeof r.query !== 'string' || !r.query.trim()) continue
    const family: QueryFamily = r.family === 'mongodb' || r.family === 'redis' ? r.family : 'sql'
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : nameFor(r.query),
      category: typeof r.category === 'string' && CATEGORIES.includes(r.category) ? (r.category as ConsoleCategory) : categorizeQuery(toDriver(family), r.query),
      family,
      connectionId: typeof r.connectionId === 'string' && r.connectionId ? r.connectionId : null,
      query: r.query.slice(0, MAX_SAVED_QUERY_CHARS),
      ts: typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : 0,
      ...(r.personal ? { personal: true } : {}),
    })
  }
  return capSaved(out)
}

/**
 * Old favorites (bare strings) → records: category deduced by the interpreter, valid for every
 * connection of the deduced family. The old list is left in place so a rollback still finds it.
 */
export function migrateFavorites(raw: unknown): SavedQuery[] {
  if (!Array.isArray(raw)) return []
  const out: SavedQuery[] = []
  const seen = new Set<string>()
  raw.forEach((value, index) => {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) return
    seen.add(value)
    const family = guessFamily(value)
    out.push({
      id: newId(),
      name: nameFor(value),
      category: categorizeQuery(toDriver(family), value),
      family,
      connectionId: null,
      query: value.slice(0, MAX_SAVED_QUERY_CHARS),
      ts: -index, // keeps the old order (first = newest) without inventing dates
    })
  })
  return capSaved(out)
}

export function addSavedQuery(list: readonly SavedQuery[], record: SavedQuery): SavedQuery[] {
  const without = list.filter((q) => !(q.query === record.query && q.family === record.family && q.connectionId === record.connectionId && !!q.personal === !!record.personal))
  return capSaved([record, ...without])
}

/** Keeps the newest MAX_SAVED_QUERIES plain records; personal templates are curated, so they never count against the cap. */
function capSaved(list: SavedQuery[]): SavedQuery[] {
  let plain = 0
  return list.filter((q) => q.personal || ++plain <= MAX_SAVED_QUERIES)
}

export function removeSavedQuery(list: readonly SavedQuery[], id: string): SavedQuery[] {
  return list.filter((q) => q.id !== id)
}

export function renameSavedQuery(list: readonly SavedQuery[], id: string, name: string): SavedQuery[] {
  const next = name.trim().slice(0, 120)
  return next ? list.map((q) => (q.id === id ? { ...q, name: next } : q)) : [...list]
}

export function setPersonal(list: readonly SavedQuery[], id: string, personal: boolean): SavedQuery[] {
  return list.map((q) => {
    if (q.id !== id) return q
    const { personal: _drop, ...rest } = q
    return personal ? { ...rest, personal: true } : rest
  })
}

export function filterSavedQueries(list: readonly SavedQuery[], filter: SavedFilter): SavedQuery[] {
  const text = filter.text?.trim().toLowerCase()
  return list.filter((q) => {
    if (filter.category && q.category !== filter.category) return false
    if (filter.family && q.family !== filter.family) return false
    if (filter.connectionId && q.connectionId !== null && q.connectionId !== filter.connectionId) return false
    if (filter.personalOnly && !q.personal) return false
    return !text || `${q.name} ${q.query}`.toLowerCase().includes(text)
  })
}

// "password = 'x'", "secret: \"x\"", "token='x'", "api_key = 'x'": the value is replaced, the shape kept.
const SECRET_LITERAL = /\b((?:\w*[_-])?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|credential)\w*)(["']?\s*[:=]\s*)(['"])[^'"]*\3/gi

/** Replaces the value of secret-looking assignments (SQL or JSON, any length), keeping the quote style so JSON stays JSON. */
export function redactQueryText(query: string): string {
  return query.replace(SECRET_LITERAL, (_, key: string, sep: string, quote: string) => `${key}${sep}${quote}<redacted>${quote}`)
}

/** File content for sharing: no connection ids, secret-looking literals replaced. */
export function exportSavedQueries(list: readonly SavedQuery[]): string {
  const queries = list.map(({ connectionId: _connection, ...rest }) => ({ ...rest, name: redactQueryText(rest.name), query: redactQueryText(rest.query) }))
  return JSON.stringify({ format: SAVED_EXPORT_FORMAT, version: 1, queries }, null, 2)
}

/** Reads an exported file; imported records get fresh ids and are never tied to a connection. */
export function importSavedQueries(text: string): SavedQuery[] {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  const doc = parsed as { format?: unknown; queries?: unknown }
  if (!doc || doc.format !== SAVED_EXPORT_FORMAT || !Array.isArray(doc.queries)) throw new Error('This is not an adOmnia saved-queries file.')
  return normalizeSavedQueries(doc.queries).map((q) => ({ ...q, id: newId(), connectionId: null }))
}

/** Merges imported records in front of the existing ones, dropping duplicates and respecting the cap. */
export function mergeSavedQueries(existing: readonly SavedQuery[], incoming: readonly SavedQuery[]): SavedQuery[] {
  // Added last-to-first so the file's first record ends up first, as it was exported.
  return [...incoming].reverse().reduce<SavedQuery[]>((list, record) => addSavedQuery(list, record), [...existing])
}

// ── query history (DB-3.4.1) ─────────────────────────────────────────────────
export const MAX_HISTORY = 50

/** A history entry as a record: id, deduced category, driver and where it ran. */
export function createHistoryRecord(input: { query: string; driver: string; connectionId?: string | null; name?: string; ts?: number }): HistoryItem {
  const query = input.query.slice(0, MAX_SAVED_QUERY_CHARS)
  return {
    id: newId(),
    name: (input.name ?? '').trim().slice(0, 120) || nameFor(query),
    category: categorizeQuery(input.driver, query),
    driver: input.driver,
    connectionId: input.connectionId ?? null,
    query,
    ts: typeof input.ts === 'number' ? input.ts : Date.now(),
  }
}

/**
 * Old bare strings and partial records (`{query, ts, label}`) become full records.
 * Migrated entries carry no `connectionId`: they are valid for every connection of
 * their driver, exactly like migrated favorites.
 */
export function migrateHistory(raw: unknown, driver: string, connectionId: string | null = null): HistoryItem[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryItem[] = []
  for (const entry of raw) {
    if (out.length >= MAX_HISTORY) break
    if (typeof entry === 'string') {
      if (entry.trim()) out.push(createHistoryRecord({ query: entry, driver, connectionId }))
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Partial<HistoryItem> & { label?: string }
    if (typeof record.query !== 'string' || !record.query.trim()) continue
    out.push(createHistoryRecord({
      query: record.query,
      driver: typeof record.driver === 'string' && record.driver ? record.driver : driver,
      connectionId: record.connectionId ?? connectionId,
      name: record.name ?? record.label,
      ts: typeof record.ts === 'number' ? record.ts : 0,
    }))
  }
  return out
}

import type { LogEvent, LogLevel } from './types'
import { normalizeLevel } from './normalize'

/** Event fields usable as `field:value` in a query and as sidebar facets. */
export const QUERY_FIELDS = [
  'level', 'message', 'service', 'namespace', 'pod', 'container',
  'traceId', 'correlationId', 'requestId', 'thread', 'logger', 'raw',
] as const

export type QueryField = (typeof QUERY_FIELDS)[number]

export const FACET_FIELDS = ['service', 'namespace', 'pod', 'container', 'logger', 'thread'] as const
export type FacetField = (typeof FACET_FIELDS)[number]

const FIELD_SYNONYMS: Record<string, QueryField> = {
  level: 'level', lvl: 'level', severity: 'level',
  message: 'message', msg: 'message', text: 'message',
  service: 'service', svc: 'service', app: 'service', application: 'service',
  namespace: 'namespace', ns: 'namespace',
  pod: 'pod', podname: 'pod',
  container: 'container',
  traceid: 'traceId', trace: 'traceId', trace_id: 'traceId',
  correlationid: 'correlationId', correlation: 'correlationId', correlation_id: 'correlationId', cid: 'correlationId',
  requestid: 'requestId', request: 'requestId', request_id: 'requestId', req: 'requestId',
  thread: 'thread',
  logger: 'logger',
  raw: 'raw', line: 'raw', any: 'raw',
}

export interface QueryClause {
  /** Undefined for a bare full-text term. */
  field?: QueryField
  value: string
  negated: boolean
  /** Matches any non-empty value (`pod:*`). */
  existence: boolean
  matcher: RegExp | null
}

export interface CompiledQuery {
  clauses: QueryClause[]
  /** Plain terms the list should highlight. */
  highlights: string[]
  error: string
}

export const EMPTY_QUERY: CompiledQuery = { clauses: [], highlights: [], error: '' }

/** Split on whitespace but keep `"quoted phrases"` together. */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote = ''
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = '' }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `pay*-svc` → /^pay.*-svc$/i */
function globToRegExp(pattern: string): RegExp {
  const body = pattern.split('*').map(escapeRegExp).join('.*')
  return new RegExp(`^${body}$`, 'i')
}

/** Turn a query string into clauses. Unknown fields degrade to full-text. */
export function compileQuery(input: string): CompiledQuery {
  const trimmed = input.trim()
  if (!trimmed) return EMPTY_QUERY

  const clauses: QueryClause[] = []
  const highlights: string[] = []
  let error = ''

  for (const token of tokenize(trimmed)) {
    const negated = token.startsWith('-') && token.length > 1
    const body = negated ? token.slice(1) : token
    const colon = body.indexOf(':')

    if (colon > 0) {
      const rawField = body.slice(0, colon).toLowerCase()
      const value = body.slice(colon + 1)
      const field = FIELD_SYNONYMS[rawField]
      if (field) {
        const existence = value === '*'
        clauses.push({
          field,
          value,
          negated,
          existence,
          matcher: existence || !value.includes('*') ? null : globToRegExp(value),
        })
        if (!negated && !existence && value) highlights.push(value.replace(/\*/g, ''))
        continue
      }
      if (!rawField.includes('/') && !rawField.includes('.')) {
        error = `Unknown field "${rawField}" — searched as text`
      }
    }

    clauses.push({ value: body, negated, existence: false, matcher: null })
    if (!negated && body) highlights.push(body)
  }

  return { clauses, highlights, error }
}

// A lowercase haystack per event, built once. Keyed by the event object so it
// is dropped together with the parsed batch.
const searchCache = new WeakMap<LogEvent, string>()

function haystack(event: LogEvent): string {
  const cached = searchCache.get(event)
  if (cached !== undefined) return cached
  const built = `${event.raw}\n${event.message}\n${event.stack}`.toLowerCase()
  searchCache.set(event, built)
  return built
}

function fieldValue(event: LogEvent, field: QueryField): string {
  if (field === 'raw') return event.raw
  return String(event[field] ?? '')
}

function clauseMatches(event: LogEvent, clause: QueryClause): boolean {
  if (!clause.field) {
    if (!clause.value) return true
    return haystack(event).includes(clause.value.toLowerCase())
  }

  const value = fieldValue(event, clause.field)
  if (clause.existence) return value.trim() !== ''
  if (clause.matcher) return clause.matcher.test(value)

  if (clause.field === 'level') {
    const wanted = normalizeLevel(clause.value)
    if (wanted !== 'unknown') return event.level === wanted
    return event.level.toLowerCase() === clause.value.toLowerCase()
  }
  return value.toLowerCase().includes(clause.value.toLowerCase())
}

export function matchesQuery(event: LogEvent, compiled: CompiledQuery): boolean {
  for (const clause of compiled.clauses) {
    const hit = clauseMatches(event, clause)
    if (clause.negated ? hit : !hit) return false
  }
  return true
}

// ─── Structured filters ──────────────────────────────────────────────────────

export interface LogFilterState {
  query: string
  /** Empty means "every level". */
  levels: LogLevel[]
  from: number | null
  to: number | null
  include: Partial<Record<FacetField, string[]>>
  exclude: Partial<Record<FacetField, string[]>>
  onlyStack: boolean
  onlyUnparsed: boolean
}

export const EMPTY_FILTERS: LogFilterState = {
  query: '',
  levels: [],
  from: null,
  to: null,
  include: {},
  exclude: {},
  onlyStack: false,
  onlyUnparsed: false,
}

export function hasActiveFilters(filters: LogFilterState): boolean {
  return Boolean(
    filters.query.trim()
    || filters.levels.length
    || filters.from !== null
    || filters.to !== null
    || filters.onlyStack
    || filters.onlyUnparsed
    || Object.values(filters.include).some((values) => values && values.length)
    || Object.values(filters.exclude).some((values) => values && values.length),
  )
}

export function matchesFilters(event: LogEvent, filters: LogFilterState, compiled: CompiledQuery): boolean {
  if (filters.onlyUnparsed && !event.parseError) return false
  if (filters.onlyStack && !event.stack) return false
  if (filters.levels.length && !filters.levels.includes(event.level)) return false

  if (filters.from !== null || filters.to !== null) {
    if (event.ts === null) return false
    if (filters.from !== null && event.ts < filters.from) return false
    if (filters.to !== null && event.ts > filters.to) return false
  }

  for (const [field, values] of Object.entries(filters.include)) {
    if (!values?.length) continue
    if (!values.includes(String(event[field as FacetField] ?? ''))) return false
  }
  for (const [field, values] of Object.entries(filters.exclude)) {
    if (!values?.length) continue
    if (values.includes(String(event[field as FacetField] ?? ''))) return false
  }

  return matchesQuery(event, compiled)
}

/** Apply the whole filter state. Returns a new array; input is never mutated. */
export function filterEvents(events: LogEvent[], filters: LogFilterState): LogEvent[] {
  const compiled = compileQuery(filters.query)
  if (!hasActiveFilters(filters)) return events
  return events.filter((event) => matchesFilters(event, filters, compiled))
}

// ─── Highlighting ────────────────────────────────────────────────────────────

export interface HighlightSegment {
  text: string
  hit: boolean
}

/** Split text into alternating plain/highlighted segments. */
export function highlightSegments(text: string, terms: string[]): HighlightSegment[] {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length >= 2)
  if (!cleaned.length || !text) return [{ text, hit: false }]

  const pattern = new RegExp(`(${cleaned.map(escapeRegExp).join('|')})`, 'ig')
  const segments: HighlightSegment[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) segments.push({ text: text.slice(last, index), hit: false })
    segments.push({ text: match[0], hit: true })
    last = index + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false })
  return segments.length ? segments : [{ text, hit: false }]
}

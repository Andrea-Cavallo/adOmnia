import type { LogEvent, LogLevel } from './types'
import { canonicalKey, flattenPayload, normalizeLevel } from './normalize'

/** Event fields usable as `field:value` in a query and as sidebar facets. */
export const QUERY_FIELDS = [
  'level', 'message', 'service', 'namespace', 'pod', 'container',
  'traceId', 'correlationId', 'requestId', 'thread', 'logger', 'sourceName', 'raw',
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
  source: 'sourceName', sourcename: 'sourceName', sourcefile: 'sourceName', file: 'sourceName', filename: 'sourceName',
  raw: 'raw', line: 'raw', any: 'raw',
}

export interface QueryClause {
  /** Undefined for a bare full-text term or for a payload lookup. */
  field?: QueryField
  /** Arbitrary payload key (`merchantId:M-4471`), resolved canonically. */
  path?: string
  value: string
  negated: boolean
  /** Matches any non-empty value (`pod:*`). */
  existence: boolean
  /** Regex / alternatives / glob predicate; null means plain substring. */
  matcher: ((text: string) => boolean) | null
}

export interface CompiledQuery {
  clauses: QueryClause[]
  expression?: QueryExpression
  /** Plain terms the list should highlight. */
  highlights: string[]
  error: string
}

export const EMPTY_QUERY: CompiledQuery = { clauses: [], highlights: [], error: '' }

type ComparisonOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'between' | 'is-null' | 'is-missing' | 'exists'

interface ComparisonExpression {
  kind: 'comparison'
  path: string
  operator: ComparisonOperator
  value?: unknown
  upper?: unknown
}

interface ClauseExpression { kind: 'clause'; clause: QueryClause }
interface BinaryExpression { kind: 'and' | 'or'; left: QueryExpression; right: QueryExpression }
interface NotExpression { kind: 'not'; child: QueryExpression }
export type QueryExpression = ComparisonExpression | ClauseExpression | BinaryExpression | NotExpression

// A `/` opens a regex only at the start of a token (optionally after `-` or
// `field:`) and when it is not the `//` of a URL.
const REGEX_OPENER = /^-?(?:[\w.@$-]+:)?\/$/

/**
 * Split on whitespace but keep `"quoted phrases"` and `/regex literals/`
 * together — a log regex almost always contains a space.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote = ''
  let inRegex = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (inRegex) {
      current += char
      if (char === '/' && input[i - 1] !== '\\') inRegex = false
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = '' }
      continue
    }

    current += char
    if (char === '/' && input[i + 1] !== '/' && REGEX_OPENER.test(current)) inRegex = true
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

const REGEX_LITERAL = /^\/(.+)\/([gimsuy]*)$/
// Only an identifier-ish name is treated as a payload field, so a pasted URL
// (`http://host/path`) stays a full-text term instead of becoming a lookup.
const FIELD_NAME = /^[A-Za-z_@$][\w.@$-]*$/

/**
 * Build the predicate for one value expression:
 * `/re/` regex, `a|b` alternatives, `pay-*` glob, or a plain substring.
 * `anchored` distinguishes whole-value matching (fields) from "contains".
 */
function buildMatcher(value: string, anchored: boolean): ((text: string) => boolean) | null {
  const literal = REGEX_LITERAL.exec(value)
  if (literal) {
    try {
      const flags = literal[2].includes('i') ? literal[2] : `${literal[2]}i`
      const regex = new RegExp(literal[1], flags.replace('g', ''))
      return (text) => regex.test(text)
    } catch {
      /* invalid regex — fall through and treat it as literal text */
    }
  }

  if (value.includes('|')) {
    const parts = value.split('|').map((part) => part.trim()).filter(Boolean)
    if (parts.length > 1) {
      const matchers = parts.map((part) => buildMatcher(part, anchored) ?? containsMatcher(part, anchored))
      return (text) => matchers.some((match) => match(text))
    }
  }

  if (value.includes('*')) {
    const glob = globToRegExp(value)
    return (text) => glob.test(text)
  }

  return null
}

function containsMatcher(value: string, anchored: boolean): (text: string) => boolean {
  const needle = value.toLowerCase()
  return anchored
    ? (text) => text.toLowerCase() === needle || text.toLowerCase().includes(needle)
    : (text) => text.toLowerCase().includes(needle)
}

/**
 * Turn a query string into clauses. A name that is not a known field is looked
 * up in the event payload, so `merchantId:M-4471` works without the field being
 * modelled.
 */
export function compileQuery(input: string): CompiledQuery {
  const trimmed = input.trim()
  if (!trimmed) return EMPTY_QUERY

  if (/[()<>]=?|!=|(?:^|\s)[\w.@$[\]-]+\s*=|\b(?:AND|OR|NOT|IS|BETWEEN|EXISTS)\b/i.test(trimmed)) {
    const parsed = compileExpressionQuery(trimmed)
    if (parsed) return parsed
  }

  const clauses: QueryClause[] = []
  const highlights: string[] = []
  let error = ''

  const addHighlight = (value: string) => {
    if (REGEX_LITERAL.test(value)) return
    for (const part of value.split('|')) {
      const clean = part.replace(/\*/g, '').trim()
      if (clean) highlights.push(clean)
    }
  }

  for (const token of tokenize(trimmed)) {
    const negated = token.startsWith('-') && token.length > 1
    const body = negated ? token.slice(1) : token
    const colon = body.indexOf(':')

    if (colon > 0) {
      const rawField = body.slice(0, colon)
      const value = body.slice(colon + 1)
      const field = FIELD_SYNONYMS[rawField.toLowerCase()]
      const isPayloadField = !field && FIELD_NAME.test(rawField) && !value.startsWith('//')

      if (field || isPayloadField) {
        const existence = value === '*'
        clauses.push({
          field,
          path: field ? undefined : rawField,
          value,
          negated,
          existence,
          matcher: existence ? null : buildMatcher(value, true),
        })
        if (!negated && !existence && value) addHighlight(value)
        continue
      }
    }

    const matcher = buildMatcher(body, false)
    clauses.push({ value: body, negated, existence: false, matcher })
    if (!negated && body) addHighlight(body)
  }

  return { clauses, highlights, error }
}

function expressionTokens(input: string): string[] {
  const tokens: string[] = []
  const pattern = /\s*(>=|<=|!=|=|>|<|\(|\)|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s()<>!=]+)/gy
  let offset = 0
  while (offset < input.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(input)
    if (!match || match.index !== offset) throw new Error(`Unexpected token at character ${offset + 1}`)
    tokens.push(match[1])
    offset = pattern.lastIndex
  }
  return tokens
}

function literal(token: string): unknown {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return token.slice(1, -1)
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(token)) return Number(token)
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === 'true'
  if (/^null$/i.test(token)) return null
  return token
}

function legacyClause(token: string): QueryClause {
  const negated = token.startsWith('-') && token.length > 1
  const body = negated ? token.slice(1) : token
  const colon = body.indexOf(':')
  if (colon > 0) {
    const rawField = body.slice(0, colon)
    const value = body.slice(colon + 1)
    const field = FIELD_SYNONYMS[rawField.toLowerCase()]
    if (field || FIELD_NAME.test(rawField)) return {
      field,
      path: field ? undefined : rawField,
      value,
      negated,
      existence: value === '*',
      matcher: value === '*' ? null : buildMatcher(value, true),
    }
  }
  return { value: body, negated, existence: false, matcher: buildMatcher(body, false) }
}

function compileExpressionQuery(input: string): CompiledQuery | null {
  try {
    const tokens = expressionTokens(input)
    let position = 0
    const peek = () => tokens[position]
    const consume = () => tokens[position++]
    const keyword = (value: string) => peek()?.toUpperCase() === value
    const parsePrimary = (): QueryExpression => {
      if (peek() === '(') {
        consume()
        const child = parseOr()
        if (consume() !== ')') throw new Error(`Missing closing parenthesis near token ${position + 1}`)
        return child
      }
      const path = consume()
      if (!path) throw new Error('Expected a field or search term')
      const operator = peek()
      if (operator && ['=', '!=', '>', '>=', '<', '<='].includes(operator)) {
        consume()
        const valueToken = consume()
        if (!valueToken || valueToken === ')') throw new Error(`Expected a value after ${operator}`)
        return { kind: 'comparison', path, operator: operator as ComparisonOperator, value: literal(valueToken) }
      }
      if (keyword('BETWEEN')) {
        consume()
        const lower = consume()
        if (!lower || !keyword('AND')) throw new Error('BETWEEN requires “lower AND upper”')
        consume()
        const upper = consume()
        if (!upper) throw new Error('BETWEEN requires an upper bound')
        return { kind: 'comparison', path, operator: 'between', value: literal(lower), upper: literal(upper) }
      }
      if (keyword('IS')) {
        consume()
        const negated = keyword('NOT') ? (consume(), true) : false
        const kind = consume()?.toUpperCase()
        if (kind !== 'NULL' && kind !== 'MISSING') throw new Error('IS accepts NULL, NOT NULL, MISSING or NOT MISSING')
        const comparison: ComparisonExpression = { kind: 'comparison', path, operator: kind === 'NULL' ? 'is-null' : 'is-missing' }
        return negated ? { kind: 'not', child: comparison } : comparison
      }
      if (keyword('EXISTS')) {
        consume()
        return { kind: 'comparison', path, operator: 'exists' }
      }
      return { kind: 'clause', clause: legacyClause(path) }
    }
    const parseUnary = (): QueryExpression => keyword('NOT') ? (consume(), { kind: 'not', child: parseUnary() }) : parsePrimary()
    const parseAnd = (): QueryExpression => {
      let node = parseUnary()
      while (position < tokens.length && peek() !== ')' && !keyword('OR')) {
        if (keyword('AND')) consume()
        node = { kind: 'and', left: node, right: parseUnary() }
      }
      return node
    }
    const parseOr = (): QueryExpression => {
      let node = parseAnd()
      while (keyword('OR')) { consume(); node = { kind: 'or', left: node, right: parseAnd() } }
      return node
    }
    const expression = parseOr()
    if (position !== tokens.length) throw new Error(`Unexpected token “${peek()}”`)
    const highlights = tokens.filter((token) => !/^(AND|OR|NOT|IS|BETWEEN|EXISTS|NULL|MISSING|[()<>!=]+)$/i.test(token) && !/^-?\d/.test(token))
    return { clauses: [], expression, highlights, error: '' }
  } catch (cause) {
    return { clauses: [], highlights: [], error: cause instanceof Error ? cause.message : 'Invalid query syntax' }
  }
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

// Scalar payload values indexed by canonical key, built the first time a query
// asks for a field the model does not carry. Keyed by the event, so it is
// released with the batch.
const payloadCache = new WeakMap<LogEvent, Map<string, string>>()
const typedPayloadCache = new WeakMap<LogEvent, Map<string, unknown>>()

function payloadIndex(event: LogEvent): Map<string, string> {
  const cached = payloadCache.get(event)
  if (cached) return cached

  const index = new Map<string, string>()
  const absorb = (source: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(flattenPayload(source))) {
      if (value === null || value === undefined || typeof value === 'object') continue
      const canonical = canonicalKey(key)
      if (!index.has(canonical)) index.set(canonical, String(value))
    }
  }
  if (event.json && typeof event.json === 'object') absorb(event.json as Record<string, unknown>)
  absorb(event.extra)
  absorb(event.decoded)

  payloadCache.set(event, index)
  return index
}

function typedPayloadIndex(event: LogEvent): Map<string, unknown> {
  const cached = typedPayloadCache.get(event)
  if (cached) return cached
  const index = new Map<string, unknown>()
  const absorb = (source: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(flattenPayload(source))) {
      const canonical = canonicalKey(key)
      if (!index.has(canonical)) index.set(canonical, value)
    }
  }
  if (event.json && typeof event.json === 'object') absorb(event.json as Record<string, unknown>)
  absorb(event.extra)
  absorb(event.decoded)
  typedPayloadCache.set(event, index)
  return index
}

function directPath(source: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let current = source
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else if (current && typeof current === 'object') {
      const object = current as Record<string, unknown>
      const key = Object.keys(object).find((candidate) => canonicalKey(candidate) === canonicalKey(segment))
      if (!key) return undefined
      current = object[key]
    } else return undefined
  }
  return current
}

function comparisonValue(event: LogEvent, path: string): unknown {
  const field = FIELD_SYNONYMS[path.toLowerCase()]
  if (field === 'raw') return event.raw
  if (field) return event[field]
  const direct = directPath(event.json, path) ?? directPath(event.decoded, path) ?? directPath(event.extra, path)
  return direct !== undefined ? direct : typedPayloadIndex(event).get(canonicalKey(path))
}

function compareTyped(actual: unknown, expression: ComparisonExpression): boolean {
  const expected = expression.value
  if (expression.operator === 'is-missing') return actual === undefined
  if (expression.operator === 'is-null') return actual === null
  if (expression.operator === 'exists') return actual !== undefined
  if (expression.operator === '=' || expression.operator === '!=') {
    const equal = typeof actual === typeof expected && Object.is(actual, expected)
    return expression.operator === '=' ? equal : !equal
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') return false
  if (expression.operator === 'between') return typeof expression.upper === 'number' && actual >= expected && actual <= expression.upper
  if (expression.operator === '>') return actual > expected
  if (expression.operator === '>=') return actual >= expected
  if (expression.operator === '<') return actual < expected
  return actual <= expected
}

function expressionMatches(event: LogEvent, expression: QueryExpression): boolean {
  if (expression.kind === 'and') return expressionMatches(event, expression.left) && expressionMatches(event, expression.right)
  if (expression.kind === 'or') return expressionMatches(event, expression.left) || expressionMatches(event, expression.right)
  if (expression.kind === 'not') return !expressionMatches(event, expression.child)
  if (expression.kind === 'clause') {
    const hit = clauseMatches(event, expression.clause)
    return expression.clause.negated ? !hit : hit
  }
  if (expression.kind === 'comparison') return compareTyped(comparisonValue(event, expression.path), expression)
  return false
}

function fieldValue(event: LogEvent, clause: QueryClause): string {
  if (clause.path) return payloadIndex(event).get(canonicalKey(clause.path)) ?? ''
  if (clause.field === 'raw') return event.raw
  return String(event[clause.field as Exclude<QueryField, 'raw'>] ?? '')
}

function clauseMatches(event: LogEvent, clause: QueryClause): boolean {
  if (!clause.field && !clause.path) {
    if (!clause.value) return true
    if (clause.matcher) return clause.matcher(haystack(event))
    return haystack(event).includes(clause.value.toLowerCase())
  }

  const value = fieldValue(event, clause)
  if (clause.existence) return value.trim() !== ''
  if (clause.matcher) return clause.matcher(value)

  if (clause.field === 'level') {
    const wanted = normalizeLevel(clause.value)
    if (wanted !== 'unknown') return event.level === wanted
    return event.level.toLowerCase() === clause.value.toLowerCase()
  }
  return value.toLowerCase().includes(clause.value.toLowerCase())
}

export function matchesQuery(event: LogEvent, compiled: CompiledQuery): boolean {
  if (compiled.error) return false
  if (compiled.expression) return expressionMatches(event, compiled.expression)
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

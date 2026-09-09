import type { LogEventFields, LogLevel } from './types'

// ─── Field aliases ────────────────────────────────────────────────────────────
// Order matters: the first key present wins.

/**
 * Aliases are matched **canonically**: case, `-`, `_` and spaces are ignored, so
 * one entry covers every spelling a logger might emit. `correlationId` therefore
 * also matches `correlation_id`, `correlation-id`, `CorrelationID` and
 * `CORRELATION_ID`; only genuinely different words need their own entry.
 * Dots are preserved, so nested paths (`kubernetes.pod_name`) stay distinct.
 */
export const FIELD_ALIASES: Record<keyof Omit<LogEventFields, 'level' | 'levelRaw' | 'ts'>, string[]> = {
  tsRaw: [
    'timestamp', 'time', '@timestamp', '@t', 'ts', 'eventTime', 'eventTimestamp',
    'datetime', 'date', 'asctime', 'timeMillis', 'timestampMs', 'logTime',
    'startTime', 'receivedAt', '_time',
  ],
  message: [
    'message', 'msg', 'log', 'text', 'event', '@m', '@mt',
    'shortMessage', 'logMessage', 'body',
  ],
  service: [
    'service', 'service.name', 'application', 'applicationName', 'app', 'appName',
    'serviceName', 'component', 'microservice', 'svc', 'program',
    'spring.application.name',
  ],
  namespace: [
    'namespace', 'namespaceName', 'ns', 'kubernetes.namespace_name',
    'kubernetes.namespace', 'k8s.namespace', 'k8s.namespace.name',
    'openshift.namespace', 'project',
  ],
  pod: [
    'pod', 'podName', 'podId', 'kubernetes.pod_name', 'kubernetes.pod',
    'k8s.pod.name', 'instance', 'nodeName', 'host', 'hostname',
  ],
  container: [
    'container', 'containerName', 'containerId', 'kubernetes.container_name',
    'k8s.container.name', 'docker.container_name',
  ],
  traceId: [
    'traceId', 'trace.id', 'X-B3-TraceId', 'dd.trace_id', 'otel.trace_id',
    'otelTraceId', 'apm.trace_id', 'mdc.traceId',
  ],
  correlationId: [
    'correlationId', 'X-Correlation-Id', 'correlation', 'corrId', 'cid',
    'conversationId', 'mdc.correlationId',
  ],
  requestId: [
    'requestId', 'X-Request-Id', 'reqId', 'http.request.id', 'mdc.requestId',
    // An idempotency key is not literally a request id, but it is the value an
    // operator filters by to find every retry of the same operation.
    'X-Idempotency-Key', 'idempotencyKey',
    'X-Amzn-Trace-Id', 'X-Amz-Request-Id', 'X-Transaction-Id', 'transactionId',
    'operationId',
  ],
  thread: [
    'thread', 'threadName', 'threadId', 'tid', 'goroutine', 'worker',
    'process.thread.name', 'coroutine',
  ],
  logger: [
    'logger', 'loggerName', 'log.logger', 'caller', 'source', 'class',
    'category', 'channel', 'module', 'facility',
  ],
}

const LEVEL_KEYS = [
  'level', 'log.level', 'severity', 'severityText', 'logLevel', 'lvl',
  'levelname', 'levelValue', '@l', 'priority',
]

// ─── Level ────────────────────────────────────────────────────────────────────

const LEVEL_MAP: Record<string, LogLevel> = {
  trace: 'trace', finest: 'trace', finer: 'trace', verbose: 'trace', v: 'trace',
  debug: 'debug', fine: 'debug', dbg: 'debug', d: 'debug',
  info: 'info', information: 'info', notice: 'info', log: 'info', i: 'info',
  warn: 'warn', warning: 'warn', w: 'warn',
  error: 'error', err: 'error', severe: 'error', e: 'error', eror: 'error',
  fatal: 'fatal', critical: 'fatal', crit: 'fatal', panic: 'fatal', emergency: 'fatal', alert: 'fatal',
}

/** Bunyan/pino numeric levels. */
function levelFromNumber(n: number): LogLevel {
  if (n >= 60) return 'fatal'
  if (n >= 50) return 'error'
  if (n >= 40) return 'warn'
  if (n >= 30) return 'info'
  if (n >= 20) return 'debug'
  return 'trace'
}

export function normalizeLevel(raw: unknown): LogLevel {
  if (typeof raw === 'number' && Number.isFinite(raw)) return levelFromNumber(raw)
  const text = String(raw ?? '').trim()
  if (!text) return 'unknown'
  if (/^\d+$/.test(text)) return levelFromNumber(Number(text))
  return LEVEL_MAP[text.toLowerCase()] ?? 'unknown'
}

const TEXT_LEVEL_RE = /\b(TRACE|DEBUG|INFO|INFORMATION|NOTICE|WARN|WARNING|ERROR|SEVERE|FATAL|CRITICAL|PANIC)\b/i

/** Best-effort level for a plain-text line. */
export function levelFromText(text: string): { level: LogLevel; raw: string } {
  if (/^\s*(panic:|fatal error:)/i.test(text)) return { level: 'fatal', raw: 'panic' }
  const match = TEXT_LEVEL_RE.exec(text)
  if (!match) return { level: 'unknown', raw: '' }
  return { level: normalizeLevel(match[1]), raw: match[1] }
}

// ─── Timestamp ────────────────────────────────────────────────────────────────

// Leading timestamps we can pull out of unstructured lines. Ordered widest-first.
const TS_PATTERNS: RegExp[] = [
  // 2024-05-15T10:23:45.123456789Z / +02:00 / no zone
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?/,
  // 15/May/2024:10:23:45 +0000  (access logs)
  /\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s[+-]\d{4}/,
  // May 15 10:23:45 (syslog)
  /\b[A-Za-z]{3}\s{1,2}\d{1,2}\s\d{2}:\d{2}:\d{2}\b/,
  // 10:23:45.123 (bare clock)
  /\b\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?\b/,
]

/** True when the text starts with something that looks like a timestamp. */
export function startsWithTimestamp(text: string): boolean {
  const head = text.slice(0, 40)
  return /^\s*[[(]?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(head)
    || /^\s*[[(]?\d{2}\/[A-Za-z]{3}\/\d{4}:/.test(head)
    || /^\s*[[(]?\d{2}:\d{2}:\d{2}[.,\]\s]/.test(head)
    || /^\s*[A-Za-z]{3}\s{1,2}\d{1,2}\s\d{2}:\d{2}:\d{2}\s/.test(head)
}

/** Convert a timestamp of any recognized shape to epoch ms, or null. */
export function parseTimestamp(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return epochToMs(raw)

  const text = String(raw).trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return epochToMs(Number(text))

  // `15/May/2024:10:23:45 +0000` — Date.parse rejects the CLF shape outright.
  const clf = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})\s?([+-]\d{4})?$/.exec(text)
  if (clf) {
    const zone = clf[5] ? `${clf[5].slice(0, 3)}:${clf[5].slice(3)}` : 'Z'
    const retry = Date.parse(`${clf[3]}-${monthNumber(clf[2])}-${clf[1]}T${clf[4]}${zone}`)
    if (Number.isFinite(retry)) return retry
  }

  // Normalize the `,` fractional separator and the space date/time separator so
  // Date.parse accepts the common Java/Python shapes, then trim sub-millisecond
  // precision, which JS cannot represent.
  let candidate = text.replace(',', '.')
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(candidate)) candidate = candidate.replace(' ', 'T')
  candidate = candidate.replace(/(\.\d{3})\d+/, '$1')

  const parsed = Date.parse(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function epochToMs(n: number): number {
  const abs = Math.abs(n)
  if (abs > 1e17) return Math.round(n / 1e6) // nanoseconds
  if (abs > 1e14) return Math.round(n / 1e3) // microseconds
  if (abs > 1e11) return Math.round(n)       // milliseconds
  return Math.round(n * 1000)                // seconds
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function monthNumber(name: string): string {
  return String(MONTHS.indexOf(name.toLowerCase()) + 1).padStart(2, '0')
}

/** Pull the first recognizable timestamp out of a plain-text line. */
export function timestampFromText(text: string): { ts: number | null; raw: string } {
  for (const pattern of TS_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    const ts = parseTimestamp(match[0])
    if (ts !== null) return { ts, raw: match[0] }
  }
  return { ts: null, raw: '' }
}

// ─── Payload flattening & field extraction ───────────────────────────────────

// Structured logs nest a few levels (`attributes.http.status_code`), never
// hundreds. The caps keep a pathological payload from turning one event into
// thousands of keys.
const MAX_FLATTEN_DEPTH = 5
const MAX_FLATTEN_KEYS = 250

/**
 * Flatten nested objects into dotted paths, keeping the containers too, so both
 * `attributes` and `attributes.http.status_code` are addressable. Arrays are
 * kept whole: you filter on scalars, not on element positions.
 */
export function flattenPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {}

  const walk = (value: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [key, child] of Object.entries(value)) {
      if (Object.keys(flat).length >= MAX_FLATTEN_KEYS) return
      const path = prefix ? `${prefix}.${key}` : key
      if (!(path in flat)) flat[path] = child
      if (child && typeof child === 'object' && !Array.isArray(child) && depth < MAX_FLATTEN_DEPTH) {
        walk(child as Record<string, unknown>, path, depth + 1)
      }
    }
  }

  walk(payload, '', 0)
  return flat
}

/**
 * Collapse the spellings a key can take. `X-Correlation-Id`, `x_correlation_id`
 * and `correlationId` all become `xcorrelationid` / `correlationid`, so one
 * alias covers every casing and separator style. Dots survive, keeping nested
 * paths (`kubernetes.pod_name`) apart from flat ones.
 */
export function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '')
}

export interface PayloadLookup {
  get(alias: string): { value: unknown; key: string } | undefined
}

/** Index a flattened payload by canonical key. First spelling wins. */
export function buildLookup(flat: Record<string, unknown>): PayloadLookup {
  const index = new Map<string, { value: unknown; key: string }>()
  for (const [key, value] of Object.entries(flat)) {
    const canonical = canonicalKey(key)
    if (!index.has(canonical)) index.set(canonical, { value, key })
  }
  return { get: (alias) => index.get(canonicalKey(alias)) }
}

function pick(lookup: PayloadLookup, aliases: string[]): { value: string; key: string } {
  for (const alias of aliases) {
    const hit = lookup.get(alias)
    if (!hit) continue
    const { value, key } = hit
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'object') continue
    return { value: String(value), key }
  }
  return { value: '', key: '' }
}

const NESTED_JSON_KEYS = [
  'message', 'msg', 'body', 'payload', 'response', 'request', 'data',
  'result', 'error', 'exception', 'detail', 'context', 'params', 'attributes',
]

/**
 * Decode JSON that was escaped into a string field, recursively: a payload
 * escaped inside a message that itself holds an escaped body comes back fully
 * unwrapped. Returns the decoded values keyed by their source field; the
 * original payload is never mutated.
 */
export function decodeNested(flat: Record<string, unknown>): Record<string, unknown> {
  const lookup = buildLookup(flat)
  const decoded: Record<string, unknown> = {}
  for (const alias of NESTED_JSON_KEYS) {
    const hit = lookup.get(alias)
    if (!hit || typeof hit.value !== 'string') continue
    const parsed = parseJsonString(hit.value)
    if (parsed !== undefined) decoded[hit.key] = unwrapNestedJson(parsed)
  }
  return decoded
}

/** Parse a string only when it really is a JSON object or array. */
export function parseJsonString(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.length < 2) return undefined
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined // not JSON after all — leave the string alone
  }
}

// Escaped-inside-escaped happens in the wild (a gateway logs a body that already
// contains a serialized payload), but the nesting is shallow; the cap stops a
// pathological input from recursing forever.
const MAX_UNWRAP_DEPTH = 6

/**
 * Walk a value and replace every string that is really serialized JSON with the
 * parsed structure. Returns new values; the input is never mutated.
 */
export function unwrapNestedJson(value: unknown, depth = 0): unknown {
  if (depth >= MAX_UNWRAP_DEPTH) return value
  if (typeof value === 'string') {
    const parsed = parseJsonString(value)
    return parsed === undefined ? value : unwrapNestedJson(parsed, depth + 1)
  }
  if (Array.isArray(value)) return value.map((item) => unwrapNestedJson(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = unwrapNestedJson(child, depth + 1)
    }
    return out
  }
  return value
}

export interface NormalizedPayload {
  fields: LogEventFields
  extra: Record<string, unknown>
  decoded: Record<string, unknown>
}

/** Map an arbitrary JSON payload onto the normalized event fields. */
export function normalizePayload(
  payload: Record<string, unknown>,
  options: { decodeNestedJson?: boolean } = {},
): NormalizedPayload {
  const flat = flattenPayload(payload)
  const lookup = buildLookup(flat)
  const consumed = new Set<string>()

  const take = (keys: string[]) => {
    const found = pick(lookup, keys)
    if (found.key) consumed.add(found.key)
    return found.value
  }

  const levelHit = pick(lookup, LEVEL_KEYS)
  if (levelHit.key) consumed.add(levelHit.key)
  const rawLevelValue = levelHit.key ? flat[levelHit.key] : ''

  const tsRaw = take(FIELD_ALIASES.tsRaw)
  let message = take(FIELD_ALIASES.message)

  const decoded = options.decodeNestedJson === false ? {} : decodeNested(flat)
  // A message that is itself JSON reads much better as its inner message.
  const decodedMessage = decoded.message ?? decoded.msg ?? decoded.Message
  if (decodedMessage && typeof decodedMessage === 'object') {
    const inner = pick(buildLookup(decodedMessage as Record<string, unknown>), FIELD_ALIASES.message)
    if (inner.value) message = inner.value
  }

  const fields: LogEventFields = {
    level: normalizeLevel(rawLevelValue),
    levelRaw: levelHit.value,
    ts: parseTimestamp(tsRaw),
    tsRaw,
    message,
    service: take(FIELD_ALIASES.service),
    namespace: take(FIELD_ALIASES.namespace),
    pod: take(FIELD_ALIASES.pod),
    container: take(FIELD_ALIASES.container),
    traceId: take(FIELD_ALIASES.traceId),
    correlationId: take(FIELD_ALIASES.correlationId),
    requestId: take(FIELD_ALIASES.requestId),
    thread: take(FIELD_ALIASES.thread),
    logger: take(FIELD_ALIASES.logger),
  }

  const extra = omitConsumedFields(payload, consumed)

  return { fields, extra, decoded }
}

const OMITTED = Symbol('omitted-log-field')

/** Remove only promoted leaves, preserving siblings such as attributes.request_body. */
function omitConsumedFields(payload: Record<string, unknown>, consumed: Set<string>): Record<string, unknown> {
  const visit = (value: unknown, path: string): unknown | typeof OMITTED => {
    if (consumed.has(path)) return OMITTED
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key
      const kept = visit(child, nextPath)
      if (kept !== OMITTED) output[key] = kept
    }
    return Object.keys(output).length ? output : OMITTED
  }

  const result = visit(payload, '')
  return result === OMITTED ? {} : result as Record<string, unknown>
}

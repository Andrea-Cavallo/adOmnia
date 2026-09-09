import type { LogEventFields, LogLevel } from './types'

// ─── Field aliases ────────────────────────────────────────────────────────────
// Order matters: the first key present wins.

export const FIELD_ALIASES: Record<keyof Omit<LogEventFields, 'level' | 'levelRaw' | 'ts'>, string[]> = {
  tsRaw: ['timestamp', 'time', '@timestamp', 'ts', 'eventTime', 'datetime', 'date'],
  message: ['message', 'msg', 'log', 'text', 'event'],
  service: ['service', 'application', 'app', 'serviceName', 'service_name', 'app_name', 'component'],
  namespace: ['namespace', 'ns', 'kubernetes.namespace_name', 'k8s.namespace'],
  pod: ['pod', 'podName', 'pod_name', 'kubernetes.pod_name', 'instance', 'host', 'hostname'],
  container: ['container', 'containerName', 'container_name', 'kubernetes.container_name'],
  traceId: ['traceId', 'trace_id', 'trace-id', 'traceID', 'dd.trace_id', 'otel.trace_id'],
  correlationId: ['correlationId', 'correlation_id', 'correlation-id', 'corrId', 'cid'],
  requestId: ['requestId', 'request_id', 'request-id', 'reqId', 'req_id'],
  thread: ['thread', 'threadName', 'thread_name', 'goroutine', 'worker'],
  logger: ['logger', 'loggerName', 'logger_name', 'caller', 'source', 'class', 'category'],
}

const LEVEL_KEYS = ['level', 'severity', 'logLevel', 'log_level', 'lvl', 'levelname', 'levelName', 'priority']

/** Every payload key the normalizer can consume — the rest lands in `extra`. */
export const KNOWN_KEYS = new Set<string>([...LEVEL_KEYS, ...Object.values(FIELD_ALIASES).flat()])

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

/**
 * Flatten one nested level so `kubernetes: { pod_name }` resolves through the
 * dotted aliases, without exploding deeply nested payloads.
 */
export function flattenPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...payload }
  for (const [key, value] of Object.entries(payload)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const dotted = `${key}.${childKey}`
      if (!(dotted in flat)) flat[dotted] = childValue
    }
  }
  return flat
}

function pick(flat: Record<string, unknown>, keys: string[]): { value: string; key: string } {
  for (const key of keys) {
    const value = flat[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'object') continue
    return { value: String(value), key }
  }
  return { value: '', key: '' }
}

const NESTED_JSON_KEYS = ['message', 'msg', 'body', 'payload', 'response', 'request', 'data']

/**
 * Decode JSON that was escaped into a string field. Returns the decoded values
 * keyed by their source field; the original payload is never mutated.
 */
export function decodeNested(flat: Record<string, unknown>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {}
  for (const key of NESTED_JSON_KEYS) {
    const value = flat[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length < 2) continue
    if (trimmed[0] !== '{' && trimmed[0] !== '[') continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') decoded[key] = parsed
    } catch {
      /* not JSON after all — leave the string alone */
    }
  }
  return decoded
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
  const consumed = new Set<string>()

  const take = (keys: string[]) => {
    const found = pick(flat, keys)
    if (found.key) consumed.add(found.key.split('.')[0])
    return found.value
  }

  const levelHit = pick(flat, LEVEL_KEYS)
  if (levelHit.key) consumed.add(levelHit.key)
  const rawLevelValue = levelHit.key ? flat[levelHit.key] : ''

  const tsRaw = take(FIELD_ALIASES.tsRaw)
  let message = take(FIELD_ALIASES.message)

  const decoded = options.decodeNestedJson === false ? {} : decodeNested(flat)
  // A message that is itself JSON reads much better as its inner message.
  const decodedMessage = decoded.message ?? decoded.msg
  if (decodedMessage && typeof decodedMessage === 'object') {
    const holder = decodedMessage as Record<string, unknown>
    const inner = holder.message ?? holder.msg
    if (typeof inner === 'string' && inner) message = inner
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

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (consumed.has(key)) continue
    extra[key] = value
  }

  return { fields, extra, decoded }
}

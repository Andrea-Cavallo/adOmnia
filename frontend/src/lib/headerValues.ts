export type HeaderValueKind = 'uuid7' | 'timestamp' | 'http-date'
export type TimestampFormat = 'seconds' | 'milliseconds' | 'iso'

export function headerValueKind(name: string): HeaderValueKind | null {
  const key = name.trim().toLowerCase().replace(/[_-]/g, '').replace(/^x/, '')
  if (['requestid', 'correlationid', 'idempotencykey', 'idempotencekey'].includes(key)) return 'uuid7'
  if (['timestamp', 'requesttimestamp', 'webhooktimestamp'].includes(key)) return 'timestamp'
  if (key === 'date') return 'http-date'
  return null
}

/** UUIDv7: 48-bit Unix milliseconds, version 7, RFC variant and 74 random bits. */
export function uuid7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let time = BigInt(now)
  for (let i = 5; i >= 0; i--) { bytes[i] = Number(time & 255n); time >>= 8n }
  bytes[6] = (bytes[6] & 15) | 112
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function generateHeaderValue(kind: HeaderValueKind, format: TimestampFormat = 'seconds', now = Date.now()): string {
  if (kind === 'uuid7') return uuid7(now)
  if (kind === 'http-date') return new Date(now).toUTCString()
  if (format === 'iso') return new Date(now).toISOString()
  return String(format === 'milliseconds' ? now : Math.floor(now / 1000))
}

// Generated-on-send variables (`{{$uuid7}}`), Postman-compatible names where they exist.
const DYNAMIC_VARS: Record<string, () => string> = {
  $uuid7: () => uuid7(),
  $guid: () => crypto.randomUUID(),
  $randomUUID: () => crypto.randomUUID(),
  $timestamp: () => generateHeaderValue('timestamp', 'seconds'),
  $timestampMs: () => generateHeaderValue('timestamp', 'milliseconds'),
  $isoTimestamp: () => generateHeaderValue('timestamp', 'iso'),
  $httpDate: () => generateHeaderValue('http-date'),
}

/** A fresh value for a dynamic variable name (`$uuid7`), or undefined if it is not one. */
export function dynamicVarValue(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(DYNAMIC_VARS, name) ? DYNAMIC_VARS[name]() : undefined
}

export function isDynamicVar(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(DYNAMIC_VARS, name)
}

const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_VALUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const HTTP_DATE_VALUE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/

/**
 * The dynamic token a recorded header should replay with, so a flow sends a fresh
 * Request-Id/Timestamp/Date on every run instead of the value captured once.
 * ponytail: matches on header name + value shape, not on "was the Generate button
 * clicked"; a hand-typed UUID in X-Request-ID is also replayed fresh, which is what
 * a replay of these headers wants anyway.
 */
export function recordedHeaderToken(name: string, value: string): string | null {
  const kind = headerValueKind(name)
  const v = value.trim()
  if (kind === 'uuid7') return UUID_VALUE.test(v) ? '{{$uuid7}}' : null
  if (kind === 'http-date') return HTTP_DATE_VALUE.test(v) ? '{{$httpDate}}' : null
  if (kind === 'timestamp') {
    if (/^\d{10}$/.test(v)) return '{{$timestamp}}'
    if (/^\d{13}$/.test(v)) return '{{$timestampMs}}'
    if (ISO_VALUE.test(v)) return '{{$isoTimestamp}}'
  }
  return null
}

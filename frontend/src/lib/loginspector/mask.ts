import type { LogEvent } from './types'

export const REDACTED = '[redacted]'

/** Substrings that mark a field name as sensitive (case-insensitive). */
export const DEFAULT_SENSITIVE_FIELDS = [
  'authorization', 'token', 'password', 'passwd', 'secret', 'cookie',
  'apikey', 'api_key', 'api-key', 'credential', 'private_key', 'privatekey',
  'session', 'fiscalcode', 'fiscal_code', 'codice_fiscale', 'iban', 'dean',
  'pan', 'card_number', 'phone', 'telephone', 'mobile', 'telefono',
]

const BEARER_RE = /\b(bearer|basic)\s+[A-Za-z0-9._\-+/=]{8,}/gi
const KEYED_VALUE_RE =
  /("?)(authorization|token|access_token|refresh_token|id_token|password|passwd|secret|client_secret|api[-_]?key|cookie|session)\1(\s*[:=]\s*)("?)([^"\s,;}&]+)\4/gi

function isSensitiveKey(key: string, terms: string[]): boolean {
  const lower = key.toLowerCase()
  return terms.some((term) => term && lower.includes(term))
}

/** Redact values whose key looks sensitive. Returns new values; never mutates. */
export function maskJsonValue(value: unknown, terms: string[], keyIsSensitive = false): unknown {
  if (keyIsSensitive && (value === null || typeof value !== 'object')) return REDACTED
  if (Array.isArray(value)) return value.map((item) => maskJsonValue(item, terms, keyIsSensitive))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskJsonValue(child, terms, keyIsSensitive || isSensitiveKey(key, terms))
    }
    return out
  }
  if (typeof value === 'string') return maskText(value)
  return value
}

/** Redact secrets embedded in free text (`Bearer …`, `password=…`, `"token":"…"`). */
export function maskText(text: string): string {
  if (!text) return text
  return text
    .replace(BEARER_RE, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(KEYED_VALUE_RE, (_m, q1: string, key: string, sep: string, q2: string) => `${q1}${key}${q1}${sep}${q2}${REDACTED}${q2}`)
}

/**
 * Produce a masked copy of a parsed batch. The original events stay intact so
 * masking can be toggled off without re-importing.
 */
export function maskEvents(events: LogEvent[], extraFields: string[] = []): LogEvent[] {
  const terms = [...DEFAULT_SENSITIVE_FIELDS, ...extraFields.map((f) => f.trim().toLowerCase())].filter(Boolean)
  return events.map((event) => ({
    ...event,
    message: maskText(event.message),
    raw: maskText(event.raw),
    stack: maskText(event.stack),
    json: event.json ? maskJsonValue(event.json, terms) : null,
    extra: maskJsonValue(event.extra, terms) as Record<string, unknown>,
    decoded: maskJsonValue(event.decoded, terms) as Record<string, unknown>,
  }))
}

/** Remove configured noisy keys from a value shown in the detail tree. */
export function hideJsonFields(value: unknown, hiddenFields: string[]): unknown {
  const hidden = new Set(hiddenFields.map((field) => field.trim().toLowerCase()).filter(Boolean))
  if (hidden.size === 0) return value
  return hideValue(value, hidden)
}

function hideValue(value: unknown, hidden: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => hideValue(item, hidden))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!hidden.has(key.toLowerCase())) out[key] = hideValue(child, hidden)
  }
  return out
}

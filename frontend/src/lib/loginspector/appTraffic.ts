// Correlating application logs with the traffic adOmnia itself observed.
//
// A browser call, a Composer send and a proxied request all carry the same
// correlation/trace headers the backend later writes into its logs. Reading
// those headers turns three separate panels into one investigation: from a
// call in the browser you reach the backend chain it produced, and back.

import type { CorrelationKey } from './correlate'
import { canonicalKey } from './normalize'
import type { LogEvent } from './types'

export type AppTrafficSource = 'browser' | 'composer' | 'proxy'

export interface TrafficIdentifier {
  key: CorrelationKey
  /** Header the value came from, so the match is auditable. */
  header: string
  value: string
}

export interface AppTrafficRecord {
  id: string
  source: AppTrafficSource
  method: string
  url: string
  status: number
  timestamp: number | null
  identifiers: TrafficIdentifier[]
}

/**
 * Correlation headers that carry an id we can match against log fields.
 * Matched on the canonical spelling, so `X-Correlation-ID`, `x_correlation_id`
 * and `correlationId` are one entry.
 */
const HEADER_KEYS: { pattern: RegExp; key: CorrelationKey }[] = [
  { pattern: /^x?correlationid$/, key: 'correlationId' },
  { pattern: /^x?requestid$/, key: 'requestId' },
  { pattern: /^x?(?:b3)?traceid$/, key: 'traceId' },
]

function traceparentId(value: string): string {
  // 00-<32 hex trace id>-<16 hex span id>-<flags>
  const parts = value.trim().split('-')
  return parts.length >= 3 && /^[0-9a-f]{32}$/i.test(parts[1]) ? parts[1] : ''
}

export function correlationIdsFromHeaders(headers: Record<string, string> | undefined): TrafficIdentifier[] {
  if (!headers) return []
  const found: TrafficIdentifier[] = []
  for (const [header, raw] of Object.entries(headers)) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    const canonical = canonicalKey(header)
    if (canonical === 'traceparent') {
      const trace = traceparentId(value)
      if (trace) found.push({ key: 'traceId', header, value: trace })
      continue
    }
    if (canonical === 'xamzntraceid') {
      const root = /Root=([^;]+)/i.exec(value)?.[1]
      if (root) found.push({ key: 'traceId', header, value: root })
      continue
    }
    const match = HEADER_KEYS.find((candidate) => candidate.pattern.test(canonical))
    if (match) found.push({ key: match.key, header, value })
  }
  return found
}

interface BrowserLikeEntry {
  id: string
  url: string
  method: string
  status: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  timestamp?: number
}

export function browserTrafficRecords(entries: BrowserLikeEntry[]): AppTrafficRecord[] {
  return entries.flatMap((entry) => {
    const identifiers = [
      ...correlationIdsFromHeaders(entry.requestHeaders),
      ...correlationIdsFromHeaders(entry.responseHeaders),
    ]
    if (!identifiers.length) return []
    return [{
      id: `browser-${entry.id}`,
      source: 'browser' as const,
      method: entry.method,
      url: entry.url,
      status: entry.status,
      timestamp: entry.timestamp ?? null,
      identifiers,
    }]
  })
}

interface ComposerLikeEntry {
  id: string
  recordedAt: string | null
  request?: { method: string; url: string; headers: { key: string; value: string; enabled: boolean }[] }
  response: { status: number; headers: Record<string, string> }
}

export function composerTrafficRecords(history: ComposerLikeEntry[]): AppTrafficRecord[] {
  return history.flatMap((entry) => {
    const requestHeaders = Object.fromEntries(
      (entry.request?.headers ?? []).filter((header) => header.enabled && header.key).map((header) => [header.key, header.value]),
    )
    const identifiers = [
      ...correlationIdsFromHeaders(requestHeaders),
      ...correlationIdsFromHeaders(entry.response.headers),
    ]
    if (!identifiers.length) return []
    const recorded = entry.recordedAt ? Date.parse(entry.recordedAt) : NaN
    return [{
      id: `composer-${entry.id}`,
      source: 'composer' as const,
      method: entry.request?.method ?? '',
      url: entry.request?.url ?? '',
      status: entry.response.status,
      timestamp: Number.isFinite(recorded) ? recorded : null,
      identifiers,
    }]
  })
}

interface ProxyLikeEntry {
  id: string
  timestamp?: string
  method: string
  url: string
  status: number
  reqHeaders?: Record<string, string>
  respHeaders?: Record<string, string>
}

export function proxyTrafficRecords(entries: ProxyLikeEntry[]): AppTrafficRecord[] {
  return entries.flatMap((entry) => {
    const identifiers = [
      ...correlationIdsFromHeaders(entry.reqHeaders),
      ...correlationIdsFromHeaders(entry.respHeaders),
    ]
    if (!identifiers.length) return []
    const recorded = entry.timestamp ? Date.parse(entry.timestamp) : NaN
    return [{
      id: `proxy-${entry.id}`,
      source: 'proxy' as const,
      method: entry.method,
      url: entry.url,
      status: entry.status,
      timestamp: Number.isFinite(recorded) ? recorded : null,
      identifiers,
    }]
  })
}

/** adOmnia traffic that carries one of this event's correlation identifiers. */
export function trafficForEvent(records: AppTrafficRecord[], event: LogEvent): AppTrafficRecord[] {
  const own = new Set([event.correlationId, event.traceId, event.requestId].filter(Boolean))
  if (!own.size) return []
  return records.filter((record) => record.identifiers.some((identifier) => own.has(identifier.value)))
}

/** Log events reachable from one observed call — the browser → backend jump. */
export function eventsForTraffic(events: LogEvent[], record: AppTrafficRecord): LogEvent[] {
  const wanted = new Set(record.identifiers.map((identifier) => identifier.value))
  return events.filter((event) => wanted.has(event.correlationId) || wanted.has(event.traceId) || wanted.has(event.requestId))
}

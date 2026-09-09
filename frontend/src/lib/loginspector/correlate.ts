import type { LogEvent } from './types'

export type CorrelationKey = 'correlationId' | 'traceId' | 'requestId'

export const CORRELATION_KEYS: { key: CorrelationKey; label: string }[] = [
  { key: 'correlationId', label: 'Correlation ID' },
  { key: 'traceId', label: 'Trace ID' },
  { key: 'requestId', label: 'Request ID' },
]

export interface CorrelatedEvent {
  event: LogEvent
  /** Milliseconds since the previous event in the chain, null when unknown. */
  deltaMs: number | null
}

export interface CorrelationResult {
  key: CorrelationKey
  value: string
  events: CorrelatedEvent[]
  /** Total wall time of the chain, null when timestamps are missing. */
  spanMs: number | null
  errorCount: number
  services: string[]
}

/** Correlation identifiers present on an event, for the "show related" menu. */
export function correlationCandidates(event: LogEvent): { key: CorrelationKey; label: string; value: string }[] {
  return CORRELATION_KEYS
    .filter(({ key }) => Boolean(event[key]))
    .map(({ key, label }) => ({ key, label, value: event[key] }))
}

/** Chronological order; events without a timestamp keep their source order. */
export function sortChronologically(events: LogEvent[], direction: 'asc' | 'desc' = 'asc'): LogEvent[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...events].sort((a, b) => {
    if (a.ts === null && b.ts === null) return (a.id - b.id) * factor
    if (a.ts === null) return 1
    if (b.ts === null) return -1
    if (a.ts === b.ts) return (a.id - b.id) * factor
    return (a.ts - b.ts) * factor
  })
}

/** Rebuild one distributed request from a correlation / trace / request id. */
export function correlateEvents(events: LogEvent[], key: CorrelationKey, value: string): CorrelationResult {
  const matched = sortChronologically(events.filter((event) => event[key] === value))

  let previousTs: number | null = null
  const chain: CorrelatedEvent[] = matched.map((event) => {
    const deltaMs = event.ts !== null && previousTs !== null ? event.ts - previousTs : null
    if (event.ts !== null) previousTs = event.ts
    return { event, deltaMs }
  })

  let firstStamp: number | null = null
  let lastStamp: number | null = null
  for (const event of matched) {
    if (event.ts === null) continue
    firstStamp = firstStamp === null ? event.ts : Math.min(firstStamp, event.ts)
    lastStamp = lastStamp === null ? event.ts : Math.max(lastStamp, event.ts)
  }
  const services = [...new Set(matched.map((event) => event.service).filter(Boolean))]

  return {
    key,
    value,
    events: chain,
    spanMs: firstStamp !== null && lastStamp !== null && firstStamp !== lastStamp ? lastStamp - firstStamp : null,
    errorCount: matched.filter((event) => event.level === 'error' || event.level === 'fatal').length,
    services,
  }
}

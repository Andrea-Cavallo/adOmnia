import { buildLookup, flattenPayload } from './normalize'
import { sortChronologically } from './correlate'
import type { LogEvent } from './types'

export interface LogCallSpan {
  id: string
  parentId: string
  service: string
  label: string
  startMs: number | null
  durationMs: number | null
  eventIds: number[]
  inferred: boolean
  status: 'ok' | 'error' | 'unknown'
}

function lookup(event: LogEvent, aliases: string[]): string {
  const source = event.json && typeof event.json === 'object' && !Array.isArray(event.json)
    ? event.json as Record<string, unknown>
    : event.extra
  const fields = buildLookup(flattenPayload(source))
  for (const alias of aliases) {
    const hit = fields.get(alias)
    if (hit && hit.value !== null && hit.value !== undefined && typeof hit.value !== 'object') {
      const value = String(hit.value).trim()
      if (value) return value
    }
  }
  return ''
}

function duration(event: LogEvent): number | null {
  const raw = lookup(event, ['duration_ms', 'attributes.duration_ms', 'http.duration_ms', 'attributes.latency_ms', 'latency_ms'])
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function label(event: LogEvent): string {
  const method = lookup(event, ['http.method', 'http.request.method', 'attributes.http.method', 'attributes.method'])
  const operation = lookup(event, ['span.name', 'operation', 'attributes.operation', 'http.route', 'attributes.http.route', 'url.path'])
  return [method, operation].filter(Boolean).join(' ') || event.message || 'log event'
}

function status(events: LogEvent[]): LogCallSpan['status'] {
  if (events.some((event) => event.level === 'error' || event.level === 'fatal')) return 'error'
  return events.some((event) => event.level !== 'unknown') ? 'ok' : 'unknown'
}

/** Build service lanes from real spans, falling back to clearly marked inferred event points. */
export function buildCallWaterfall(events: LogEvent[]): LogCallSpan[] {
  const ordered = sortChronologically(events)
  const explicit = new Map<string, LogEvent[]>()
  const inferred: LogEvent[] = []

  for (const event of ordered) {
    if (event.spanId) {
      const bucket = explicit.get(event.spanId)
      if (bucket) bucket.push(event)
      else explicit.set(event.spanId, [event])
    } else {
      inferred.push(event)
    }
  }

  const spans: LogCallSpan[] = []
  for (const [spanId, spanEvents] of explicit) {
    const stamps = spanEvents.map((event) => event.ts).filter((value): value is number => value !== null)
    const declared = spanEvents.map(duration).filter((value): value is number => value !== null)
    const observed = stamps.length > 1 ? Math.max(...stamps) - Math.min(...stamps) : null
    spans.push({
      id: spanId,
      parentId: spanEvents.find((event) => event.parentSpanId)?.parentSpanId || '',
      service: spanEvents.find((event) => event.service)?.service || 'unknown service',
      label: label(spanEvents[0]),
      startMs: stamps.length ? Math.min(...stamps) : null,
      durationMs: declared.length ? declared[declared.length - 1] : observed,
      eventIds: spanEvents.map((event) => event.id),
      inferred: false,
      status: status(spanEvents),
    })
  }

  for (const event of inferred) {
    spans.push({
      id: `event-${event.id}`,
      parentId: '',
      service: event.service || 'unknown service',
      label: label(event),
      startMs: event.ts,
      durationMs: duration(event),
      eventIds: [event.id],
      inferred: true,
      status: status([event]),
    })
  }

  return spans.sort((a, b) => (a.startMs ?? Number.MAX_SAFE_INTEGER) - (b.startMs ?? Number.MAX_SAFE_INTEGER))
}

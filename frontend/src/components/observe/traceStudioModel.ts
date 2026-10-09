// Pure helpers for the Trace Studio: where a span's code lives, a stable color per service,
// and the comparison of two traces of the same operation.
import type { OtlpSpan } from '@/lib/otlp-api'
export { relativeToRoots } from '@/lib/sourcePaths'

/** Source location from the OpenTelemetry code.* attributes (old and stable names). */
export function spanSource(span: Pick<OtlpSpan, 'attributes'>): { file: string; line: number; function?: string } | null {
  const attrs = span.attributes ?? {}
  const file = attrs['code.filepath'] ?? attrs['code.file.path']
  if (!file) return null
  const line = Number(attrs['code.lineno'] ?? attrs['code.line.number']) || 1
  const fn = attrs['code.function'] ?? attrs['code.function.name']
  return { file, line, ...(fn ? { function: fn } : {}) }
}

/** Stable hue per service name, readable on dark and light surfaces. */
export function serviceColor(service: string): string {
  let hash = 0
  for (const ch of service) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = (hash % 12) * 30 + 15
  return `oklch(68% 0.14 ${hue})`
}

export interface SpanComparison {
  key: string
  service: string
  name: string
  left?: number
  right?: number
  /** right - left in ms, when the step exists in both traces. */
  deltaMs?: number
}

/** Steps matched by service + name (the n-th occurrence pairs with the n-th): durations side by side. */
export function compareTraces(left: readonly OtlpSpan[], right: readonly OtlpSpan[]): SpanComparison[] {
  const keyed = (spans: readonly OtlpSpan[]) => {
    const seen = new Map<string, number>()
    return spans.map((span) => {
      const base = `${span.service}\u0000${span.name}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      return { key: `${base}\u0000${n}`, span }
    })
  }
  const rows = new Map<string, SpanComparison>()
  for (const { key, span } of keyed(left)) rows.set(key, { key, service: span.service, name: span.name, left: span.durationMs })
  for (const { key, span } of keyed(right)) {
    const row = rows.get(key) ?? { key, service: span.service, name: span.name }
    rows.set(key, { ...row, right: span.durationMs })
  }
  return [...rows.values()].map((row) => (row.left !== undefined && row.right !== undefined ? { ...row, deltaMs: row.right - row.left } : row))
}

export interface SpanInsight {
  /** Client span minus the server span it caused, in another service: time on the wire and queues. */
  networkMs?: number
  /** Consumer start minus producer end: how long the message waited in the broker. */
  brokerDelayMs?: number
  /** The deepest failing span: the error starts here, its ancestors only propagate it. */
  errorOrigin?: boolean
  /** Overlaps a sibling in time. */
  parallel?: boolean
  /** Ends after its parent ended (fire-and-forget, goroutine, message). */
  async?: boolean
}

export function spanInsights(spans: readonly OtlpSpan[]): Map<string, SpanInsight> {
  const byId = new Map(spans.map((span) => [span.spanId, span]))
  const children = new Map<string, OtlpSpan[]>()
  for (const span of spans) {
    if (!span.parentSpanId) continue
    children.set(span.parentSpanId, [...(children.get(span.parentSpanId) ?? []), span])
  }
  const end = (span: OtlpSpan) => span.startMs + span.durationMs
  const hasErrorBelow = (span: OtlpSpan): boolean => (children.get(span.spanId) ?? []).some((child) => child.statusCode === 'ERROR' || hasErrorBelow(child))
  const out = new Map<string, SpanInsight>()
  const set = (id: string, patch: SpanInsight) => out.set(id, { ...out.get(id), ...patch })
  for (const span of spans) {
    const kids = children.get(span.spanId) ?? []
    if (span.kind === 'client') {
      const server = kids.find((child) => child.kind === 'server' && child.service !== span.service)
      if (server) set(span.spanId, { networkMs: Math.max(0, span.durationMs - server.durationMs) })
    }
    const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined
    if (span.kind === 'consumer' && parent?.kind === 'producer') set(span.spanId, { brokerDelayMs: Math.max(0, span.startMs - end(parent)) })
    if (span.statusCode === 'ERROR' && !hasErrorBelow(span)) set(span.spanId, { errorOrigin: true })
    if (parent && end(span) > end(parent) + 0.001) set(span.spanId, { async: true })
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i]
        const b = kids[j]
        if (a.startMs < end(b) && b.startMs < end(a)) { set(a.spanId, { parallel: true }); set(b.spanId, { parallel: true }) }
      }
    }
  }
  return out
}

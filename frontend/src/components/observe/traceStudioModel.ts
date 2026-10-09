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

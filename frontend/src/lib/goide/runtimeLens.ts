// Runtime Lens text: what the running code did at a source location, from OpenTelemetry spans.
import type { OtlpLensStat } from '@/lib/otlp-api'

/** p95 at or above this is a slow path whatever the median. */
export const SLOW_P95_MS = 250

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`
  if (value >= 10) return `${Math.round(value)} ms`
  return `${value.toFixed(1)} ms`
}

function ago(lastMs: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - lastMs) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

/** Counts of every lens in the file: hot is the single most called location (2+ calls). */
export interface FileCounts {
  max: number
  /** How many locations share the max: a tie (spans of the same request) is not a hot path. */
  atMax: number
}

export function fileCounts(stats: readonly OtlpLensStat[]): FileCounts {
  const max = Math.max(0, ...stats.map((stat) => stat.count))
  return { max, atMax: stats.filter((stat) => stat.count === max).length }
}

/** Hot: the single most called location of its file. Slow: high p95, or a tail 5× the median. */
export function lensFlags(stat: OtlpLensStat, counts: FileCounts): { hot: boolean; slow: boolean } {
  return {
    hot: stat.count > 1 && stat.count === counts.max && counts.atMax === 1,
    slow: stat.p95Ms >= SLOW_P95_MS || (stat.count >= 5 && stat.p95Ms >= 5 * Math.max(stat.p50Ms, 0.1)),
  }
}

/** Messages per minute for a consumer location, over the time its spans cover (at least a minute). */
export function consumeRate(stat: OtlpLensStat): number | undefined {
  if (stat.kind !== 'consumer' || stat.firstMs === undefined) return undefined
  return stat.count / Math.max(1, (stat.lastMs - stat.firstMs) / 60_000)
}

export function lensTitle(stat: OtlpLensStat, counts: FileCounts, now: number): string {
  const { hot, slow } = lensFlags(stat, counts)
  const parts = [
    `runtime: ${stat.count} ${stat.kind === 'consumer' ? 'message' : 'call'}${stat.count === 1 ? '' : 's'}`,
    consumeRate(stat) !== undefined ? `${consumeRate(stat)!.toFixed(1)} msg/min` : '',
    `p50 ${ms(stat.p50Ms)}`,
    `p95 ${ms(stat.p95Ms)}`,
    stat.errors ? `${stat.errors} error${stat.errors === 1 ? '' : 's'}` : '',
    stat.retries ? `${stat.retries} retr${stat.retries === 1 ? 'y' : 'ies'}` : '',
    ago(stat.lastMs, now),
    hot ? 'hot path' : '',
    slow ? 'slow path' : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

export function lensTooltip(stat: OtlpLensStat): string {
  return `${stat.name}${stat.function ? ` (${stat.function})` : ''}: avg ${ms(stat.avgMs)}, p99 ${ms(stat.p99Ms)}, max ${ms(stat.maxMs)}. From the OpenTelemetry spans received locally.`
}

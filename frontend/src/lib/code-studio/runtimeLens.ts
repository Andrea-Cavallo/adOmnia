// Runtime Lens text: what the running code did at a source location, from OpenTelemetry spans.
import type { OtlpLensStat } from '@/lib/otlp-api'

/** p95 at or above this is a slow path whatever the median. */
export const SLOW_P95_MS = 250

// Runtime Lens polling: a normal cadence, a slower idle cadence after repeated empty polls, and no
// polling while the window is hidden. The lens reads only the local OTLP receiver, but a background
// editor must not keep asking for data nobody is looking at.
export const LENS_POLL_MS = 3000
export const LENS_IDLE_POLL_MS = 15000
export const LENS_IDLE_AFTER = 3

/** Delay before the next poll: it slows down once several polls in a row returned no spans. */
export function lensPollDelayMs(emptyPolls: number): number {
  return emptyPolls >= LENS_IDLE_AFTER ? LENS_IDLE_POLL_MS : LENS_POLL_MS
}

/** The poll loop runs only while the lens is on and the window is visible, to keep overhead down. */
export function lensPollingActive(enabled: boolean, visible: boolean): boolean {
  return enabled && visible
}

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
    (stat.cacheHits ?? 0) + (stat.cacheMisses ?? 0) ? `cache ${stat.cacheHits ?? 0} hit / ${stat.cacheMisses ?? 0} miss` : '',
    ago(stat.lastMs, now),
    hot ? 'hot path' : '',
    slow ? 'slow path' : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

export function lensTooltip(stat: OtlpLensStat): string {
  return `${stat.name}${stat.function ? ` (${stat.function})` : ''}: avg ${ms(stat.avgMs)}, p99 ${ms(stat.p99Ms)}, max ${ms(stat.maxMs)}. From the OpenTelemetry spans received locally.${(stat.cacheHits ?? 0) + (stat.cacheMisses ?? 0) ? ` Cache hit rate ${Math.round(100 * (stat.cacheHits ?? 0) / ((stat.cacheHits ?? 0) + (stat.cacheMisses ?? 0)))}% of explicitly reported outcomes.` : ''}`
}

export interface NodeRuntime { count: number; errors: number; p95Ms: number }

/** Trailing slashes removed without `/\/+$/`, whose repetition before the end anchor is quadratic. */
const withoutTrailingSlashes = (path: string): string => {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end -= 1
  return path.slice(0, end)
}

interface RuntimeNode { id: string; kind: string; label: string; file?: string; line?: number }

/**
 * Runtime correlation for workspace-graph nodes: a route gets the server spans named like it,
 * a function the spans whose source line falls inside it (the nearest function start above).
 * Span files may be absolute (under the project root) or already relative.
 */
export function runtimeByNode(stats: readonly OtlpLensStat[], root: string, nodes: readonly RuntimeNode[]): Map<string, NodeRuntime> {
  const out = new Map<string, NodeRuntime>()
  const add = (id: string, stat: OtlpLensStat) => {
    const current = out.get(id) ?? { count: 0, errors: 0, p95Ms: 0 }
    out.set(id, { count: current.count + stat.count, errors: current.errors + stat.errors, p95Ms: Math.max(current.p95Ms, stat.p95Ms) })
  }
  const normalize = (path: string) => path.split(String.fromCharCode(92)).join('/')
  const base = withoutTrailingSlashes(normalize(root)).toLowerCase()
  const relative = (file: string) => {
    const path = normalize(file)
    return path.toLowerCase().startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  }
  const code = nodes.filter((node) => node.file && node.line && node.kind !== 'endpoint' && node.kind !== 'rpc')
  for (const stat of stats) {
    const route = nodes.find((node) => (node.kind === 'endpoint' || node.kind === 'rpc') && node.label === stat.name)
    if (route) add(route.id, stat)
    const file = relative(stat.file)
    let owner: RuntimeNode | null = null
    for (const node of code) {
      const same = node.file === file || (!file.includes('/') && node.file!.endsWith(`/${file}`))
      if (same && node.line! <= stat.line && (!owner || node.line! > owner.line!)) owner = node
    }
    if (owner) add(owner.id, stat)
  }
  return out
}

export function runtimeText(runtime: NodeRuntime): string {
  return `${runtime.count} call${runtime.count === 1 ? '' : 's'} · p95 ${ms(runtime.p95Ms)}${runtime.errors ? ` · ${runtime.errors} err` : ''}`
}

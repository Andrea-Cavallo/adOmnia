import type { AnalyzedRequest, LogAnalysis } from './analyze'

export type MetricDimension = 'route' | 'service' | 'version'

export interface ExecutionMetric {
  key: string
  dimension: MetricDimension
  sampleCount: number
  completedSamples: number
  errorCount: number
  errorRate: number
  timedSamples: number
  explicitTimedSamples: number
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
  chainKeys: string[]
  eventIds: number[]
}

export interface MetricComparison {
  key: string
  baseline: ExecutionMetric | null
  current: ExecutionMetric | null
  sampleDelta: number
  errorRateDelta: number | null
  p95DeltaMs: number | null
  p95DeltaPercent: number | null
}

function percentile(sorted: number[], value: number): number | null {
  if (!sorted.length) return null
  const index = Math.max(0, Math.ceil(value * sorted.length) - 1)
  return sorted[Math.min(index, sorted.length - 1)]
}

function requestKey(request: AnalyzedRequest): string {
  return `${request.correlationKey}:${request.correlationId || request.traceId || request.requestId}`
}

function dimensionKey(request: AnalyzedRequest, dimension: MetricDimension): string {
  if (dimension === 'route') return `${request.method || 'ANY'} ${request.endpoint || request.operation || '(unknown route)'}`
  if (dimension === 'version') return `${request.service || '(unknown service)'}@${request.serviceVersion || '(unknown version)'}`
  return request.service || '(unknown service)'
}

/** Request metrics keep their denominator and evidence chains next to every percentile. */
export function buildExecutionMetrics(analysis: LogAnalysis, dimension: MetricDimension): ExecutionMetric[] {
  const groups = new Map<string, AnalyzedRequest[]>()
  for (const request of analysis.requests) {
    const key = dimensionKey(request, dimension)
    groups.set(key, [...(groups.get(key) ?? []), request])
  }
  return [...groups.entries()].map(([key, requests]) => {
    const timed = requests.filter((request) => request.durationMs !== null)
    const durations = timed.map((request) => request.durationMs!).sort((a, b) => a - b)
    const errors = requests.filter((request) => ['client-error', 'server-error', 'timeout'].includes(request.status))
    const completed = requests.filter((request) => request.status !== 'unknown' && request.status !== 'retry')
    return {
      key,
      dimension,
      sampleCount: requests.length,
      completedSamples: completed.length,
      errorCount: errors.length,
      errorRate: requests.length ? errors.length / requests.length : 0,
      timedSamples: timed.length,
      explicitTimedSamples: timed.filter((request) => request.durationKind === 'explicit').length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      chainKeys: requests.map(requestKey),
      eventIds: [...new Set(requests.flatMap((request) => request.eventIds))],
    }
  }).sort((a, b) => b.sampleCount - a.sampleCount || a.key.localeCompare(b.key))
}

export function compareExecutionMetrics(baseline: ExecutionMetric[], current: ExecutionMetric[]): MetricComparison[] {
  const left = new Map(baseline.map((metric) => [metric.key, metric]))
  const right = new Map(current.map((metric) => [metric.key, metric]))
  return [...new Set([...left.keys(), ...right.keys()])].map((key) => {
    const before = left.get(key) ?? null
    const after = right.get(key) ?? null
    const p95DeltaMs = before?.p95Ms !== null && before?.p95Ms !== undefined && after?.p95Ms !== null && after?.p95Ms !== undefined
      ? after.p95Ms - before.p95Ms : null
    return {
      key,
      baseline: before,
      current: after,
      sampleDelta: (after?.sampleCount ?? 0) - (before?.sampleCount ?? 0),
      errorRateDelta: before && after ? after.errorRate - before.errorRate : null,
      p95DeltaMs,
      p95DeltaPercent: p95DeltaMs !== null && before?.p95Ms ? p95DeltaMs / before.p95Ms : null,
    }
  }).sort((a, b) => Math.abs(b.p95DeltaMs ?? 0) - Math.abs(a.p95DeltaMs ?? 0) || a.key.localeCompare(b.key))
}

/** Split by service version for a direct before/after comparison. */
export function compareVersions(analysis: LogAnalysis, baselineVersion: string, currentVersion: string, dimension: MetricDimension = 'route'): MetricComparison[] {
  const subset = (version: string): LogAnalysis => ({
    ...analysis,
    requests: analysis.requests.filter((request) => request.serviceVersion === version),
  })
  return compareExecutionMetrics(buildExecutionMetrics(subset(baselineVersion), dimension), buildExecutionMetrics(subset(currentVersion), dimension))
}

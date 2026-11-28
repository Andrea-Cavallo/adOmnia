import type { LoadTestResult, LoadTestTimelinePoint } from '@/lib/loadtest-api'
import type { StressSample, StressStats } from '@/lib/flowStressStats'

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * The Go engine's result in the shape the Stress dock draws (charts, analysis, history,
 * exports). One conversion for the live snapshot and the final result.
 */
export function toStressStats(result: LoadTestResult): StressStats {
  const steps = (result.steps ?? []).map((step) => ({
    nodeId: step.id,
    step: step.step,
    count: step.count,
    errors: step.errors,
    errorPct: round1(step.errorPct),
    min: round1(step.minMs),
    avg: round1(step.avgMs),
    p50: round1(step.p50Ms),
    p90: round1(step.p90Ms),
    p95: round1(step.p95Ms),
    p99: round1(step.p99Ms),
    max: round1(step.maxMs),
    statuses: { ...step.statusCodes },
  }))
  const statuses: Record<string, number> = {}
  steps.forEach((step) => Object.entries(step.statuses).forEach(([code, n]) => { statuses[code] = (statuses[code] ?? 0) + n }))
  const measuredMs = result.measuredTimeMs ?? 0
  const bytes = result.bytesReceived ?? 0
  const iterations = result.iterations ?? 0
  const failedIterations = result.failedIterations ?? 0
  const slowest = steps.reduce<(typeof steps)[number] | undefined>((worst, step) => (!worst || step.p95 > worst.p95 ? step : worst), undefined)
  return {
    totalRequests: result.successful + result.failed,
    totalErrors: result.failed,
    excludedRequests: result.warmupSkipped ?? 0,
    iterationsOk: iterations - failedIterations,
    iterationsFailed: failedIterations,
    elapsedMs: Math.round(result.totalTimeMs),
    measuredElapsedMs: Math.round(measuredMs),
    rps: round1(result.throughput),
    bytes,
    bytesPerSecond: measuredMs > 0 ? Math.round(bytes / (measuredMs / 1000)) : 0,
    overall: {
      min: round1(result.minMs), avg: round1(result.avgMs), p50: round1(result.p50Ms), p90: round1(result.p90Ms),
      p95: round1(result.p95Ms), p99: round1(result.p99Ms), max: round1(result.maxMs),
    },
    statuses,
    errorGroups: (result.errorGroups ?? []).map((group) => ({
      fingerprint: group.message,
      count: group.count,
      steps: group.steps ?? [],
      statuses: [group.status ? String(group.status) : 'ERR'],
    })),
    steps,
    timeline: (result.throughputTimeline ?? []).map((bucket) => ({ s: bucket.second, requests: bucket.reqs, errors: bucket.errors, activeVus: bucket.vus })),
    distribution: (result.distribution ?? []).map((bin) => ({
      fromMs: bin.fromMs,
      toMs: bin.overflow ? Number.POSITIVE_INFINITY : bin.toMs,
      count: bin.count,
      percentage: bin.percentage,
      ...(bin.overflow ? { overflow: true } : {}),
    })),
    apdex: result.apdex ?? { thresholdMs: 500, satisfied: 0, tolerated: 0, frustrated: 0, score: 0 },
    slowestStep: slowest?.step,
  }
}

/** The raw request log (CSV export), 0-based VU and iteration like the dataset modes. */
export function toStressSamples(timeline: LoadTestTimelinePoint[] = []): StressSample[] {
  return timeline.map((point) => ({
    t: Math.round(point.timeMs),
    vu: Math.max(0, (point.vu ?? 1) - 1),
    iteration: Math.max(0, (point.iteration ?? 1) - 1),
    nodeId: point.stepId ?? '',
    step: point.step ?? '',
    status: point.ok ? 'success' : 'failed',
    httpStatus: point.status || undefined,
    latencyMs: Math.round(point.latencyMs),
    stepMs: Math.round(point.latencyMs),
    bytes: point.bytes,
    error: point.error,
    measured: point.measured,
  }))
}

import type { FlowRunStatus } from '@/lib/flowStorage'

/** One executed request inside a stress run. */
export interface StressSample {
  /** ms since the run started, taken when the request finished */
  t: number
  vu: number
  iteration: number
  nodeId: string
  step: string
  status: FlowRunStatus
  httpStatus?: number
  /** HTTP time measured by the Go executor — the backend figure */
  latencyMs?: number
  /** Whole step time: IPC, scripts, retries included */
  stepMs: number
  bytes?: number
  error?: string
  phase?: string
  measured?: boolean
}

export interface StepStats {
  nodeId: string
  step: string
  count: number
  errors: number
  errorPct: number
  min: number
  avg: number
  p50: number
  p90: number
  p95: number
  p99: number
  max: number
  statuses: Record<string, number>
}

export interface LatencyStats {
  min: number
  avg: number
  p50: number
  p90: number
  p95: number
  p99: number
  max: number
}

export interface StressErrorGroup {
  fingerprint: string
  count: number
  steps: string[]
  statuses: string[]
}

export interface StressStats {
  totalRequests: number
  totalErrors: number
  excludedRequests: number
  iterationsOk: number
  iterationsFailed: number
  elapsedMs: number
  measuredElapsedMs: number
  rps: number
  bytes: number
  bytesPerSecond: number
  overall: LatencyStats
  statuses: Record<string, number>
  errorGroups: StressErrorGroup[]
  steps: StepStats[]
  timeline: Array<{ s: number; requests: number; errors: number; activeVus?: number }>
  distribution: Array<{ fromMs: number; toMs: number; count: number; percentage: number; overflow?: boolean }>
  apdex: { thresholdMs: number; satisfied: number; tolerated: number; frustrated: number; score: number }
  slowestStep?: string
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

const round1 = (value: number) => Math.round(value * 10) / 10

function latencyStats(values: number[]): LatencyStats {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    min: sorted[0] ?? 0,
    avg: sorted.length ? round1(sum / sorted.length) : 0,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

function errorFingerprint(sample: StressSample) {
  const raw = sample.error?.trim() || (sample.httpStatus ? `HTTP ${sample.httpStatus}` : 'Request failed')
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/\b\d{3,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
}

/**
 * Running aggregates for a stress run. Keeps only numbers per step, so stats
 * stay complete after raw samples hit their cap.
 * ponytail: snapshot re-sorts every step, fine for the 25-VU ceiling; switch to
 * a histogram if runs reach millions of requests.
 */
function latencyDistribution(values: number[], p99: number): StressStats['distribution'] {
  if (values.length === 0) return []
  const ceiling = Math.max(1, p99)
  const binSize = niceBinSize(ceiling / 10)
  const bins = Array.from({ length: Math.ceil(ceiling / binSize) }, (_, index) => ({
    fromMs: index * binSize,
    toMs: (index + 1) * binSize,
    count: 0,
    percentage: 0,
  }))
  let overflow = 0
  values.forEach((value) => {
    if (value > bins[bins.length - 1].toMs) overflow += 1
    else bins[Math.min(bins.length - 1, Math.floor(value / binSize))].count += 1
  })
  const result: StressStats['distribution'] = bins.map((bin) => ({ ...bin, percentage: round1((bin.count / values.length) * 100) }))
  if (overflow) result.push({ fromMs: bins[bins.length - 1].toMs, toMs: Number.POSITIVE_INFINITY, count: overflow, percentage: round1((overflow / values.length) * 100), overflow: true })
  return result
}

function niceBinSize(value: number) {
  if (!Number.isFinite(value) || value <= 1) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
}

export function createStressAccumulator(apdexThresholdMs = 500) {
  const steps = new Map<string, { step: string; values: number[]; errors: number; statuses: Record<string, number> }>()
  const timeline = new Map<number, { requests: number; errors: number; activeVus?: number }>()
  const values: number[] = []
  const statuses: Record<string, number> = {}
  const errorGroups = new Map<string, { count: number; steps: Set<string>; statuses: Set<string> }>()
  let requests = 0
  let errors = 0
  let excludedRequests = 0
  let bytes = 0
  let iterationsOk = 0
  let iterationsFailed = 0

  return {
    add(sample: StressSample, measured = sample.measured !== false) {
      const failed = sample.status === 'failed'
      const second = Math.floor(sample.t / 1000)
      const bucket = timeline.get(second) ?? { requests: 0, errors: 0 }
      timeline.set(second, { ...bucket, requests: bucket.requests + 1, errors: bucket.errors + (failed ? 1 : 0) })
      if (!measured) { excludedRequests += 1; return }
      requests += 1
      if (failed) errors += 1
      const latency = sample.latencyMs ?? sample.stepMs
      values.push(latency)
      bytes += sample.bytes ?? 0
      const step = steps.get(sample.nodeId) ?? { step: sample.step, values: [], errors: 0, statuses: {} }
      step.values.push(latency)
      if (failed) step.errors += 1
      const code = sample.httpStatus ? String(sample.httpStatus) : 'ERR'
      step.statuses[code] = (step.statuses[code] ?? 0) + 1
      statuses[code] = (statuses[code] ?? 0) + 1
      if (failed) {
        const fingerprint = errorFingerprint(sample)
        const group = errorGroups.get(fingerprint) ?? { count: 0, steps: new Set<string>(), statuses: new Set<string>() }
        group.count += 1
        group.steps.add(sample.step)
        group.statuses.add(code)
        if (errorGroups.size < 200 || errorGroups.has(fingerprint)) errorGroups.set(fingerprint, group)
      }
      steps.set(sample.nodeId, step)
    },
    activity(elapsedMs: number, activeVus: number) {
      const second = Math.floor(elapsedMs / 1000)
      const bucket = timeline.get(second) ?? { requests: 0, errors: 0 }
      timeline.set(second, { ...bucket, activeVus })
    },
    iteration(ok: boolean, measured = true) {
      if (!measured) return
      if (ok) iterationsOk += 1
      else iterationsFailed += 1
    },
    snapshot(elapsedMs: number, measuredElapsedMs = elapsedMs): StressStats {
      const stepStats: StepStats[] = [...steps.entries()].map(([nodeId, step]) => {
        const latency = latencyStats(step.values)
        return {
          nodeId,
          step: step.step,
          count: step.values.length,
          errors: step.errors,
          errorPct: step.values.length ? round1((step.errors / step.values.length) * 100) : 0,
          ...latency,
          statuses: { ...step.statuses },
        }
      })
      const lastSecond = Math.max(-1, ...timeline.keys())
      let lastActive = 0
      const seconds = Array.from({ length: lastSecond + 1 }, (_, s) => {
        const bucket = timeline.get(s)
        if (bucket?.activeVus !== undefined) lastActive = bucket.activeVus
        return { s, requests: bucket?.requests ?? 0, errors: bucket?.errors ?? 0, activeVus: bucket?.activeVus ?? lastActive }
      })
      const slowest = stepStats.reduce<StepStats | undefined>((worst, step) => (!worst || step.p95 > worst.p95 ? step : worst), undefined)
      const overall = latencyStats(values)
      const satisfied = values.filter((value) => value <= apdexThresholdMs).length
      const tolerated = values.filter((value) => value > apdexThresholdMs && value <= apdexThresholdMs * 4).length
      const frustrated = Math.max(0, values.length - satisfied - tolerated)
      return {
        totalRequests: requests,
        totalErrors: errors,
        excludedRequests,
        iterationsOk,
        iterationsFailed,
        elapsedMs: Math.round(elapsedMs),
        measuredElapsedMs: Math.round(measuredElapsedMs),
        rps: measuredElapsedMs > 0 ? round1(requests / (measuredElapsedMs / 1000)) : 0,
        bytes,
        bytesPerSecond: measuredElapsedMs > 0 ? Math.round(bytes / (measuredElapsedMs / 1000)) : 0,
        overall,
        statuses: { ...statuses },
        errorGroups: [...errorGroups.entries()]
          .map(([fingerprint, group]) => ({ fingerprint, count: group.count, steps: [...group.steps], statuses: [...group.statuses] }))
          .sort((a, b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint))
          .slice(0, 8),
        steps: stepStats,
        timeline: seconds,
        distribution: latencyDistribution(values, overall.p99),
        apdex: { thresholdMs: apdexThresholdMs, satisfied, tolerated, frustrated, score: values.length ? Math.round(((satisfied + tolerated / 2) / values.length) * 1000) / 1000 : 0 },
        slowestStep: slowest?.step,
      }
    },
  }
}

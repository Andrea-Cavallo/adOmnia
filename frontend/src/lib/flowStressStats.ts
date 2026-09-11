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

export interface StressStats {
  totalRequests: number
  totalErrors: number
  iterationsOk: number
  iterationsFailed: number
  elapsedMs: number
  rps: number
  steps: StepStats[]
  timeline: Array<{ s: number; requests: number; errors: number }>
  slowestStep?: string
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Running aggregates for a stress run. Keeps only numbers per step, so stats
 * stay complete after raw samples hit their cap.
 * ponytail: snapshot re-sorts every step, fine for the 25-VU ceiling; switch to
 * a histogram if runs reach millions of requests.
 */
export function createStressAccumulator() {
  const steps = new Map<string, { step: string; values: number[]; errors: number; statuses: Record<string, number> }>()
  const timeline = new Map<number, { requests: number; errors: number }>()
  let requests = 0
  let errors = 0
  let iterationsOk = 0
  let iterationsFailed = 0

  return {
    add(sample: StressSample) {
      const failed = sample.status === 'failed'
      requests += 1
      if (failed) errors += 1
      const step = steps.get(sample.nodeId) ?? { step: sample.step, values: [], errors: 0, statuses: {} }
      step.values.push(sample.latencyMs ?? sample.stepMs)
      if (failed) step.errors += 1
      const code = sample.httpStatus ? String(sample.httpStatus) : 'ERR'
      step.statuses[code] = (step.statuses[code] ?? 0) + 1
      steps.set(sample.nodeId, step)
      const second = Math.floor(sample.t / 1000)
      const bucket = timeline.get(second) ?? { requests: 0, errors: 0 }
      timeline.set(second, { requests: bucket.requests + 1, errors: bucket.errors + (failed ? 1 : 0) })
    },
    iteration(ok: boolean) {
      if (ok) iterationsOk += 1
      else iterationsFailed += 1
    },
    snapshot(elapsedMs: number): StressStats {
      const stepStats: StepStats[] = [...steps.entries()].map(([nodeId, step]) => {
        const sorted = [...step.values].sort((a, b) => a - b)
        const sum = sorted.reduce((total, value) => total + value, 0)
        return {
          nodeId,
          step: step.step,
          count: sorted.length,
          errors: step.errors,
          errorPct: sorted.length ? round1((step.errors / sorted.length) * 100) : 0,
          min: sorted[0] ?? 0,
          avg: sorted.length ? round1(sum / sorted.length) : 0,
          p50: percentile(sorted, 50),
          p90: percentile(sorted, 90),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          max: sorted[sorted.length - 1] ?? 0,
          statuses: { ...step.statuses },
        }
      })
      const lastSecond = Math.max(-1, ...timeline.keys())
      const seconds = Array.from({ length: lastSecond + 1 }, (_, s) => ({ s, ...(timeline.get(s) ?? { requests: 0, errors: 0 }) }))
      const slowest = stepStats.reduce<StepStats | undefined>((worst, step) => (!worst || step.p95 > worst.p95 ? step : worst), undefined)
      return {
        totalRequests: requests,
        totalErrors: errors,
        iterationsOk,
        iterationsFailed,
        elapsedMs: Math.round(elapsedMs),
        rps: elapsedMs > 0 ? round1(requests / (elapsedMs / 1000)) : 0,
        steps: stepStats,
        timeline: seconds,
        slowestStep: slowest?.step,
      }
    },
  }
}

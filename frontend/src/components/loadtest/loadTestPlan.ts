import type { LoadTestWorkload } from '@/lib/loadtest-api'

export type LoadMode = 'burst' | 'gap' | 'load'

export interface LoadInputs {
  concurrency: number
  totalReqs: number
  durationS: number
  useDuration: boolean
  warmupReqs: number
  rampUpS: number
  thinkTimeMs: number
  burst: number
  gapRequests: number
  gapMs: number
}

/** Engine limits (internal/loadtest/scenario.go). */
export const MAX_VUS = 2000
export const MAX_PROBE = 2000
const MAX_DURATION_S = 24 * 60 * 60

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)))

/**
 * The engine workload for each drawer mode. Burst/gap are probes: every request is measured.
 * Load is the closed model: VUs repeat the request for N iterations or for a duration, with
 * an optional ramp-up (a first stage from 0 to the target VUs) and think time.
 */
export function buildLoadPlan(mode: LoadMode, input: LoadInputs): LoadTestWorkload {
  if (mode === 'burst') return { executor: 'probe', count: clamp(input.burst, 1, MAX_PROBE) }
  if (mode === 'gap') return { executor: 'probe', count: clamp(input.gapRequests, 2, 50), gapMs: clamp(input.gapMs, 0, 60000) }

  const vus = clamp(input.concurrency, 1, MAX_VUS)
  const thinkTimeMs = clamp(input.thinkTimeMs, 0, 60000)
  const common = { executor: 'vus', ...(thinkTimeMs > 0 ? { thinkTimeMs } : {}) }
  if (!input.useDuration) {
    const iterations = clamp(input.totalReqs, 1, 10_000_000)
    // The warm-up must leave something to measure.
    const warmupIterations = Math.min(clamp(input.warmupReqs, 0, 100_000), iterations - 1)
    return { ...common, vus, iterations, ...(warmupIterations > 0 ? { warmupIterations } : {}) }
  }
  const durationS = clamp(input.durationS, 1, MAX_DURATION_S)
  const rampUpS = clamp(input.rampUpS, 0, MAX_DURATION_S)
  if (rampUpS === 0) {
    const warmupIterations = clamp(input.warmupReqs, 0, 100_000)
    return { ...common, vus, durationS, ...(warmupIterations > 0 ? { warmupIterations } : {}) }
  }
  // With a ramp the warm-up is the ramp itself: it is sent, not measured.
  return { ...common, stages: [{ durationS: rampUpS, targetVUs: vus, unmeasured: true }, { durationS, targetVUs: vus }] }
}

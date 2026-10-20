export type LoadMode = 'burst' | 'gap' | 'load'

export interface LoadInputs {
  concurrency: number
  totalReqs: number
  durationS: number
  useDuration: boolean
  warmupReqs: number
  burst: number
  gapRequests: number
  gapMs: number
}

export interface LoadPlan {
  concurrency: number
  totalReqs?: number
  durationS?: number
  warmupReqs: number
  staggerMs: number
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)))

/** What the backend receives for each mode. Burst/gap runs are probes: never any warmup, so every request is measured. */
export function buildLoadPlan(mode: LoadMode, input: LoadInputs): LoadPlan {
  if (mode === 'burst') {
    const n = clamp(input.burst, 1, 200)
    return { concurrency: n, totalReqs: n, warmupReqs: 0, staggerMs: 0 }
  }
  if (mode === 'gap') {
    const n = clamp(input.gapRequests, 2, 50)
    return { concurrency: n, totalReqs: n, warmupReqs: 0, staggerMs: clamp(input.gapMs, 0, 60000) }
  }
  const concurrency = clamp(input.concurrency, 1, 200)
  const warmupReqs = clamp(input.warmupReqs, 0, 1000)
  return input.useDuration
    ? { concurrency, durationS: clamp(input.durationS, 1, 3600), warmupReqs, staggerMs: 0 }
    : { concurrency, totalReqs: clamp(input.totalReqs, 1, 50000), warmupReqs, staggerMs: 0 }
}

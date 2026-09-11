import type { ExecuteRequestResult } from '@/lib/executeRequest'
import type { FlowGraphDefinition } from '@/lib/flowStorage'
import { runApiFlow, type RunEntry } from '@/lib/flowRunner'
import { createStressAccumulator, type StressSample, type StressStats } from '@/lib/flowStressStats'
import type { RequestItem } from '@/lib/types'

export const MAX_STRESS_VUS = 25
export const STRESS_SAMPLE_CAP = 200_000

export interface FlowStressConfig {
  vus: number
  rampUpS: number
  mode: 'iterations' | 'duration'
  /** Total iterations across all VUs (iterations mode) */
  iterations: number
  durationS: number
  /** Pause between two iterations of the same VU */
  thinkTimeMs: number
}

export const DEFAULT_STRESS_CONFIG: FlowStressConfig = { vus: 5, rampUpS: 0, mode: 'iterations', iterations: 50, durationS: 30, thinkTimeMs: 0 }

export interface StressProgress {
  stats: StressStats
  iterationsDone: number
  activeVus: number
  elapsedMs: number
  truncated: boolean
}

export interface StressRun {
  config: FlowStressConfig
  startedAt: string
  finishedAt: string
  status: 'completed' | 'stopped'
  stats: StressStats
  samples: StressSample[]
  truncated: boolean
}

export interface RunFlowStressOptions {
  initialVars: Record<string, string>
  signal?: AbortSignal
  execute?: (request: RequestItem, vars: Record<string, string>, options?: { signal?: AbortSignal; record?: boolean }) => Promise<ExecuteRequestResult>
  onProgress?: (progress: StressProgress) => void
  progressIntervalMs?: number
  sampleCap?: number
}

export function validateStressConfig(config: FlowStressConfig): string[] {
  const errors: string[] = []
  const between = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  if (!Number.isInteger(config.vus) || !between(config.vus, 1, MAX_STRESS_VUS)) errors.push(`Virtual users must be a whole number between 1 and ${MAX_STRESS_VUS}.`)
  if (!between(config.rampUpS, 0, 600)) errors.push('Ramp-up must be between 0 and 600 seconds.')
  if (config.mode === 'iterations' && (!Number.isInteger(config.iterations) || !between(config.iterations, 1, 100_000))) errors.push('Iterations must be a whole number between 1 and 100000.')
  if (config.mode === 'duration' && !between(config.durationS, 1, 3600)) errors.push('Duration must be between 1 and 3600 seconds.')
  if (!between(config.thinkTimeMs, 0, 60_000)) errors.push('Think time must be between 0 and 60000 ms.')
  return errors
}

function sleep(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve(false)
  if (ms <= 0) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(false) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true) }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Runs a flow concurrently: `vus` loops each repeat `runApiFlow` with their own
 * variable context until the iteration budget or the duration is spent.
 */
export async function runFlowStress(graph: FlowGraphDefinition, config: FlowStressConfig, options: RunFlowStressOptions): Promise<StressRun> {
  const errors = validateStressConfig(config)
  if (errors.length) throw new Error(errors[0])

  const controller = new AbortController()
  const userAbort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', userAbort, { once: true })

  const cap = options.sampleCap ?? STRESS_SAMPLE_CAP
  const startedAt = new Date().toISOString()
  const start = performance.now()
  const elapsed = () => performance.now() - start
  const acc = createStressAccumulator()
  const samples: StressSample[] = []
  let truncated = false
  let claimed = 0
  let iterationsDone = 0
  let activeVus = 0

  const progress = (): StressProgress => ({ stats: acc.snapshot(elapsed()), iterationsDone, activeVus, elapsedMs: elapsed(), truncated })
  const ticker = options.onProgress ? setInterval(() => options.onProgress?.(progress()), options.progressIntervalMs ?? 500) : undefined
  // Duration mode: in-flight iterations are cut at the deadline and not counted.
  const deadline = config.mode === 'duration' ? setTimeout(() => controller.abort(), config.durationS * 1000) : undefined

  const claim = () => {
    if (controller.signal.aborted) return -1
    if (config.mode === 'iterations' && claimed >= config.iterations) return -1
    claimed += 1
    return claimed - 1
  }

  const record = (entry: RunEntry | undefined, vu: number, iteration: number) => {
    // Only request steps are load; anything finishing after abort is noise.
    if (!entry?.response || controller.signal.aborted) return
    const sample: StressSample = {
      t: Math.round(elapsed()),
      vu,
      iteration,
      nodeId: entry.nodeId,
      step: entry.nodeLabel,
      status: entry.status,
      httpStatus: entry.httpStatus || undefined,
      latencyMs: entry.response.ms > 0 ? Math.round(entry.response.ms) : undefined,
      stepMs: Math.round(entry.durationMs),
      bytes: entry.response.size,
      error: entry.error,
    }
    acc.add(sample)
    if (samples.length < cap) samples.push(sample)
    else truncated = true
  }

  const runVu = async (vu: number) => {
    if (!await sleep((vu * config.rampUpS * 1000) / config.vus, controller.signal)) return
    activeVus += 1
    try {
      for (let first = true; ; first = false) {
        if (!first && !await sleep(config.thinkTimeMs, controller.signal)) break
        const iteration = claim()
        if (iteration < 0) break
        const result = await runApiFlow(graph, {
          initialVars: { ...options.initialVars },
          signal: controller.signal,
          execute: options.execute,
          onEntry: (entries) => record(entries[entries.length - 1], vu, iteration),
        })
        if (controller.signal.aborted) break
        acc.iteration(!result.entries.some((entry) => entry.status === 'failed'))
        iterationsDone += 1
      }
    } finally {
      activeVus -= 1
    }
  }

  try {
    await Promise.all(Array.from({ length: config.vus }, (_, vu) => runVu(vu)))
  } finally {
    clearInterval(ticker)
    clearTimeout(deadline)
    options.signal?.removeEventListener('abort', userAbort)
  }

  const final = progress()
  options.onProgress?.(final)
  return {
    config,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: options.signal?.aborted ? 'stopped' : 'completed',
    stats: final.stats,
    samples,
    truncated,
  }
}

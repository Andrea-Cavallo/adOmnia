import type { ExecuteRequestResult } from '@/lib/executeRequest'
import type { FlowGraphDefinition } from '@/lib/flowStorage'
import { runApiFlow, type RunEntry } from '@/lib/flowRunner'
import { createStressAccumulator, type StressSample, type StressStats } from '@/lib/flowStressStats'
import type { RequestItem } from '@/lib/types'
import { stressBuiltinVars, stressDatasetRow, type StressDataset, type StressDatasetMode } from '@/lib/flowStressDataset'

export const MAX_STRESS_VUS = 200
export const STRESS_SAMPLE_CAP = 200_000

export type StressScenario = 'custom' | 'smoke' | 'load' | 'spike' | 'soak'

export interface StressStage {
  id: string
  label: string
  durationS: number
  targetVus: number
  rampS: number
  measure: boolean
}

export interface FlowStressConfig {
  scenario?: StressScenario
  vus: number
  rampUpS: number
  mode: 'iterations' | 'duration' | 'stages'
  /** Total iterations across all VUs (iterations mode) */
  iterations: number
  durationS: number
  /** Pause between two iterations of the same VU */
  thinkTimeMs: number
  warmupS?: number
  stages?: StressStage[]
  datasetMode?: StressDatasetMode
  apdexTMs?: number
  minApdex?: number
  /** Zero disables p95/throughput gates; zero error rate means strict zero tolerance. */
  maxP95Ms?: number
  maxErrorPct?: number
  minRps?: number
}

export const DEFAULT_STRESS_CONFIG: FlowStressConfig = {
  scenario: 'custom', vus: 5, rampUpS: 0, mode: 'iterations', iterations: 50, durationS: 30, thinkTimeMs: 0, warmupS: 0,
  datasetMode: 'shared', apdexTMs: 500, minApdex: 0.85, maxP95Ms: 1000, maxErrorPct: 1, minRps: 0,
}

const stage = (id: string, label: string, durationS: number, targetVus: number, rampS: number, measure = true): StressStage => ({ id, label, durationS, targetVus, rampS, measure })

export const STRESS_PRESETS: Array<{ id: Exclude<StressScenario, 'custom'>; label: string; description: string; config: Partial<FlowStressConfig> }> = [
  { id: 'smoke', label: 'Smoke', description: 'Fast correctness signal', config: { vus: 1, rampUpS: 0, mode: 'iterations', iterations: 10, thinkTimeMs: 0 } },
  { id: 'load', label: 'Load', description: 'Warm-up, steady traffic and cooldown', config: { vus: 20, mode: 'stages', stages: [stage('warmup', 'Warm-up', 15, 10, 15, false), stage('steady', 'Steady', 60, 20, 10), stage('cooldown', 'Cooldown', 10, 2, 8, false)], thinkTimeMs: 100 } },
  { id: 'spike', label: 'Spike', description: 'Baseline, abrupt peak and recovery', config: { vus: 100, mode: 'stages', stages: [stage('base', 'Baseline', 15, 10, 5), stage('spike', 'Spike', 25, 100, 2), stage('recover', 'Recovery', 20, 10, 5)], thinkTimeMs: 0 } },
  { id: 'soak', label: 'Soak', description: 'Warm-up and long stability run', config: { vus: 25, mode: 'stages', stages: [stage('warmup', 'Warm-up', 30, 10, 30, false), stage('soak', 'Soak', 600, 25, 30), stage('cooldown', 'Cooldown', 30, 2, 25, false)], thinkTimeMs: 250 } },
]

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
  dataset?: StressDataset
  random?: () => number
}

export function validateStressConfig(config: FlowStressConfig): string[] {
  const errors: string[] = []
  const between = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  if (!Number.isInteger(config.vus) || !between(config.vus, 1, MAX_STRESS_VUS)) errors.push(`Virtual users must be a whole number between 1 and ${MAX_STRESS_VUS}.`)
  if (!between(config.rampUpS, 0, 600)) errors.push('Ramp-up must be between 0 and 600 seconds.')
  if (config.mode === 'iterations' && (!Number.isInteger(config.iterations) || !between(config.iterations, 1, 100_000))) errors.push('Iterations must be a whole number between 1 and 100000.')
  if (config.mode === 'duration' && !between(config.durationS, 1, 3600)) errors.push('Duration must be between 1 and 3600 seconds.')
  if (config.mode === 'stages') {
    if (!config.stages?.length || config.stages.length > 8) errors.push('A staged workload needs between 1 and 8 stages.')
    if (config.stages?.length && Math.max(...config.stages.map((item) => item.targetVus)) < 1) errors.push('At least one stage must target one or more virtual users.')
    config.stages?.forEach((item, index) => {
      if (!between(item.durationS, 0.05, 3600)) errors.push(`Stage ${index + 1} duration must be between 0.05 and 3600 seconds.`)
      if (!Number.isInteger(item.targetVus) || !between(item.targetVus, 0, MAX_STRESS_VUS)) errors.push(`Stage ${index + 1} users must be between 0 and ${MAX_STRESS_VUS}.`)
      if (!between(item.rampS, 0, item.durationS)) errors.push(`Stage ${index + 1} ramp must fit inside its duration.`)
    })
  }
  if (!between(config.thinkTimeMs, 0, 60_000)) errors.push('Think time must be between 0 and 60000 ms.')
  if (!between(config.warmupS ?? 0, 0, 3600)) errors.push('Warm-up exclusion must be between 0 and 3600 seconds.')
  if (!between(config.apdexTMs ?? 500, 1, 600_000)) errors.push('APDEX T must be between 1 and 600000 ms.')
  if (!between(config.minApdex ?? 0, 0, 1)) errors.push('Minimum APDEX must be between 0 and 1.')
  if (config.maxP95Ms !== undefined && !between(config.maxP95Ms, 0, 600_000)) errors.push('The p95 SLO must be between 0 and 600000 ms.')
  if (config.maxErrorPct !== undefined && !between(config.maxErrorPct, 0, 100)) errors.push('The error-rate SLO must be between 0 and 100%.')
  if (config.minRps !== undefined && !between(config.minRps, 0, 1_000_000)) errors.push('The throughput SLO must be between 0 and 1000000 req/s.')
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
  const acc = createStressAccumulator(config.apdexTMs ?? 500)
  const samples: StressSample[] = []
  let truncated = false
  let claimed = 0
  let iterationsDone = 0
  let activeVus = 0

  const stages = config.stages ?? []
  const stagedDurationS = stages.reduce((total, item) => total + item.durationS, 0)
  const peakVus = config.mode === 'stages' ? Math.max(0, ...stages.map((item) => item.targetVus)) : config.vus
  const stageAt = (elapsedMs: number) => {
    let offsetS = 0
    for (const item of stages) {
      if (elapsedMs / 1000 < offsetS + item.durationS) return { item, offsetS, elapsedInStageS: elapsedMs / 1000 - offsetS }
      offsetS += item.durationS
    }
    return undefined
  }
  const targetAt = (elapsedMs: number) => {
    const current = stageAt(elapsedMs)
    if (!current) return 0
    const index = stages.indexOf(current.item)
    const previous = index > 0 ? stages[index - 1].targetVus : 0
    if (current.item.rampS <= 0 || current.elapsedInStageS >= current.item.rampS) return current.item.targetVus
    return Math.max(0, Math.round(previous + (current.item.targetVus - previous) * (current.elapsedInStageS / current.item.rampS)))
  }
  const measuredTime = (elapsedMs: number) => {
    if (config.mode !== 'stages') return Math.max(0, elapsedMs - (config.warmupS ?? 0) * 1000)
    let offsetMs = 0
    let measuredMs = 0
    stages.forEach((item) => {
      const stageMs = item.durationS * 1000
      if (item.measure) measuredMs += Math.max(0, Math.min(stageMs, elapsedMs - offsetMs))
      offsetMs += stageMs
    })
    return measuredMs
  }

  const progress = (): StressProgress => {
    const elapsedMs = elapsed()
    return { stats: acc.snapshot(elapsedMs, measuredTime(elapsedMs)), iterationsDone, activeVus, elapsedMs, truncated }
  }
  const ticker = options.onProgress ? setInterval(() => options.onProgress?.(progress()), options.progressIntervalMs ?? 500) : undefined
  // Duration mode: in-flight iterations are cut at the deadline and not counted.
  const deadlineMs = config.mode === 'duration' ? config.durationS * 1000 : config.mode === 'stages' ? stagedDurationS * 1000 : 0
  const deadline = deadlineMs ? setTimeout(() => controller.abort(), deadlineMs) : undefined

  const claim = () => {
    if (controller.signal.aborted) return -1
    if (config.mode === 'iterations' && claimed >= config.iterations) return -1
    claimed += 1
    return claimed - 1
  }

  const record = (entry: RunEntry | undefined, vu: number, iteration: number) => {
    // Only request steps are load; anything finishing after abort is noise.
    if (!entry?.response || controller.signal.aborted) return
    const finishedMs = elapsed()
    const phase = config.mode === 'stages' ? stageAt(finishedMs)?.item : undefined
    const measured = phase ? phase.measure : finishedMs >= (config.warmupS ?? 0) * 1000
    const sample: StressSample = {
      t: Math.round(finishedMs),
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
      phase: phase?.label,
      measured,
    }
    acc.add(sample, measured)
    if (samples.length < cap) samples.push(sample)
    else truncated = true
  }

  const runVu = async (vu: number) => {
    if (config.mode !== 'stages' && !await sleep((vu * config.rampUpS * 1000) / config.vus, controller.signal)) return
    let active = false
    const setActive = (next: boolean) => {
      if (active === next) return
      active = next
      activeVus += next ? 1 : -1
      acc.activity(elapsed(), activeVus)
    }
    try {
      for (let first = true; ; first = false) {
        if (config.mode === 'stages') {
          const eligible = vu < targetAt(elapsed())
          setActive(eligible)
          if (!eligible) { if (!await sleep(50, controller.signal)) break; first = true; continue }
        } else setActive(true)
        if (!first && !await sleep(config.thinkTimeMs, controller.signal)) break
        const iteration = claim()
        if (iteration < 0) break
        const vars = {
          ...options.initialVars,
          ...stressDatasetRow(options.dataset, config.datasetMode ?? 'shared', vu, iteration, options.random),
          ...stressBuiltinVars(vu, iteration),
        }
        const result = await runApiFlow(graph, {
          initialVars: vars,
          signal: controller.signal,
          execute: options.execute,
          onEntry: (entries) => record(entries[entries.length - 1], vu, iteration),
        })
        if (controller.signal.aborted) break
        const phase = config.mode === 'stages' ? stageAt(elapsed())?.item : undefined
        const measured = phase ? phase.measure : elapsed() >= (config.warmupS ?? 0) * 1000
        acc.iteration(!result.entries.some((entry) => entry.status === 'failed'), measured)
        iterationsDone += 1
      }
    } finally {
      setActive(false)
    }
  }

  try {
    await Promise.all(Array.from({ length: peakVus }, (_, vu) => runVu(vu)))
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

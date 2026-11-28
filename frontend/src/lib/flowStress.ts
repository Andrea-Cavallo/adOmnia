import type { FlowGraphDefinition } from '@/lib/flowStorage'
import type { StressSample, StressStats } from '@/lib/flowStressStats'
import type { StressDataset, StressDatasetMode } from '@/lib/flowStressDataset'
import { runStressPlan, type LoadTestPlan } from '@/lib/loadtest-api'
import { toStressSamples, toStressStats } from '@/lib/flowStressResult'
import { resolveVaultReferences } from '@/lib/vaultRefs'
import { useSettingsStore } from '@/stores/settings'
import { useHostsStore } from '@/stores/hosts'

/** Engine limit (internal/loadtest/scenario.go). */
export const MAX_STRESS_VUS = 2000

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
  mode: 'iterations' | 'duration' | 'stages' | 'rate'
  /** Rate mode: flow runs started per second (open model); `vus` is the pool size. */
  rps?: number
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
  flowName?: string
  signal?: AbortSignal
  onProgress?: (progress: StressProgress) => void
  dataset?: StressDataset
}

export function validateStressConfig(config: FlowStressConfig): string[] {
  const errors: string[] = []
  const between = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  if (!Number.isInteger(config.vus) || !between(config.vus, 1, MAX_STRESS_VUS)) errors.push(`Virtual users must be a whole number between 1 and ${MAX_STRESS_VUS}.`)
  if (!between(config.rampUpS, 0, 600)) errors.push('Ramp-up must be between 0 and 600 seconds.')
  if (config.mode === 'iterations' && (!Number.isInteger(config.iterations) || !between(config.iterations, 1, 10_000_000))) errors.push('Iterations must be a whole number between 1 and 10000000.')
  if ((config.mode === 'duration' || config.mode === 'rate') && !between(config.durationS, 1, 86_400)) errors.push('Duration must be between 1 and 86400 seconds.')
  if (config.mode === 'rate' && !between(config.rps ?? 0, 0.1, 100_000)) errors.push('The rate must be between 0.1 and 100000 flow runs per second.')
  if (config.mode === 'stages') {
    if (!config.stages?.length || config.stages.length > 8) errors.push('A staged workload needs between 1 and 8 stages.')
    if (config.stages?.length && Math.max(...config.stages.map((item) => item.targetVus)) < 1) errors.push('At least one stage must target one or more virtual users.')
    config.stages?.forEach((item, index) => {
      if (!between(item.durationS, 0.05, 86_400)) errors.push(`Stage ${index + 1} duration must be between 0.05 and 86400 seconds.`)
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

/**
 * Runs the flow on the Go load testing engine with the very plan the CI export writes, so
 * the dock and `adomnia stress` measure the same thing. Variables are resolved here (vault),
 * the app's TLS, client certificate and hosts map go with them.
 */
export async function runFlowStress(graph: FlowGraphDefinition, config: FlowStressConfig, options: RunFlowStressOptions): Promise<StressRun> {
  const errors = validateStressConfig(config)
  if (errors.length) throw new Error(errors[0])
  if (options.signal?.aborted) throw new Error('Stopped before start')

  const startedAt = new Date().toISOString()
  const vars = await resolveVaultReferences(options.initialVars)
  const requests = useSettingsStore.getState().settings.requests
  const hostsMap = useHostsStore.getState().getActiveEntries().map((e) => ({ host: e.host, ip: e.ip, enabled: e.enabled }))
  const plan = { format: 'adomnia-flow-stress-plan', version: 1, flowName: options.flowName ?? '', graph, config } as unknown as LoadTestPlan
  const run = runStressPlan(plan, {
    vars,
    dataset: options.dataset?.rows,
    transport: {
      skipTlsVerify: requests.skipCertVerify ?? false,
      clientCertPem: requests.clientCertPem ?? '',
      clientCertPassphrase: requests.clientCertPassphrase ?? '',
      hostsMap,
    },
  }, (p) => {
    if (!p.snapshot) return
    options.onProgress?.({ stats: toStressStats(p.snapshot), iterationsDone: p.iterations, activeVus: p.vus, elapsedMs: Math.round(p.elapsedS * 1000), truncated: p.snapshot.timelineTruncated ?? false })
  })
  const onAbort = () => run.stop()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await run.result
    const stats = toStressStats(result)
    options.onProgress?.({ stats, iterationsDone: (result.iterations ?? 0), activeVus: 0, elapsedMs: Math.round(result.totalTimeMs), truncated: result.timelineTruncated ?? false })
    return {
      config,
      startedAt: result.startedAt ?? startedAt,
      finishedAt: result.endedAt ?? new Date().toISOString(),
      status: result.aborted ? 'stopped' : 'completed',
      stats,
      samples: toStressSamples(result.timeline),
      truncated: result.timelineTruncated ?? false,
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
}

import type { FlowStressConfig } from '@/lib/flowStress'
import type { StressStats } from '@/lib/flowStressStats'

export type StressVerdict = 'pass' | 'fail' | 'inconclusive'

export interface StressThresholdCheck {
  id: 'p95' | 'errors' | 'throughput'
  label: string
  actual: number
  target: number
  unit: 'ms' | '%' | 'req/s'
  passed: boolean
}

export interface StressInsight {
  severity: 'info' | 'warn' | 'error'
  title: string
  detail: string
  action: string
}

export interface StressAssessment {
  verdict: StressVerdict
  checks: StressThresholdCheck[]
  insights: StressInsight[]
}

const round1 = (value: number) => Math.round(value * 10) / 10

/** Deterministic, evidence-backed interpretation of a stress run. */
export function analyzeStressRun(stats: StressStats, config: FlowStressConfig, baseline?: StressStats): StressAssessment {
  const errorPct = stats.totalRequests ? round1((stats.totalErrors / stats.totalRequests) * 100) : 0
  const maxP95 = config.maxP95Ms ?? 0
  const maxErrors = config.maxErrorPct ?? 0
  const minRps = config.minRps ?? 0
  const checks: StressThresholdCheck[] = []

  if (maxP95 > 0) checks.push({ id: 'p95', label: 'Overall p95', actual: stats.overall.p95, target: maxP95, unit: 'ms', passed: stats.overall.p95 <= maxP95 })
  if (maxErrors >= 0) checks.push({ id: 'errors', label: 'Error rate', actual: errorPct, target: maxErrors, unit: '%', passed: errorPct <= maxErrors })
  if (minRps > 0) checks.push({ id: 'throughput', label: 'Throughput', actual: stats.rps, target: minRps, unit: 'req/s', passed: stats.rps >= minRps })

  const insights: StressInsight[] = []
  if (stats.totalRequests < 20) {
    insights.push({ severity: 'warn', title: 'Small sample', detail: `Only ${stats.totalRequests} requests were observed; tail percentiles are unstable.`, action: 'Run at least 20 requests, and preferably several hundred, before treating p95/p99 as a release signal.' })
  }

  const tailRatio = stats.overall.p50 > 0 ? stats.overall.p95 / stats.overall.p50 : 0
  if (tailRatio >= 3 && stats.overall.p95 - stats.overall.p50 >= 50) {
    insights.push({ severity: 'warn', title: 'Long latency tail', detail: `Overall p50 is ${stats.overall.p50} ms while p95 reaches ${stats.overall.p95} ms (${round1(tailRatio)}×).`, action: 'Inspect the slowest step and correlate the slow samples with downstream latency, retries and pool saturation.' })
  }

  const worstErrors = [...stats.steps].sort((a, b) => b.errorPct - a.errorPct || b.errors - a.errors)[0]
  if (worstErrors?.errors) {
    insights.push({ severity: 'error', title: 'Errors concentrate in one step', detail: `${worstErrors.step} failed ${worstErrors.errors}/${worstErrors.count} times (${worstErrors.errorPct}%).`, action: `Inspect ${worstErrors.step} status codes and the grouped errors below before increasing concurrency.` })
  }

  const slowest = stats.steps.find((step) => step.step === stats.slowestStep)
  if (slowest && stats.steps.length > 1) {
    insights.push({ severity: 'info', title: 'Primary bottleneck', detail: `${slowest.step} has the highest step p95 at ${slowest.p95} ms.`, action: `Optimize or isolate ${slowest.step}, then compare the next run with this baseline.` })
  }

  if (baseline && baseline.totalRequests > 0) {
    const p95Delta = baseline.overall.p95 > 0 ? round1(((stats.overall.p95 - baseline.overall.p95) / baseline.overall.p95) * 100) : 0
    const rpsDelta = baseline.rps > 0 ? round1(((stats.rps - baseline.rps) / baseline.rps) * 100) : 0
    if (p95Delta > 15) insights.push({ severity: 'error', title: 'Latency regression', detail: `Overall p95 regressed ${p95Delta}% (${baseline.overall.p95} → ${stats.overall.p95} ms).`, action: 'Compare per-step p95 deltas and start with the largest regression.' })
    if (rpsDelta < -15) insights.push({ severity: 'warn', title: 'Throughput regression', detail: `Throughput dropped ${Math.abs(rpsDelta)}% (${baseline.rps} → ${stats.rps} req/s).`, action: 'Check whether latency, errors, think time or the tested environment changed.' })
  }

  if (insights.length === 0) insights.push({ severity: 'info', title: 'No dominant anomaly', detail: 'The observed sample has no strong tail, error concentration or baseline regression signal.', action: 'Keep this run as a baseline and repeat it after meaningful changes.' })

  const failed = checks.some((check) => !check.passed)
  return { verdict: failed ? 'fail' : stats.totalRequests < 20 ? 'inconclusive' : 'pass', checks, insights }
}

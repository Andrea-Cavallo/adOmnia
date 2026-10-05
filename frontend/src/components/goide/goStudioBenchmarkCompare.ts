import type { GoIDETestResult } from '@/lib/goide-tests-api'
import { benchmarkMeasurementFor, parseBenchmarkMeasurement, type GoStudioBenchmarkMeasurement } from './goStudioBenchmarks'
import type { GoStudioBenchmarkHistoryEntry } from './goStudioBenchmarkHistory'

/** Soglia di significatività usata da benchstat. */
export const BENCHMARK_ALPHA = 0.05

const PER_OPERATION = /(?:\/op|allocs\/op)$/i
const THROUGHPUT = /(?:B\/s|bytes\/s|ops\/s|items\/s)$/i

/** Ogni ripetizione di `-count=N`; un vecchio risultato senza campioni vale una sola misura. */
export function benchmarkSamplesFor(result: GoIDETestResult): GoStudioBenchmarkMeasurement[] {
  const samples = (result.benchmarkSamples ?? []).map(parseBenchmarkMeasurement).filter((item): item is GoStudioBenchmarkMeasurement => !!item)
  if (samples.length) return samples
  const single = benchmarkMeasurementFor(result)
  return single ? [single] : []
}

/** Un gruppo di misure salvate confrontabile: stesso commit (e branch), oppure la baseline fissata. */
export interface GoStudioBenchmarkBaseline {
  key: string
  label: string
  branch?: string
  commit?: string
  startedAt: string
  samples: GoStudioBenchmarkMeasurement[]
}

function shortCommit(commit?: string): string {
  return commit ? commit.slice(0, 7) : ''
}

export function baselineKeyFor(entry: Pick<GoStudioBenchmarkHistoryEntry, 'runId' | 'branch' | 'commit' | 'dirty'>): string {
  // Le misure su un albero sporco non rappresentano il commit: restano legate alla loro run.
  return entry.commit && !entry.dirty ? `commit:${entry.commit}` : `run:${entry.runId}`
}

/**
 * Raggruppa la storia locale dello stesso benchmark per commit, escludendo la run mostrata.
 * Ordine: baseline fissata, poi i branch principali, poi le più recenti.
 */
export function benchmarkBaselines(history: readonly GoStudioBenchmarkHistoryEntry[], current: { runId: string; package: string; name: string; commit?: string }, pinnedRunId?: string | null): GoStudioBenchmarkBaseline[] {
  const groups = new Map<string, GoStudioBenchmarkBaseline>()
  for (const entry of history) {
    if (entry.runId === current.runId || entry.package !== current.package || entry.name !== current.name) continue
    const pinned = !!pinnedRunId && entry.runId === pinnedRunId
    const key = pinned ? 'pinned' : baselineKeyFor(entry)
    const samples = entry.samples?.length ? entry.samples : [entry.measurement]
    const existing = groups.get(key)
    if (existing) {
      existing.samples.push(...samples)
      if (entry.startedAt > existing.startedAt) existing.startedAt = entry.startedAt
      continue
    }
    const where = [entry.branch, shortCommit(entry.commit)].filter(Boolean).join(' @ ')
    const when = new Date(entry.startedAt).toLocaleString()
    const label = pinned ? `Pinned baseline · ${where || when}` : `${where || 'Run'}${entry.dirty ? ' (uncommitted)' : ''} · ${when}`
    groups.set(key, { key, label, branch: entry.branch, commit: entry.commit, startedAt: entry.startedAt, samples: [...samples] })
  }
  const rank = (item: GoStudioBenchmarkBaseline) => item.key === 'pinned' ? 0 : isMainBranch(item.branch) ? 1 : 2
  return [...groups.values()].sort((left, right) => rank(left) - rank(right) || right.startedAt.localeCompare(left.startedAt))
}

export function isMainBranch(branch?: string): boolean {
  return branch === 'main' || branch === 'master' || branch === 'trunk' || branch === 'develop'
}

/** Baseline predefinita: quella fissata, altrimenti main/master se lavoro su un altro branch, altrimenti la più recente. */
export function defaultBaselineKey(baselines: readonly GoStudioBenchmarkBaseline[], currentBranch?: string): string | null {
  if (!baselines.length) return null
  const pinned = baselines.find((item) => item.key === 'pinned')
  if (pinned) return pinned.key
  if (currentBranch && !isMainBranch(currentBranch)) {
    const main = baselines.find((item) => isMainBranch(item.branch))
    if (main) return main.key
  }
  return [...baselines].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0].key
}

const binomialCache = new Map<string, number>()
function arrangements(n: number, m: number, u: number): number {
  if (u < 0) return 0
  if (n === 0 || m === 0) return u === 0 ? 1 : 0
  const key = `${n},${m},${u}`
  const cached = binomialCache.get(key)
  if (cached !== undefined) return cached
  const value = arrangements(n - 1, m, u - m) + arrangements(n, m - 1, u)
  binomialCache.set(key, value)
  return value
}

function choose(n: number, k: number): number {
  let result = 1
  for (let index = 1; index <= k; index++) result = (result * (n - k + index)) / index
  return result
}

/**
 * Test U di Mann-Whitney a due code, come benchstat: esatto per campioni piccoli senza pareggi,
 * approssimazione normale con correzione per pareggi negli altri casi.
 */
export function mannWhitneyPValue(left: readonly number[], right: readonly number[]): number | null {
  const n = left.length
  const m = right.length
  if (!n || !m) return null
  const all = [...left.map((value) => ({ value, left: true })), ...right.map((value) => ({ value, left: false }))].sort((a, b) => a.value - b.value)
  const ranks = new Array<number>(all.length)
  let tieTerm = 0
  for (let start = 0; start < all.length;) {
    let end = start
    while (end + 1 < all.length && all[end + 1].value === all[start].value) end++
    const size = end - start + 1
    for (let index = start; index <= end; index++) ranks[index] = (start + end) / 2 + 1
    tieTerm += size ** 3 - size
    start = end + 1
  }
  const rankSum = all.reduce((sum, item, index) => item.left ? sum + ranks[index] : sum, 0)
  const u = rankSum - (n * (n + 1)) / 2
  if (tieTerm === 0 && n <= 20 && m <= 20) {
    const total = choose(n + m, n)
    let lower = 0
    for (let value = 0; value <= u; value++) lower += arrangements(n, m, value)
    let upper = 0
    for (let value = u; value <= n * m; value++) upper += arrangements(n, m, value)
    return Math.min(1, (2 * Math.min(lower, upper)) / total)
  }
  const mean = (n * m) / 2
  const variance = ((n * m) / 12) * (n + m + 1 - tieTerm / ((n + m) * (n + m - 1)))
  if (variance <= 0) return 1
  const z = Math.max(0, Math.abs(u - mean) - 0.5) / Math.sqrt(variance)
  return Math.min(1, 2 * (1 - normalCdf(z)))
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26, errore < 1.5e-7: sufficiente per confrontare con alpha.
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2))
  const erf = 1 - (((((1.061405429 * t - 1.453152014) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return 0.5 * (1 + erf)
}

/** Con n e m campioni il p-value minimo è 2/C(n+m, n): sotto alpha serve almeno -count=4 per lato. */
export function significancePossible(n: number, m: number): boolean {
  return n > 0 && m > 0 && 2 / choose(n + m, n) <= BENCHMARK_ALPHA
}

export interface GoStudioBenchmarkSampleComparison {
  unit: string
  current: number
  baseline: number | null
  changePercent: number | null
  direction: 'better' | 'worse' | 'unchanged' | 'unknown'
  pValue: number | null
  /** true/false se calcolabile, null con troppi pochi campioni. */
  significant: boolean | null
  regression: boolean
  currentSamples: number
  baselineSamples: number
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function valuesFor(samples: readonly GoStudioBenchmarkMeasurement[], unit: string): number[] {
  return samples.flatMap((sample) => sample.metrics.filter((metric) => metric.unit === unit).map((metric) => metric.value))
}

/**
 * Confronta mediane (come benchstat) per ogni metrica della run corrente. Una regressione è un
 * peggioramento oltre la soglia che non sia stato smentito dal test: con pochi campioni basta la soglia.
 */
export function compareBenchmarkSamples(current: readonly GoStudioBenchmarkMeasurement[], baseline: readonly GoStudioBenchmarkMeasurement[], thresholdPercent: number): GoStudioBenchmarkSampleComparison[] {
  const units = [...new Set(current.flatMap((sample) => sample.metrics.map((metric) => metric.unit)))]
  return units.map((unit) => {
    const now = valuesFor(current, unit)
    const before = valuesFor(baseline, unit)
    const currentValue = median(now)
    if (!before.length) {
      return { unit, current: currentValue, baseline: null, changePercent: null, direction: 'unknown', pValue: null, significant: null, regression: false, currentSamples: now.length, baselineSamples: 0 }
    }
    const baselineValue = median(before)
    const changePercent = baselineValue !== 0 ? ((currentValue - baselineValue) / Math.abs(baselineValue)) * 100 : null
    const direction = currentValue === baselineValue ? 'unchanged'
      : THROUGHPUT.test(unit) ? (currentValue > baselineValue ? 'better' : 'worse')
        : PER_OPERATION.test(unit) ? (currentValue < baselineValue ? 'better' : 'worse') : 'unknown'
    const pValue = mannWhitneyPValue(now, before)
    const significant = significancePossible(now.length, before.length) && pValue !== null ? pValue <= BENCHMARK_ALPHA : null
    const regression = direction === 'worse' && changePercent !== null && Math.abs(changePercent) >= thresholdPercent && significant !== false
    return { unit, current: currentValue, baseline: baselineValue, changePercent, direction, pValue, significant, regression, currentSamples: now.length, baselineSamples: before.length }
  })
}

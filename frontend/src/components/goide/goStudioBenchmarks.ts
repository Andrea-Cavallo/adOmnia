import type { GoIDETestResult, GoIDETestRun } from '@/lib/goide-tests-api'

/** Una misura riportata da `go test -bench` (incluse metriche aggiunte da ReportMetric). */
export interface GoStudioBenchmarkMetric {
  unit: string
  value: number
}

export interface GoStudioBenchmarkMeasurement {
  iterations: number
  metrics: GoStudioBenchmarkMetric[]
}

export interface GoStudioBenchmarkComparison {
  current: GoStudioBenchmarkMetric
  previous: GoStudioBenchmarkMetric | null
  /** Percentuale: positiva è peggiore per metriche per-operazione, migliore per throughput. */
  changePercent: number | null
  direction: 'better' | 'worse' | 'unchanged' | 'unknown'
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const PER_OPERATION = /(?:\/op|allocs\/op)$/i
const THROUGHPUT = /(?:B\/s|bytes\/s|ops\/s|items\/s)$/i

/**
 * Legge la coda normalizzata dell'output di Go: `100 12.3 ns/op 0 B/op`.
 * Il backend conserva il testo per compatibilità; qui lo trasformiamo senza
 * inventare valori e senza limitarsi alle tre metriche standard.
 */
export function parseBenchmarkMeasurement(text: string | undefined): GoStudioBenchmarkMeasurement | null {
  const tokens = (text ?? '').trim().split(/\s+/)
  if (!tokens.length || !NUMBER.test(tokens[0])) return null
  const iterations = Number(tokens[0])
  if (!Number.isFinite(iterations) || iterations < 0) return null
  const metrics: GoStudioBenchmarkMetric[] = []
  for (let index = 1; index + 1 < tokens.length; index += 2) {
    const value = Number(tokens[index])
    const unit = tokens[index + 1]
    if (!Number.isFinite(value) || !unit) continue
    metrics.push({ value, unit })
  }
  return { iterations, metrics }
}

export function benchmarkMeasurementFor(result: GoIDETestResult): GoStudioBenchmarkMeasurement | null {
  return result.status === 'bench' || result.benchmark ? parseBenchmarkMeasurement(result.benchmark) : null
}

/** Durata wall-clock del processo `go test -bench`, disponibile solo a run terminata. */
export function benchmarkRunDurationMillis(run: Pick<GoIDETestRun, 'startedAt' | 'finishedAt'>): number | null {
  if (!run.finishedAt) return null
  const startedAt = Date.parse(run.startedAt)
  const finishedAt = Date.parse(run.finishedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return null
  return Math.max(0, finishedAt - startedAt)
}

/** Trova la stessa misura nell'esecuzione immediatamente precedente della sessione. */
export function previousBenchmarkRun(runs: GoIDETestRun[], currentRun: GoIDETestRun, result: GoIDETestResult): GoIDETestRun | null {
  const currentAt = Date.parse(currentRun.startedAt)
  return runs
    .filter((candidate) => candidate.runId !== currentRun.runId && (Number.isNaN(currentAt) || Date.parse(candidate.startedAt) < currentAt))
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .find((candidate) => candidate.results.some((item) => item.package === result.package && item.name === result.name && benchmarkMeasurementFor(item))) ?? null
}

function directionFor(unit: string, current: number, previous: number): GoStudioBenchmarkComparison['direction'] {
  if (previous === current) return 'unchanged'
  if (THROUGHPUT.test(unit)) return current > previous ? 'better' : 'worse'
  if (PER_OPERATION.test(unit)) return current < previous ? 'better' : 'worse'
  return 'unknown'
}

/** Confronta solo metriche omogenee: l'assenza di una metrica non è mai uno zero fittizio. */
export function compareBenchmarkMetrics(current: GoStudioBenchmarkMeasurement, previous: GoStudioBenchmarkMeasurement | null): GoStudioBenchmarkComparison[] {
  const before = new Map((previous?.metrics ?? []).map((metric) => [metric.unit, metric]))
  return current.metrics.map((metric) => {
    const prior = before.get(metric.unit) ?? null
    const changePercent = prior && prior.value !== 0 ? ((metric.value - prior.value) / Math.abs(prior.value)) * 100 : null
    return { current: metric, previous: prior, changePercent, direction: prior ? directionFor(metric.unit, metric.value, prior.value) : 'unknown' }
  })
}

export function formatBenchmarkValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

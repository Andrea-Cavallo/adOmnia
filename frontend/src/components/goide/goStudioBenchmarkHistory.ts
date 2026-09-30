import type { GoIDETestRun } from '@/lib/goide-tests-api'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { benchmarkMeasurementFor, type GoStudioBenchmarkMeasurement } from './goStudioBenchmarks'

const STORAGE_PREFIX = 'adomnia.goide.benchmark-history.v1.'
const MAX_MEASUREMENTS = 120

export interface GoStudioBenchmarkHistoryEntry {
  id: string
  runId: string
  package: string
  name: string
  startedAt: string
  finishedAt?: string | null
  measurement: GoStudioBenchmarkMeasurement
}

export function benchmarkHistoryKey(projectRoot: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectRoot.trim())}`
}

function validEntry(value: unknown): value is GoStudioBenchmarkHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<GoStudioBenchmarkHistoryEntry>
  return typeof entry.id === 'string' && typeof entry.runId === 'string' && typeof entry.package === 'string'
    && typeof entry.name === 'string' && typeof entry.startedAt === 'string' && typeof entry.measurement?.iterations === 'number'
    && Array.isArray(entry.measurement.metrics)
}

/** Loads compact benchmark measurements saved only for this local project. */
export function loadBenchmarkHistory(projectRoot: string): GoStudioBenchmarkHistoryEntry[] {
  if (!projectRoot.trim()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(benchmarkHistoryKey(projectRoot)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(validEntry).slice(0, MAX_MEASUREMENTS) : []
  } catch {
    return []
  }
}

/** Persists completed benchmark metrics, without test output, coverage, environment or source files. */
export function saveBenchmarkHistory(projectRoot: string, runs: readonly GoIDETestRun[]): GoStudioBenchmarkHistoryEntry[] {
  if (!projectRoot.trim()) return []
  const fresh = runs.flatMap((run) => run.status === 'running' ? [] : run.results.flatMap((result) => {
    const measurement = benchmarkMeasurementFor(result)
    if (!measurement || !result.name) return []
    return [{ id: `${run.runId}:${result.id}`, runId: run.runId, package: result.package, name: result.name, startedAt: run.startedAt, finishedAt: run.finishedAt, measurement }]
  }))
  if (fresh.length === 0) return loadBenchmarkHistory(projectRoot)
  const freshIds = new Set(fresh.map((entry) => entry.id))
  const next = [...fresh, ...loadBenchmarkHistory(projectRoot).filter((entry) => !freshIds.has(entry.id))]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, MAX_MEASUREMENTS)
  safeSetItem(benchmarkHistoryKey(projectRoot), JSON.stringify(next))
  return next
}

export function clearBenchmarkHistory(projectRoot: string): void {
  if (!projectRoot.trim()) return
  try { localStorage.removeItem(benchmarkHistoryKey(projectRoot)) } catch { /* disabled storage is non-fatal */ }
}

function csvValue(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Portable CSV: one row per metric, ready for a CI artifact or a spreadsheet. */
export function benchmarkHistoryCsv(entries: readonly GoStudioBenchmarkHistoryEntry[]): string {
  const rows = ['started_at,finished_at,package,benchmark,iterations,metric,value']
  for (const entry of entries) {
    for (const metric of entry.measurement.metrics) {
      rows.push([entry.startedAt, entry.finishedAt, entry.package, entry.name, entry.measurement.iterations, metric.unit, metric.value].map(csvValue).join(','))
    }
  }
  return `${rows.join('\r\n')}\r\n`
}

/** The newest saved measurement for the same benchmark before the displayed run. */
export function previousSavedBenchmark(entries: readonly GoStudioBenchmarkHistoryEntry[], currentStartedAt: string, packageName: string, benchmarkName: string): GoStudioBenchmarkHistoryEntry | null {
  const current = Date.parse(currentStartedAt)
  return entries
    .filter((entry) => entry.package === packageName && entry.name === benchmarkName && (Number.isNaN(current) || Date.parse(entry.startedAt) < current))
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0] ?? null
}

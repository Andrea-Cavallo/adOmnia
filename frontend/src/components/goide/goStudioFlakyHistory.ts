import type { GoIDETestRun } from '@/lib/goide-tests-api'
import { safeSetItem } from '@/lib/safeLocalStorage'

const STORAGE_PREFIX = 'adomnia.goide.flaky-history.v1.'
const MAX_ENTRIES = 200

/** Un test che in una run ripetuta ha sia passato sia fallito. */
export interface GoStudioFlakyHistoryEntry {
  id: string
  runId: string
  package: string
  name: string
  startedAt: string
  runs: number
  failures: number
}

function storageKey(projectRoot: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectRoot.trim())}`
}

function validEntry(value: unknown): value is GoStudioFlakyHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<GoStudioFlakyHistoryEntry>
  return typeof entry.id === 'string' && typeof entry.package === 'string' && typeof entry.name === 'string'
    && typeof entry.startedAt === 'string' && typeof entry.runs === 'number' && typeof entry.failures === 'number'
}

export function loadFlakyHistory(projectRoot: string): GoStudioFlakyHistoryEntry[] {
  if (!projectRoot.trim()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(projectRoot)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(validEntry).slice(0, MAX_ENTRIES) : []
  } catch {
    return []
  }
}

/** Salva i test flaky delle run ripetute concluse: solo nomi e conteggi, mai output. */
export function saveFlakyHistory(projectRoot: string, runs: readonly GoIDETestRun[]): GoStudioFlakyHistoryEntry[] {
  if (!projectRoot.trim()) return []
  const fresh = runs.flatMap((run) => run.status === 'running' ? [] : run.results.flatMap((result) => {
    const runsCount = result.runs ?? 0
    const failures = result.failures ?? 0
    if (!result.name || runsCount < 2 || failures === 0 || failures === runsCount) return []
    return [{ id: `${run.runId}:${result.id}`, runId: run.runId, package: result.package, name: result.name, startedAt: run.startedAt, runs: runsCount, failures }]
  }))
  if (fresh.length === 0) return loadFlakyHistory(projectRoot)
  const freshIds = new Set(fresh.map((entry) => entry.id))
  const next = [...fresh, ...loadFlakyHistory(projectRoot).filter((entry) => !freshIds.has(entry.id))]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, MAX_ENTRIES)
  safeSetItem(storageKey(projectRoot), JSON.stringify(next))
  return next
}

export function clearFlakyHistory(projectRoot: string): void {
  if (!projectRoot.trim()) return
  try { localStorage.removeItem(storageKey(projectRoot)) } catch { /* storage disabilitato: non bloccante */ }
}

export interface GoStudioFlakyRecord {
  /** Quante run ripetute l'hanno visto flaky e il totale di fallimenti/ripetizioni. */
  occurrences: number
  failures: number
  runs: number
  lastSeen: string
}

/** Storico aggregato per test ("package\u0000name"), per il badge anche nelle run normali. */
export function flakyRecords(entries: readonly GoStudioFlakyHistoryEntry[]): Map<string, GoStudioFlakyRecord> {
  const records = new Map<string, GoStudioFlakyRecord>()
  for (const entry of entries) {
    const key = `${entry.package}\u0000${entry.name}`
    const record = records.get(key)
    if (!record) {
      records.set(key, { occurrences: 1, failures: entry.failures, runs: entry.runs, lastSeen: entry.startedAt })
      continue
    }
    record.occurrences++
    record.failures += entry.failures
    record.runs += entry.runs
    if (Date.parse(entry.startedAt) > Date.parse(record.lastSeen)) record.lastSeen = entry.startedAt
  }
  return records
}

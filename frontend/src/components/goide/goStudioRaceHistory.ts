import { safeSetItem } from '@/lib/safeLocalStorage'
import type { RaceSource } from './goStudioConcurrency'

const STORAGE_PREFIX = 'adomnia.goide.race-history.v1.'
const MAX_SAVED_SESSIONS = 20
const MAX_OUTPUT_LENGTH = 64 * 1024

export interface RaceHistorySource extends RaceSource {
  /** Timestamp of the original run, used to keep the newest session first. */
  at: number
  /** Timestamp when Go Studio persisted this source locally. */
  savedAt: number
}

export type TimestampedRaceSource = RaceSource & { at: number }

export function raceHistoryKey(projectRoot: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectRoot.trim())}`
}

function validSource(value: unknown): value is RaceHistorySource {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<RaceHistorySource>
  return typeof source.id === 'string' && typeof source.label === 'string' && typeof source.text === 'string'
    && Number.isFinite(source.at) && Number.isFinite(source.savedAt)
}

/** Loads only local, bounded race-detector output for the current project. */
export function loadRaceHistory(projectRoot: string): RaceHistorySource[] {
  if (!projectRoot.trim()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(raceHistoryKey(projectRoot)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(validSource).slice(0, MAX_SAVED_SESSIONS) : []
  } catch {
    return []
  }
}

/**
 * Persists reports which actually contain a race. Output stays local to the project and
 * is capped to avoid turning a diagnostic history into an unbounded console archive.
 */
export function saveRaceHistory(projectRoot: string, sources: readonly TimestampedRaceSource[]): RaceHistorySource[] {
  if (!projectRoot.trim()) return []
  const now = Date.now()
  const fresh = sources
    .filter((source) => source.id && source.text.includes('WARNING: DATA RACE'))
    .map((source) => ({
      id: source.id,
      label: source.label,
      text: source.text.slice(0, MAX_OUTPUT_LENGTH),
      at: Number.isFinite(source.at) ? source.at : now,
      savedAt: now,
    }))
    .filter((source, index, all) => all.findIndex((candidate) => candidate.id === source.id) === index)
  if (fresh.length === 0) return loadRaceHistory(projectRoot)

  const freshIds = new Set(fresh.map((source) => source.id))
  const next = [...fresh, ...loadRaceHistory(projectRoot).filter((source) => !freshIds.has(source.id))]
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_SAVED_SESSIONS)
  safeSetItem(raceHistoryKey(projectRoot), JSON.stringify(next))
  return next
}

/** Removes persisted race reports for this project without touching any other local data. */
export function clearRaceHistory(projectRoot: string): void {
  if (!projectRoot.trim()) return
  try {
    localStorage.removeItem(raceHistoryKey(projectRoot))
  } catch {
    // Storage can be disabled by the host. Clearing diagnostic history must remain non-fatal.
  }
}

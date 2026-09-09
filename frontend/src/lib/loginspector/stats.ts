import type { FacetField } from './query'
import { LOG_LEVELS, type LogEvent, type LogLevel } from './types'

export type LevelCounts = Record<LogLevel, number>

export function emptyLevelCounts(): LevelCounts {
  return LOG_LEVELS.reduce((acc, level) => ({ ...acc, [level]: 0 }), {} as LevelCounts)
}

export function countByLevel(events: LogEvent[]): LevelCounts {
  const counts = emptyLevelCounts()
  for (const event of events) counts[event.level]++
  return counts
}

export interface FacetValue {
  value: string
  count: number
}

/** Distinct values of a field with their counts, most frequent first. */
export function computeFacet(events: LogEvent[], field: FacetField, limit = 50): FacetValue[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    const value = event[field]
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit)
}

export interface TimeExtent {
  min: number | null
  max: number | null
}

export function timeExtent(events: LogEvent[]): TimeExtent {
  let min: number | null = null
  let max: number | null = null
  for (const event of events) {
    if (event.ts === null) continue
    if (min === null || event.ts < min) min = event.ts
    if (max === null || event.ts > max) max = event.ts
  }
  return { min, max }
}

export interface HistogramBucket {
  start: number
  end: number
  total: number
  errors: number
}

/**
 * Fixed-width buckets across the batch time range. Events without a timestamp
 * are ignored — they have no place on a time axis.
 */
export function buildHistogram(events: LogEvent[], bucketCount = 60): HistogramBucket[] {
  const { min, max } = timeExtent(events)
  if (min === null || max === null || bucketCount < 1) return []

  const span = Math.max(max - min, 1)
  const width = span / bucketCount
  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    total: 0,
    errors: 0,
  }))

  for (const event of events) {
    if (event.ts === null) continue
    const index = Math.min(bucketCount - 1, Math.floor((event.ts - min) / width))
    buckets[index].total++
    if (event.level === 'error' || event.level === 'fatal') buckets[index].errors++
  }
  return buckets
}

import type { LogEvent } from './types'

export interface AcquisitionDuplicateGroup {
  fingerprint: string
  keptEventIds: number[]
  removedEventIds: number[]
  sourceNames: string[]
}

export interface DeduplicationResult {
  events: LogEvent[]
  duplicateCount: number
  groups: AcquisitionDuplicateGroup[]
}

function eventFingerprint(event: LogEvent): string {
  // Exact source material plus exact timestamp is intentionally conservative.
  // A message-only fingerprint would confuse legitimate application retries.
  let hash = 2166136261
  for (let index = 0; index < event.raw.length; index++) {
    hash ^= event.raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${event.ts ?? event.tsRaw}:${event.raw.length}:${hash >>> 0}`
}

/**
 * Fold identical acquisition copies across different sources. Repeated events
 * inside one source are retained, so an application retry is never silently
 * discarded. Callers must opt in before using the returned event list.
 */
export function deduplicateAcquisitionEvents(events: LogEvent[]): DeduplicationResult {
  const buckets = new Map<string, LogEvent[][]>()
  for (const event of events) {
    const key = eventFingerprint(event)
    const candidates = buckets.get(key)
    const exact = candidates?.find((bucket) => {
      const first = bucket[0]
      return first.raw === event.raw && first.ts === event.ts && first.tsRaw === event.tsRaw
    })
    if (exact) exact.push(event)
    else if (candidates) candidates.push([event])
    else buckets.set(key, [[event]])
  }

  const removed = new Set<number>()
  const replacements = new Map<number, LogEvent>()
  const groups: AcquisitionDuplicateGroup[] = []

  for (const [fingerprint, candidateBuckets] of buckets) {
    for (const bucket of candidateBuckets) {
      const bySource = new Map<string, LogEvent[]>()
      for (const event of bucket) {
        const sourceId = event.sourceId || `event-${event.id}`
        const sourceEvents = bySource.get(sourceId)
        if (sourceEvents) sourceEvents.push(event)
        else bySource.set(sourceId, [event])
      }
      if (bySource.size < 2) continue

      const sourceGroups = [...bySource.values()].sort((a, b) => b.length - a.length || a[0].id - b[0].id)
      const canonical = sourceGroups[0]
      const removedIds: number[] = []
      for (const copies of sourceGroups.slice(1)) {
        copies.forEach((copy, index) => {
          removed.add(copy.id)
          removedIds.push(copy.id)
          const target = canonical[Math.min(index, canonical.length - 1)]
          const existing = replacements.get(target.id) ?? target
          replacements.set(target.id, {
            ...existing,
            duplicateSources: [
              ...(existing.duplicateSources ?? []),
              { sourceId: copy.sourceId || '', sourceName: copy.sourceName || '', line: copy.line },
            ],
          })
        })
      }
      groups.push({
        fingerprint,
        keptEventIds: canonical.map((event) => event.id),
        removedEventIds: removedIds,
        sourceNames: [...new Set(bucket.map((event) => event.sourceName || '').filter(Boolean))],
      })
    }
  }

  return {
    events: events.filter((event) => !removed.has(event.id)).map((event) => replacements.get(event.id) ?? event),
    duplicateCount: removed.size,
    groups,
  }
}

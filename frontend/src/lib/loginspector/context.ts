import { sortChronologically } from './correlate'
import type { LogEvent } from './types'

export interface EventContextResult {
  source: LogEvent[]
  temporal: LogEvent[]
}

/** Context intentionally ignores the active query; callers pass the full session. */
export function eventContext(
  events: LogEvent[],
  target: LogEvent,
  lineRadius = 5,
  timeRadiusMs = 5_000,
): EventContextResult {
  const source = events.filter((event) => (
    event.id !== target.id
    && event.sourceId === target.sourceId
    && event.line <= target.line + lineRadius
    && event.line + Math.max(0, event.lineCount - 1) >= target.line - lineRadius
  )).sort((a, b) => a.line - b.line)

  const temporal = target.ts === null ? [] : sortChronologically(events.filter((event) => (
    event.id !== target.id
    && event.ts !== null
    && Math.abs(event.ts - target.ts!) <= timeRadiusMs
    && (event.sourceId !== target.sourceId || !source.some((candidate) => candidate.id === event.id))
  )))

  return { source, temporal }
}

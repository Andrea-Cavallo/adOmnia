import { buildLookup, flattenPayload } from './normalize'
import type { LogEvent } from './types'

export type ChainIntegrityKind =
  | 'missing-start' | 'missing-end' | 'missing-timestamp' | 'clock-skew'
  | 'corrected-time' | 'observation-gap' | 'truncated-log' | 'uncertain-correlation'

export interface ChainIntegrityIssue {
  kind: ChainIntegrityKind
  severity: 'warn' | 'info'
  title: string
  detail: string
  eventIds: number[]
  sourceIds: string[]
}

function searchable(event: LogEvent): string {
  return `${event.message}\n${event.stack}\n${event.raw}`
}

function hasStructuredValue(event: LogEvent, paths: string[]): boolean {
  if (!event.json || typeof event.json !== 'object' || Array.isArray(event.json)) return false
  const lookup = buildLookup(flattenPayload(event.json as Record<string, unknown>))
  return paths.some((path) => {
    const value = lookup.get(path)?.value
    return value !== undefined && value !== null && value !== ''
  })
}

/** Explain incomplete or temporally unreliable chains without rewriting evidence. */
export function assessChainIntegrity(events: LogEvent[], correlationKind = ''): ChainIntegrityIssue[] {
  if (!events.length) return []
  const issues: ChainIntegrityIssue[] = []
  const sourceIds = [...new Set(events.map((event) => event.sourceId || event.sourceName || 'unknown'))]
  const missingTimestamp = events.filter((event) => event.ts === null)
  if (missingTimestamp.length) issues.push({
    kind: 'missing-timestamp', severity: 'warn', title: 'Events without timestamps',
    detail: `${missingTimestamp.length}/${events.length} events cannot be placed on the time axis.`,
    eventIds: missingTimestamp.map((event) => event.id), sourceIds,
  })

  const hasStart = events.some((event) => /\b(start(?:ed|ing)?|begin|received|incoming)\b.*\b(request|operation|call)\b|\brequest\b.*\b(start(?:ed|ing)?|received)\b/i.test(searchable(event))
    || event.normalizedRequestBody !== null && event.normalizedRequestBody !== undefined
    || hasStructuredValue(event, ['http.request.method', 'http.method', 'request.body', 'request_body']))
  if (!hasStart) issues.push({
    kind: 'missing-start', severity: 'warn', title: 'Start not observed',
    detail: 'The first visible event is not evidence that the request began here; earlier rows may be missing.',
    eventIds: [events[0].id], sourceIds,
  })

  const hasEnd = events.some((event) => /\b(completed|finished|responded|returned|success|failed|failure)\b/i.test(searchable(event))
    || event.normalizedResponseBody !== null && event.normalizedResponseBody !== undefined
    || hasStructuredValue(event, ['http.status_code', 'http.response.status_code', 'event.outcome', 'response.body', 'response_body']))
  if (!hasEnd) issues.push({
    kind: 'missing-end', severity: 'warn', title: 'Final result not observed',
    detail: 'No completion, response, outcome or HTTP status is present in this chain.',
    eventIds: [events[events.length - 1].id], sourceIds,
  })

  const truncated = events.filter((event) => /\b(?:truncated|log limit reached|output cut|\.\.\.\s*truncated)\b/i.test(searchable(event))
    || (event.normalizationWarnings ?? []).some((warning) => /stopped|limit/i.test(warning)))
  if (truncated.length) issues.push({
    kind: 'truncated-log', severity: 'warn', title: 'Truncated evidence',
    detail: `${truncated.length} event(s) explicitly indicate truncated output or indexing limits.`,
    eventIds: truncated.map((event) => event.id), sourceIds: [...new Set(truncated.map((event) => event.sourceId || 'unknown'))],
  })

  const corrected = events.filter((event) => (event.clockOffsetMs ?? 0) !== 0)
  if (corrected.length) issues.push({
    kind: 'corrected-time', severity: 'info', title: 'Explicit clock correction applied',
    detail: `${corrected.length} event(s) use a source offset. Original timestamps remain available in event details.`,
    eventIds: corrected.map((event) => event.id), sourceIds: [...new Set(corrected.map((event) => event.sourceId || 'unknown'))],
  })

  const regressions: LogEvent[] = []
  for (const source of sourceIds) {
    const rows = events
      .filter((event) => (event.sourceId || event.sourceName || 'unknown') === source && (event.tsOriginal ?? event.ts) !== null)
      .sort((a, b) => a.line - b.line)
    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1].tsOriginal ?? rows[index - 1].ts
      const current = rows[index].tsOriginal ?? rows[index].ts
      if (previous !== null && current !== null && current < previous - 50) regressions.push(rows[index])
    }
  }
  if (regressions.length) issues.push({
    kind: 'clock-skew', severity: 'warn', title: 'Clock order is inconsistent',
    detail: `${regressions.length} source row(s) move backwards in original time. No automatic correction was made.`,
    eventIds: regressions.map((event) => event.id), sourceIds: [...new Set(regressions.map((event) => event.sourceId || 'unknown'))],
  })

  const timed = events.filter((event) => event.ts !== null).sort((a, b) => a.ts! - b.ts!)
  let largestGap = 0
  let gapEvent: LogEvent | null = null
  for (let index = 1; index < timed.length; index++) {
    const gap = timed[index].ts! - timed[index - 1].ts!
    if (gap > largestGap) { largestGap = gap; gapEvent = timed[index] }
  }
  if (largestGap >= 30_000 && gapEvent) issues.push({
    kind: 'observation-gap', severity: 'info', title: 'Unobserved interval',
    detail: `The chain has a ${Math.round(largestGap / 100) / 10}s gap with no events; activity inside it is unknown.`,
    eventIds: [gapEvent.id], sourceIds,
  })

  const services = new Set(events.map((event) => event.service).filter(Boolean))
  const spanCoverage = events.filter((event) => event.spanId).length / events.length
  if (correlationKind === 'requestId' || (services.size > 1 && spanCoverage < 1)) issues.push({
    kind: 'uncertain-correlation', severity: 'info', title: 'Correlation is partly inferred',
    detail: correlationKind === 'requestId'
      ? 'The chain relies on a request ID, which may be reused by downstream services.'
      : `Only ${Math.round(spanCoverage * 100)}% of events carry span IDs across ${services.size} services; temporal order is not proof of causality.`,
    eventIds: events.filter((event) => !event.spanId).map((event) => event.id), sourceIds,
  })

  return issues
}

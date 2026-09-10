import { operationalContext } from './analyze'
import { sortChronologically } from './correlate'
import type { LogEvent } from './types'

export interface PairedCallPayload {
  key: string
  requestEvent: LogEvent | null
  responseEvent: LogEvent | null
  requestBody: unknown | null
  responseBody: unknown | null
  requestHeaders: unknown | null
  responseHeaders: unknown | null
  method: string
  url: string
  status: number | null
  inferred: boolean
}

function callKey(event: LogEvent): { key: string; inferred: boolean } {
  if (event.spanId) return { key: `span:${event.spanId}`, inferred: false }
  if (event.requestId) return { key: `request:${event.requestId}`, inferred: false }
  // Without a per-attempt identifier, joining rows can exchange responses from
  // parallel downstream calls. Keep the event isolated and label it inferred.
  return { key: `event:${event.id}`, inferred: true }
}

/** Pair payload rows only when a span/request identity makes the association safe. */
export function pairCallPayloads(events: LogEvent[]): PairedCallPayload[] {
  const groups = new Map<string, { inferred: boolean; events: LogEvent[] }>()
  for (const event of events) {
    const identity = callKey(event)
    const context = operationalContext(event)
    if (context.requestBody === null && context.responseBody === null && context.requestHeaders === null && context.responseHeaders === null) continue
    const group = groups.get(identity.key)
    if (group) group.events.push(event)
    else groups.set(identity.key, { inferred: identity.inferred, events: [event] })
  }

  const pairs: PairedCallPayload[] = []
  for (const [key, group] of groups) {
    const ordered = sortChronologically(group.events)
    const requestEvent = ordered.find((event) => {
      const context = operationalContext(event)
      return context.requestBody !== null || context.requestHeaders !== null
    }) ?? null
    const responseEvent = ordered.find((event) => {
      const context = operationalContext(event)
      return context.responseBody !== null || context.responseHeaders !== null
    }) ?? null
    const request = requestEvent ? operationalContext(requestEvent) : null
    const response = responseEvent ? operationalContext(responseEvent) : null
    pairs.push({
      key,
      requestEvent,
      responseEvent,
      requestBody: request?.requestBody ?? null,
      responseBody: response?.responseBody ?? null,
      requestHeaders: request?.requestHeaders ?? null,
      responseHeaders: response?.responseHeaders ?? null,
      method: request?.httpMethod || response?.httpMethod || '',
      url: request?.httpUrl || request?.httpRoute || response?.httpUrl || response?.httpRoute || '',
      status: response?.httpStatus ?? request?.httpStatus ?? null,
      inferred: group.inferred,
    })
  }
  return pairs
}

export function callPayloadForEvent(events: LogEvent[], event: LogEvent): PairedCallPayload | null {
  const identity = callKey(event)
  if (identity.inferred) {
    const context = operationalContext(event)
    if (context.requestBody === null && context.responseBody === null && context.requestHeaders === null && context.responseHeaders === null) return null
  }
  return pairCallPayloads(events).find((pair) => (
    pair.key === identity.key
    || pair.requestEvent?.id === event.id
    || pair.responseEvent?.id === event.id
  )) ?? null
}

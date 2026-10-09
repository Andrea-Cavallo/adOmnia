// Group repeated logs: one row per message template (numbers, ids, hex and quoted values
// ignored), in first-seen order, with how many events share it.
import type { LogEvent } from './types'

export interface RepeatGroups {
  /** First event of every template, in the order the templates first appear. */
  events: LogEvent[]
  /** Representative event id → number of events with that template (only when > 1). */
  counts: Map<number, number>
}

/** Message with its variable parts blanked: ids, hex, every number (also in 12ms, v2), quoted values. */
export function messageTemplate(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{16,}\b/g, '<hex>')
    .replace(/\d+(?:\.\d+)?/g, '<n>')
    .replace(/"[^"]*"|'[^']*'/g, '<quoted>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function groupRepeated(events: readonly LogEvent[]): RepeatGroups {
  const byKey = new Map<string, LogEvent>()
  const counts = new Map<number, number>()
  for (const event of events) {
    const key = `${event.level}\u0000${event.service}\u0000${messageTemplate(event.message)}`
    const first = byKey.get(key)
    if (first) counts.set(first.id, (counts.get(first.id) ?? 1) + 1)
    else byKey.set(key, event)
  }
  return { events: [...byKey.values()], counts }
}

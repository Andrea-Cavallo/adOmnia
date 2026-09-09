import type { LogEvent } from './types'

export type ExportFormat = 'json' | 'jsonl' | 'text'

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  json: 'json',
  jsonl: 'jsonl',
  text: 'log',
}

/** Serializable projection: normalized fields plus everything we kept. */
function toRecord(event: LogEvent): Record<string, unknown> {
  return {
    line: event.line,
    lineCount: event.lineCount,
    sourceId: event.sourceId,
    sourceName: event.sourceName,
    timestamp: event.ts !== null ? new Date(event.ts).toISOString() : null,
    timestampRaw: event.tsRaw,
    level: event.level,
    levelRaw: event.levelRaw,
    message: event.message,
    service: event.service,
    namespace: event.namespace,
    pod: event.pod,
    container: event.container,
    traceId: event.traceId,
    correlationId: event.correlationId,
    requestId: event.requestId,
    thread: event.thread,
    logger: event.logger,
    prefix: event.prefix || undefined,
    stack: event.stack || undefined,
    json: event.json ?? undefined,
    extra: Object.keys(event.extra).length ? event.extra : undefined,
    decoded: Object.keys(event.decoded).length ? event.decoded : undefined,
    parseError: event.parseError || undefined,
    raw: event.raw,
  }
}

export function formatEventLine(event: LogEvent): string {
  const stamp = event.ts !== null ? new Date(event.ts).toISOString() : (event.tsRaw || '-')
  const origin = [event.service, event.pod || event.container].filter(Boolean).join('/')
  const head = `${stamp} ${event.level.toUpperCase().padEnd(5)} ${origin ? `[${origin}] ` : ''}${event.message}`
  return event.stack ? `${head}\n${event.stack}` : head
}

/** Serialize the current (filtered) result set. */
export function exportEvents(events: LogEvent[], format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(events.map(toRecord), null, 2)
  if (format === 'jsonl') return events.map((event) => JSON.stringify(toRecord(event))).join('\n')
  return events.map(formatEventLine).join('\n')
}

/** The raw source lines of the selected events, exactly as they arrived. */
export function exportRaw(events: LogEvent[]): string {
  return events.map((event) => event.raw).join('\n')
}

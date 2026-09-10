import { analyzeLog } from './analyze'
import { maskEvents, maskText } from './mask'
import type { LogFilterState } from './query'
import type { LogEvent } from './types'

export interface EvidenceBundle {
  format: 'adomnia-log-evidence'
  version: 1
  createdAt: string
  title: string
  filters: LogFilterState
  notes: string
  redaction: {
    applied: true
    extraSensitiveFields: string[]
    uiHiddenFields: string[]
    uiHiddenFieldsRemoved: false
  }
  sources: { id: string; name: string; lines: number[] }[]
  timeline: { eventId: number; timestamp: string | null; service: string; level: string; message: string; sourceId: string; line: number }[]
  events: LogEvent[]
  summaryMarkdown: string
}

export interface EvidenceOptions {
  title?: string
  filters: LogFilterState
  notes: string
  extraSensitiveFields?: string[]
  hiddenFields?: string[]
}

export function evidenceMarkdown(events: LogEvent[], title: string, notes: string): string {
  const analysis = analyzeLog(events)
  const lines = [
    `# ${maskText(title)}`,
    '',
    `Generated locally by adOmnia · ${events.length} events · ${analysis.requests.length} correlated requests`,
    '',
    '## Notes',
    '',
    maskText(notes) || '_No notes._',
    '',
    '## Timeline',
    '',
    '| Time | Level | Service | Source | Message |',
    '|---|---|---|---|---|',
    ...events.map((event) => `| ${event.ts !== null ? new Date(event.ts).toISOString() : event.tsRaw || '-'} | ${event.level} | ${event.service || '-'} | ${(event.sourceName || '-')}:${event.line} | ${event.message.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} |`),
  ]
  return lines.join('\n')
}

/** Build an offline evidence package. Redaction is mandatory and precedes every projection. */
export function buildEvidenceBundle(events: LogEvent[], options: EvidenceOptions): EvidenceBundle {
  const redacted = maskEvents(events, options.extraSensitiveFields)
  const title = options.title || 'Log investigation evidence'
  const sourceMap = new Map<string, { id: string; name: string; lines: number[] }>()
  for (const event of redacted) {
    const id = event.sourceId || 'unknown'
    const source = sourceMap.get(id)
    if (source) source.lines.push(event.line)
    else sourceMap.set(id, { id, name: event.sourceName || id, lines: [event.line] })
  }
  const safeNotes = maskText(options.notes)
  return {
    format: 'adomnia-log-evidence',
    version: 1,
    createdAt: new Date().toISOString(),
    title: maskText(title),
    filters: options.filters,
    notes: safeNotes,
    redaction: {
      applied: true,
      extraSensitiveFields: options.extraSensitiveFields ?? [],
      uiHiddenFields: options.hiddenFields ?? [],
      uiHiddenFieldsRemoved: false,
    },
    sources: [...sourceMap.values()],
    timeline: redacted.map((event) => ({
      eventId: event.id,
      timestamp: event.ts !== null ? new Date(event.ts).toISOString() : null,
      service: event.service,
      level: event.level,
      message: event.message,
      sourceId: event.sourceId || '',
      line: event.line,
    })),
    events: redacted,
    summaryMarkdown: evidenceMarkdown(redacted, title, safeNotes),
  }
}

export function serializeEvidence(bundle: EvidenceBundle): string {
  return JSON.stringify(bundle, null, 2)
}

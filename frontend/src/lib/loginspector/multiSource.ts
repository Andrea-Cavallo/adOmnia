import { parseLogTextInBackground } from './background'
import type { ChunkedHooks } from './parse'
import type { LogEvent, LogFormat, ParseOptions, ParseResult, ParseSummary } from './types'
import type { LogSourceResult } from './sources'

export type MultiSourceParseResult = ParseResult & { aborted: boolean; sourceCount: number }

function sourceLineCount(text: string): number {
  return text ? text.split(/\r?\n/).length : 0
}

function labelEvents(events: LogEvent[], sourceName: string, offset: number, showSource: boolean): LogEvent[] {
  return events.map((event, index) => ({
    ...event,
    id: offset + index,
    sourceName: showSource ? sourceName : undefined,
  }))
}

function emptySummary(): ParseSummary {
  return {
    valid: 0,
    invalid: 0,
    totalLines: 0,
    errors: [],
    warnings: [],
    errorCount: 0,
    warningCount: 0,
    truncated: false,
    format: 'empty',
    durationMs: 0,
  }
}

/** Parse each file independently, then expose one globally correlated event set. */
export async function parseLogSourcesInBackground(
  sources: LogSourceResult[],
  options: ParseOptions = {},
  hooks: ChunkedHooks = {},
): Promise<MultiSourceParseResult> {
  if (!sources.length) return { events: [], summary: emptySummary(), aborted: false, sourceCount: 0 }

  const events: LogEvent[] = []
  const summaries: ParseSummary[] = []
  const totalLines = sources.reduce((sum, source) => sum + sourceLineCount(source.text), 0)
  const maxEvents = options.maxEvents ?? Number.MAX_SAFE_INTEGER
  let completedLines = 0
  let aborted = false

  for (const source of sources) {
    if (events.length >= maxEvents || hooks.shouldAbort?.()) {
      aborted = hooks.shouldAbort?.() ?? false
      break
    }
    const offset = events.length
    const remaining = maxEvents - offset
    const parsed = await parseLogTextInBackground(
      source.text,
      { ...options, maxEvents: remaining },
      {
        shouldAbort: hooks.shouldAbort,
        onProgress: (done, _sourceTotal, partial) => {
          const combined = events.concat(labelEvents(partial, source.name, offset, sources.length > 1))
          hooks.onProgress?.(Math.min(totalLines, completedLines + done), totalLines, combined)
        },
      },
    )
    const labelled = labelEvents(parsed.events, source.name, offset, sources.length > 1)
    events.push(...labelled)
    summaries.push(parsed.summary)
    completedLines += parsed.summary.totalLines
    hooks.onProgress?.(Math.min(totalLines, completedLines), totalLines, events)
    if (parsed.aborted) {
      aborted = true
      break
    }
  }

  const formats = new Set(summaries.map((summary) => summary.format).filter((format) => format !== 'empty'))
  const format: LogFormat = formats.size === 0 ? 'empty' : formats.size === 1 ? [...formats][0] : 'mixed'
  const summary: ParseSummary = {
    valid: summaries.reduce((sum, item) => sum + item.valid, 0),
    invalid: summaries.reduce((sum, item) => sum + item.invalid, 0),
    totalLines: summaries.reduce((sum, item) => sum + item.totalLines, 0),
    errors: summaries.flatMap((item) => item.errors).slice(0, 100),
    warnings: summaries.flatMap((item) => item.warnings).slice(0, 100),
    errorCount: summaries.reduce((sum, item) => sum + item.errorCount, 0),
    warningCount: summaries.reduce((sum, item) => sum + item.warningCount, 0),
    truncated: events.length >= maxEvents || summaries.some((item) => item.truncated),
    format,
    durationMs: summaries.reduce((sum, item) => sum + item.durationMs, 0),
  }
  return { events, summary, aborted, sourceCount: sources.length }
}

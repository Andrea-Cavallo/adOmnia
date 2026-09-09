// Normalized internal model for the Log Inspector.
//
// Every event keeps the original material alongside the normalized fields so
// nothing is lost: the raw source text, the original parsed JSON, the fields we
// did not recognize, the source line number, and the parse error (if any).

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'unknown'

export const LOG_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'unknown']

/** Fields promoted out of the payload and shown as columns / facets. */
export interface LogEventFields {
  level: LogLevel
  /** Level exactly as written in the source (`SEVERE`, `WARNING`, `30`, ...). */
  levelRaw: string
  /** Epoch milliseconds, or null when no timestamp could be recognized. */
  ts: number | null
  /** Timestamp exactly as written in the source. */
  tsRaw: string
  message: string
  service: string
  namespace: string
  pod: string
  container: string
  traceId: string
  correlationId: string
  requestId: string
  thread: string
  logger: string
}

export interface LogEvent extends LogEventFields {
  /** Stable index in the parsed batch (also the default chronological tiebreak). */
  id: number
  /** Stable source id inside a multi-file import, used to distinguish homonymous files. */
  sourceId?: string
  /** Human-readable file label when the event belongs to a multi-file import. */
  sourceName?: string
  /** 1-based line number of the first source line of this event. */
  line: number
  /** Number of source lines consumed by this event (>1 for stack traces). */
  lineCount: number
  /** Aggregated multiline stack trace, empty when the event has none. */
  stack: string
  /** Original JSON payload when the event was JSON, otherwise null. */
  json: unknown | null
  /** Non-blank text that preceded the JSON payload on the same line. */
  prefix: string
  /** Payload keys we did not promote into a known field. */
  extra: Record<string, unknown>
  /** JSON that was embedded as a string inside message/body/payload/response. */
  decoded: Record<string, unknown>
  /** Original source text (ANSI escapes removed), all lines joined. */
  raw: string
  /** Non-empty when the line could not be parsed as structured data. */
  parseError: string
}

export interface ParseIssue {
  line: number
  message: string
  /** Truncated source excerpt, for the summary list. */
  excerpt: string
}

export interface ParseSummary {
  /** Events that produced structured data. */
  valid: number
  /** Events flagged as not parsable (kept, never dropped). */
  invalid: number
  totalLines: number
  /** Sampled issue lists — capped so a 100k-line paste cannot blow up memory. */
  errors: ParseIssue[]
  warnings: ParseIssue[]
  errorCount: number
  warningCount: number
  /** True when maxEvents cut the import short. */
  truncated: boolean
  format: LogFormat
  durationMs: number
}

export type LogFormat = 'json' | 'json-array' | 'jsonl' | 'mixed' | 'text' | 'empty'

export interface ParseResult {
  events: LogEvent[]
  summary: ParseSummary
}

export interface ParseOptions {
  /** Hard ceiling on retained events. Default 200_000. */
  maxEvents?: number
  /** Try to JSON.parse strings found in message/body/payload/response. Default true. */
  decodeNestedJson?: boolean
}

export const DEFAULT_MAX_EVENTS = 200_000

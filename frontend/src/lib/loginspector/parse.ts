import { detectFormat, findJsonSuffix, stripAnsi } from './detect'
import { levelFromText, normalizePayload, parseTimestamp, startsWithTimestamp, timestampFromText } from './normalize'
import {
  DEFAULT_MAX_EVENTS,
  type LogEvent,
  type LogFormat,
  type ParseIssue,
  type ParseOptions,
  type ParseResult,
} from './types'

// Only a sample of issues is kept: a 100k-line paste of unparsable text would
// otherwise retain a second copy of the whole file in the summary.
const ISSUE_SAMPLE_LIMIT = 100

// ─── Stack trace recognition ─────────────────────────────────────────────────

const JAVA_FRAME = /^\s+at\s+\S/
const JAVA_MORE = /^\s*\.{3}\s+\d+\s+more\s*$/
const JAVA_CAUSE = /^\s*(?:Caused by|Suppressed):\s/
const JAVA_THROWABLE = /^(?:[\w$]+\.)+[\w$]*(?:Exception|Error|Throwable)(?::|\s*$)/

const GO_PANIC = /^\s*(?:panic:|fatal error:)/
const GO_GOROUTINE = /^goroutine\s+\d+\s+\[/
const GO_FILE_FRAME = /^\s*\/?\S*\.go:\d+(?:\s+\+0x[0-9a-f]+)?\s*$/
const GO_FUNC_FRAME = /^(?:\S+\.)+\S*\([^)]*\)$/
const GO_CREATED_BY = /^created by\s+\S/
const GO_EXIT = /^exit status\s+\d+\s*$/
const GO_SIGNAL = /^\[signal\s/

// `2024-05-15T10:23:45.123456789Z stdout F {"level":"info"}` — the CRI-O line
// format `oc logs` emits when the container writes to stdout/stderr.
const CRI_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(stdout|stderr)\s+([FP])\s?/

interface CriSplit {
  body: string
  ts: number | null
  stream: string
}

/** Split the CRI-O wrapper off a line so the payload can be judged on its own. */
export function splitCriPrefix(line: string): CriSplit {
  const match = CRI_PREFIX.exec(line)
  if (!match) return { body: line, ts: null, stream: '' }
  return { body: line.slice(match[0].length), ts: parseTimestamp(match[1]), stream: match[2] }
}

// ─── Incremental parser ──────────────────────────────────────────────────────

interface Draft {
  startLine: number
  /** CRI-stripped bodies; index 0 is the head line, the rest are the stack. */
  bodies: string[]
  /** Original (ANSI-stripped) lines, kept verbatim for "copy raw line". */
  raws: string[]
  criTs: number | null
  criStream: string
  goStack: boolean
}

export interface LogParser {
  /** Feed one source line (without its trailing newline). */
  pushLine(line: string): void
  /** True once maxEvents has been reached and further lines are ignored. */
  isFull(): boolean
  /** Close the last draft and produce the result. */
  finish(): ParseResult
  /** Events produced so far — used for progressive rendering. */
  peek(): LogEvent[]
}

export function createLogParser(options: ParseOptions & { format?: LogFormat } = {}): LogParser {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const decodeNestedJson = options.decodeNestedJson !== false

  const events: LogEvent[] = []
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []
  let errorCount = 0
  let warningCount = 0
  let invalid = 0
  let lineNo = 0
  let truncated = false
  let draft: Draft | null = null
  const started = Date.now()

  const addIssue = (bucket: ParseIssue[], line: number, message: string, excerpt: string) => {
    if (bucket.length < ISSUE_SAMPLE_LIMIT) {
      bucket.push({ line, message, excerpt: excerpt.slice(0, 240) })
    }
  }

  const flush = () => {
    if (!draft) return
    if (events.length >= maxEvents) {
      truncated = true
      draft = null
      return
    }
    const event = buildEvent(draft, events.length, decodeNestedJson)
    if (event.parseError) {
      invalid++
      errorCount++
      addIssue(errors, event.line, event.parseError, event.raw)
    } else if (event.ts === null) {
      warningCount++
      addIssue(warnings, event.line, 'No recognizable timestamp', event.raw)
    }
    events.push(event)
    draft = null
  }

  const isContinuation = (body: string): boolean => {
    if (!draft) return false
    if (body.trim() === '') return draft.goStack
    // A new structured record always starts a new event.
    if (body.trimStart().startsWith('{')) return false
    if (startsWithTimestamp(body)) return false

    if (draft.goStack) {
      return GO_GOROUTINE.test(body) || GO_FILE_FRAME.test(body) || GO_FUNC_FRAME.test(body)
        || GO_CREATED_BY.test(body) || GO_EXIT.test(body) || GO_SIGNAL.test(body) || /^\s/.test(body)
    }
    if (JAVA_FRAME.test(body) || JAVA_MORE.test(body) || JAVA_CAUSE.test(body)) return true
    if (JAVA_THROWABLE.test(body)) return true
    if (GO_GOROUTINE.test(body)) {
      draft.goStack = true
      return true
    }
    // Anything indented belongs to the event above it.
    return /^[ \t]/.test(body)
  }

  return {
    pushLine(line: string) {
      lineNo++
      if (events.length >= maxEvents) {
        truncated = true
        return
      }
      const clean = stripAnsi(line).replace(/\s+$/, '')
      const { body, ts, stream } = splitCriPrefix(clean)

      if (isContinuation(body)) {
        draft!.bodies.push(body)
        draft!.raws.push(clean)
        return
      }

      flush()
      if (body.trim() === '') return

      draft = {
        startLine: lineNo,
        bodies: [body],
        raws: [clean],
        criTs: ts,
        criStream: stream,
        goStack: GO_PANIC.test(body),
      }
    },
    isFull() {
      return events.length >= maxEvents
    },
    peek() {
      return events
    },
    finish(): ParseResult {
      flush()
      return {
        events,
        summary: {
          valid: events.length - invalid,
          invalid,
          totalLines: lineNo,
          errors,
          warnings,
          errorCount,
          warningCount,
          truncated,
          format: options.format ?? 'text',
          durationMs: Date.now() - started,
        },
      }
    },
  }
}

// ─── Draft → event ───────────────────────────────────────────────────────────

// `2024-05-15 10:23:45.123  INFO 1 --- [nio-8080-exec-1] c.e.PaymentController : msg`
const JAVA_THREAD_LOGGER = /\[([^\]]{1,80})\]\s+([\w$.]+)\s*:\s/

function buildEvent(draft: Draft, id: number, decodeNestedJson: boolean): LogEvent {
  const head = draft.bodies[0]
  const stack = draft.bodies.slice(1).join('\n')
  const raw = draft.raws.join('\n')
  const base = {
    id,
    line: draft.startLine,
    lineCount: draft.bodies.length,
    stack,
    raw,
  }

  const trimmedHead = head.trim()
  let payload: Record<string, unknown> | null = null
  let prefix = ''
  let parseError = ''

  if (trimmedHead.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmedHead)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>
      } else {
        parseError = 'JSON value is not an object'
      }
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Invalid JSON'
    }
  } else {
    const at = findJsonSuffix(head)
    if (at > 0) {
      prefix = head.slice(0, at).trim()
      payload = JSON.parse(head.slice(at)) as Record<string, unknown>
    }
  }

  if (payload) {
    const { fields, extra, decoded } = normalizePayload(payload, { decodeNestedJson })
    const fromPrefix = prefix ? timestampFromText(prefix) : { ts: null, raw: '' }
    const ts = fields.ts ?? draft.criTs ?? fromPrefix.ts
    return {
      ...base,
      ...fields,
      ts,
      tsRaw: fields.tsRaw || fromPrefix.raw || (draft.criTs !== null ? new Date(draft.criTs).toISOString() : ''),
      message: fields.message || prefix || trimmedHead,
      container: fields.container || draft.criStream,
      stack: stack || stringField(extra, ['stack', 'stack_trace', 'stackTrace', 'exception', 'error.stack']),
      json: payload,
      prefix,
      extra,
      decoded,
      parseError: '',
    }
  }

  // Plain text (or broken JSON, which we keep and flag).
  const { ts, raw: tsRaw } = timestampFromText(head)
  const { level, raw: levelRaw } = levelFromText(head)
  const threadLogger = JAVA_THREAD_LOGGER.exec(head)
  let message = head.trim()
  if (tsRaw && message.startsWith(tsRaw)) message = message.slice(tsRaw.length).trim()

  return {
    ...base,
    // Unparsable lines keep `unknown` so they never inflate the error counter —
    // the dedicated `parseError` flag is what the UI badges and filters on.
    level: parseError ? 'unknown' : level,
    levelRaw: parseError ? 'unparsed' : levelRaw,
    ts: ts ?? draft.criTs,
    tsRaw: tsRaw || (draft.criTs !== null ? new Date(draft.criTs).toISOString() : ''),
    message,
    service: '',
    namespace: '',
    pod: '',
    container: draft.criStream,
    traceId: '',
    correlationId: '',
    requestId: '',
    thread: threadLogger?.[1] ?? '',
    logger: threadLogger?.[2] ?? '',
    json: null,
    prefix: '',
    extra: {},
    decoded: {},
    parseError,
  }
}

function stringField(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

// ─── Entry points ────────────────────────────────────────────────────────────

/** Synchronous parse — used by tests and by small pastes. */
export function parseLogText(text: string, options: ParseOptions = {}): ParseResult {
  const format = detectFormat(text)
  if (format === 'empty') {
    return {
      events: [],
      summary: {
        valid: 0, invalid: 0, totalLines: 0, errors: [], warnings: [],
        errorCount: 0, warningCount: 0, truncated: false, format, durationMs: 0,
      },
    }
  }

  if (format === 'json' || format === 'json-array') {
    return parseJsonDocument(text, format, options)
  }

  const parser = createLogParser({ ...options, format })
  const lines = stripAnsi(text).split(/\r?\n/)
  for (const line of lines) {
    parser.pushLine(line)
    if (parser.isFull()) break
  }
  return parser.finish()
}

/** A whole-document JSON object or array of objects. */
function parseJsonDocument(text: string, format: LogFormat, options: ParseOptions): ParseResult {
  const started = Date.now()
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const decodeNestedJson = options.decodeNestedJson !== false
  const totalLines = text.split(/\r?\n/).length

  let parsed: unknown
  try {
    parsed = JSON.parse(stripAnsi(text).trim())
  } catch (error) {
    // Should not happen (detectFormat already parsed it) but never throw at the UI.
    return {
      events: [],
      summary: {
        valid: 0, invalid: 1, totalLines, errorCount: 1, warningCount: 0,
        errors: [{ line: 1, message: error instanceof Error ? error.message : 'Invalid JSON', excerpt: text.slice(0, 240) }],
        warnings: [], truncated: false, format, durationMs: Date.now() - started,
      },
    }
  }

  const items = Array.isArray(parsed) ? parsed : [parsed]
  const events: LogEvent[] = []
  const warnings: ParseIssue[] = []
  let invalid = 0
  let warningCount = 0
  const errors: ParseIssue[] = []

  for (const item of items.slice(0, maxEvents)) {
    const id = events.length
    const raw = JSON.stringify(item)
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid++
      if (errors.length < ISSUE_SAMPLE_LIMIT) {
        errors.push({ line: 1, message: 'Array element is not an object', excerpt: raw.slice(0, 240) })
      }
      events.push(scalarEvent(id, raw))
      continue
    }
    const payload = item as Record<string, unknown>
    const { fields, extra, decoded } = normalizePayload(payload, { decodeNestedJson })
    if (fields.ts === null) {
      warningCount++
      if (warnings.length < ISSUE_SAMPLE_LIMIT) {
        warnings.push({ line: 1, message: 'No recognizable timestamp', excerpt: raw.slice(0, 240) })
      }
    }
    events.push({
      id,
      line: 1,
      lineCount: 1,
      ...fields,
      message: fields.message || raw.slice(0, 200),
      stack: stringField(extra, ['stack', 'stack_trace', 'stackTrace', 'exception', 'error.stack']),
      json: payload,
      prefix: '',
      extra,
      decoded,
      raw,
      parseError: '',
    })
  }

  return {
    events,
    summary: {
      valid: events.length - invalid,
      invalid,
      totalLines,
      errors,
      warnings,
      errorCount: invalid,
      warningCount,
      truncated: items.length > maxEvents,
      format,
      durationMs: Date.now() - started,
    },
  }
}

function scalarEvent(id: number, raw: string): LogEvent {
  return {
    id, line: 1, lineCount: 1, level: 'unknown', levelRaw: '', ts: null, tsRaw: '',
    message: raw, service: '', namespace: '', pod: '', container: '', traceId: '',
    correlationId: '', requestId: '', thread: '', logger: '', stack: '', json: null,
    prefix: '', extra: {}, decoded: {}, raw, parseError: 'Array element is not an object',
  }
}

// ─── Chunked parse (keeps the UI responsive on large pastes) ─────────────────

export interface ChunkedHooks {
  /** Called after every chunk with the events produced so far. */
  onProgress?: (done: number, total: number, events: LogEvent[]) => void
  /** Return true to stop the import early; the partial result is returned. */
  shouldAbort?: () => boolean
  /** Lines per chunk. Larger = faster, less responsive. */
  chunkLines?: number
}

const YIELD = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

/**
 * Parse in slices with a macrotask yield between them, so the progress bar
 * paints, the cancel button responds, and the list can fill in progressively.
 * This entry point is also used inside parser.worker.ts. Keeping the parser
 * incremental provides progress and cooperative cancellation in both places.
 */
export async function parseLogTextChunked(
  text: string,
  options: ParseOptions = {},
  hooks: ChunkedHooks = {},
): Promise<ParseResult & { aborted: boolean }> {
  const format = detectFormat(text)
  if (format === 'empty' || format === 'json' || format === 'json-array') {
    return { ...parseLogText(text, options), aborted: false }
  }

  const chunkLines = hooks.chunkLines ?? 4000
  const lines = stripAnsi(text).split(/\r?\n/)
  const parser = createLogParser({ ...options, format })
  let aborted = false

  for (let i = 0; i < lines.length; i += chunkLines) {
    const end = Math.min(i + chunkLines, lines.length)
    for (let j = i; j < end; j++) parser.pushLine(lines[j])
    hooks.onProgress?.(end, lines.length, parser.peek())
    if (parser.isFull()) break
    if (end < lines.length) {
      await YIELD()
      if (hooks.shouldAbort?.()) {
        aborted = true
        break
      }
    }
  }

  return { ...parser.finish(), aborted }
}

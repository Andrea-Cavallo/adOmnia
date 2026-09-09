import { parseLogTextChunked, type ChunkedHooks } from './parse'
import type { LogEvent, LogFormat, ParseOptions, ParseResult } from './types'

type BackgroundResult = ParseResult & { aborted: boolean }

interface ProgressMessage {
  type: 'progress'
  done: number
  total: number
  batch: LogEvent[]
}

interface CompleteMessage {
  type: 'complete'
  result: BackgroundResult
}

interface ErrorMessage {
  type: 'error'
  message: string
}

type WorkerMessage = ProgressMessage | CompleteMessage | ErrorMessage

/**
 * Parse logs away from React's renderer. Progress messages carry only newly
 * parsed events, avoiding repeated structured clones of the complete list.
 * The fallback keeps tests and older WebViews functional.
 */
export function parseLogTextInBackground(
  text: string,
  options: ParseOptions = {},
  hooks: ChunkedHooks = {},
): Promise<BackgroundResult> {
  if (typeof Worker === 'undefined') return parseLogTextChunked(text, options, hooks)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })
    const events: LogEvent[] = []
    const started = Date.now()
    let done = 0
    let total = 0
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      window.clearInterval(cancelTimer)
      worker.terminate()
      callback()
    }

    const cancelTimer = window.setInterval(() => {
      if (!hooks.shouldAbort?.()) return
      worker.postMessage({ type: 'cancel' })
      finish(() => resolve(cancelledResult(events, done || total, started)))
    }, 32)

    worker.onmessage = (message: MessageEvent<WorkerMessage>) => {
      const payload = message.data
      if (payload.type === 'progress') {
        done = payload.done
        total = payload.total
        events.push(...payload.batch)
        hooks.onProgress?.(done, total, events)
        return
      }
      if (payload.type === 'error') {
        finish(() => reject(new Error(payload.message)))
        return
      }
      finish(() => resolve(payload.result))
    }
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'Background parser failed')))
    worker.postMessage({ type: 'parse', text, options })
  })
}

function cancelledResult(events: LogEvent[], totalLines: number, started: number): BackgroundResult {
  const invalid = events.reduce((count, event) => count + (event.parseError ? 1 : 0), 0)
  return {
    events,
    aborted: true,
    summary: {
      valid: events.length - invalid,
      invalid,
      totalLines,
      errors: [],
      warnings: [],
      errorCount: invalid,
      warningCount: 0,
      truncated: false,
      format: 'text' as LogFormat,
      durationMs: Date.now() - started,
    },
  }
}


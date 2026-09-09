import { parseLogTextChunked } from './parse'
import type { LogEvent, ParseOptions } from './types'

type WorkerRequest =
  | { type: 'parse'; text: string; options: ParseOptions }
  | { type: 'cancel' }

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: unknown) => void
}

const scope = globalThis as unknown as WorkerScope
let cancelled = false

scope.onmessage = (message) => {
  if (message.data.type === 'cancel') {
    cancelled = true
    return
  }

  cancelled = false
  let sent = 0
  void parseLogTextChunked(message.data.text, message.data.options, {
    chunkLines: 2_000,
    shouldAbort: () => cancelled,
    onProgress: (done, total, events) => {
      const batch: LogEvent[] = events.slice(sent)
      sent = events.length
      scope.postMessage({ type: 'progress', done, total, batch })
    },
  }).then(
    (result) => scope.postMessage({ type: 'complete', result }),
    (error: unknown) => scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Import failed',
    }),
  )
}


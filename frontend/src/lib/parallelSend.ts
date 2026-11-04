import { CancelHTTP, ExecuteHTTPBatch } from '@/wailsjs/go/main/App'
import type { RequestItem, ResponseData } from '@/lib/types'
import { prepareExecution, responseFromGo, type GoHTTPResponse } from '@/lib/sendRequest'

/** One entry of the Go batch response (`internal/httpexec.batch.go`). */
interface GoBatchItem {
  index: number
  response: GoHTTPResponse
}

interface GoBatchResponse {
  results?: GoBatchItem[]
  concurrency?: number
  ms?: number
  error?: { code: string; message: string }
}

export interface ParallelSendOptions {
  /** How many times to repeat the request when no body variant is given. */
  copies?: number
  /** One body per item; when present it wins over `copies`. */
  bodies?: string[]
  concurrency?: number
  /** Aborting it cancels every item still in flight (CancelHTTP per id). */
  signal?: AbortSignal
}

export interface ParallelItemResult {
  index: number
  body: string
  response: ResponseData
}

export interface ParallelSendOutcome {
  ms: number
  concurrency: number
  results: ParallelItemResult[]
  /** Set when the batch could not run at all. */
  error?: string
  /** Aborts every item still in flight. */
  cancel: () => void
}

const MIN_COPIES = 1
const MAX_COPIES = 50
const DEFAULT_COPIES = 5

/**
 * Sends the same resolved request several times at once through the Go batch
 * executor, either unchanged or with one body per copy. The whole preparation
 * (vault, auth, cookies, TLS) runs once, so every item shares the same auth and
 * differs only by its body. This is the wiring of the hidden fan-out: it has no
 * visible affordance in the shell.
 */
export async function sendRequestInParallel(
  request: RequestItem,
  vars: Record<string, string>,
  options: ParallelSendOptions = {},
): Promise<ParallelSendOutcome> {
  const prepared = await prepareExecution(request, vars)
  if (prepared.kind === 'error') {
    return failed(prepared.response.error?.message ?? 'The request could not be prepared.')
  }
  if (prepared.kind === 'browser') {
    return failed('Multipart form-data still uses the browser transport and cannot run in parallel.')
  }

  const bodies = resolveBodies(options, prepared.exec.body)
  const ids = bodies.map((_, index) => `${prepared.exec.id}-${index + 1}`)
  const cancel = () => { for (const id of ids) void CancelHTTP(id) }

  const onAbort = () => { cancel() }
  options.signal?.addEventListener('abort', onAbort)
  let batch: GoBatchResponse
  try {
    const raw = await ExecuteHTTPBatch(JSON.stringify({
      request: prepared.exec,
      bodies,
      concurrency: options.concurrency ?? defaultConcurrency(bodies.length),
    }))
    batch = JSON.parse(raw) as GoBatchResponse
  } catch (e) {
    return { ...failed(e instanceof Error ? e.message : String(e)), cancel }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
  if (batch.error) return { ...failed(batch.error.message), cancel }

  const results = (batch.results ?? []).map((item) => ({
    index: item.index,
    body: bodies[item.index] ?? '',
    response: responseFromGo(item.response, prepared.fullUrl),
  }))
  return { ms: batch.ms ?? 0, concurrency: batch.concurrency ?? 0, results, cancel }
}

function resolveBodies(options: ParallelSendOptions, baseBody: string): string[] {
  if (options.bodies && options.bodies.length > 0) {
    return options.bodies.slice(0, MAX_COPIES)
  }
  const copies = Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.round(options.copies ?? DEFAULT_COPIES)))
  return Array.from({ length: copies }, () => baseBody)
}

function defaultConcurrency(count: number): number {
  return Math.min(4, Math.max(1, count))
}

function failed(error: string): ParallelSendOutcome {
  return { ms: 0, concurrency: 0, results: [], error, cancel: () => {} }
}

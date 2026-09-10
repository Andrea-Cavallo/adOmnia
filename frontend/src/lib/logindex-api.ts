import { serverUrl, sidecarFetch } from '@/lib/useServerPort'

export interface LogIndexStatus {
  id: string
  path: string
  name: string
  size: number
  bytesRead: number
  records: number
  done: boolean
  cancelled: boolean
  error: string
  firstTs: number
  lastTs: number
  levelCounts: Record<string, number>
  firstRecordMs: number
  indexBytes: number
}

export interface LogIndexEntry {
  index: number
  offset: number
  length: number
  ts: number
  level: string
  continuation: boolean
  text: string
}

export interface LogIndexPage {
  entries: LogIndexEntry[]
  /** Record index to continue from; the index is exhausted when `exhausted`. */
  nextFrom: number
  scanned: number
  exhausted: boolean
  /** The scan hit its time budget before filling the page. */
  budgetExceeded: boolean
  indexing: boolean
  records: number
  error: string
}

export interface LogIndexQuery {
  id: string
  from?: number
  limit?: number
  levels?: string[]
  fromTs?: number
  toTs?: number
  text?: string
  budgetMs?: number
}

const NO_BACKEND = 'The local backend is not reachable.'

async function call(port: number | null, path: string, body?: unknown): Promise<unknown> {
  const url = serverUrl(port, path)
  if (!url) throw new Error(NO_BACKEND)
  const response = await sidecarFetch(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

const EMPTY_STATUS: LogIndexStatus = {
  id: '', path: '', name: '', size: 0, bytesRead: 0, records: 0, done: false,
  cancelled: false, error: '', firstTs: -1, lastTs: -1, levelCounts: {},
  firstRecordMs: 0, indexBytes: 0,
}

/** Start indexing a file on disk. The file is never loaded into the renderer. */
export async function openLogIndex(port: number | null, path: string): Promise<LogIndexStatus> {
  try {
    const result = await call(port, '/logindex/open', { path }) as Partial<LogIndexStatus>
    return { ...EMPTY_STATUS, ...result }
  } catch (error: unknown) {
    return { ...EMPTY_STATUS, error: error instanceof Error ? error.message : NO_BACKEND }
  }
}

export async function logIndexStatus(port: number | null, id: string): Promise<LogIndexStatus> {
  try {
    const result = await call(port, `/logindex/status?id=${encodeURIComponent(id)}`) as Partial<LogIndexStatus>
    return { ...EMPTY_STATUS, ...result }
  } catch (error: unknown) {
    return { ...EMPTY_STATUS, error: error instanceof Error ? error.message : NO_BACKEND }
  }
}

export async function queryLogIndex(port: number | null, query: LogIndexQuery): Promise<LogIndexPage> {
  const empty: LogIndexPage = {
    entries: [], nextFrom: -1, scanned: 0, exhausted: false,
    budgetExceeded: false, indexing: false, records: 0, error: '',
  }
  try {
    const result = await call(port, '/logindex/query', query) as Partial<LogIndexPage>
    return { ...empty, ...result, entries: result.entries ?? [] }
  } catch (error: unknown) {
    return { ...empty, error: error instanceof Error ? error.message : NO_BACKEND }
  }
}

async function signal(port: number | null, action: 'cancel' | 'close', id: string): Promise<void> {
  try {
    await call(port, `/logindex/${action}?id=${encodeURIComponent(id)}`)
  } catch {
    /* the index is released with the backend anyway */
  }
}

export const cancelLogIndex = (port: number | null, id: string) => signal(port, 'cancel', id)
export const closeLogIndex = (port: number | null, id: string) => signal(port, 'close', id)

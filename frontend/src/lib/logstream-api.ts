import { serverUrl, sidecarFetch } from '@/lib/useServerPort'

export type LiveSourceKind = 'file' | 'kubectl' | 'oc' | 'docker'

export interface LiveSourceConfig {
  kind: LiveSourceKind
  path?: string
  context?: string
  namespace?: string
  pod?: string
  container?: string
  /** Only lines newer than this many seconds, for container runtimes. */
  sinceSeconds?: number
  /** Ring buffer size held by the backend. */
  bufferLines?: number
  /** Read a file from byte 0 instead of from its current end. */
  fromStart?: boolean
}

export interface LivePoll {
  lines: string[]
  cursor: number
  running: boolean
  error: string
  dropped: number
  /** True when lines were evicted before this client read them. */
  missed: boolean
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

/** Which CLIs are installed — the UI names the missing dependency up front. */
export async function liveTools(port: number | null): Promise<Record<string, boolean>> {
  try {
    return await call(port, '/logstream/tools') as Record<string, boolean>
  } catch {
    return { kubectl: false, oc: false, docker: false }
  }
}

export async function startLiveSource(port: number | null, config: LiveSourceConfig): Promise<{ id: string; label: string; error: string }> {
  try {
    const result = await call(port, '/logstream/start', config) as { id?: string; label?: string; error?: string }
    return { id: result.id ?? '', label: result.label ?? '', error: result.error ?? '' }
  } catch (error: unknown) {
    return { id: '', label: '', error: error instanceof Error ? error.message : NO_BACKEND }
  }
}

export async function pollLiveSource(port: number | null, id: string, cursor: number): Promise<LivePoll> {
  try {
    const result = await call(port, `/logstream/poll?id=${encodeURIComponent(id)}&cursor=${cursor}`) as Partial<LivePoll>
    return {
      lines: result.lines ?? [],
      cursor: result.cursor ?? cursor,
      running: result.running ?? false,
      error: result.error ?? '',
      dropped: result.dropped ?? 0,
      missed: result.missed ?? false,
    }
  } catch (error: unknown) {
    return { lines: [], cursor, running: false, error: error instanceof Error ? error.message : NO_BACKEND, dropped: 0, missed: false }
  }
}

async function command(port: number | null, action: 'stop' | 'resume' | 'close', id: string): Promise<string> {
  try {
    const result = await call(port, `/logstream/${action}?id=${encodeURIComponent(id)}`) as { error?: string }
    return result.error ?? ''
  } catch (error: unknown) {
    return error instanceof Error ? error.message : NO_BACKEND
  }
}

export const stopLiveSource = (port: number | null, id: string) => command(port, 'stop', id)
export const resumeLiveSource = (port: number | null, id: string) => command(port, 'resume', id)
export const closeLiveSource = (port: number | null, id: string) => command(port, 'close', id)

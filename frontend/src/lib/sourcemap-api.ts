import { serverUrl, sidecarFetch } from '@/lib/useServerPort'

export interface FrameResolution {
  found: boolean
  path: string
  root: string
  /** Candidate suffix that matched, so an approximate hit stays visible. */
  matched: string
  /** Other files matching the same candidate — the choice is not certain. */
  ambiguous: string[]
  error: string
}

const UNAVAILABLE: FrameResolution = {
  found: false, path: '', root: '', matched: '', ambiguous: [],
  error: 'The local backend is not reachable.',
}

async function post(port: number | null, path: string, body: unknown): Promise<unknown> {
  const url = serverUrl(port, path)
  if (!url) throw new Error(UNAVAILABLE.error)
  const response = await sidecarFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

/** Find the first file under `roots` whose path ends with one of `candidates`. */
export async function resolveFrame(port: number | null, roots: string[], candidates: string[]): Promise<FrameResolution> {
  try {
    return await post(port, '/sourcemap/resolve', { roots, candidates }) as FrameResolution
  } catch (error: unknown) {
    return { ...UNAVAILABLE, error: error instanceof Error ? error.message : UNAVAILABLE.error }
  }
}

/** Open `path` at `line`. Returns an empty string on success, the error otherwise. */
export async function openSourceLocation(
  port: number | null,
  roots: string[],
  path: string,
  line: number,
  editor: string,
): Promise<string> {
  try {
    const result = await post(port, '/sourcemap/open', { roots, path, line, editor }) as { error?: string }
    return result.error ?? ''
  } catch (error: unknown) {
    return error instanceof Error ? error.message : UNAVAILABLE.error
  }
}

/** Forget the cached file index, after a checkout or a branch switch. */
export async function reindexRepositories(port: number | null): Promise<void> {
  try {
    await post(port, '/sourcemap/reindex', {})
  } catch {
    /* the index rebuilds itself on the next resolve anyway */
  }
}

import { LoadCollectionWorkspaceV2 } from '@/wailsjs/go/main/App'
import { parseWorkspacePayload, scheduleWorkspaceIdle, type StructuredWorkspacePayload } from './workspaceSplit'

/**
 * Idle/hover workspace prefetch. Workspace shards are fetched before the user
 * switches to them so the switch renders from the cache. The cache is local,
 * bounded and dropped when a save invalidates it.
 */
const cache = new Map<string, StructuredWorkspacePayload>()
const inflight = new Map<string, Promise<StructuredWorkspacePayload>>()

/** Bounded cache: large workspaces must not accumulate forever. */
export const MAX_PREFETCHED_WORKSPACES = 4

async function fetchWorkspacePayload(id: string): Promise<StructuredWorkspacePayload> {
  const raw = await LoadCollectionWorkspaceV2(id)
  return parseWorkspacePayload(raw)
}

/** Fetch one workspace payload, coalescing concurrent requests. */
export async function loadWorkspacePayload(id: string): Promise<StructuredWorkspacePayload> {
  const cached = cache.get(id)
  if (cached) return cached
  const pending = inflight.get(id)
  if (pending) return pending
  const request = fetchWorkspacePayload(id).then((payload) => {
    inflight.delete(id)
    cache.delete(id)
    if (cache.size >= MAX_PREFETCHED_WORKSPACES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(id, payload)
    return payload
  }, (error) => {
    inflight.delete(id)
    throw error
  })
  inflight.set(id, request)
  return request
}

/** Returns a cached payload without starting a fetch. */
export function peekPrefetchedWorkspace(id: string): StructuredWorkspacePayload | null {
  return cache.get(id) ?? null
}

/** Start a prefetch without awaiting it (hover trigger). */
export function prefetchWorkspace(id: string): void {
  void loadWorkspacePayload(id).catch(() => {
    // A workspace that cannot be read now is loaded on first switch.
  })
}

/** Drop cached payloads after a save; contents may have changed. */
export function invalidatePrefetchedWorkspaces(id?: string): void {
  if (id === undefined) cache.clear()
  else cache.delete(id)
}

/** True while a prefetch for the workspace is in flight. */
export function isPrefetchingWorkspace(id: string): boolean {
  return inflight.has(id)
}

/**
 * Prefetch on idle, one workspace at a time so a background fetch never
 * competes with the interaction the user is waiting for.
 */
export function scheduleIdleWorkspacePrefetch(ids: string[]): void {
  const queue = ids.filter((id) => !cache.has(id) && !inflight.has(id))
  if (queue.length === 0) return
  scheduleWorkspaceIdle(() => {
    void (async () => {
      for (const id of queue) {
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: idle prefetch must not hammer storage in parallel
          await loadWorkspacePayload(id)
        } catch {
          // A workspace that cannot be read now is loaded on first switch.
        }
      }
    })()
  })
}

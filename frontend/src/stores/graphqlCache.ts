import { create } from 'zustand'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'

// Local-first cache of GraphQL introspection results and last-used query
// variables, keyed by endpoint URL. This lets a loaded schema and the variables
// the user typed survive tab close/reopen and app restart, without a re-fetch.
const BUCKET = 'graphql'
const KEY = 'introspection-cache-v1'
const MAX_ENTRIES = 40
// Introspection payloads are megabytes each: a count-only LRU can hold tens of
// MB. The budget is by weight, and the newest entry is always kept.
const MAX_BYTES = 8 * 1024 * 1024
// Evict a whole entry only when it would exceed the budget; keep the newest
// even when it alone is bigger, so the schema just loaded is never lost.
export const GRAPHQL_CACHE_MAX_ENTRIES = MAX_ENTRIES
export const GRAPHQL_CACHE_MAX_BYTES = MAX_BYTES

export interface GraphQLEndpointCache {
  /** Raw introspection payload (the `data` field of the introspection response). */
  schema?: unknown
  /** Last-used variables JSON for this endpoint. */
  variables?: string
  /** ISO timestamp of the last update, used for LRU pruning. */
  updatedAt: string
}

type PersistedState = {
  version: 1
  byEndpoint: Record<string, GraphQLEndpointCache>
}

interface GraphQLCacheState {
  byEndpoint: Record<string, GraphQLEndpointCache>
  loaded: boolean
  load: () => Promise<void>
  getEntry: (endpoint: string) => GraphQLEndpointCache | undefined
  setSchema: (endpoint: string, schema: unknown) => void
  setVariables: (endpoint: string, variables: string) => void
  clearSchema: (endpoint: string) => void
}

function normalizeKey(endpoint: string | undefined): string {
  return (endpoint ?? '').trim()
}

export function graphqlEntryBytes(entry: GraphQLEndpointCache): number {
  return new TextEncoder().encode(JSON.stringify(entry)).length
}

/**
 * Keep the newest entries while both the count and the byte budget allow it.
 * The newest entry is always kept, even if it alone exceeds the budget.
 */
export function pruneGraphqlCache(
  byEndpoint: Record<string, GraphQLEndpointCache>,
  maxEntries = MAX_ENTRIES,
  maxBytes = MAX_BYTES,
): Record<string, GraphQLEndpointCache> {
  const entries = Object.entries(byEndpoint).sort(([, a], [, b]) => (b.updatedAt > a.updatedAt ? 1 : -1))
  const kept: Array<[string, GraphQLEndpointCache]> = []
  let bytes = 0
  for (const [key, entry] of entries) {
    if (kept.length >= maxEntries) break
    const weight = graphqlEntryBytes(entry)
    if (kept.length > 0 && bytes + weight > maxBytes) break
    kept.push([key, entry])
    bytes += weight
  }
  return Object.fromEntries(kept)
}

function persist(byEndpoint: Record<string, GraphQLEndpointCache>): void {
  const payload: PersistedState = { version: 1, byEndpoint }
  debouncedSave('graphql', () => StoragePut(BUCKET, KEY, JSON.stringify(payload)))
}

export const useGraphqlCacheStore = create<GraphQLCacheState>((set, get) => ({
  byEndpoint: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return
    try {
      const raw = await StorageGet(BUCKET, KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState
        set({ byEndpoint: parsed.byEndpoint ?? {}, loaded: true })
        return
      }
    } catch (e) {
      console.error('Failed to load GraphQL cache:', e)
    }
    set({ loaded: true })
  },

  getEntry: (endpoint) => get().byEndpoint[normalizeKey(endpoint)],

  setSchema: (endpoint, schema) => {
    const key = normalizeKey(endpoint)
    if (!key) return
    set((s) => {
      const next = pruneGraphqlCache({
        ...s.byEndpoint,
        [key]: { ...s.byEndpoint[key], schema, updatedAt: new Date().toISOString() },
      })
      persist(next)
      return { byEndpoint: next }
    })
  },

  setVariables: (endpoint, variables) => {
    const key = normalizeKey(endpoint)
    if (!key) return
    set((s) => {
      const existing = s.byEndpoint[key]
      if (existing?.variables === variables) return s
      const next = pruneGraphqlCache({
        ...s.byEndpoint,
        [key]: { ...existing, variables, updatedAt: new Date().toISOString() },
      })
      persist(next)
      return { byEndpoint: next }
    })
  },

  clearSchema: (endpoint) => {
    const key = normalizeKey(endpoint)
    if (!key) return
    set((s) => {
      const existing = s.byEndpoint[key]
      if (!existing) return s
      const { schema: _omit, ...rest } = existing
      const next = { ...s.byEndpoint, [key]: { ...rest, updatedAt: new Date().toISOString() } }
      persist(next)
      return { byEndpoint: next }
    })
  },
}))

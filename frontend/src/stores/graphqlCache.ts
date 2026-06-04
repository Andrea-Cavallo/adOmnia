import { create } from 'zustand'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'

// Local-first cache of GraphQL introspection results and last-used query
// variables, keyed by endpoint URL. This lets a loaded schema and the variables
// the user typed survive tab close/reopen and app restart, without a re-fetch.
const BUCKET = 'graphql'
const KEY = 'introspection-cache-v1'
const MAX_ENTRIES = 40

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

function prune(byEndpoint: Record<string, GraphQLEndpointCache>): Record<string, GraphQLEndpointCache> {
  const entries = Object.entries(byEndpoint)
  if (entries.length <= MAX_ENTRIES) return byEndpoint
  const kept = entries
    .sort(([, a], [, b]) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, MAX_ENTRIES)
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
      const next = prune({
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
      const next = prune({
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

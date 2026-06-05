import { create } from 'zustand'
import { uid } from '@/lib/types'
import { safeSetItem } from '@/lib/safeLocalStorage'

export interface SchemaEntry {
  id: string
  name: string
  /** JSON Schema serialized as a JSON string. */
  schema: string
  description: string
}

const STORAGE_KEY = 'adomnia.schemas'

function loadSchemas(): SchemaEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(schemas: SchemaEntry[]): void {
  safeSetItem(STORAGE_KEY, JSON.stringify(schemas))
}

interface SchemasState {
  schemas: SchemaEntry[]
  addSchema: (entry: Omit<SchemaEntry, 'id'>) => SchemaEntry
  updateSchema: (id: string, patch: Partial<Omit<SchemaEntry, 'id'>>) => void
  removeSchema: (id: string) => void
}

export const useSchemasStore = create<SchemasState>((set, get) => ({
  schemas: loadSchemas(),

  addSchema: (entry) => {
    const created: SchemaEntry = { ...entry, id: uid() }
    const next = [...get().schemas, created]
    set({ schemas: next })
    persist(next)
    return created
  },

  updateSchema: (id, patch) => {
    const next = get().schemas.map((s) => (s.id === id ? { ...s, ...patch } : s))
    set({ schemas: next })
    persist(next)
  },

  removeSchema: (id) => {
    const next = get().schemas.filter((s) => s.id !== id)
    set({ schemas: next })
    persist(next)
  },
}))

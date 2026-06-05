import { create } from 'zustand'
import { uid } from '@/lib/types'
import { safeSetItem } from '@/lib/safeLocalStorage'
import type { VisualTest, TestBlock } from '@/lib/types'

const STORAGE_KEY = 'adomnia.visualTests'

function load(): VisualTest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(tests: VisualTest[]): void {
  safeSetItem(STORAGE_KEY, JSON.stringify(tests))
}

interface VisualTestsState {
  tests: VisualTest[]
  addTest: (name: string) => string
  updateTest: (id: string, patch: Partial<VisualTest>) => void
  removeTest: (id: string) => void
  addBlock: (testId: string, block: TestBlock) => void
  updateBlock: (testId: string, blockId: string, patch: Partial<TestBlock>) => void
  removeBlock: (testId: string, blockId: string) => void
  moveBlock: (testId: string, fromIdx: number, toIdx: number) => void
}

export const useVisualTestsStore = create<VisualTestsState>((set, get) => ({
  tests: load(),

  addTest: (name) => {
    const id = uid()
    const next: VisualTest[] = [...get().tests, { id, name, blocks: [], envId: null }]
    set({ tests: next })
    persist(next)
    return id
  },

  updateTest: (id, patch) => {
    const next = get().tests.map((t) => (t.id === id ? { ...t, ...patch } : t))
    set({ tests: next })
    persist(next)
  },

  removeTest: (id) => {
    const next = get().tests.filter((t) => t.id !== id)
    set({ tests: next })
    persist(next)
  },

  addBlock: (testId, block) => {
    const next = get().tests.map((t) => (t.id === testId ? { ...t, blocks: [...t.blocks, block] } : t))
    set({ tests: next })
    persist(next)
  },

  updateBlock: (testId, blockId, patch) => {
    const next = get().tests.map((t) =>
      t.id === testId
        ? { ...t, blocks: t.blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as TestBlock) : b)) }
        : t,
    )
    set({ tests: next })
    persist(next)
  },

  removeBlock: (testId, blockId) => {
    const next = get().tests.map((t) =>
      t.id === testId ? { ...t, blocks: t.blocks.filter((b) => b.id !== blockId) } : t,
    )
    set({ tests: next })
    persist(next)
  },

  moveBlock: (testId, fromIdx, toIdx) => {
    const next = get().tests.map((t) => {
      if (t.id !== testId) return t
      if (toIdx < 0 || toIdx >= t.blocks.length) return t
      const blocks = [...t.blocks]
      const [moved] = blocks.splice(fromIdx, 1)
      blocks.splice(toIdx, 0, moved)
      return { ...t, blocks }
    })
    set({ tests: next })
    persist(next)
  },
}))

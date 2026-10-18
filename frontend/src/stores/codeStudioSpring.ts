import { create } from 'zustand'
import type { SpringIndex, SpringMetadataReport } from '../../bindings/adomnia/internal/languages/java/models'
import { getSpringIndex, refreshSpringMetadata } from '@/lib/code-studio-api'

/** Stato dell'indice Spring di una sessione: l'indice è locale, i metadata solo su richiesta. */
export interface SpringState {
  index: SpringIndex | null
  refreshing: boolean
  /** Scansione degli jar della repository Maven locale (lavoro pesante). */
  indexingMetadata: boolean
  report: SpringMetadataReport | null
  error: string
  refreshedAt: string
}

const EMPTY: SpringState = { index: null, refreshing: false, indexingMetadata: false, report: null, error: '', refreshedAt: '' }

interface SpringStore {
  bySession: Record<string, SpringState>
  /** Rilegge l'indice dal filesystem del progetto. */
  refresh: (sessionId: string) => Promise<void>
  /** Indicizza i metadata di configurazione degli jar già scaricati (solo su richiesta). */
  refreshMetadata: (sessionId: string) => Promise<void>
  /** Dimentica l'indice di una sessione chiusa. */
  clear: (sessionId: string) => void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useSpringStore = create<SpringStore>((set, get) => {
  const patch = (sessionId: string, change: Partial<SpringState>) =>
    set((state) => ({ bySession: { ...state.bySession, [sessionId]: { ...(state.bySession[sessionId] ?? EMPTY), ...change } } }))
  return {
    bySession: {},
    refresh: async (sessionId) => {
      if (get().bySession[sessionId]?.refreshing) return
      patch(sessionId, { refreshing: true, error: '' })
      try {
        const index = await getSpringIndex(sessionId)
        patch(sessionId, { index, refreshing: false, refreshedAt: new Date().toISOString() })
      } catch (error) {
        patch(sessionId, { refreshing: false, error: message(error) })
      }
    },
    refreshMetadata: async (sessionId) => {
      if (get().bySession[sessionId]?.indexingMetadata) return
      patch(sessionId, { indexingMetadata: true, error: '' })
      try {
        const report = await refreshSpringMetadata(sessionId)
        patch(sessionId, { indexingMetadata: false, report })
        // I nuovi metadata cambiano le proprietà note: l'indice si rilegge.
        await get().refresh(sessionId)
      } catch (error) {
        patch(sessionId, { indexingMetadata: false, error: message(error) })
      }
    },
    clear: (sessionId) =>
      set((state) => {
        const bySession = { ...state.bySession }
        delete bySession[sessionId]
        return { bySession }
      }),
  }
})

/** Lo stato Spring di una sessione: mai `null`, così i consumatori non gestiscono il vuoto. */
export function springStateOf(sessionId: string): SpringState {
  return useSpringStore.getState().bySession[sessionId] ?? EMPTY
}

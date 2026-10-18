import { create } from 'zustand'
import { getJavaMainClasses } from '@/lib/code-studio-api'

/** Classi lanciabili decise da JDT LS (source "jdt"); con "scan" restano le regex del gutter (fallback). */
export interface JavaMains {
  classes: ReadonlySet<string>
  source: 'jdt' | 'scan'
  loadedAt: number
}

const TTL_MILLIS = 30_000
const loading = new Set<string>()

interface JavaMainsState {
  bySession: Record<string, JavaMains>
  refresh: (sessionId: string) => Promise<void>
}

export const useJavaMainsStore = create<JavaMainsState>((set, get) => ({
  bySession: {},
  refresh: async (sessionId) => {
    const current = get().bySession[sessionId]
    if (loading.has(sessionId) || (current && Date.now() - current.loadedAt < TTL_MILLIS)) return
    loading.add(sessionId)
    try {
      const found = await getJavaMainClasses(sessionId)
      const source = found.length > 0 && found.every((item) => item.source === 'jdt') ? 'jdt' : 'scan'
      set((state) => ({ bySession: { ...state.bySession, [sessionId]: { classes: new Set(found.map((item) => item.class)), source, loadedAt: Date.now() } } }))
    } catch {
      // senza risposta resta il fallback a regex: il gutter non deve rompersi
    } finally {
      loading.delete(sessionId)
    }
  },
}))

/** Le classi decise da JDT per la sessione, o null se non c'è (ancora) una risposta del server. */
export function jdtMainClasses(sessionId: string): ReadonlySet<string> | null {
  const mains = useJavaMainsStore.getState().bySession[sessionId]
  return mains?.source === 'jdt' ? mains.classes : null
}

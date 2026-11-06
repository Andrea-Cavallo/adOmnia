/**
 * External Libraries dei progetti Maven, per sessione: l'albero e il pom.xml (View source, Ctrl+click) leggono
 * lo stesso elenco. Si carica alla prima richiesta e si rilegge quando un pom cambia o dopo un download.
 */
import { create } from 'zustand'
import { listJavaLibraries, type JavaLibraries } from '@/lib/code-studio-api'

export interface JavaLibrariesState {
  result: JavaLibraries | null
  loading: boolean
  error: string
}

const IDLE: JavaLibrariesState = { result: null, loading: false, error: '' }

interface JavaLibrariesStore {
  bySession: Record<string, JavaLibrariesState>
  /** Carica l'elenco; con force rilegge anche se già noto. Ritorna l'elenco, o null se non si è potuto leggere. */
  load: (sessionId: string, force?: boolean) => Promise<JavaLibraries | null>
  forget: (sessionId: string) => void
}

const inFlight = new Map<string, Promise<JavaLibraries | null>>()

export const useJavaLibrariesStore = create<JavaLibrariesStore>((set, get) => {
  const patch = (sessionId: string, change: Partial<JavaLibrariesState>) => set((state) => ({
    bySession: { ...state.bySession, [sessionId]: { ...(state.bySession[sessionId] ?? IDLE), ...change } },
  }))
  return {
    bySession: {},
    load: (sessionId, force = false) => {
      const known = get().bySession[sessionId]?.result
      if (known && !force) return Promise.resolve(known)
      const running = inFlight.get(sessionId)
      if (running) return running
      patch(sessionId, { loading: true, error: '' })
      const request = Promise.resolve(listJavaLibraries(sessionId))
        .then((result) => { patch(sessionId, { result, loading: false }); return result })
        .catch((reason: unknown) => { patch(sessionId, { loading: false, error: reason instanceof Error ? reason.message : String(reason) }); return null })
        .finally(() => inFlight.delete(sessionId))
      inFlight.set(sessionId, request)
      return request
    },
    forget: (sessionId) => set((state) => {
      const { [sessionId]: _gone, ...rest } = state.bySession
      return { bySession: rest }
    }),
  }
})

export const javaLibrariesOf = (sessionId: string): JavaLibrariesState => useJavaLibrariesStore.getState().bySession[sessionId] ?? IDLE

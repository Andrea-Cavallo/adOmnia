import { create } from 'zustand'
import { Events } from '@wailsio/runtime'
import { checkDevContextStale, getDevContext, rescanDevContext, type DevSnapshot } from '@/lib/devcontext-api'
import { useGoIDEStore } from '@/stores/goide'

interface DevContextState {
  snapshots: Record<string, DevSnapshot>
  errors: Record<string, string>
  /** Load once per session; later updates arrive through `devcontext:changed`. */
  ensure: (sessionId: string) => Promise<void>
  load: (sessionId: string) => Promise<void>
  rescan: (sessionId: string) => Promise<void>
  checkStale: (sessionId: string) => Promise<void>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const useDevContextStore = create<DevContextState>((set, get) => {
  const store = (sessionId: string, snapshot: DevSnapshot) => set((s) => {
    const { [sessionId]: _dropped, ...errors } = s.errors
    return { snapshots: { ...s.snapshots, [sessionId]: snapshot }, errors }
  })
  const fail = (sessionId: string, error: unknown) => set((s) => ({ errors: { ...s.errors, [sessionId]: message(error) } }))
  return {
    snapshots: {},
    errors: {},
    ensure: async (sessionId) => {
      if (!get().snapshots[sessionId]) await get().load(sessionId)
    },
    load: async (sessionId) => {
      try { store(sessionId, await getDevContext(sessionId)) } catch (error) { fail(sessionId, error) }
    },
    rescan: async (sessionId) => {
      try { store(sessionId, await rescanDevContext(sessionId)) } catch (error) { fail(sessionId, error) }
    },
    checkStale: async (sessionId) => {
      if (!get().snapshots[sessionId]) return
      try { await checkDevContextStale(sessionId) } catch (error) { fail(sessionId, error) }
    },
  }
})

/** Keep snapshots fresh: backend change events plus a stale check on window focus. */
export function startDevContextSync(): () => void {
  const offChanged = Events.On('devcontext:changed', (event) => {
    const { sessionId } = (event.data ?? {}) as { sessionId?: string }
    if (sessionId && useDevContextStore.getState().snapshots[sessionId]) void useDevContextStore.getState().load(sessionId)
  })
  const onFocus = () => {
    const sessionId = useGoIDEStore.getState().activeSessionId
    if (sessionId) void useDevContextStore.getState().checkStale(sessionId)
  }
  window.addEventListener('focus', onFocus)
  return () => {
    offChanged()
    window.removeEventListener('focus', onFocus)
  }
}

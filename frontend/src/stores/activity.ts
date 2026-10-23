import { create } from 'zustand'
export type ActivityPhase = 'Active' | 'Background' | 'Idle' | 'Suspended'
export type PollKind = 'status' | 'decorative' | 'live'
export const IDLE_AFTER_MS = 5 * 60_000
interface ActivityStore {
  phase: ActivityPhase
  scopes: readonly string[]
  retained: Readonly<Record<string, number>>
  setPhase: (phase: ActivityPhase) => void
  setScopes: (scopes: string[]) => void
  retain: (scope: string) => () => void
}
export const useActivityStore = create<ActivityStore>((set, get) => ({
  phase: 'Active', scopes: [], retained: {},
  setPhase: phase => { if (phase !== get().phase) set({ phase }) },
  setScopes: scopes => {
    const next = [...new Set(scopes)].sort((a, b) => a.localeCompare(b))
    if (next.join('\0') !== get().scopes.join('\0')) set({ scopes: next })
  },
  retain: scope => {
    set(state => ({ retained: { ...state.retained, [scope]: (state.retained[scope] ?? 0) + 1 } }))
    let released = false
    return () => {
      if (released) return
      released = true
      set(state => {
        const retained = { ...state.retained }
        if (retained[scope] > 1) retained[scope]--
        else delete retained[scope]
        return { retained }
      })
    }
  },
}))
export function scopedPhase(state: Pick<ActivityStore, 'phase' | 'scopes'>, scope?: string): ActivityPhase {
  return scope && !state.scopes.includes(scope) ? 'Background' : state.phase
}
export function currentActivityPhase(scope?: string): ActivityPhase {
  if (typeof document !== 'undefined' && document.hidden) return 'Background'
  return scopedPhase(useActivityStore.getState(), scope)
}
// Live status belongs to an intentional operation: only its UI visibility gate
// applies. No policy here cancels work or releases a backend resource.
export function pollingDelay(interval: number, phase: ActivityPhase, kind: PollKind = 'status'): number | null {
  if (phase === 'Background' || phase === 'Suspended') return null
  if (phase === 'Idle' && kind === 'decorative') return null
  return phase === 'Idle' && kind !== 'live' ? Math.max(15_000, interval * 5) : interval
}

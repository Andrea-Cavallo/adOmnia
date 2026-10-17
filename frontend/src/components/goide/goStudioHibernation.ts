import { create } from 'zustand'
import { useActivityStore, IDLE_AFTER_MS } from '@/stores/activity'
import { useGoIDEStore } from '@/stores/goide'
import { createHibernationController } from '@/lib/goide/hibernation'
import { releaseDormantModels } from './goStudioModelUri'

// Runtime only: tabs, buffers and recovery remain owned by the document store.
export const useGoStudioHibernation = create<{ sleeping: Readonly<Record<string, boolean>> }>(() => ({ sleeping: {} }))

export function releaseSleepingSessionModels(id: string): void {
  if (useGoStudioHibernation.getState().sleeping[id]) {
    releaseDormantModels(useGoIDEStore.getState().documents.filter(doc => doc.document.sessionId === id))
  }
}

let started = false
export function startGoStudioHibernation(): void {
  if (started) return
  started = true
  const controller = createHibernationController(id => {
    useGoStudioHibernation.setState(state => ({ sleeping: { ...state.sleeping, [id]: true } }))
    // Wait until React has detached editors; attached/dirty/undo-bearing models are protected.
    setTimeout(() => releaseSleepingSessionModels(id), 0)
  }, id => {
    useGoStudioHibernation.setState(state => {
      const sleeping = { ...state.sleeping }; delete sleeping[id]
      return { sleeping }
    })
  }, IDLE_AFTER_MS)
  const reconcile = () => {
    const activity = useActivityStore.getState()
    const ids = [...new Set(useGoIDEStore.getState().documents.map(doc => doc.document.sessionId))]
    // A visible, idle editor remains painted. Background projects/windows can unmount.
    const awake = new Set(activity.phase === 'Background' ? [] : activity.scopes.filter(scope => scope.startsWith('goide:')).map(scope => scope.slice(6)))
    controller.reconcile(ids, awake)
  }
  useActivityStore.subscribe(reconcile)
  useGoIDEStore.subscribe((state, previous) => { if (state.documents !== previous.documents) reconcile() })
  reconcile()
}

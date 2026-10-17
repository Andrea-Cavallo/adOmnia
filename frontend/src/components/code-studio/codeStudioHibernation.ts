import { create } from 'zustand'
import { useActivityStore, IDLE_AFTER_MS } from '@/stores/activity'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { createHibernationController } from '@/lib/code-studio/hibernation'
import { releaseDormantModels } from './codeStudioModelUri'

// Runtime only: tabs, buffers and recovery remain owned by the document store.
export const useCodeStudioHibernation = create<{ sleeping: Readonly<Record<string, boolean>> }>(() => ({ sleeping: {} }))

export function releaseSleepingSessionModels(id: string): void {
  if (useCodeStudioHibernation.getState().sleeping[id]) {
    releaseDormantModels(useCodeStudioStore.getState().documents.filter(doc => doc.document.sessionId === id))
  }
}

let started = false
export function startCodeStudioHibernation(): void {
  if (started) return
  started = true
  const controller = createHibernationController(id => {
    useCodeStudioHibernation.setState(state => ({ sleeping: { ...state.sleeping, [id]: true } }))
    // Wait until React has detached editors; attached/dirty/undo-bearing models are protected.
    setTimeout(() => releaseSleepingSessionModels(id), 0)
  }, id => {
    useCodeStudioHibernation.setState(state => {
      const sleeping = { ...state.sleeping }; delete sleeping[id]
      return { sleeping }
    })
  }, IDLE_AFTER_MS)
  const reconcile = () => {
    const activity = useActivityStore.getState()
    const ids = [...new Set(useCodeStudioStore.getState().documents.map(doc => doc.document.sessionId))]
    // A visible, idle editor remains painted. Background projects/windows can unmount.
    const awake = new Set(activity.phase === 'Background' ? [] : activity.scopes.filter(scope => scope.startsWith('code-studio:')).map(scope => scope.slice('code-studio:'.length)))
    controller.reconcile(ids, awake)
  }
  useActivityStore.subscribe(reconcile)
  useCodeStudioStore.subscribe((state, previous) => { if (state.documents !== previous.documents) reconcile() })
  reconcile()
}

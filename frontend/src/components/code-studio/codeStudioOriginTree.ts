import { create } from 'zustand'
import { useCodeStudioStore } from '@/stores/codeStudio'
export const useOriginTreeReveal = create<{
  sessionId: string
  path: string
  epoch: number
}>(() => ({ sessionId: '', path: '', epoch: 0 }))
export function revealSymbolOrigin(sessionId: string, path: string): void {
  const store = useCodeStudioStore.getState()
  if (store.activeSessionId !== sessionId) return
  store.updateLayout({ projectOpen: true })
  useOriginTreeReveal.setState((state) => ({
    sessionId,
    path,
    epoch: state.epoch + 1,
  }))
}

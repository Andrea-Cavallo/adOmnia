import { useEffect } from 'react'
import { scopedPhase, useActivityStore } from '@/stores/activity'
export function useActivityPhase(scope?: string) { return useActivityStore(state => scopedPhase(state, scope)) }
export function useActivityScope(scope: string | null, visible: boolean): void {
  useEffect(() => {
    if (!scope || !visible) return
    return useActivityStore.getState().retain(scope)
  }, [scope, visible])
}

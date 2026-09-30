import { useEffect, useState } from 'react'
import { useDevSessionStore } from '@/stores/devSession'
import { findRoute, type RouteMatch } from './routeMatch'

/**
 * The Go handler that serves a request, from the Developer Context of the
 * open gO projects. Loaded lazily: the API workspace never pulls Go Studio
 * into its own bundle.
 */
export function useRouteForRequest(method: string, resolvedUrl: string, preferGoSessionId?: string): RouteMatch | null {
  const [match, setMatch] = useState<RouteMatch | null>(null)
  useEffect(() => {
    if (!resolvedUrl) {
      setMatch(null)
      return
    }
    let cancelled = false
    let unsubscribe = () => {}
    void Promise.all([import('@/stores/devcontext'), import('@/stores/goide')]).then(([{ useDevContextStore }, { useGoIDEStore }]) => {
      if (cancelled) return
      const live = Object.values(useDevSessionStore.getState().sessions).map((session) => session.goSessionId)
      const open = useGoIDEStore.getState().sessions.map((session) => session.id)
      for (const id of new Set([...open, ...live])) void useDevContextStore.getState().ensure(id)
      const compute = () => { if (!cancelled) setMatch(findRoute(useDevContextStore.getState().snapshots, method, resolvedUrl, preferGoSessionId)) }
      compute()
      unsubscribe = useDevContextStore.subscribe(compute)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [method, resolvedUrl, preferGoSessionId])
  return match
}

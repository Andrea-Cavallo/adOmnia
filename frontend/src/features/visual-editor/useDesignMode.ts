import { lazy, useCallback, useEffect, useState } from 'react'
import type { DesignSession } from './adapters/design-session'

/**
 * Entry point of the Visual Editor (Design Mode) for the Live Preview. This module is the only
 * one the preview imports statically, and it stays tiny: the engine, the parser and the panel
 * are loaded the first time Design Mode is turned on.
 */

/** Id of the element the selection layer measures against (the engine looks it up by this id). */
export const DESIGN_CONTAINER_ID = 'canvas-container'

export const DesignCanvas = lazy(() => import('./ui/DesignCanvas'))
export const DesignPanel = lazy(() => import('./ui/DesignPanel'))

const loadSessions = () => import('./adapters/design-session')

export interface DesignMode {
  /** The design session while Design Mode is on for this Code Studio session. */
  session: DesignSession | null
  starting: boolean
  error: string | null
  start: () => void
  stop: () => void
  /** Connects the editor to the page the preview iframe just loaded. */
  attach: (iframe: HTMLIFrameElement, origin: string, reload: () => void) => void
}

/**
 * Design Mode of one Code Studio session. The session state is keyed by `sessionId`: switching
 * project never shows another project's selection, and leaving the preview releases the engine,
 * the element index and the page connection.
 */
export function useDesignMode(sessionId: string, root: string): DesignMode {
  const [active, setActive] = useState<{ sessionId: string; session: DesignSession } | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = active?.sessionId === sessionId ? active.session : null

  useEffect(() => () => {
    void loadSessions().then((module) => module.disposeDesignSession(sessionId))
  }, [sessionId])

  const start = useCallback(() => {
    setStarting(true)
    setError(null)
    loadSessions().then((module) => {
      const next = module.designSession(sessionId, root)
      setActive({ sessionId, session: next })
      void next.prepare()
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => setStarting(false))
  }, [root, sessionId])

  const stop = useCallback(() => {
    session?.detach()
    setActive(null)
  }, [session])

  const attach = useCallback((iframe: HTMLIFrameElement, origin: string, reload: () => void) => {
    session?.attach(iframe, origin, reload)
  }, [session])

  return { session, starting, error, start, stop, attach }
}

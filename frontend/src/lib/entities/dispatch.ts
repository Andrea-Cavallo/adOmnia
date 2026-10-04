import { useEffect, useRef } from 'react'
import { showModule } from '@/lib/moduleRouting'
import type { RailItem } from '@/stores/app'
import { showEntityNotice } from './notice'
import type { EntityRef } from './types'

export const ENTITY_HANDOFF_EVENT = 'adomnia:entity-handoff'

/**
 * Show a panel and deliver an event once it is mounted, in the window where the panel lives: the
 * event is re-dispatched every frame until a listener sets detail.handled, for at most 5 s.
 */
export function dispatchToPanel(rail: RailItem, eventName: string, detail: Record<string, unknown> = {}, onTimeout?: () => void): void {
  showModule(rail, { kind: 'dispatch', eventName, detail }, onTimeout)
}

export function handoffToPanel(rail: RailItem, ref: EntityRef, intent: string, payload: Record<string, unknown> = {}): void {
  dispatchToPanel(rail, ENTITY_HANDOFF_EVENT, { rail, ref, intent, payload }, () => {
    showEntityNotice(`The ${rail} panel did not accept ${ref.label} in time. Try again once it has loaded.`)
  })
}

/**
 * Receive entity handoffs for `rail`. Return false while the panel is not
 * ready (e.g. still hydrating) and the handoff is retried next frame.
 */
export function useEntityHandoff(
  rail: RailItem,
  handler: (ref: EntityRef, intent: string, payload: Record<string, unknown>) => boolean | void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ rail: RailItem; ref: EntityRef; intent: string; payload: Record<string, unknown>; handled: boolean }>).detail
      if (!detail || detail.rail !== rail || detail.handled) return
      if (handlerRef.current(detail.ref, detail.intent, detail.payload ?? {}) !== false) detail.handled = true
    }
    document.addEventListener(ENTITY_HANDOFF_EVENT, listener)
    return () => document.removeEventListener(ENTITY_HANDOFF_EVENT, listener)
  }, [rail])
}

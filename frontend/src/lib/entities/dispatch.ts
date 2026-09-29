import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app'
import type { RailItem } from '@/stores/app'
import { showEntityNotice } from './notice'
import type { EntityRef } from './types'

export const ENTITY_HANDOFF_EVENT = 'adomnia:entity-handoff'

const HANDOFF_TIMEOUT_MS = 5000

/**
 * Switch to a panel and deliver an event once it is mounted: the event is
 * re-dispatched every frame until a listener sets detail.handled, for at most
 * 5 s of wall time (frame caps expire early on high refresh-rate displays).
 */
export function dispatchToPanel(rail: RailItem, eventName: string, detail: Record<string, unknown> = {}, onTimeout?: () => void): void {
  useAppStore.getState().setActiveRail(rail)
  const deadline = performance.now() + HANDOFF_TIMEOUT_MS
  const dispatchWhenMounted = () => {
    if (useAppStore.getState().activeRail !== rail) return
    const eventDetail = { ...detail, handled: false }
    document.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }))
    if (eventDetail.handled) return
    if (performance.now() < deadline) window.requestAnimationFrame(dispatchWhenMounted)
    else onTimeout?.()
  }
  window.requestAnimationFrame(dispatchWhenMounted)
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

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app'
import type { RailItem } from '@/stores/app'
import type { EntityRef } from './types'

export const ENTITY_HANDOFF_EVENT = 'adomnia:entity-handoff'

/**
 * Switch to a panel and deliver an event once it is mounted: the event is
 * re-dispatched every frame (max ~2s) until a listener sets detail.handled.
 */
export function dispatchToPanel(rail: RailItem, eventName: string, detail: Record<string, unknown> = {}): void {
  useAppStore.getState().setActiveRail(rail)
  let attempts = 0
  const dispatchWhenMounted = () => {
    if (useAppStore.getState().activeRail !== rail) return
    const eventDetail = { ...detail, handled: false }
    document.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }))
    if (!eventDetail.handled && attempts < 120) {
      attempts += 1
      window.requestAnimationFrame(dispatchWhenMounted)
    }
  }
  window.requestAnimationFrame(dispatchWhenMounted)
}

export function handoffToPanel(rail: RailItem, ref: EntityRef, intent: string, payload: Record<string, unknown> = {}): void {
  dispatchToPanel(rail, ENTITY_HANDOFF_EVENT, { rail, ref, intent, payload })
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

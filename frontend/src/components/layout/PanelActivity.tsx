import { createContext, useContext, useRef } from 'react'

/**
 * Kept-alive panels (API Workspace, Go Studio) stay mounted while hidden so
 * switching tools never loses state. Their window-level shortcuts must only
 * fire while visible: they read this context.
 */
export const PanelActiveContext = createContext(true)

export function usePanelActive(): boolean {
  return useContext(PanelActiveContext)
}

/** Ref form for event listeners registered once. */
export function usePanelActiveRef(): { readonly current: boolean } {
  const active = usePanelActive()
  const ref = useRef(active)
  ref.current = active
  return ref
}

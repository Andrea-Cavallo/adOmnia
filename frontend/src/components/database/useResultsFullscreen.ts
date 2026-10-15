import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'

interface ResultsFullscreen<T extends HTMLElement> {
  expanded: boolean
  toggle: () => void
  /** Sul contenitore dei risultati: serve al controllo "pannello a fuoco". */
  containerRef: RefObject<T | null>
  /** Da spalmare sul contenitore: registra l'ultimo click dentro il pannello. */
  focusProps: { onMouseDownCapture: (event: ReactMouseEvent<HTMLElement>) => void }
}

/**
 * Schermo intero dei risultati (DB-1.5): copre tutta la finestra (`fixed inset-0`),
 * Esc esce, Ctrl+Shift+F commuta. La scorciatoia vale solo quando il pannello
 * Database è a fuoco (elemento attivo o ultimo click dentro il contenitore),
 * così non ruba Ctrl+Shift+F alle altre viste.
 */
export function useResultsFullscreen<T extends HTMLElement = HTMLElement>(): ResultsFullscreen<T> {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<T | null>(null)
  const lastPointer = useRef<EventTarget | null>(null)

  const focused = useCallback(() => {
    const root = containerRef.current
    if (!root) return false
    if (root.contains(document.activeElement)) return true
    return Boolean(lastPointer.current && root.contains(lastPointer.current as Node))
  }, [])

  const toggle = useCallback(() => setExpanded((value) => !value), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded && focused()) {
        event.preventDefault()
        setExpanded(false)
        return
      }
      if (event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f' && focused()) {
        event.preventDefault()
        setExpanded((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, focused])

  const focusProps = {
    onMouseDownCapture: (event: ReactMouseEvent<HTMLElement>) => {
      lastPointer.current = event.target
    },
  }

  return { expanded, toggle, containerRef, focusProps }
}

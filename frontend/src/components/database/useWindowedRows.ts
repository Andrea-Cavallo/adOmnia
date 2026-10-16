import { useCallback, useEffect, useRef, useState } from 'react'

interface WindowedRowsOptions {
  enabled?: boolean
  /** Righe extra sopra e sotto la finestra visibile, per non vedere buchi scrollando. */
  overscan?: number
}

export interface WindowedRows<T> {
  /** Le sole righe da renderizzare. */
  rows: T[]
  /** Indice della prima riga resa (per la numerazione progressiva). */
  start: number
  /** Spaziatori da mettere come righe vuote della tabella, sopra e sotto. */
  paddingTop: number
  paddingBottom: number
  /** Da mettere sul contenitore con lo scroll verticale. */
  scrollRef: (node: HTMLElement | null) => void
}

export interface WindowedRange {
  start: number
  end: number
  paddingTop: number
  paddingBottom: number
}

/** Finestra di righe da rendere, in funzione della posizione di scroll. */
export function windowedRange(total: number, rowHeight: number, scrollTop: number, viewport: number, overscan = 12): WindowedRange {
  const visibleCount = Math.ceil((viewport || 600) / rowHeight) + overscan * 2
  const start = total === 0 ? 0 : Math.max(0, Math.min(Math.floor(scrollTop / rowHeight) - overscan, total - 1))
  const end = Math.min(total, start + visibleCount)
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (total - end) * rowHeight),
  }
}

/**
 * Virtualizzazione delle righe senza librerie (DB-1.6): altezza fissa, finestra
 * calcolata da `scrollTop`, spaziatori sopra e sotto. Serve a rendere subito le
 * 5000 righe caricate a schermo intero senza appesantire le pagine piccole.
 */
export function useWindowedRows<T>(allRows: readonly T[], rowHeight: number, options: WindowedRowsOptions = {}): WindowedRows<T> {
  const { enabled = true, overscan = 12 } = options
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  const nodeRef = useRef<HTMLElement | null>(null)

  const scrollRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node
    setViewport(node?.clientHeight ?? 0)
    setScrollTop(node?.scrollTop ?? 0)
  }, [])

  useEffect(() => {
    const node = nodeRef.current
    if (!node || !enabled) return
    const onScroll = () => setScrollTop(node.scrollTop)
    const measure = () => setViewport(node.clientHeight)
    node.addEventListener('scroll', onScroll, { passive: true })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [enabled])

  if (!enabled) {
    return { rows: allRows.slice(), start: 0, paddingTop: 0, paddingBottom: 0, scrollRef }
  }
  const range = windowedRange(allRows.length, rowHeight, scrollTop, viewport, overscan)
  return {
    rows: allRows.slice(range.start, range.end),
    start: range.start,
    paddingTop: range.paddingTop,
    paddingBottom: range.paddingBottom,
    scrollRef,
  }
}

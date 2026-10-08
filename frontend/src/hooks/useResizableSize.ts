import { useCallback, useEffect, useRef, useState } from 'react'

export interface ResizableSizeOptions {
  /** localStorage key; the size survives restarts. */
  storageKey: string
  defaultSize: number
  min: number
  /** Largest share of the window the pane may take (0–1). */
  maxRatio: number
  /** `x` for columns (width), `y` for stacked panes (height). */
  axis?: 'x' | 'y'
  /** -1 when the handle sits before the pane (right column, bottom pane): dragging toward the pane shrinks it. */
  direction?: 1 | -1
}

/** Clamps a size between `min` and `maxRatio` of the window, never below `min`. */
export function clampSize(size: number, min: number, maxRatio: number, viewport: number): number {
  return Math.round(Math.max(min, Math.min(size, Math.max(min, viewport * maxRatio))))
}

function load(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(key))
    return Number.isFinite(stored) && stored > 0 ? stored : fallback
  } catch {
    return fallback
  }
}

/**
 * A pane size dragged through a ResizeHandle, persisted per key and re-clamped
 * when the window shrinks. Pass `startResize` to the handle's onMouseDown.
 */
export function useResizableSize({ storageKey, defaultSize, min, maxRatio, axis = 'x', direction = 1 }: ResizableSizeOptions) {
  const viewport = () => (axis === 'x' ? window.innerWidth : window.innerHeight)
  const [size, setSize] = useState(() => clampSize(load(storageKey, defaultSize), min, maxRatio, viewport()))
  const sizeRef = useRef(size)
  sizeRef.current = size

  useEffect(() => {
    const onResize = () => setSize((current) => clampSize(current, min, maxRatio, viewport()))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, maxRatio, axis])

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const start = axis === 'x' ? event.clientX : event.clientY
    const startSize = sizeRef.current
    const move = (moveEvent: MouseEvent) => {
      const position = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
      setSize(clampSize(startSize + (position - start) * direction, min, maxRatio, viewport()))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { localStorage.setItem(storageKey, String(sizeRef.current)) } catch { /* per-viewer convenience only */ }
    }
    document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, direction, min, maxRatio, storageKey])

  return { size, startResize }
}

import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { ResizeHandleInteraction } from '@/components/ui/ResizeHandle'

export type FunctionExplorerSide = 'left' | 'right'

const DOCK_KEY = 'adomnia.codestudio.functionExplorer.dock'
const DEFAULT_WIDTH = 560
const MIN_WIDTH = 360

interface Dock {
  side: FunctionExplorerSide
  width: number
}

function readDock(): Dock {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DOCK_KEY) ?? '{}')
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return {
      side: record.side === 'left' ? 'left' : 'right',
      width: typeof record.width === 'number' && Number.isFinite(record.width) ? Math.max(MIN_WIDTH, record.width) : DEFAULT_WIDTH,
    }
  } catch {
    return { side: 'right', width: DEFAULT_WIDTH }
  }
}

function writeDock(dock: Dock) {
  try { localStorage.setItem(DOCK_KEY, JSON.stringify(dock)) } catch { /* Per-viewer convenience: the dock stays usable in memory. */ }
}

/** Keep at least ~40% of the workspace for the editor, whatever side the explorer sits on. */
function clampWidth(width: number, element: Element | null) {
  const total = element?.closest('.grid')?.getBoundingClientRect().width ?? window.innerWidth
  return Math.round(Math.min(Math.max(MIN_WIDTH, width), Math.max(MIN_WIDTH, total * 0.6)))
}

/** Side and width of the docked Function Explorer, saved per viewer like the other tool positions. */
export function useFunctionExplorerDock() {
  const [dock, setDock] = useState(readDock)
  const update = useCallback((patch: Partial<Dock>) => {
    setDock((current) => {
      const next = { ...current, ...patch }
      writeDock(next)
      return next
    })
  }, [])
  // Dragging toward the editor widens the pane: the sign depends on the side.
  const direction = dock.side === 'right' ? -1 : 1
  const resize: ResizeHandleInteraction = {
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const handle = event.currentTarget
      const start = event.clientX
      const initial = dock.width
      const onMove = (move: MouseEvent) => update({ width: clampWidth(initial + (move.clientX - start) * direction, handle) })
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    onArrow: (delta, event) => update({ width: clampWidth(dock.width + delta * direction, event.currentTarget) }),
    onDoubleClick: (event) => update({ width: clampWidth(DEFAULT_WIDTH, event.currentTarget) }),
  }
  return { side: dock.side, width: dock.width, setSide: (side: FunctionExplorerSide) => update({ side }), resize }
}

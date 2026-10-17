import type { CSSProperties } from 'react'
import type { ToolPlacement } from './studioToolState'

interface ToolPane {
  id: string
  key: string
  position: ToolPlacement
  open: boolean
  detached?: boolean
  width: number
}

/** Detached views reserve no track. Keep their mounted containers hidden so owner state survives. */
export function studioToolLayout(panes: ToolPane[], maximized: string | null, bottomHeight: number) {
  const docked = panes.filter((pane) => pane.open && !pane.detached)
  const focused = docked.find((pane) => pane.key === maximized)
  const shown = docked.filter((pane) => !focused || focused.id === pane.id)
  const left = shown.filter((pane) => pane.position === 'left')
  const right = shown.filter((pane) => pane.position === 'right')
  const bottom = shown.filter((pane) => pane.position === 'bottom')
  const centerColumns = Math.max(1, bottom.length)
  const columns = left.length + centerColumns + right.length
  const styleFor = (id: string): CSSProperties => {
    const pane = shown.find((item) => item.id === id)
    if (!pane) return { display: 'none' }
    if (focused) return { gridColumn: '1 / -1', gridRow: 1 }
    const atLeft = left.findIndex((item) => item.id === id)
    const atRight = right.findIndex((item) => item.id === id)
    if (atLeft >= 0) return { gridColumn: atLeft + 1, gridRow: 1 }
    if (atRight >= 0) return { gridColumn: left.length + centerColumns + atRight + 1, gridRow: 1 }
    const index = bottom.findIndex((item) => item.id === id)
    return { gridColumn: `${Math.floor(index * columns / bottom.length) + 1} / ${Math.floor((index + 1) * columns / bottom.length) + 1}`, gridRow: 2 }
  }
  const gridStyle: CSSProperties = focused ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' } : {
    gridTemplateColumns: [...left.map((pane) => `${pane.width}px`), ...Array(centerColumns).fill('minmax(0, 1fr)'), ...right.map((pane) => `${pane.width}px`)].join(' '),
    gridTemplateRows: bottom.length ? `minmax(140px, 1fr) minmax(100px, min(${bottomHeight}px, calc(100% - 140px)))` : 'minmax(0, 1fr)',
  }
  return { focused, left, centerColumns, gridStyle, styleFor }
}

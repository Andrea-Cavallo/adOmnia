import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

const MIN_COLUMN_WIDTH = 60

export interface ColumnWidths {
  /** Larghezza impostata dall'utente, o `undefined` se la colonna è ancora automatica. */
  widthOf: (column: string) => number | undefined
  /** Maniglia sul bordo destro dell'intestazione: trascina per ridimensionare, doppio click resetta. */
  gripProps: (column: string) => {
    onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void
  }
}

/**
 * Larghezze colonne delle griglie database (DB-1.7), in stato locale per nome di
 * colonna: resta la larghezza automatica finché non si trascina la maniglia.
 */
export function useColumnWidths(): ColumnWidths {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const drag = useRef<{ column: string; startX: number; startWidth: number } | null>(null)

  const gripProps = useCallback((column: string) => ({
    onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const header = event.currentTarget.parentElement
      const startWidth = header?.getBoundingClientRect().width ?? 120
      drag.current = { column, startX: event.clientX, startWidth }
      const onMove = (move: MouseEvent) => {
        const current = drag.current
        if (!current) return
        const width = Math.max(MIN_COLUMN_WIDTH, current.startWidth + (move.clientX - current.startX))
        setWidths((state) => ({ ...state, [current.column]: width }))
      }
      const onUp = () => {
        drag.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setWidths((state) => {
        const { [column]: _dropped, ...rest } = state
        return rest
      })
    },
  }), [])

  return { widthOf: (column) => widths[column], gripProps }
}

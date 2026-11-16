import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { observer } from 'mobx-react-lite'
import { GestureScreen } from '@ve-client/app/project/[id]/_components/canvas/frame/gesture'
import { Overlay } from '@ve-client/app/project/[id]/_components/canvas/overlay'
import { EditorEngineContext } from '@ve-client/components/store/editor'
import { getRelativeMousePositionToFrameView } from '@ve-client/components/store/editor/overlay/utils'
import type { DesignSession } from '../adapters/design-session'

interface DesignCanvasProps {
  session: DesignSession
  /** Scrolls the page inside the preview: the selection layer covers it, so the wheel is forwarded. */
  onScroll: (dx: number, dy: number) => void
}

/**
 * The selection layer of Design Mode, laid over the Live Preview iframe: the transplanted
 * gesture screen (hover, select, draw-to-insert) and overlay (outlines, resize handles,
 * measurements), plus drag-to-reorder, keyboard shortcuts and wheel forwarding.
 */
const DesignCanvas = observer(function DesignCanvas({ session, onScroll }: DesignCanvasProps) {
  const { engine, frame } = session
  const root = useRef<HTMLDivElement>(null)
  const refresh = useRef<number | null>(null)

  useEffect(() => () => { if (refresh.current !== null) window.clearTimeout(refresh.current) }, [])

  const position = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const view = engine.frames.get(frame.id)?.view
    return view ? getRelativeMousePositionToFrameView(event, view) : { x: 0, y: 0 }
  }, [engine, frame.id])

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    onScroll(event.deltaX, event.deltaY)
    engine.overlay.state.removeHoverRect()
    // The page scrolls asynchronously: re-measure the selection once it settles.
    if (refresh.current !== null) window.clearTimeout(refresh.current)
    refresh.current = window.setTimeout(() => { void engine.overlay.refresh() }, 60)
  }

  // Drag to reorder: press on the selected element, then move. The move manager decides when a
  // press becomes a drag (distance and delay) and writes the new position on release.
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    root.current?.focus({ preventScroll: true })
    if (event.button !== 0 || engine.state.insertMode || !session.support?.structure) return
    const selected = engine.elements.selected[0]
    const hovered = engine.elements.hovered
    const data = engine.frames.get(frame.id)
    if (!selected || !data || hovered?.domId !== selected.domId) return
    engine.move.startDragPreparation(selected, position(event), data)
  }

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (engine.move.state && event.buttons === 1) void engine.move.drag(event, position)
  }

  const endDrag = (event: MouseEvent<HTMLDivElement>) => {
    // end() also covers a press that never became a drag: it releases the element in the page.
    if (engine.move.state) void engine.move.end(event)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    const handled = (() => {
      if (mod && key === 'z') return event.shiftKey ? session.redo() : session.undo()
      if (mod && key === 'y') return session.redo()
      if (mod && key === 'd') return session.support?.structure ? engine.copy.duplicate() : null
      if (key === 'delete' || key === 'backspace') return session.support?.structure ? engine.elements.delete() : null
      if (key === 'escape') {
        engine.state.insertMode = null
        engine.clearUI()
        return true
      }
      if (key === 'enter') return session.openSource(engine.elements.selected[0]?.instanceId ?? engine.elements.selected[0]?.oid) ?? true
      return undefined
    })()
    if (handled === undefined) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <EditorEngineContext.Provider value={engine}>
      <div
        ref={root}
        tabIndex={0}
        role="application"
        aria-label="Design Mode canvas: click to select an element, double-click to open its source"
        className={`absolute inset-0 outline-none ${session.interact ? 'pointer-events-none' : ''}`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onKeyDown={onKeyDown}
      >
        {!session.interact && <GestureScreen frame={frame} isResizing={false} />}
        <Overlay />
      </div>
    </EditorEngineContext.Provider>
  )
})

export default DesignCanvas

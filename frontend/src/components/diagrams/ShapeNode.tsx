/**
 * Every diagram node: the outline from the shape catalog, its text (label, subtitle, UML
 * compartments), connection points on each side, a resizer and a rotation handle when selected,
 * and inline text editing on double-click.
 */
import { memo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Lock, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CONTAINER_TITLE_HEIGHT } from '@/lib/diagrams/geometry'
import type { DiagramNode } from '@/lib/diagrams/model'
import { shapeOf } from '@/lib/diagrams/shapes'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { SHAPE_ICONS } from './shapeIcons'
import { ShapeOutline, themeColor } from './ShapeOutline'

const MIN_SIZE = 32
/** A side this long or longer gets two extra connection points, at a quarter and three quarters. */
const EXTRA_HANDLES_FROM = 120
const ROTATION_SNAP = 15
const SIDES: ReadonlyArray<{ side: 'top' | 'right' | 'bottom' | 'left'; position: Position; horizontal: boolean }> = [
  { side: 'top', position: Position.Top, horizontal: true },
  { side: 'right', position: Position.Right, horizontal: false },
  { side: 'bottom', position: Position.Bottom, horizontal: true },
  { side: 'left', position: Position.Left, horizontal: false },
]

function ConnectionPoints({ width, height, locked }: { width: number; height: number; locked: boolean }) {
  return (
    <>
      {SIDES.flatMap(({ side, position, horizontal }) => {
        const length = horizontal ? width : height
        const offsets = length >= EXTRA_HANDLES_FROM ? [25, 50, 75] : [50]
        return offsets.map((offset) => (
          <Handle
            key={`${side}-${offset}`}
            id={`${side}-${offset}`}
            type="source"
            position={position}
            isConnectable={!locked}
            className="diagram-handle diagram-no-export"
            style={horizontal ? { left: `${offset}%` } : { top: `${offset}%` }}
          />
        ))
      })}
    </>
  )
}

function RotationHandle({ id, rotation }: { id: string; rotation: number }) {
  const checkpoint = useDiagramStudio((state) => state.checkpoint)
  const previewNodes = useDiagramStudio((state) => state.previewNodes)
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const node = event.currentTarget.closest('.react-flow__node')
    if (!node) return
    const box = node.getBoundingClientRect()
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    checkpoint()
    const move = (moveEvent: PointerEvent) => {
      const raw = (Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) * 180) / Math.PI + 90
      const snapped = moveEvent.shiftKey ? raw : Math.round(raw / ROTATION_SNAP) * ROTATION_SNAP
      previewNodes([id], { rotation: ((snapped % 360) + 360) % 360 })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  return (
    <button type="button" className="diagram-rotate nodrag diagram-no-export" onPointerDown={start} title={`Rotate (${rotation}°) · Shift for free angle`} aria-label="Rotate">
      <RotateCw size={10} />
    </button>
  )
}

function InlineEditor({ id, value }: { id: string; value: string }) {
  const updateNodes = useDiagramStudio((state) => state.updateNodes)
  const editNode = useDiagramUi((state) => state.editNode)
  const done = useRef(false)
  const finish = (text: string | null) => {
    if (done.current) return
    done.current = true
    if (text !== null && text !== value) updateNodes([id], { label: text })
    editNode(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') finish(null)
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(event.currentTarget.value) }
  }
  return (
    <textarea
      className="diagram-inline-editor nodrag nowheel nopan"
      defaultValue={value}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      aria-label="Shape text"
    />
  )
}

export const ShapeNode = memo(function ShapeNode({ id, data, selected, width, height }: NodeProps<DiagramNode>) {
  const definition = shapeOf(data.shape)
  const editing = useDiagramUi((state) => state.editingNodeId === id)
  const checkpoint = useDiagramStudio((state) => state.checkpoint)
  const w = width ?? definition.width
  const h = height ?? definition.height
  const Icon = data.icon ? SHAPE_ICONS[data.icon] : undefined
  const style = data.style
  const uml = definition.geometry === 'uml-class'
  const container = definition.geometry === 'container'
  const textStyle = { color: themeColor(style.textColor, '--diagram-node-text'), fontSize: style.fontSize }

  return (
    <div className={cn('diagram-node', `diagram-node--${definition.geometry}`, selected && 'is-selected', data.locked && 'is-locked')} style={{ width: w, height: h }}>
      <NodeResizer
        isVisible={selected && !data.locked}
        minWidth={MIN_SIZE}
        minHeight={MIN_SIZE}
        onResizeStart={checkpoint}
        lineClassName="diagram-resizer-line diagram-no-export"
        handleClassName="diagram-resizer-handle diagram-no-export"
      />
      <div className="diagram-node-body" style={{ transform: data.rotation ? `rotate(${data.rotation}deg)` : undefined }}>
        <ShapeOutline geometry={definition.geometry} width={w} height={h} style={style} />
        {uml ? (
          <div className="diagram-uml" style={textStyle}>
            {data.subtitle && <div className="diagram-uml-stereotype">{data.subtitle}</div>}
            <div className="diagram-uml-name">{editing ? <InlineEditor id={id} value={data.label} /> : data.label}</div>
            {data.attributes !== undefined && <pre className="diagram-uml-section">{data.attributes}</pre>}
            {data.operations !== undefined && <pre className="diagram-uml-section">{data.operations}</pre>}
          </div>
        ) : (
          <div className={cn('diagram-node-text', container && 'diagram-node-text--title')} style={{ ...textStyle, ...(container ? { height: CONTAINER_TITLE_HEIGHT } : {}) }}>
            {editing ? <InlineEditor id={id} value={data.label} /> : (
              <>
                <span className="diagram-node-label">
                  {Icon && <Icon size={Math.round(style.fontSize * 1.1)} className="diagram-node-icon" aria-hidden="true" />}
                  <span>{data.label}</span>
                </span>
                {data.subtitle && <span className="diagram-node-subtitle">{data.subtitle}</span>}
              </>
            )}
          </div>
        )}
      </div>
      {data.locked && <Lock size={10} className="diagram-node-lock diagram-no-export" aria-label="Locked" />}
      {selected && !data.locked && definition.rotatable && <RotationHandle id={id} rotation={data.rotation} />}
      <ConnectionPoints width={w} height={h} locked={data.locked} />
    </div>
  )
})

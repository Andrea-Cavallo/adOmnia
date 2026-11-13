/**
 * The diagram connector: straight, Bézier or orthogonal (routed around the nodes in its way),
 * arrowheads at either end, a label edited with a double-click, waypoints dragged, added with the
 * "+" between two points and removed with a double-click, and optional data-flow pulses.
 */
import { memo, useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { BaseEdge, EdgeLabelRenderer, Position, getBezierPath, useInternalNode, useReactFlow, useStore, type EdgeProps, type InternalNode, type ReactFlowState } from '@xyflow/react'
import type { Rect } from '@/lib/diagrams/graphOps'
import { DEFAULT_EDGE_DATA, type ArrowHead, type DiagramEdge, type Waypoint } from '@/lib/diagrams/model'
import { EXIT_OFFSET, edgePoints, floatingAnchors, midpoint, pathOf, type Anchor, type Point, type Side } from '@/lib/diagrams/routing'
import { shapeOf } from '@/lib/diagrams/shapes'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'

/** Nodes this far outside the box between the two ends can still be in the way of a detour. */
const OBSTACLE_REACH = 160
const PULSES = 3
const PULSE_SECONDS = 2.4
const ARROW_SIZE = 9

/**
 * The rectangles of the nodes near this edge, as a string so the edge re-renders only when one of
 * them really moves (React Flow's store changes on every frame of every drag).
 */
function obstacleKey(state: ReactFlowState, source: string, target: string, box: Rect): string {
  const parts: string[] = []
  for (const node of state.nodeLookup.values()) {
    if (node.id === source || node.id === target || node.hidden) continue
    const shape = typeof node.data?.shape === 'string' ? shapeOf(node.data.shape) : null
    if (shape?.container) continue
    const { x, y } = node.internals.positionAbsolute
    const width = node.measured.width ?? 0
    const height = node.measured.height ?? 0
    if (x > box.x + box.width || x + width < box.x || y > box.y + box.height || y + height < box.y) continue
    parts.push(`${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`)
  }
  return parts.join(';')
}

const parseObstacles = (key: string): Rect[] => (key ? key.split(';').map((part) => {
  const [x, y, width, height] = part.split(',').map(Number)
  return { x, y, width, height }
}) : [])

/** An arrowhead at `tip`, pointing away from `from`. */
function Arrow({ tip, from, kind, color, thickness }: { tip: Point; from: Point; kind: ArrowHead; color: string; thickness: number }) {
  if (kind === 'none') return null
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const size = ARROW_SIZE + thickness
  const at = (along: number, across: number) => ({
    x: tip.x - Math.cos(angle) * along - Math.sin(angle) * across,
    y: tip.y - Math.sin(angle) * along + Math.cos(angle) * across,
  })
  const points = (list: Point[]) => list.map((point) => `${point.x},${point.y}`).join(' ')
  if (kind === 'circle') {
    const center = at(size / 2, 0)
    return <circle cx={center.x} cy={center.y} r={size / 2.6} fill="var(--diagram-canvas)" stroke={color} strokeWidth={thickness} />
  }
  if (kind === 'diamond') {
    return <polygon points={points([tip, at(size * 0.7, size * 0.4), at(size * 1.4, 0), at(size * 0.7, -size * 0.4)])} fill={color} stroke={color} strokeWidth={1} />
  }
  if (kind === 'open') {
    return <polyline points={points([at(size, size * 0.5), tip, at(size, -size * 0.5)])} fill="none" stroke={color} strokeWidth={thickness} strokeLinejoin="round" />
  }
  return <polygon points={points([tip, at(size, size * 0.45), at(size * 0.8, 0), at(size, -size * 0.45)])} fill={color} />
}

const rectOf = (node: InternalNode): Rect => ({
  ...node.internals.positionAbsolute, width: node.measured.width ?? 0, height: node.measured.height ?? 0,
})

/**
 * The two ends: the handles the user attached to, or, for a connector created without handles
 * (templates, generated diagrams), the facing sides of the two nodes.
 */
function useAnchors(props: EdgeProps<DiagramEdge>): [Anchor, Anchor] {
  const sourceNode = useInternalNode(props.source)
  const targetNode = useInternalNode(props.target)
  const handles: [Anchor, Anchor] = [
    { x: props.sourceX, y: props.sourceY, side: props.sourcePosition as Side },
    { x: props.targetX, y: props.targetY, side: props.targetPosition as Side },
  ]
  if ((props.sourceHandleId && props.targetHandleId) || !sourceNode || !targetNode) return handles
  const floating = floatingAnchors(rectOf(sourceNode), rectOf(targetNode))
  return [props.sourceHandleId ? handles[0] : floating[0], props.targetHandleId ? handles[1] : floating[1]]
}

const POSITION: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

function stepFrom(anchor: Anchor): Point {
  const unit = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[anchor.side]
  return { x: anchor.x + unit[0] * EXIT_OFFSET, y: anchor.y + unit[1] * EXIT_OFFSET }
}

function EdgeLabelEditor({ id, label }: { id: string; label: string }) {
  const updateEdges = useDiagramStudio((state) => state.updateEdges)
  const editEdge = useDiagramUi((state) => state.editEdge)
  const done = useRef(false)
  const finish = (text: string | null) => {
    if (done.current) return
    done.current = true
    if (text !== null && text !== label) updateEdges([id], { label: text })
    editEdge(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') finish(null)
    if (event.key === 'Enter') finish(event.currentTarget.value)
  }
  return (
    <input
      className="diagram-edge-label-input"
      defaultValue={label}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      aria-label="Connector label"
    />
  )
}

function EdgeLabel({ id, label, at, editing }: { id: string; label: string; at: Point; editing: boolean }) {
  const editEdge = useDiagramUi((state) => state.editEdge)
  if (!label && !editing) return null
  return (
    <div
      className="diagram-edge-label nodrag nopan"
      style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
      role="button"
      tabIndex={0}
      aria-label={editing ? undefined : `Connector label ${label}: press Enter to edit`}
      onDoubleClick={() => editEdge(id)}
      onKeyDown={(event) => { if (!editing && event.key === 'Enter') { event.stopPropagation(); editEdge(id) } }}
    >
      {editing ? <EdgeLabelEditor id={id} label={label} /> : label}
    </div>
  )
}

function Waypoints({ id, ends, waypoints }: { id: string; ends: [Point, Point]; waypoints: Waypoint[] }) {
  const { screenToFlowPosition } = useReactFlow()
  const checkpoint = useDiagramStudio((state) => state.checkpoint)
  const previewEdges = useDiagramStudio((state) => state.previewEdges)
  const updateEdges = useDiagramStudio((state) => state.updateEdges)
  const route = [ends[0], ...waypoints, ends[1]]

  /** Drags waypoint `index` of `list`; the history step is recorded once, at the start. */
  const drag = (event: ReactPointerEvent, list: Waypoint[], index: number) => {
    event.stopPropagation()
    event.preventDefault()
    checkpoint()
    const move = (moveEvent: PointerEvent) => {
      const point = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY })
      previewEdges([id], { waypoints: list.map((waypoint, at) => (at === index ? { x: Math.round(point.x), y: Math.round(point.y) } : waypoint)) })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return (
    <EdgeLabelRenderer>
      {waypoints.map((point, index) => (
        <div
          key={`w${index}`}
          className="diagram-waypoint nodrag nopan diagram-no-export"
          // Direct manipulation by pointer only; the keyboard path is "Reset bends" in the inspector.
          data-a11y-click-exempt
          style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
          onPointerDown={(event) => drag(event, waypoints, index)}
          onDoubleClick={() => updateEdges([id], { waypoints: waypoints.filter((_, at) => at !== index) })}
          title="Drag to bend · double-click to remove"
        />
      ))}
      {route.slice(1).map((point, index) => {
        const from = route[index]
        const middle = { x: (from.x + point.x) / 2, y: (from.y + point.y) / 2 }
        return (
          <div
            key={`a${index}`}
            className="diagram-waypoint-add nodrag nopan diagram-no-export"
            data-a11y-click-exempt
            style={{ transform: `translate(-50%, -50%) translate(${middle.x}px, ${middle.y}px)` }}
            onPointerDown={(event) => {
              const list = [...waypoints.slice(0, index), { x: Math.round(middle.x), y: Math.round(middle.y) }, ...waypoints.slice(index)]
              previewEdges([id], { waypoints: list })
              drag(event, list, index)
            }}
            title="Drag to add a bend"
          >
            +
          </div>
        )
      })}
    </EdgeLabelRenderer>
  )
}

export const SmartEdge = memo(function SmartEdge(props: EdgeProps<DiagramEdge>) {
  const { id, source, target, selected } = props
  const data = { ...DEFAULT_EDGE_DATA, ...props.data }
  const editing = useDiagramUi((state) => state.editingEdgeId === id)
  const [sourceAnchor, targetAnchor] = useAnchors(props)
  const { x: sourceX, y: sourceY } = sourceAnchor
  const { x: targetX, y: targetY } = targetAnchor
  const autoRouted = data.routing === 'orthogonal' && data.waypoints.length === 0
  const box: Rect = {
    x: Math.min(sourceX, targetX) - OBSTACLE_REACH, y: Math.min(sourceY, targetY) - OBSTACLE_REACH,
    width: Math.abs(targetX - sourceX) + OBSTACLE_REACH * 2, height: Math.abs(targetY - sourceY) + OBSTACLE_REACH * 2,
  }
  const key = useStore((state) => (autoRouted ? obstacleKey(state, source, target, box) : ''))
  const obstacles = useMemo(() => parseObstacles(key), [key])
  const points = edgePoints(data.routing, sourceAnchor, targetAnchor, data.waypoints, obstacles)
  const bezierAuto = data.routing === 'bezier' && data.waypoints.length === 0
  const [path, labelX, labelY] = bezierAuto
    ? getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition: POSITION[sourceAnchor.side], targetPosition: POSITION[targetAnchor.side] })
    : [pathOf(data.routing, points), midpoint(points).x, midpoint(points).y]
  const color = data.color || 'var(--diagram-edge)'
  const before = (end: 'start' | 'end') => {
    if (bezierAuto || data.routing === 'orthogonal') return stepFrom(end === 'end' ? targetAnchor : sourceAnchor)
    return end === 'end' ? points[points.length - 2] : points[1]
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        className={selected ? 'is-selected' : undefined}
        style={{ stroke: color, strokeWidth: data.thickness, strokeDasharray: data.dashed ? `${data.thickness * 4} ${data.thickness * 3}` : undefined }}
      />
      <Arrow tip={targetAnchor} from={before('end')} kind={data.arrowEnd} color={color} thickness={data.thickness} />
      <Arrow tip={sourceAnchor} from={before('start')} kind={data.arrowStart} color={color} thickness={data.thickness} />
      {data.flow && (
        <g className="diagram-flow" aria-hidden="true">
          {Array.from({ length: PULSES }, (_, index) => (
            <circle key={index} r={3.2} className="diagram-flow-pulse">
              {/* A negative start puts every pulse already on its way: none waits at the canvas origin. */}
              <animateMotion dur={`${PULSE_SECONDS}s`} begin={`-${(index * PULSE_SECONDS) / PULSES}s`} repeatCount="indefinite" path={path} />
            </circle>
          ))}
        </g>
      )}
      <EdgeLabelRenderer>
        <EdgeLabel id={id} label={data.label} at={{ x: labelX, y: labelY }} editing={editing} />
      </EdgeLabelRenderer>
      {selected && <Waypoints id={id} ends={[sourceAnchor, targetAnchor]} waypoints={data.waypoints} />}
    </>
  )
})

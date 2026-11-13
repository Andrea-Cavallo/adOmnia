/**
 * The infinite canvas: React Flow wired to the Diagram Studio store, with smart alignment guides
 * while dragging, drop from the shape library, context menus, keyboard shortcuts, minimap and
 * zoom controls. Drag on empty canvas selects; Space+drag, the middle button or the wheel pans.
 */
import { useCallback, useSyncExternalStore, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background, BackgroundVariant, ConnectionLineType, ConnectionMode, Controls, MiniMap, ReactFlow, SelectionMode, ViewportPortal,
  useReactFlow, type NodeChange, type NodePositionChange, type OnNodeDrag, type Viewport,
} from '@xyflow/react'
import { alignmentGuides } from '@/lib/diagrams/guides'
import { absoluteRect, indexNodes, nodeSize } from '@/lib/diagrams/graphOps'
import type { DiagramEdge, DiagramNode } from '@/lib/diagrams/model'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi, type ContextTarget } from '@/stores/diagramStudioUi'
import { DiagramContextMenu } from './DiagramContextMenu'
import { handleDiagramKey, typingIn } from './diagramActions'
import { SelectionToolbar } from './SelectionToolbar'
import { SHAPE_DRAG_TYPE } from './ShapeLibrary'
import { ShapeNode } from './ShapeNode'
import { SmartEdge } from './SmartEdge'

const NODE_TYPES = { shape: ShapeNode }
const EDGE_TYPES = { smart: SmartEdge }
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const BACKGROUND: Record<'dots' | 'lines', BackgroundVariant> = { dots: BackgroundVariant.Dots, lines: BackgroundVariant.Lines }

/**
 * React Flow puts its color mode as a class on its root, and adOmnia's light tokens apply to any
 * `.light` element: the canvas must use the app's own mode, or a dark theme turns light inside it.
 */
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  return () => observer.disconnect()
}
const appColorMode = () => (document.documentElement.classList.contains('light') ? 'light' : 'dark')

/**
 * Snaps a single dragged top-level node to the edges and centers of the others and shows the guide
 * lines; any other change passes through untouched.
 */
function withGuides(changes: NodeChange<DiagramNode>[], nodes: DiagramNode[]): NodeChange<DiagramNode>[] {
  const ui = useDiagramUi.getState()
  const [change] = changes
  const dragging = changes.length === 1 && change.type === 'position' && change.dragging && change.position
  if (!dragging) {
    if (!changes.some((candidate) => candidate.type === 'position' && candidate.dragging)) ui.setGuides([])
    return changes
  }
  const move = change as NodePositionChange
  const byId = indexNodes(nodes)
  const node = byId.get(move.id)
  if (!node || node.parentId || !move.position) return changes
  const others = nodes.filter((other) => other.id !== node.id && !other.parentId && !other.selected).map((other) => absoluteRect(other, byId))
  const result = alignmentGuides({ ...move.position, ...nodeSize(node) }, others)
  ui.setGuides(result.guides)
  return [{ ...move, position: { x: result.x, y: result.y } }]
}

function GuideLines() {
  const guides = useDiagramUi((state) => state.guides)
  if (guides.length === 0) return null
  return (
    <ViewportPortal>
      {guides.map((guide, index) => (
        <div
          key={index}
          className={`diagram-guide diagram-guide--${guide.orientation} diagram-no-export`}
          style={guide.orientation === 'vertical'
            ? { transform: `translate(${guide.position}px, ${guide.from}px)`, height: guide.to - guide.from }
            : { transform: `translate(${guide.from}px, ${guide.position}px)`, width: guide.to - guide.from }}
        />
      ))}
    </ViewportPortal>
  )
}

export function DiagramCanvas() {
  const doc = useDiagramStudio((state) => state.doc)
  const onNodesChange = useDiagramStudio((state) => state.onNodesChange)
  const onEdgesChange = useDiagramStudio((state) => state.onEdgesChange)
  const connect = useDiagramStudio((state) => state.connect)
  const reconnect = useDiagramStudio((state) => state.reconnect)
  const checkpoint = useDiagramStudio((state) => state.checkpoint)
  const setViewport = useDiagramStudio((state) => state.setViewport)
  const addShape = useDiagramStudio((state) => state.addShape)
  const editNode = useDiagramUi((state) => state.editNode)
  const editEdge = useDiagramUi((state) => state.editEdge)
  const openMenu = useDiagramUi((state) => state.openMenu)
  const setGuides = useDiagramUi((state) => state.setGuides)
  const { screenToFlowPosition } = useReactFlow()
  const colorMode = useSyncExternalStore(subscribeToTheme, appColorMode)

  const handleNodesChange = useCallback((changes: NodeChange<DiagramNode>[]) => {
    const nodes = useDiagramStudio.getState().doc?.nodes ?? []
    onNodesChange(withGuides(changes, nodes))
  }, [onNodesChange])

  const onDragStop = useCallback<OnNodeDrag<DiagramNode>>((_event, _node, dragged) => {
    setGuides([])
    const store = useDiagramStudio.getState()
    for (const node of dragged) store.dropInContainer(node.id)
  }, [setGuides])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const shapeId = event.dataTransfer.getData(SHAPE_DRAG_TYPE)
    if (!shapeId) return
    event.preventDefault()
    addShape(shapeId, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }, [addShape, screenToFlowPosition])

  const menuAt = useCallback((event: ReactMouseEvent | MouseEvent, target: ContextTarget) => {
    event.preventDefault()
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    if (target.kind !== 'pane') useDiagramStudio.getState().selectFor(target.kind, target.id)
    openMenu({ x: event.clientX, y: event.clientY, flowX: flow.x, flowY: flow.y, target })
  }, [openMenu, screenToFlowPosition])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (typingIn(event.target)) return
    if (handleDiagramKey(event, useDiagramStudio.getState())) event.preventDefault()
  }, [])

  if (!doc) return null
  const { settings } = doc
  return (
    <div className="diagram-canvas" tabIndex={0} onKeyDown={onKeyDown} onDragOver={(event) => { if (event.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={onDrop}>
      <ReactFlow<DiagramNode, DiagramEdge>
        key={doc.id}
        colorMode={colorMode}
        nodes={doc.nodes}
        edges={doc.edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={connect}
        onReconnect={reconnect}
        onReconnectStart={checkpoint}
        edgesReconnectable
        onNodeDragStart={checkpoint}
        onNodeDragStop={onDragStop}
        onNodeDoubleClick={(_event, node) => { if (!node.data.locked) editNode(node.id) }}
        onEdgeDoubleClick={(_event, edge) => editEdge(edge.id)}
        onNodeContextMenu={(event, node) => menuAt(event, { kind: 'node', id: node.id })}
        onEdgeContextMenu={(event, edge) => menuAt(event, { kind: 'edge', id: edge.id })}
        onPaneContextMenu={(event) => menuAt(event, { kind: 'pane' })}
        onMoveEnd={(_event, viewport: Viewport) => setViewport(viewport)}
        defaultViewport={doc.viewport}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={settings.defaultRouting === 'bezier' ? ConnectionLineType.Bezier : settings.defaultRouting === 'straight' ? ConnectionLineType.Straight : ConnectionLineType.SmoothStep}
        snapToGrid={settings.snapToGrid}
        snapGrid={[settings.gridSize, settings.gridSize]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1]}
        panOnScroll
        deleteKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        elevateNodesOnSelect={false}
        onlyRenderVisibleElements
        onInit={(instance) => {
          // A diagram never viewed before (a template, an import) is framed once; a saved view is kept.
          const fresh = doc.viewport.x === 0 && doc.viewport.y === 0 && doc.viewport.zoom === 1
          if (fresh && doc.nodes.length > 0) void instance.fitView({ maxZoom: 1, padding: 0.15 })
        }}
      >
        {settings.grid !== 'none' && (
          <Background variant={BACKGROUND[settings.grid]} gap={settings.gridSize} size={settings.grid === 'dots' ? 1.2 : undefined} className="diagram-grid" />
        )}
        <MiniMap pannable zoomable className="diagram-minimap diagram-no-export" nodeStrokeWidth={2} />
        <Controls showInteractive={false} className="diagram-controls diagram-no-export" />
        <GuideLines />
        <SelectionToolbar />
      </ReactFlow>
      <DiagramContextMenu />
    </div>
  )
}

/**
 * Diagram Studio: shape library on the left, the infinite canvas in the middle, the collapsible
 * properties inspector on the right. Diagrams are saved in adOmnia's local store as you edit; the
 * pending save is written before the window hides or the studio closes.
 */
import { useCallback, useEffect, useRef } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'
import { NothingStudioHeader } from '@/components/ui/NothingStudioHeader'
import { createNode, nodeSize } from '@/lib/diagrams/graphOps'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { DiagramCanvas } from './DiagramCanvas'
import { DiagramInspector } from './DiagramInspector'
import { DiagramTopBar } from './DiagramTopBar'
import { ShapeLibrary } from './ShapeLibrary'
import '@xyflow/react/dist/base.css'
import './diagramStudio.css'

const CASCADE = 32

function Notice() {
  const notice = useDiagramStudio((state) => state.notice)
  const dismiss = useDiagramStudio((state) => state.dismissNotice)
  if (!notice) return null
  return (
    <div className="diagram-notice" role="alert">
      <span>{notice}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss"><X size={12} /></button>
    </div>
  )
}

function Studio() {
  const ready = useDiagramStudio((state) => state.ready)
  const doc = useDiagramStudio((state) => state.doc)
  const inspectorOpen = useDiagramUi((state) => state.inspectorOpen)
  const canvasRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  useEffect(() => {
    void useDiagramStudio.getState().init()
    const save = () => { void useDiagramStudio.getState().flush() }
    const onVisibility = () => { if (document.hidden) save() }
    window.addEventListener('beforeunload', save)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      save()
      window.removeEventListener('beforeunload', save)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  /** A shape clicked in the library lands in the middle of the visible canvas. */
  const addAtCenter = useCallback((shapeId: string) => {
    const box = canvasRef.current?.getBoundingClientRect()
    if (!box) return
    const center = screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
    const size = nodeSize(createNode(shapeId, center))
    const nodes = useDiagramStudio.getState().doc?.nodes ?? []
    // Shapes added one after the other cascade instead of landing on top of each other.
    let spot = { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2) }
    while (nodes.some((node) => Math.abs(node.position.x - spot.x) < CASCADE && Math.abs(node.position.y - spot.y) < CASCADE)) {
      spot = { x: spot.x + CASCADE, y: spot.y + CASCADE }
    }
    useDiagramStudio.getState().addShape(shapeId, spot)
    canvasRef.current?.querySelector<HTMLElement>('.diagram-canvas')?.focus()
  }, [screenToFlowPosition])

  return (
    <div className="nothing-studio diagram-studio">
      <NothingStudioHeader
        title="Diagram Studio"
        section="Studio / Design"
        detail="Architectures, flows and UML on an infinite canvas"
        count={doc ? `${doc.nodes.length} shapes · ${doc.edges.length} connectors` : 'Loading…'}
      />
      <DiagramTopBar canvas={() => canvasRef.current} />
      <Notice />
      <div className={inspectorOpen ? 'diagram-body' : 'diagram-body diagram-body--no-inspector'}>
        <ShapeLibrary onAdd={addAtCenter} />
        <div ref={canvasRef} className="diagram-canvas-host">
          {ready && doc ? <DiagramCanvas /> : <p className="diagram-empty-hint">Loading diagrams…</p>}
        </div>
        {inspectorOpen && <DiagramInspector />}
      </div>
    </div>
  )
}

export function DiagramStudioPanel() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  )
}

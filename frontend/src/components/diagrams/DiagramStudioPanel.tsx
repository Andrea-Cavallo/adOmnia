/**
 * Diagram Studio: shape library on the left, the infinite canvas in the middle, the collapsible
 * properties inspector on the right. Diagrams are saved in adOmnia's local store as you edit; the
 * pending save is written before the window hides or the studio closes.
 *
 * The studio has no title header: the command bar already names the open diagram and every pixel of
 * height belongs to the canvas.
 */
import { useCallback, useEffect, useRef } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createNode, nodeSize } from '@/lib/diagrams/graphOps'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { DiagramCanvas } from './DiagramCanvas'
import { DiagramInspector } from './DiagramInspector'
import { DiagramTopBar } from './DiagramTopBar'
import { DiagramWorkspaceBar } from './DiagramWorkspaceBar'
import { useDiagramCodeGraph } from '@/stores/diagramCodeGraph'
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
  const libraryOpen = useDiagramUi((state) => state.libraryOpen)
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

  // The toolbar says which project Generate will analyse.
  useEffect(() => {
    if (useDiagramStudio.getState().doc?.origin) return
    void useDiagramCodeGraph.getState().detectProject()
  }, [])

  // A saved generated diagram reopens with its context actions available, without re-scanning.
  const originSession = useDiagramStudio((state) => state.doc?.origin?.sessionId)
  useEffect(() => {
    if (!originSession) return
    const state = useDiagramCodeGraph.getState()
    if (state.analysis?.root && state.sessionId === originSession) return
    void state.ensureAnalysis()
  }, [originSession])

  // Unsaved buffers are not analysed: the diagram says so instead of claiming a fresher graph.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let stopped = false
    void import('@/stores/codeStudio').then(({ useCodeStudioStore }) => {
      if (stopped) return
      const dirtyOf = (documents: ReturnType<typeof useCodeStudioStore.getState>['documents'], sessionId: string) =>
        documents.some((document) => document.document.sessionId === sessionId && document.dirty)
      unsubscribe = useCodeStudioStore.subscribe((state, previous) => {
        const sessionId = useDiagramStudio.getState().doc?.origin?.sessionId
        if (!sessionId) return
        if (dirtyOf(state.documents, sessionId) && !dirtyOf(previous.documents, sessionId)) {
          useDiagramStudio.getState().markGeneratedStale()
          useDiagramStudio.setState({ notice: 'Code Studio has unsaved changes: the diagram still reflects the last saved sources. Save, then Refresh from Code.' })
        }
      })
    })
    return () => { stopped = true; unsubscribe?.() }
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

  /** An architecture icon clicked in the library lands in the middle of the view. */
  const addIconAtCenter = useCallback((src: string, label: string) => {
    const box = canvasRef.current?.getBoundingClientRect()
    if (!box) return
    const center = screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
    useDiagramStudio.getState().addImage(src, { x: Math.round(center.x - 32), y: Math.round(center.y - 32) }, label, { width: 64, height: 64 })
  }, [screenToFlowPosition])

  return (
    <div className="nothing-studio diagram-studio">
      <DiagramTopBar canvas={() => canvasRef.current} />
      <DiagramWorkspaceBar />
      <Notice />
      <div className={cn('diagram-body', !inspectorOpen && 'diagram-body--no-inspector', !libraryOpen && 'diagram-body--no-library')}>
        {libraryOpen && <ShapeLibrary onAdd={addAtCenter} onAddIcon={addIconAtCenter} />}
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

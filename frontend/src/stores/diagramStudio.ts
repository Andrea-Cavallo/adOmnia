/**
 * Diagram Studio state: the open diagram, its undo history, the clipboard and the save state.
 * Every edit goes through `commit`, which records history and schedules the autosave; continuous
 * gestures (drag, resize) record one step at their start with `checkpoint`.
 */
import { create } from 'zustand'
import { applyEdgeChanges, applyNodeChanges, reconnectEdge, type Connection, type EdgeChange, type NodeChange, type Viewport, type XYPosition } from '@xyflow/react'
import { createAutosave, type SaveStatus } from '@/lib/diagrams/autosave'
import { diagramFromBlueprint } from '@/lib/diagrams/blueprint'
import {
  alignNodes, copySelection, createEdge, createNode, deleteElements, distributeNodes, duplicateSelection, groupNodes,
  moveLayer, pasteClipboard, reparentByDrop, setLocked, ungroup, updateEdgeData, updateNodeData,
  type AlignMode, type Clipboard, type DistributeAxis, type LayerMove,
} from '@/lib/diagrams/graphOps'
import { emptyHistory, record, redo, undo, type History } from '@/lib/diagrams/history'
import { autoLayout, type LayoutDirection } from '@/lib/diagrams/layout'
import {
  emptyDiagram, newDiagramId,
  type DiagramDocument, type DiagramEdge, type DiagramEdgeData, type DiagramGraph, type DiagramNode, type DiagramNodeData, type DiagramSettings, type DiagramSummary,
} from '@/lib/diagrams/model'
import { parseDiagram } from '@/lib/diagrams/serialization'
import { diagramRepository, type DiagramRepository } from '@/lib/diagrams/storage'
import { DIAGRAM_TEMPLATES } from '@/lib/diagrams/templates'

const AUTOSAVE_DELAY_MS = 800
const PASTE_OFFSET = 32

interface DiagramStudioState {
  summaries: DiagramSummary[]
  doc: DiagramDocument | null
  history: History
  clipboard: Clipboard | null
  saveStatus: SaveStatus
  saveError: string
  /** Problems loading, importing or laying out, shown in a banner until dismissed. */
  notice: string
  ready: boolean

  init: () => Promise<void>
  open: (id: string) => Promise<void>
  create: (templateId?: string) => Promise<void>
  importJson: (json: string) => Promise<void>
  rename: (name: string) => void
  remove: (id: string) => Promise<void>
  flush: () => Promise<void>
  dismissNotice: () => void

  onNodesChange: (changes: NodeChange<DiagramNode>[]) => void
  onEdgesChange: (changes: EdgeChange<DiagramEdge>[]) => void
  setViewport: (viewport: Viewport) => void
  updateSettings: (patch: Partial<DiagramSettings>) => void

  checkpoint: () => void
  commit: (edit: (graph: DiagramGraph) => DiagramGraph) => void
  undo: () => void
  redo: () => void

  addShape: (shapeId: string, position: XYPosition) => string | null
  connect: (connection: Connection) => void
  /** Moves an edge's end to another node or handle (endpoint dragged on the canvas). */
  reconnect: (edge: DiagramEdge, connection: Connection) => void
  /** Live updates during a gesture that already recorded its history step (rotation, waypoint drag). */
  previewNodes: (ids: readonly string[], patch: Partial<DiagramNodeData>) => void
  previewEdges: (ids: readonly string[], patch: Partial<DiagramEdgeData>) => void
  updateNodes: (ids: readonly string[], patch: Partial<DiagramNodeData>) => void
  updateEdges: (ids: readonly string[], patch: Partial<DiagramEdgeData>) => void
  deleteSelection: () => void
  copy: () => void
  cut: () => void
  paste: (at?: XYPosition) => void
  duplicate: () => void
  group: () => void
  ungroupSelection: () => void
  align: (mode: AlignMode) => void
  distribute: (axis: DistributeAxis) => void
  layer: (move: LayerMove) => void
  lock: (locked: boolean) => void
  dropInContainer: (nodeId: string) => void
  layout: (direction: LayoutDirection) => Promise<void>
  selectAll: () => void
  /** Selects just these elements, unless the clicked one is already part of the selection. */
  selectFor: (kind: 'node' | 'edge', id: string) => void
}

const graphOf = (doc: DiagramDocument): DiagramGraph => ({ nodes: doc.nodes, edges: doc.edges })
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
export const selectedNodeIds = (doc: DiagramDocument | null) => doc?.nodes.filter((node) => node.selected).map((node) => node.id) ?? []
export const selectedEdgeIds = (doc: DiagramDocument | null) => doc?.edges.filter((edge) => edge.selected).map((edge) => edge.id) ?? []

/**
 * Changes the canvas makes on its own: selecting, and measuring a node it rendered. A resize also
 * arrives as a dimensions change, but with `setAttributes`: that one is an edit and is saved.
 */
const isSilentNodeChange = (change: NodeChange<DiagramNode>) =>
  change.type === 'select' || (change.type === 'dimensions' && !change.setAttributes)

export function createDiagramStudioStore(repository: DiagramRepository = diagramRepository) {
  return create<DiagramStudioState>((set, get) => {
    const autosave = createAutosave<DiagramDocument>({
      delayMs: AUTOSAVE_DELAY_MS,
      save: async (doc) => {
        await repository.save(doc)
        set((state) => ({ summaries: upsertSummary(state.summaries, doc) }))
      },
      onStatus: (saveStatus, error) => set({ saveStatus, saveError: error ?? '' }),
    })

    /** Replaces the open diagram and schedules its save. */
    const store = (doc: DiagramDocument) => {
      const next = { ...doc, updatedAt: Date.now() }
      set({ doc: next })
      autosave.schedule(next)
    }

    const withGraph = (graph: DiagramGraph) => {
      const { doc } = get()
      if (doc) store({ ...doc, ...graph })
    }

    const openDoc = async (doc: DiagramDocument) => {
      await autosave.flush()
      set({ doc, history: emptyHistory() })
    }

    const commit = (edit: (graph: DiagramGraph) => DiagramGraph) => {
      const { doc, history } = get()
      if (!doc) return
      const before = graphOf(doc)
      const after = edit(before)
      if (after === before) return
      set({ history: record(history, before) })
      withGraph(after)
    }

    const selection = () => selectedNodeIds(get().doc)

    return {
      summaries: [],
      doc: null,
      history: emptyHistory(),
      clipboard: null,
      saveStatus: 'saved',
      saveError: '',
      notice: '',
      ready: false,

      async init() {
        if (get().ready) return
        try {
          const summaries = await repository.list()
          set({ summaries })
          const latest = summaries[0] ? await repository.load(summaries[0].id) : null
          if (latest) await openDoc(latest)
          else await get().create()
        } catch (error) {
          set({ notice: `Could not read the saved diagrams: ${message(error)}`, doc: get().doc ?? emptyDiagram() })
        } finally {
          set({ ready: true })
        }
      },

      async open(id) {
        if (get().doc?.id === id) return
        try {
          const doc = await repository.load(id)
          if (!doc) { set({ notice: 'That diagram is no longer saved.' }); return }
          await openDoc(doc)
        } catch (error) {
          set({ notice: `Could not open the diagram: ${message(error)}` })
        }
      },

      async create(templateId) {
        const template = DIAGRAM_TEMPLATES.find((candidate) => candidate.id === templateId)
        const doc = emptyDiagram(template ? template.label : 'Untitled diagram')
        try {
          if (template) Object.assign(doc, await diagramFromBlueprint(template.blueprint, doc.settings.defaultRouting))
        } catch (error) {
          set({ notice: `The template could not be laid out: ${message(error)}` })
        }
        await openDoc(doc)
        store(doc)
      },

      async importJson(json) {
        try {
          // A fresh id: importing the same file twice gives two diagrams, never an overwrite.
          const doc = { ...parseDiagram(json), id: newDiagramId() }
          await openDoc(doc)
          store(doc)
        } catch (error) {
          set({ notice: `Could not import the diagram: ${message(error)}` })
        }
      },

      rename(name) {
        const { doc } = get()
        const trimmed = name.trim()
        if (doc && trimmed && trimmed !== doc.name) store({ ...doc, name: trimmed })
      },

      async remove(id) {
        try {
          if (get().doc?.id === id) autosave.cancel()
          await repository.remove(id)
          const summaries = get().summaries.filter((summary) => summary.id !== id)
          set({ summaries })
          if (get().doc?.id !== id) return
          const next = summaries[0] ? await repository.load(summaries[0].id) : null
          if (next) await openDoc(next)
          else await get().create()
        } catch (error) {
          set({ notice: `Could not delete the diagram: ${message(error)}` })
        }
      },

      flush: () => autosave.flush(),
      dismissNotice: () => set({ notice: '' }),

      onNodesChange(changes) {
        const { doc } = get()
        if (!doc) return
        const nodes = applyNodeChanges(changes, doc.nodes) as DiagramNode[]
        if (changes.every(isSilentNodeChange)) {
          set({ doc: { ...doc, nodes } })
          return
        }
        store({ ...doc, nodes })
      },

      onEdgesChange(changes) {
        const { doc } = get()
        if (!doc) return
        const edges = applyEdgeChanges(changes, doc.edges) as DiagramEdge[]
        if (changes.every((change) => change.type === 'select')) set({ doc: { ...doc, edges } })
        else store({ ...doc, edges })
      },

      setViewport(viewport) {
        const { doc } = get()
        if (doc) store({ ...doc, viewport })
      },

      updateSettings(patch) {
        const { doc } = get()
        if (doc) store({ ...doc, settings: { ...doc.settings, ...patch } })
      },

      checkpoint() {
        const { doc, history } = get()
        if (doc) set({ history: record(history, graphOf(doc)) })
      },
      commit,

      undo() {
        const { doc, history } = get()
        const step = doc ? undo(history, graphOf(doc)) : null
        if (!step) return
        set({ history: step.history })
        withGraph(step.graph)
      },
      redo() {
        const { doc, history } = get()
        const step = doc ? redo(history, graphOf(doc)) : null
        if (!step) return
        set({ history: step.history })
        withGraph(step.graph)
      },

      addShape(shapeId, position) {
        const node = { ...createNode(shapeId, position), selected: true }
        commit((graph) => ({ ...graph, nodes: [...graph.nodes.map((other) => ({ ...other, selected: false })), node] }))
        get().dropInContainer(node.id)
        return node.id
      },

      connect(connection) {
        const { doc } = get()
        if (!doc || connection.source === connection.target) return
        commit((graph) => ({ ...graph, edges: [...graph.edges, createEdge(connection, doc.settings.defaultRouting)] }))
      },

      reconnect(edge, connection) {
        if (connection.source === connection.target) return
        commit((graph) => ({ ...graph, edges: reconnectEdge(edge, connection, graph.edges, { shouldReplaceId: false }) as DiagramEdge[] }))
      },

      previewNodes(ids, patch) {
        const { doc } = get()
        if (doc) withGraph(updateNodeData(graphOf(doc), ids, patch))
      },
      previewEdges(ids, patch) {
        const { doc } = get()
        if (doc) withGraph(updateEdgeData(graphOf(doc), ids, patch))
      },

      updateNodes: (ids, patch) => commit((graph) => updateNodeData(graph, ids, patch)),
      updateEdges: (ids, patch) => commit((graph) => updateEdgeData(graph, ids, patch)),

      deleteSelection() {
        const nodeIds = selection()
        const edgeIds = selectedEdgeIds(get().doc)
        if (nodeIds.length || edgeIds.length) commit((graph) => deleteElements(graph, nodeIds, edgeIds))
      },

      copy() {
        const { doc } = get()
        const ids = selection()
        if (doc && ids.length) set({ clipboard: copySelection(graphOf(doc), ids) })
      },
      cut() {
        get().copy()
        get().deleteSelection()
      },
      paste(at) {
        const { clipboard } = get()
        if (!clipboard || clipboard.nodes.length === 0) return
        const topLeft = clipboard.nodes.filter((node) => !node.parentId).reduce(
          (corner, node) => ({ x: Math.min(corner.x, node.position.x), y: Math.min(corner.y, node.position.y) }),
          { x: Infinity, y: Infinity },
        )
        const offset = at ? { x: at.x - topLeft.x, y: at.y - topLeft.y } : { x: PASTE_OFFSET, y: PASTE_OFFSET }
        commit((graph) => pasteClipboard(graph, clipboard, offset).graph)
        // A second paste lands beside the first instead of on top of it.
        if (!at) set({ clipboard: { ...clipboard, nodes: clipboard.nodes.map((node) => (node.parentId ? node : { ...node, position: { x: node.position.x + PASTE_OFFSET, y: node.position.y + PASTE_OFFSET } })) } })
      },
      duplicate() {
        const ids = selection()
        if (ids.length) commit((graph) => duplicateSelection(graph, ids).graph)
      },
      group() {
        const ids = selection()
        if (ids.length > 1) commit((graph) => groupNodes(graph, ids).graph)
      },
      ungroupSelection() {
        const ids = selection()
        commit((graph) => ids.reduce((current, id) => ungroup(current, id), graph))
      },
      align: (mode) => commit((graph) => alignNodes(graph, selection(), mode)),
      distribute: (axis) => commit((graph) => distributeNodes(graph, selection(), axis)),
      layer: (move) => commit((graph) => moveLayer(graph, selection(), move)),
      lock: (locked) => commit((graph) => setLocked(graph, selection(), locked)),

      dropInContainer(nodeId) {
        const { doc } = get()
        if (!doc) return
        const next = reparentByDrop(graphOf(doc), nodeId)
        if (next.nodes !== doc.nodes) withGraph(next)
      },

      async layout(direction) {
        const { doc } = get()
        if (!doc) return
        try {
          const laidOut = await autoLayout(graphOf(doc), { direction, spacing: 60 })
          commit(() => laidOut)
        } catch (error) {
          set({ notice: `Auto-layout failed: ${message(error)}` })
        }
      },

      selectFor(kind, id) {
        const { doc } = get()
        if (!doc) return
        const already = kind === 'node' ? doc.nodes.some((node) => node.id === id && node.selected) : doc.edges.some((edge) => edge.id === id && edge.selected)
        if (already) return
        set({ doc: {
          ...doc,
          nodes: doc.nodes.map((node) => ({ ...node, selected: kind === 'node' && node.id === id })),
          edges: doc.edges.map((edge) => ({ ...edge, selected: kind === 'edge' && edge.id === id })),
        } })
      },

      selectAll() {
        const { doc } = get()
        if (doc) set({ doc: { ...doc, nodes: doc.nodes.map((node) => ({ ...node, selected: true })), edges: doc.edges.map((edge) => ({ ...edge, selected: true })) } })
      },
    }
  })
}

function upsertSummary(summaries: DiagramSummary[], doc: DiagramDocument): DiagramSummary[] {
  const summary = { id: doc.id, name: doc.name, nodeCount: doc.nodes.length, updatedAt: doc.updatedAt }
  return [summary, ...summaries.filter((item) => item.id !== doc.id)]
}

export const useDiagramStudio = createDiagramStudioStore()

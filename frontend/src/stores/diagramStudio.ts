/**
 * Diagram Studio state: the open diagram, its undo history, the clipboard and the save state.
 * Every edit goes through `commit`, which records history and schedules the autosave; continuous
 * gestures (drag, resize) record one step at their start with `checkpoint`.
 */
import { create } from 'zustand'
import { applyEdgeChanges, applyNodeChanges, reconnectEdge, type Connection, type EdgeChange, type NodeChange, type Viewport, type XYPosition } from '@xyflow/react'
import { createAutosave, type SaveStatus } from '@/lib/diagrams/autosave'
import { diagramFromBlueprint, lanesFromBlueprint } from '@/lib/diagrams/blueprint'
import type { GeneratedDiagram } from '@/lib/diagrams/workspace'
import type { WorkspaceEntity, WorkspaceLink } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/diagrams/models'
import { mergeGeneratedGraph, relatedGraph, revealNode } from '@/lib/diagrams/workspaceMerge'
import {
  absoluteRect, alignNodes, copySelection, createEdge, createNode, deleteElements, distributeNodes, duplicateSelection, groupNodes,
  moveLayer, pasteClipboard, reparentByDrop, setLocked, ungroup, updateEdgeData, updateNodeData,
  type AlignMode, type Clipboard, type DistributeAxis, type LayerMove,
} from '@/lib/diagrams/graphOps'
import { emptyHistory, record, redo, undo, type History } from '@/lib/diagrams/history'
import { legendFromGraph, legendHeight } from '@/lib/diagrams/legend'
import { autoLayout, DEFAULT_LAYOUT, type LayoutDirection } from '@/lib/diagrams/layout'
import { diagramFromBlueprintFile, importDiagramFile, type BlueprintFile } from '@/lib/diagrams/importFile'
import { sequenceFromText } from '@/lib/diagrams/sequence'
import { straightenEdge } from '@/lib/diagrams/straighten'
import { shapeOf } from '@/lib/diagrams/shapes'
import {
  emptyDiagram, newDiagramId, newPage, summaryOf, syncedPages, withActivePage,
  type DiagramCodeRef, type DiagramDocument, type DiagramEdge, type DiagramEdgeData, type DiagramGraph, type DiagramNode, type DiagramNodeData, type DiagramSettings, type DiagramSummary,
} from '@/lib/diagrams/model'
import { parseDiagram } from '@/lib/diagrams/serialization'
import { diagramRepository, type DiagramRepository } from '@/lib/diagrams/storage'
import { DIAGRAM_TEMPLATES } from '@/lib/diagrams/templates'

const AUTOSAVE_DELAY_MS = 800
const PASTE_OFFSET = 32
const STRAIGHTEN_WITHIN = 32
const LIFELINE_GAP = 180

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
  /** A dropped or picked file: a diagram opens as a new one, a picture is placed at `at` (or the origin). */
  importFile: (file: File, at?: XYPosition) => Promise<void>
  /** A generated diagram (Markdown, MCP) laid out and opened as a new diagram. */
  createFromBlueprint: (file: BlueprintFile) => Promise<void>
  /**
   * Shows a workspace analysis as a diagram. `mode: 'new'` opens a fresh diagram; `'refresh'`
   * merges into the open generated diagram, keeping positions, labels and manual edits.
   */
  showWorkspaceDiagram: (generated: GeneratedDiagram, mode: 'new' | 'refresh', projectName?: string) => Promise<void>
  /** Adds the callers/callees of the selected node around it, without resetting the layout. */
  addRelated: (entities: WorkspaceEntity[], links: WorkspaceLink[], options: { sessionId: string; workspaceId?: string; fingerprint?: string }) => number
  /** Selects the node of an entity, adding it beside the selection when the diagram lacks it. */
  revealEntity: (entity: WorkspaceEntity, options: { sessionId: string; workspaceId?: string; fingerprint?: string }) => string | null
  /** The source ref of a node, for Open in Code Studio. */
  nodeSource: (nodeId: string) => DiagramCodeRef | undefined
  /** Marks every generated node of a session as stale (the index is older than the buffer). */
  markGeneratedStale: () => void
  /** A sequence diagram from Mermaid-style text, as a new page of the open diagram. */
  addSequencePage: (text: string, name?: string) => void
  addImage: (src: string, position: XYPosition, label?: string, size?: { width: number; height: number }) => string | null
  addPage: () => void
  switchPage: (pageId: string) => void
  renamePage: (pageId: string, name: string) => void
  removePage: (pageId: string) => void
  /** Straightens a crooked connector; false when it was already straight. */
  straighten: (edgeId: string) => boolean
  /** Lines the selected (or all) lifelines up: same top, same height, even spacing. */
  tidySequence: () => void
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
  /** A legend of the colors the diagram already uses, at `position`; false when nothing is colored. */
  addLegend: (position: XYPosition) => boolean
  connect: (connection: Connection) => void
  /** A new shape like the source, centered on `position` and connected to it, in one undo step. */
  connectToNew: (source: string, sourceHandle: string | null, position: XYPosition) => string | null
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

    /** Opens a diagram that came from outside under a fresh id, so importing twice never overwrites. */
    const openNew = async (doc: DiagramDocument) => {
      const fresh = { ...doc, id: newDiagramId() }
      await openDoc(fresh)
      store(fresh)
    }

    /** Shows another page (or a new page list); undo belongs to the page it was recorded on. */
    const showPages = (doc: DiagramDocument) => {
      store(doc)
      set({ history: emptyHistory() })
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
          if (template?.blueprint) {
            const graph = template.layout === 'lanes'
              ? lanesFromBlueprint(template.blueprint, doc.settings.defaultRouting)
              : await diagramFromBlueprint(template.blueprint, doc.settings.defaultRouting, template.layout ? { ...DEFAULT_LAYOUT, direction: template.layout } : undefined)
            Object.assign(doc, graph)
          }
          if (template?.sequence) Object.assign(doc, sequenceFromText(template.sequence))
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

      async importFile(file, at) {
        try {
          const imported = await importDiagramFile(file)
          if (imported.kind === 'diagram') { await openNew(imported.doc); return }
          const size = await imageSize(imported.src)
          const center = at ?? { x: 0, y: 0 }
          get().addImage(imported.src, { x: center.x - size.width / 2, y: center.y - size.height / 2 }, '', size)
        } catch (error) {
          set({ notice: `Could not import “${file.name}”: ${message(error)}` })
        }
      },

      async createFromBlueprint(file) {
        try {
          await openNew(await diagramFromBlueprintFile(file, get().doc?.settings.defaultRouting))
        } catch (error) {
          set({ notice: `Could not generate the diagram: ${message(error)}` })
        }
      },

      async showWorkspaceDiagram(generated, mode, projectName) {
        const { doc } = get()
        const routing = doc?.settings.defaultRouting ?? 'orthogonal'
        const sameOrigin = !!doc?.origin && doc.origin.sessionId === generated.origin.sessionId
        try {
          if (mode === 'new' || !doc || !sameOrigin) {
            const fresh = emptyDiagram(`${projectName ?? 'Workspace'} · ${generated.origin.view}`)
            const graph = await diagramFromBlueprint(generated.blueprint, routing)
            Object.assign(fresh, graph, { origin: generated.origin, name: fresh.name })
            await openNew(fresh)
            if (generated.notes.length) set({ notice: generated.notes.join(' ') })
            return
          }
          const graph = await diagramFromBlueprint(generated.blueprint, routing)
          commit((current) => mergeGeneratedGraph(current, graph).graph)
          const next = get().doc
          if (next) store({ ...next, origin: generated.origin })
          if (generated.notes.length) set({ notice: generated.notes.join(' ') })
        } catch (error) {
          set({ notice: `Could not generate the diagram: ${message(error)}` })
        }
      },

      addRelated(entities, links, options) {
        const { doc } = get()
        const selected = doc?.nodes.find((node) => node.selected) ?? null
        const present = new Set((doc?.nodes ?? []).flatMap((node) => (node.data.source ? [node.data.source.entityId] : [])))
        const graph = relatedGraph(entities, links, selected, { ...options, routing: doc?.settings.defaultRouting ?? 'orthogonal' })
        const isNew = (node: DiagramNode) => !node.data.source || !present.has(node.data.source.entityId)
        const nodes = graph.nodes.filter(isNew)
        const existingPairs = new Set((doc?.edges ?? []).map((edge) => `${edge.source}\u0000${edge.target}`))
        const edges = graph.edges.filter((edge) => !existingPairs.has(`${edge.source}\u0000${edge.target}`))
        if (nodes.length === 0 && edges.length === 0) return 0
        commit((current) => ({ nodes: [...current.nodes, ...nodes], edges: [...current.edges, ...edges] }))
        return nodes.length
      },

      revealEntity(entity, options) {
        const { doc } = get()
        if (!doc) return null
        const existing = doc.nodes.find((node) => node.data.source?.entityId === entity.id)
        if (existing) {
          get().selectFor('node', existing.id)
          return existing.id
        }
        const anchor = doc.nodes.find((node) => node.selected) ?? null
        const node = { ...revealNode(entity, anchor, options), selected: true }
        commit((graph) => ({ ...graph, nodes: [...graph.nodes.map((other) => ({ ...other, selected: false })), node] }))
        return node.id
      },

      nodeSource(nodeId) {
        return get().doc?.nodes.find((node) => node.id === nodeId)?.data.source
      },

      markGeneratedStale() {
        const { doc } = get()
        if (!doc || !doc.origin) return
        if (!doc.nodes.some((node) => node.data.generated && !node.data.stale)) return
        set({ doc: { ...doc, nodes: doc.nodes.map((node) => (node.data.generated ? { ...node, data: { ...node.data, stale: true } } : node)) } })
      },

      addSequencePage(text, name = 'Sequence') {
        const { doc } = get()
        if (!doc) return
        const graph = sequenceFromText(text)
        if (graph.nodes.length === 0) { set({ notice: 'No participant or message found: write lines like “A->>B: call”.' }); return }
        const page = newPage(name, graph)
        showPages(withActivePage({ ...doc, pages: [...syncedPages(doc), page] }, page.id))
      },

      addImage(src, position, label = '', size) {
        const node = { ...createNode('image', position, { image: src, label }), ...(size ?? {}), selected: true }
        commit((graph) => ({ ...graph, nodes: [...graph.nodes.map((other) => ({ ...other, selected: false })), node] }))
        return node.id
      },

      addPage() {
        const { doc } = get()
        if (!doc) return
        const page = newPage(`Page ${doc.pages.length + 1}`)
        showPages(withActivePage({ ...doc, pages: [...syncedPages(doc), page] }, page.id))
      },

      switchPage(pageId) {
        const { doc } = get()
        if (doc && doc.activePageId !== pageId) showPages(withActivePage(doc, pageId))
      },

      renamePage(pageId, name) {
        const { doc } = get()
        const trimmed = name.trim()
        if (doc && trimmed) store({ ...doc, pages: doc.pages.map((page) => (page.id === pageId ? { ...page, name: trimmed } : page)) })
      },

      removePage(pageId) {
        const { doc } = get()
        if (!doc || doc.pages.length < 2) return
        const pages = syncedPages(doc).filter((page) => page.id !== pageId)
        if (doc.activePageId !== pageId) { showPages({ ...doc, pages }); return }
        const first = pages[0]
        showPages({ ...doc, pages, activePageId: first.id, nodes: first.nodes, edges: first.edges, viewport: first.viewport })
      },

      straighten(edgeId) {
        const { doc } = get()
        if (!doc) return false
        const before = graphOf(doc)
        const after = straightenEdge(before, edgeId)
        if (after === before) return false
        commit(() => after)
        return true
      },

      tidySequence() {
        commit((graph) => {
          const isLifeline = (node: DiagramNode) => !node.parentId && shapeOf(node.data.shape).geometry === 'lifeline'
          const selected = graph.nodes.filter((node) => node.selected && isLifeline(node))
          const lifelines = (selected.length > 1 ? selected : graph.nodes.filter(isLifeline)).sort((a, b) => a.position.x - b.position.x)
          if (lifelines.length === 0) return graph
          const top = Math.min(...lifelines.map((node) => node.position.y))
          const height = Math.max(...lifelines.map((node) => node.height ?? 0))
          const left = lifelines[0].position.x
          const placed = new Map(lifelines.map((node, index) => [node.id, { x: left + index * LIFELINE_GAP, y: top }]))
          return { ...graph, nodes: graph.nodes.map((node) => (placed.has(node.id) ? { ...node, position: placed.get(node.id)!, height } : node)) }
        })
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

      addLegend(position) {
        const { doc } = get()
        if (!doc) return false
        const rows = legendFromGraph(doc.nodes, doc.edges)
        if (rows.length === 0) {
          set({ notice: 'Nothing to describe yet: color a shape or a connector, then add the legend.' })
          return false
        }
        const node = { ...createNode('legend', position, { label: 'Legend', legend: rows }), height: legendHeight(rows.length), selected: true }
        commit((graph) => ({ ...graph, nodes: [...graph.nodes.map((other) => ({ ...other, selected: false })), node] }))
        return true
      },

      connect(connection) {
        const { doc } = get()
        if (!doc || connection.source === connection.target) return
        commit((graph) => ({ ...graph, edges: [...graph.edges, createEdge(connection, doc.settings.defaultRouting)] }))
      },

      connectToNew(source, sourceHandle, position) {
        const { doc } = get()
        const from = doc?.nodes.find((node) => node.id === source)
        if (!doc || !from) return null
        const fresh = createNode(from.data.shape, position)
        // Nearly in line with the source: put it exactly in line, so the connector is straight.
        const box = absoluteRect(from, new Map(doc.nodes.map((node) => [node.id, node])))
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const inLine = (value: number, axis: number) => (Math.abs(value - axis) < STRAIGHTEN_WITHIN ? axis : value)
        const at = { x: inLine(position.x, center.x), y: inLine(position.y, center.y) }
        const node = { ...fresh, position: { x: at.x - (fresh.width ?? 0) / 2, y: at.y - (fresh.height ?? 0) / 2 }, selected: true }
        const edge = createEdge({ source, sourceHandle, target: node.id, targetHandle: null }, doc.settings.defaultRouting)
        commit((graph) => ({ nodes: [...graph.nodes.map((other) => ({ ...other, selected: false })), node], edges: [...graph.edges, edge] }))
        get().dropInContainer(node.id)
        return node.id
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

/** The natural size of a picture, scaled to fit 240px, so a dropped image keeps its proportions. */
function imageSize(src: string): Promise<{ width: number; height: number }> {
  const fit = (width: number, height: number) => {
    const scale = Math.min(1, 240 / Math.max(width, height, 1))
    return { width: Math.max(24, Math.round(width * scale)), height: Math.max(24, Math.round(height * scale)) }
  }
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(fit(image.naturalWidth || 96, image.naturalHeight || 96))
    image.onerror = () => resolve({ width: 96, height: 96 })
    image.src = src
  })
}

function upsertSummary(summaries: DiagramSummary[], doc: DiagramDocument): DiagramSummary[] {
  const summary = summaryOf(doc)
  return [summary, ...summaries.filter((item) => item.id !== doc.id)]
}

export const useDiagramStudio = createDiagramStudioStore()

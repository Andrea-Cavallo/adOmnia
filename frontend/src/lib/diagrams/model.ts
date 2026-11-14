/**
 * The Diagram Studio data model: what a diagram is, independent of how it is drawn or stored.
 * Nodes and edges are React Flow's own types with typed data, so the canvas engine reads them as
 * they are and nothing converts back and forth.
 */
import type { Edge, Node, Viewport } from '@xyflow/react'

/** The persisted format version; bump it and add a migration in serialization.ts when the shape changes. */
export const DIAGRAM_FORMAT_VERSION = 2
export const DIAGRAM_FORMAT = 'adomnia-diagram'

export type ShapeCategory = 'basic' | 'flowchart' | 'architecture' | 'integration' | 'uml' | 'sequence' | 'containers' | 'annotations'

/** How strong a relation or a source ref is: written, resolved, guessed or seen at runtime. */
export type LinkConfidence = 'declared' | 'derived' | 'inferred' | 'observed'

/** The views Diagram Studio can generate from an analysed workspace. */
export type DiagramViewKind = 'architecture' | 'service' | 'functions' | 'endpoints' | 'osgi'

/** Where a generated diagram came from, so Refresh can re-analyse the same project. */
export interface DiagramOrigin {
  sessionId: string
  workspaceId?: string
  root?: string
  projectName?: string
  fingerprint?: string
  generatedAt: number
  view: DiagramViewKind
  /** Service or entity the view was focused on, when it was generated with a focus. */
  focusId?: string
  sources?: string[]
}

/**
 * What a generated node points at. The entity id is the adapter's stable id, so a refresh keeps the
 * identity even when the displayed label or the file position moved.
 */
export interface DiagramCodeRef {
  sessionId: string
  workspaceId?: string
  entityId: string
  kind: string
  file?: string
  line?: number
  column?: number
  symbol?: string
  confidence?: LinkConfidence
  fingerprint?: string
}


/** How a shape's outline is drawn; several catalog entries share one geometry. */
export type ShapeGeometry =
  | 'rectangle' | 'rounded' | 'pill' | 'diamond' | 'parallelogram' | 'ellipse' | 'circle'
  | 'cylinder' | 'hexagon' | 'document' | 'queue' | 'cloud' | 'uml-class' | 'package'
  | 'component' | 'container' | 'note' | 'text'
  | 'triangle' | 'star' | 'arrow' | 'subprocess' | 'manual-input' | 'delay' | 'off-page' | 'actor'
  | 'image' | 'legend' | 'lifeline' | 'activation' | 'fragment'

export interface NodeStyle {
  fill: string
  stroke: string
  strokeWidth: number
  /** Corner radius in pixels; 0 keeps the shape's own corners. */
  radius: number
  textColor: string
  fontSize: number
  /** Dashed outline, used by boundaries and optional parts. */
  dashed: boolean
}

export interface DiagramNodeData extends Record<string, unknown> {
  /** Catalog id of the shape (shapes.ts). */
  shape: string
  label: string
  /** A second line under the label: a technology, a port, a stereotype. */
  subtitle?: string
  /** UML compartments: attributes and operations, one per line. */
  attributes?: string
  operations?: string
  style: NodeStyle
  /** Degrees, clockwise; only for shapes that allow it. */
  rotation: number
  locked: boolean
  /** Lucide icon name drawn next to the label. */
  icon?: string
  /** Picture of an image node: a data URL (dropped file) or an app URL (architecture icon). */
  image?: string
  /** Rows of a legend: a swatch and what it means. */
  legend?: LegendEntry[]
  /** Operand separators of a combined fragment (alt/else, par): offset from the top and guard. */
  dividers?: FragmentDivider[]
  /** The analysed entity this shape stands for; absent on shapes the user drew. */
  source?: DiagramCodeRef
  /** Id of the service this entity belongs to, for grouping and focus. */
  service?: string
  /** True for shapes produced by a workspace analysis, false/undefined for manual ones. */
  generated?: boolean
  /** The source file moved or vanished since the analysis: the node is still shown, but stale. */
  stale?: boolean
}

export interface LegendEntry { color: string; label: string; dashed?: boolean }
export interface FragmentDivider { y: number; label: string }

export type EdgeRouting = 'straight' | 'bezier' | 'orthogonal'
export type ArrowHead = 'none' | 'arrow' | 'open' | 'diamond' | 'circle'

export interface Waypoint { x: number; y: number }

export interface DiagramEdgeData extends Record<string, unknown> {
  routing: EdgeRouting
  label: string
  color: string
  thickness: number
  dashed: boolean
  arrowStart: ArrowHead
  arrowEnd: ArrowHead
  /** Glowing pulses travelling along the edge: data flowing from source to target. */
  flow: boolean
  /** Points the connector passes through, in flow coordinates; empty for an automatic route. */
  waypoints: Waypoint[]
  /** Confidence of a relation derived from the code; absent on a connector the user drew. */
  confidence?: LinkConfidence
  /** What proves the relation (an annotation, an import, a call site). */
  evidence?: string
  generated?: boolean
}

export type DiagramNode = Node<DiagramNodeData, 'shape'>
export type DiagramEdge = Edge<DiagramEdgeData, 'smart'>

export interface DiagramGraph {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

/** One page of a multi-page diagram. The active page's content lives in the document's nodes/edges. */
export interface DiagramPage extends DiagramGraph {
  id: string
  name: string
  viewport: Viewport
}

export interface DiagramDocument extends DiagramGraph {
  id: string
  name: string
  viewport: Viewport
  /** Every page; the entry of the active one is refreshed from nodes/edges/viewport on save and switch. */
  pages: DiagramPage[]
  activePageId: string
  /** Canvas preferences saved with the diagram. */
  settings: DiagramSettings
  /** Set on diagrams generated from a Code Studio workspace; absent on drawn diagrams. */
  origin?: DiagramOrigin
  createdAt: number
  updatedAt: number
}

export interface DiagramSettings {
  grid: 'lines' | 'dots' | 'none'
  snapToGrid: boolean
  gridSize: number
  defaultRouting: EdgeRouting
}

export interface DiagramSummary {
  id: string
  name: string
  nodeCount: number
  updatedAt: number
}

export const DEFAULT_SETTINGS: DiagramSettings = { grid: 'dots', snapToGrid: true, gridSize: 16, defaultRouting: 'orthogonal' }
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export const DEFAULT_EDGE_DATA: DiagramEdgeData = {
  routing: 'orthogonal', label: '', color: '', thickness: 1.5, dashed: false,
  arrowStart: 'none', arrowEnd: 'arrow', flow: false, waypoints: [],
}

export function newDiagramId(): string {
  return `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function newElementId(prefix: 'n' | 'e'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function newPage(name: string, graph: DiagramGraph = { nodes: [], edges: [] }, viewport: Viewport = DEFAULT_VIEWPORT): DiagramPage {
  return { id: `page_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, ...graph, viewport }
}

export function emptyDiagram(name = 'Untitled diagram', now = Date.now()): DiagramDocument {
  const page = newPage('Page 1')
  return {
    id: newDiagramId(), name, nodes: [], edges: [], viewport: DEFAULT_VIEWPORT, pages: [page], activePageId: page.id,
    settings: { ...DEFAULT_SETTINGS }, createdAt: now, updatedAt: now,
  }
}

/** The pages with the active one carrying the current canvas content. */
export function syncedPages(doc: DiagramDocument): DiagramPage[] {
  return doc.pages.map((page) => (page.id === doc.activePageId ? { ...page, nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport } : page))
}

/** The document showing another of its pages. */
export function withActivePage(doc: DiagramDocument, pageId: string): DiagramDocument {
  const pages = syncedPages(doc)
  const page = pages.find((candidate) => candidate.id === pageId)
  if (!page) return doc
  return { ...doc, pages, activePageId: page.id, nodes: page.nodes, edges: page.edges, viewport: page.viewport }
}

export const summaryOf = (doc: DiagramDocument): DiagramSummary => ({ id: doc.id, name: doc.name, nodeCount: syncedPages(doc).reduce((sum, page) => sum + page.nodes.length, 0), updatedAt: doc.updatedAt })

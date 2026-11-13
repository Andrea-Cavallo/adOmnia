/**
 * The Diagram Studio data model: what a diagram is, independent of how it is drawn or stored.
 * Nodes and edges are React Flow's own types with typed data, so the canvas engine reads them as
 * they are and nothing converts back and forth.
 */
import type { Edge, Node, Viewport } from '@xyflow/react'

/** The persisted format version; bump it and add a migration in serialization.ts when the shape changes. */
export const DIAGRAM_FORMAT_VERSION = 1
export const DIAGRAM_FORMAT = 'adomnia-diagram'

export type ShapeCategory = 'basic' | 'flowchart' | 'architecture' | 'integration' | 'uml' | 'containers' | 'annotations'

/** How a shape's outline is drawn; several catalog entries share one geometry. */
export type ShapeGeometry =
  | 'rectangle' | 'rounded' | 'pill' | 'diamond' | 'parallelogram' | 'ellipse' | 'circle'
  | 'cylinder' | 'hexagon' | 'document' | 'queue' | 'cloud' | 'uml-class' | 'package'
  | 'component' | 'container' | 'note' | 'text'
  | 'triangle' | 'star' | 'arrow' | 'subprocess' | 'manual-input' | 'delay' | 'off-page' | 'actor'

export interface NodeStyle {
  fill: string
  stroke: string
  strokeWidth: number
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
}

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
}

export type DiagramNode = Node<DiagramNodeData, 'shape'>
export type DiagramEdge = Edge<DiagramEdgeData, 'smart'>

export interface DiagramGraph {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

export interface DiagramDocument extends DiagramGraph {
  id: string
  name: string
  viewport: Viewport
  /** Canvas preferences saved with the diagram. */
  settings: DiagramSettings
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

export function emptyDiagram(name = 'Untitled diagram', now = Date.now()): DiagramDocument {
  return {
    id: newDiagramId(), name, nodes: [], edges: [], viewport: DEFAULT_VIEWPORT,
    settings: { ...DEFAULT_SETTINGS }, createdAt: now, updatedAt: now,
  }
}

export const summaryOf = (doc: DiagramDocument): DiagramSummary => ({ id: doc.id, name: doc.name, nodeCount: doc.nodes.length, updatedAt: doc.updatedAt })

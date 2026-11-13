/**
 * Diagrams as versioned JSON: what is saved in bbolt and what Export/Import JSON writes and reads.
 * Reading is defensive: a missing field gets its default, an edge to a missing node is dropped, a
 * file from a newer adOmnia is refused with a clear message instead of being half-read.
 */
import { cleanGraph } from './history'
import {
  DEFAULT_EDGE_DATA, DEFAULT_SETTINGS, DEFAULT_VIEWPORT, DIAGRAM_FORMAT, DIAGRAM_FORMAT_VERSION, newDiagramId,
  type DiagramDocument, type DiagramEdge, type DiagramEdgeData, type DiagramNode,
} from './model'
import { DEFAULT_NODE_STYLE } from './shapes'

export class DiagramFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiagramFormatError'
  }
}

interface DiagramFile extends DiagramDocument {
  format: typeof DIAGRAM_FORMAT
  version: number
}

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const finite = (value: unknown, fallback: number) => (isFiniteNumber(value) ? value : fallback)

/**
 * Upgrades of older files, keyed by the version they upgrade from. Version 1 is the first: when the
 * format changes, add `1: (file) => ({ ...file, version: 2, ... })` and bump DIAGRAM_FORMAT_VERSION.
 */
const MIGRATIONS: Record<number, (file: Raw) => Raw> = {}

export function serializeDiagram(doc: DiagramDocument): string {
  const graph = cleanGraph(doc)
  const file: DiagramFile = { format: DIAGRAM_FORMAT, version: DIAGRAM_FORMAT_VERSION, ...doc, nodes: graph.nodes, edges: graph.edges }
  return JSON.stringify(file, null, 2)
}

export function parseDiagram(json: string): DiagramDocument {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new DiagramFormatError('The file is not valid JSON.')
  }
  return readDiagram(raw)
}

export function readDiagram(raw: unknown): DiagramDocument {
  if (!isRecord(raw) || raw.format !== DIAGRAM_FORMAT) throw new DiagramFormatError('This is not an adOmnia diagram (format "adomnia-diagram" missing).')
  const file = migrate(raw)
  if (!Array.isArray(file.nodes) || !Array.isArray(file.edges)) throw new DiagramFormatError('The diagram has no nodes or edges list.')
  const nodes = orderParentsFirst(file.nodes.map((node, index) => readNode(node, index)))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = file.edges.flatMap((edge) => readEdge(edge, ids))
  const viewport = isRecord(file.viewport) ? file.viewport : {}
  const settings = isRecord(file.settings) ? file.settings : {}
  const now = Date.now()
  return {
    id: text(file.id) || newDiagramId(),
    name: text(file.name) || 'Untitled diagram',
    nodes,
    edges,
    viewport: { x: finite(viewport.x, DEFAULT_VIEWPORT.x), y: finite(viewport.y, DEFAULT_VIEWPORT.y), zoom: finite(viewport.zoom, DEFAULT_VIEWPORT.zoom) },
    settings: { ...DEFAULT_SETTINGS, ...settings } as DiagramDocument['settings'],
    createdAt: finite(file.createdAt, now),
    updatedAt: finite(file.updatedAt, now),
  }
}

function migrate(raw: Raw): Raw {
  let file = raw
  let version = finite(file.version, 0)
  if (version > DIAGRAM_FORMAT_VERSION) {
    throw new DiagramFormatError(`The diagram was saved by a newer adOmnia (format ${version}); update adOmnia to open it.`)
  }
  while (version < DIAGRAM_FORMAT_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new DiagramFormatError(`No upgrade from diagram format ${version}.`)
    file = step(file)
    version = finite(file.version, version + 1)
  }
  return file
}

function readNode(raw: unknown, index: number): DiagramNode {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.position) || !isRecord(raw.data)) {
    throw new DiagramFormatError(`Node ${index + 1} is incomplete (id, position and data are required).`)
  }
  const data = raw.data
  const style = isRecord(data.style) ? data.style : {}
  const node: DiagramNode = {
    id: raw.id,
    type: 'shape',
    position: { x: finite(raw.position.x, 0), y: finite(raw.position.y, 0) },
    data: {
      shape: text(data.shape, 'process'),
      label: text(data.label),
      subtitle: typeof data.subtitle === 'string' ? data.subtitle : undefined,
      attributes: typeof data.attributes === 'string' ? data.attributes : undefined,
      operations: typeof data.operations === 'string' ? data.operations : undefined,
      style: { ...DEFAULT_NODE_STYLE, ...style } as DiagramNode['data']['style'],
      rotation: finite(data.rotation, 0),
      locked: data.locked === true,
      icon: typeof data.icon === 'string' ? data.icon : undefined,
    },
  }
  if (isFiniteNumber(raw.width)) node.width = raw.width
  if (isFiniteNumber(raw.height)) node.height = raw.height
  if (isFiniteNumber(raw.zIndex)) node.zIndex = raw.zIndex
  if (typeof raw.parentId === 'string') node.parentId = raw.parentId
  if (node.data.locked) { node.draggable = false; node.deletable = false }
  return node
}

function readEdge(raw: unknown, ids: ReadonlySet<string>): DiagramEdge[] {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.source !== 'string' || typeof raw.target !== 'string') return []
  if (!ids.has(raw.source) || !ids.has(raw.target)) return []
  const data = isRecord(raw.data) ? raw.data : {}
  const waypoints = Array.isArray(data.waypoints)
    ? data.waypoints.filter((point): point is { x: number; y: number } => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y)).map(({ x, y }) => ({ x, y }))
    : []
  return [{
    id: raw.id,
    type: 'smart',
    source: raw.source,
    target: raw.target,
    sourceHandle: typeof raw.sourceHandle === 'string' ? raw.sourceHandle : null,
    targetHandle: typeof raw.targetHandle === 'string' ? raw.targetHandle : null,
    data: { ...DEFAULT_EDGE_DATA, ...data, waypoints } as DiagramEdgeData,
  }]
}

/** React Flow needs a container before the nodes inside it; a parent that is missing is dropped. */
export function orderParentsFirst(nodes: DiagramNode[]): DiagramNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ordered: DiagramNode[] = []
  const placed = new Set<string>()
  const visit = (node: DiagramNode, trail: Set<string>) => {
    if (placed.has(node.id)) return
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    let current = node
    if (node.parentId && (!parent || trail.has(parent.id))) {
      const { parentId: _orphan, ...rest } = node
      current = rest
    } else if (parent) {
      visit(parent, new Set([...trail, node.id]))
    }
    placed.add(current.id)
    ordered.push(current)
  }
  for (const node of nodes) visit(node, new Set([node.id]))
  return ordered
}

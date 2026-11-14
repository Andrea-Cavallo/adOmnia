/**
 * Diagrams as versioned JSON: what is saved in bbolt and what Export/Import JSON writes and reads.
 * Reading is defensive: a missing field gets its default, an edge to a missing node is dropped, a
 * file from a newer adOmnia is refused with a clear message instead of being half-read.
 */
import { cleanGraph } from './history'
import {
  DEFAULT_EDGE_DATA, DEFAULT_SETTINGS, DEFAULT_VIEWPORT, DIAGRAM_FORMAT, DIAGRAM_FORMAT_VERSION, newDiagramId, syncedPages,
  type DiagramCodeRef, type DiagramDocument, type DiagramEdge, type DiagramEdgeData, type DiagramNode, type DiagramOrigin, type DiagramPage, type FragmentDivider, type LegendEntry, type LinkConfidence,
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
const MIGRATIONS: Record<number, (file: Raw) => Raw> = {
  // Version 2 adds pages: a version 1 diagram is one page.
  1: (file) => ({ ...file, version: 2, activePageId: 'page_1', pages: [{ id: 'page_1', name: 'Page 1', nodes: file.nodes, edges: file.edges, viewport: file.viewport }] }),
}

export function serializeDiagram(doc: DiagramDocument): string {
  const graph = cleanGraph(doc)
  const pages = syncedPages(doc).map((page) => ({ ...page, ...cleanGraph(page) }))
  const file: DiagramFile = { format: DIAGRAM_FORMAT, version: DIAGRAM_FORMAT_VERSION, ...doc, nodes: graph.nodes, edges: graph.edges, pages }
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
  if (!Array.isArray(file.pages) || file.pages.length === 0) throw new DiagramFormatError('The diagram has no pages.')
  const pages = file.pages.map((page, index) => readPage(page, index))
  const active = pages.find((page) => page.id === file.activePageId) ?? pages[0]
  const settings = isRecord(file.settings) ? file.settings : {}
  const now = Date.now()
  return {
    id: text(file.id) || newDiagramId(),
    name: text(file.name) || 'Untitled diagram',
    nodes: active.nodes,
    edges: active.edges,
    viewport: active.viewport,
    pages,
    activePageId: active.id,
    settings: { ...DEFAULT_SETTINGS, ...settings } as DiagramDocument['settings'],
    ...(originOf(file.origin) ? { origin: originOf(file.origin)! } : {}),
    createdAt: finite(file.createdAt, now),
    updatedAt: finite(file.updatedAt, now),
  }
}

const VIEWS = new Set(['architecture', 'service', 'functions', 'endpoints', 'osgi'])
const CONFIDENCES = new Set(['declared', 'derived', 'inferred', 'observed'])

/** Origin is optional and validated: a diagram drawn before generation existed has none. */
export function originOf(value: unknown): DiagramOrigin | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !value.sessionId) return undefined
  const view = text(value.view, 'architecture')
  return {
    sessionId: value.sessionId,
    workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : undefined,
    root: typeof value.root === 'string' ? value.root : undefined,
    projectName: typeof value.projectName === 'string' ? value.projectName : undefined,
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : undefined,
    generatedAt: finite(value.generatedAt, Date.now()),
    view: (VIEWS.has(view) ? view : 'architecture') as DiagramOrigin['view'],
    focusId: typeof value.focusId === 'string' ? value.focusId : undefined,
    sources: Array.isArray(value.sources) ? value.sources.filter((entry): entry is string => typeof entry === 'string') : undefined,
  }
}

/** A source ref is only kept when it identifies an analysed entity; a partial ref is dropped. */
export function codeRefOf(value: unknown): DiagramCodeRef | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !value.sessionId) return undefined
  if (typeof value.entityId !== 'string' || !value.entityId) return undefined
  const confidence = typeof value.confidence === 'string' && CONFIDENCES.has(value.confidence) ? value.confidence as LinkConfidence : undefined
  return {
    sessionId: value.sessionId,
    workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : undefined,
    entityId: value.entityId,
    kind: text(value.kind, 'other'),
    file: typeof value.file === 'string' ? value.file : undefined,
    line: isFiniteNumber(value.line) && value.line > 0 ? value.line : undefined,
    column: isFiniteNumber(value.column) && value.column > 0 ? value.column : undefined,
    symbol: typeof value.symbol === 'string' ? value.symbol : undefined,
    confidence,
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : undefined,
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

function readPage(raw: unknown, index: number): DiagramPage {
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new DiagramFormatError(`Page ${index + 1} has no nodes or edges list.`)
  const nodes = orderParentsFirst(raw.nodes.map((node, at) => readNode(node, at)))
  const ids = new Set(nodes.map((node) => node.id))
  const viewport = isRecord(raw.viewport) ? raw.viewport : {}
  return {
    id: text(raw.id) || `page_${index + 1}`,
    name: text(raw.name) || `Page ${index + 1}`,
    nodes,
    edges: raw.edges.flatMap((edge) => readEdge(edge, ids)),
    viewport: { x: finite(viewport.x, DEFAULT_VIEWPORT.x), y: finite(viewport.y, DEFAULT_VIEWPORT.y), zoom: finite(viewport.zoom, DEFAULT_VIEWPORT.zoom) },
  }
}

const legendOf = (value: unknown): LegendEntry[] | undefined => (Array.isArray(value)
  ? value.filter(isRecord).map((entry) => ({ color: text(entry.color), label: text(entry.label), ...(entry.dashed === true ? { dashed: true } : {}) }))
  : undefined)
const dividersOf = (value: unknown): FragmentDivider[] | undefined => (Array.isArray(value)
  ? value.filter((entry): entry is Raw => isRecord(entry) && isFiniteNumber(entry.y)).map((entry) => ({ y: entry.y as number, label: text(entry.label) }))
  : undefined)

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
      image: typeof data.image === 'string' ? data.image : undefined,
      legend: legendOf(data.legend),
      dividers: dividersOf(data.dividers),
      ...(codeRefOf(data.source) ? { source: codeRefOf(data.source)! } : {}),
      ...(typeof data.service === 'string' ? { service: data.service } : {}),
      ...(data.generated === true ? { generated: true } : {}),
      ...(data.stale === true ? { stale: true } : {}),
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

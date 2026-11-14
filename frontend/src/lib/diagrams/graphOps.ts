/**
 * Editing operations on a diagram graph. Every function is pure: it takes a graph and returns a new
 * one, so undo/redo is a stack of snapshots and every operation is unit tested without a canvas.
 * Positions of grouped nodes are relative to their container (React Flow's parentId model).
 */
import type { Connection, XYPosition } from '@xyflow/react'
import {
  DEFAULT_EDGE_DATA, newElementId,
  type DiagramEdge, type DiagramEdgeData, type DiagramGraph, type DiagramNode, type DiagramNodeData, type EdgeRouting,
} from './model'
import { DEFAULT_NODE_STYLE, shapeOf } from './shapes'

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'
export type LayerMove = 'front' | 'back' | 'forward' | 'backward'

export interface Rect { x: number; y: number; width: number; height: number }
export interface Clipboard { nodes: DiagramNode[]; edges: DiagramEdge[] }

/** Space between a new group's border and the nodes it encloses; room for the title on top. */
export const GROUP_PADDING = 24
const GROUP_TITLE_SPACE = 28
/** Containers sit below every other node; the layer moves keep the rest above this. */
const CONTAINER_Z = -10

// ---- creating

export function createNode(shapeId: string, position: XYPosition, overrides: Partial<DiagramNodeData> = {}): DiagramNode {
  const definition = shapeOf(shapeId)
  const data: DiagramNodeData = {
    shape: definition.id,
    label: definition.text ?? definition.label,
    subtitle: definition.subtitle,
    attributes: definition.compartments?.attributes,
    operations: definition.compartments?.operations,
    style: { ...DEFAULT_NODE_STYLE, ...definition.style },
    rotation: 0,
    locked: false,
    icon: definition.icon,
    ...(definition.legend ? { legend: definition.legend.map((entry) => ({ ...entry })) } : {}),
    ...(definition.dividers ? { dividers: definition.dividers.map((entry) => ({ ...entry })) } : {}),
    ...overrides,
  }
  return {
    id: newElementId('n'),
    type: 'shape',
    position,
    width: definition.width,
    height: definition.height,
    zIndex: definition.container ? CONTAINER_Z : 0,
    data,
  }
}

export function createEdge(connection: Connection, routing: EdgeRouting, overrides: Partial<DiagramEdgeData> = {}): DiagramEdge {
  return {
    id: newElementId('e'),
    type: 'smart',
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? null,
    targetHandle: connection.targetHandle ?? null,
    data: { ...DEFAULT_EDGE_DATA, waypoints: [], routing, ...overrides },
  }
}

// ---- geometry

export function nodeSize(node: DiagramNode): { width: number; height: number } {
  const definition = shapeOf(node.data.shape)
  return {
    width: node.width ?? node.measured?.width ?? definition.width,
    height: node.height ?? node.measured?.height ?? definition.height,
  }
}

/** Where a node really is: its position plus those of the containers it sits in. */
export function absolutePosition(node: DiagramNode, byId: ReadonlyMap<string, DiagramNode>): XYPosition {
  let x = node.position.x
  let y = node.position.y
  const seen = new Set([node.id])
  let parentId = node.parentId
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId)
    if (!parent) break
    seen.add(parentId)
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentId
  }
  return { x, y }
}

export const indexNodes = (nodes: readonly DiagramNode[]) => new Map(nodes.map((node) => [node.id, node]))

export function absoluteRect(node: DiagramNode, byId: ReadonlyMap<string, DiagramNode>): Rect {
  return { ...absolutePosition(node, byId), ...nodeSize(node) }
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** Moves a node to an absolute point, keeping it inside its container's coordinates. */
function placeAt(node: DiagramNode, absolute: XYPosition, byId: ReadonlyMap<string, DiagramNode>): DiagramNode {
  const parent = node.parentId ? byId.get(node.parentId) : undefined
  const origin = parent ? absolutePosition(parent, byId) : { x: 0, y: 0 }
  return { ...node, position: { x: absolute.x - origin.x, y: absolute.y - origin.y } }
}

const editable = (node: DiagramNode) => !node.data.locked

// ---- updating

export function updateNodeData(graph: DiagramGraph, ids: readonly string[], patch: Partial<DiagramNodeData>): DiagramGraph {
  const targets = new Set(ids)
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (targets.has(node.id) ? { ...node, data: { ...node.data, ...patch, style: { ...node.data.style, ...patch.style } } } : node)),
  }
}

export function updateEdgeData(graph: DiagramGraph, ids: readonly string[], patch: Partial<DiagramEdgeData>): DiagramGraph {
  const targets = new Set(ids)
  return {
    ...graph,
    edges: graph.edges.map((edge) => (targets.has(edge.id) ? { ...edge, data: { ...DEFAULT_EDGE_DATA, ...edge.data, ...patch } } : edge)),
  }
}

/** Locks nodes in place: they cannot be dragged, resized, deleted or connected by accident. */
export function setLocked(graph: DiagramGraph, ids: readonly string[], locked: boolean): DiagramGraph {
  const targets = new Set(ids)
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (targets.has(node.id) ? { ...node, draggable: !locked, deletable: !locked, data: { ...node.data, locked } } : node)),
  }
}

// ---- deleting, copying, pasting

/**
 * Removes nodes and edges. Locked nodes stay; edges touching a removed node go with it; nodes inside
 * a removed container stay where they are on the canvas.
 */
export function deleteElements(graph: DiagramGraph, nodeIds: readonly string[], edgeIds: readonly string[] = []): DiagramGraph {
  const byId = indexNodes(graph.nodes)
  const removed = new Set(nodeIds.filter((id) => { const node = byId.get(id); return node !== undefined && editable(node) }))
  const removedEdges = new Set(edgeIds)
  const nodes = graph.nodes
    .filter((node) => !removed.has(node.id))
    .map((node) => (node.parentId && removed.has(node.parentId) ? detach(node, byId) : node))
  const edges = graph.edges.filter((edge) => !removedEdges.has(edge.id) && !removed.has(edge.source) && !removed.has(edge.target))
  return { nodes, edges }
}

function detach(node: DiagramNode, byId: ReadonlyMap<string, DiagramNode>): DiagramNode {
  const { parentId: _parent, extent: _extent, ...rest } = node
  return { ...rest, position: absolutePosition(node, byId) }
}

/** Copies the chosen nodes, the nodes inside chosen containers and the edges between them. */
export function copySelection(graph: DiagramGraph, nodeIds: readonly string[]): Clipboard {
  const chosen = new Set(nodeIds)
  let grew = true
  while (grew) {
    grew = false
    for (const node of graph.nodes) {
      if (node.parentId && chosen.has(node.parentId) && !chosen.has(node.id)) { chosen.add(node.id); grew = true }
    }
  }
  const byId = indexNodes(graph.nodes)
  const nodes = graph.nodes
    .filter((node) => chosen.has(node.id))
    .map((node) => (node.parentId && !chosen.has(node.parentId) ? detach(node, byId) : node))
  const edges = graph.edges.filter((edge) => chosen.has(edge.source) && chosen.has(edge.target))
  return structuredClone({ nodes, edges })
}

/** Adds a copy with fresh ids, shifted by offset; returns the new graph and the ids to select. */
export function pasteClipboard(graph: DiagramGraph, clipboard: Clipboard, offset: XYPosition): { graph: DiagramGraph; nodeIds: string[] } {
  const ids = new Map(clipboard.nodes.map((node) => [node.id, newElementId('n')]))
  const nodes = clipboard.nodes.map((node): DiagramNode => {
    const parentId = node.parentId ? ids.get(node.parentId) : undefined
    const position = parentId ? node.position : { x: node.position.x + offset.x, y: node.position.y + offset.y }
    return { ...structuredClone(node), id: ids.get(node.id)!, parentId, position, selected: true }
  })
  const edges = clipboard.edges.map((edge): DiagramEdge => ({
    ...structuredClone(edge), id: newElementId('e'), source: ids.get(edge.source)!, target: ids.get(edge.target)!, selected: false,
  }))
  const deselected = graph.nodes.map((node) => (node.selected ? { ...node, selected: false } : node))
  return { graph: { nodes: [...deselected, ...nodes], edges: [...graph.edges, ...edges] }, nodeIds: nodes.map((node) => node.id) }
}

export function duplicateSelection(graph: DiagramGraph, nodeIds: readonly string[], offset: XYPosition = { x: 24, y: 24 }) {
  return pasteClipboard(graph, copySelection(graph, nodeIds), offset)
}

// ---- grouping

/** Wraps the nodes in a new container sized to them; they keep their place on the canvas. */
export function groupNodes(graph: DiagramGraph, nodeIds: readonly string[], label = 'Group'): { graph: DiagramGraph; groupId: string | null } {
  const byId = indexNodes(graph.nodes)
  const members = nodeIds.map((id) => byId.get(id)).filter((node): node is DiagramNode => node !== undefined && !node.parentId)
  const box = boundsOf(members.map((node) => absoluteRect(node, byId)))
  if (!box || members.length < 2) return { graph, groupId: null }
  const group = createNode('container', { x: box.x - GROUP_PADDING, y: box.y - GROUP_PADDING - GROUP_TITLE_SPACE }, { label })
  group.width = box.width + GROUP_PADDING * 2
  group.height = box.height + GROUP_PADDING * 2 + GROUP_TITLE_SPACE
  const inside = new Set(members.map((node) => node.id))
  const nodes = graph.nodes.map((node) => (inside.has(node.id)
    ? { ...node, parentId: group.id, position: { x: node.position.x - group.position.x, y: node.position.y - group.position.y } }
    : node))
  // A parent must come before its children in React Flow's node array.
  return { graph: { ...graph, nodes: [group, ...nodes] }, groupId: group.id }
}

/** Removes a container and puts its nodes back on the canvas where they were. */
export function ungroup(graph: DiagramGraph, groupId: string): DiagramGraph {
  const byId = indexNodes(graph.nodes)
  if (!byId.has(groupId)) return graph
  const nodes = graph.nodes
    .filter((node) => node.id !== groupId)
    .map((node) => (node.parentId === groupId ? detach(node, byId) : node))
  return { nodes, edges: graph.edges.filter((edge) => edge.source !== groupId && edge.target !== groupId) }
}

/**
 * Puts a dropped node into the container under its center, or takes it out when it left one.
 * Keeps the node's place on the canvas either way.
 */
export function reparentByDrop(graph: DiagramGraph, nodeId: string): DiagramGraph {
  const byId = indexNodes(graph.nodes)
  const node = byId.get(nodeId)
  if (!node || shapeOf(node.data.shape).container) return graph
  const rect = absoluteRect(node, byId)
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const host = graph.nodes.find((candidate) => {
    if (candidate.id === nodeId || !shapeOf(candidate.data.shape).container) return false
    const box = absoluteRect(candidate, byId)
    return center.x > box.x && center.x < box.x + box.width && center.y > box.y && center.y < box.y + box.height
  })
  if ((host?.id ?? undefined) === node.parentId) return graph
  const absolute = absolutePosition(node, byId)
  const moved: DiagramNode = host
    ? { ...node, parentId: host.id, position: { x: absolute.x - absolutePosition(host, byId).x, y: absolute.y - absolutePosition(host, byId).y } }
    : detach(node, byId)
  // Keep parents ahead of children in the array.
  const others = graph.nodes.filter((candidate) => candidate.id !== nodeId)
  const hostIndex = host ? others.findIndex((candidate) => candidate.id === host.id) : -1
  const nodes = hostIndex >= 0 ? [...others.slice(0, hostIndex + 1), moved, ...others.slice(hostIndex + 1)] : [...others, moved]
  return { ...graph, nodes }
}

// ---- align, distribute, layers

export function alignNodes(graph: DiagramGraph, nodeIds: readonly string[], mode: AlignMode): DiagramGraph {
  const byId = indexNodes(graph.nodes)
  const members = nodeIds.map((id) => byId.get(id)).filter((node): node is DiagramNode => node !== undefined && editable(node))
  const box = boundsOf(members.map((node) => absoluteRect(node, byId)))
  if (!box || members.length < 2) return graph
  const target = new Map(members.map((node) => {
    const rect = absoluteRect(node, byId)
    const x = { left: box.x, center: box.x + (box.width - rect.width) / 2, right: box.x + box.width - rect.width }
    const y = { top: box.y, middle: box.y + (box.height - rect.height) / 2, bottom: box.y + box.height - rect.height }
    const horizontal = mode === 'left' || mode === 'center' || mode === 'right'
    return [node.id, horizontal ? { x: x[mode as 'left'], y: rect.y } : { x: rect.x, y: y[mode as 'top'] }] as const
  }))
  return { ...graph, nodes: graph.nodes.map((node) => (target.has(node.id) ? placeAt(node, target.get(node.id)!, byId) : node)) }
}

/** Spaces the nodes evenly between the first and the last along an axis. */
export function distributeNodes(graph: DiagramGraph, nodeIds: readonly string[], axis: DistributeAxis): DiagramGraph {
  const byId = indexNodes(graph.nodes)
  const horizontal = axis === 'horizontal'
  const members = nodeIds
    .map((id) => byId.get(id))
    .filter((node): node is DiagramNode => node !== undefined && editable(node))
    .map((node) => ({ node, rect: absoluteRect(node, byId) }))
    .sort((a, b) => (horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
  if (members.length < 3) return graph
  const start = horizontal ? members[0].rect.x : members[0].rect.y
  const last = members[members.length - 1].rect
  const end = horizontal ? last.x + last.width : last.y + last.height
  const occupied = members.reduce((sum, { rect }) => sum + (horizontal ? rect.width : rect.height), 0)
  const gap = (end - start - occupied) / (members.length - 1)
  const target = new Map<string, XYPosition>()
  let cursor = start
  for (const { node, rect } of members) {
    target.set(node.id, horizontal ? { x: cursor, y: rect.y } : { x: rect.x, y: cursor })
    cursor += (horizontal ? rect.width : rect.height) + gap
  }
  return { ...graph, nodes: graph.nodes.map((node) => (target.has(node.id) ? placeAt(node, target.get(node.id)!, byId) : node)) }
}

/** Changes the drawing order; containers keep their own lower band so they never hide their nodes. */
export function moveLayer(graph: DiagramGraph, nodeIds: readonly string[], move: LayerMove): DiagramGraph {
  const targets = new Set(nodeIds)
  const layers = graph.nodes.map((node) => node.zIndex ?? 0)
  const top = Math.max(0, ...layers)
  const bottom = Math.min(0, ...layers.filter((z) => z > CONTAINER_Z))
  const next = (node: DiagramNode) => {
    const z = node.zIndex ?? 0
    if (shapeOf(node.data.shape).container) return z
    if (move === 'front') return top + 1
    if (move === 'back') return bottom - 1 > CONTAINER_Z ? bottom - 1 : CONTAINER_Z + 1
    if (move === 'forward') return z + 1
    return Math.max(CONTAINER_Z + 1, z - 1)
  }
  return { ...graph, nodes: graph.nodes.map((node) => (targets.has(node.id) ? { ...node, zIndex: next(node) } : node)) }
}

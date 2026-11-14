/**
 * "Straighten this connector" (double-click on a crooked line): bends go away and one end moves so
 * the line is exactly horizontal or vertical, whichever it is closer to. A sequence message between
 * two rows of lifelines snaps its target to the source's row instead of moving a lifeline.
 */
import { handleConstraint } from './drawio'
import { absoluteRect, indexNodes, type Rect } from './graphOps'
import type { DiagramEdge, DiagramGraph, DiagramNode } from './model'

const ROW_HANDLE = /^([LR])(\d+)$/

function anchor(node: DiagramNode, handle: string | null | undefined, rect: Rect): { x: number; y: number } {
  const at = handleConstraint(node, handle)
  return at ? { x: rect.x + at.x * rect.width, y: rect.y + at.y * rect.height } : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

const withEdge = (graph: DiagramGraph, edge: DiagramEdge, patch: Partial<DiagramEdge>): DiagramGraph => ({
  ...graph,
  edges: graph.edges.map((candidate) => (candidate.id === edge.id ? { ...candidate, ...patch, data: candidate.data && { ...candidate.data, waypoints: [] } } : candidate)),
})

/** The graph with the connector straightened; the same graph when it already is straight. */
export function straightenEdge(graph: DiagramGraph, edgeId: string): DiagramGraph {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId)
  const byId = indexNodes(graph.nodes)
  const source = edge && byId.get(edge.source)
  const target = edge && byId.get(edge.target)
  if (!edge || !source || !target) return graph
  const bent = (edge.data?.waypoints.length ?? 0) > 0

  const sourceRow = ROW_HANDLE.exec(edge.sourceHandle ?? '')
  const targetRow = ROW_HANDLE.exec(edge.targetHandle ?? '')
  if (sourceRow && targetRow && edge.source !== edge.target) {
    if (sourceRow[2] === targetRow[2] && !bent) return graph
    return withEdge(graph, edge, { targetHandle: `${targetRow[1]}${sourceRow[2]}` })
  }

  const from = anchor(source, edge.sourceHandle, absoluteRect(source, byId))
  const to = anchor(target, edge.targetHandle, absoluteRect(target, byId))
  const dx = to.x - from.x
  const dy = to.y - from.y
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const off = horizontal ? dy : dx
  if (Math.abs(off) < 0.5 && !bent) return graph
  // Move the target; a locked target stays and the source moves the other way.
  const [moving, sign] = target.data.locked ? [source, -1] : [target, 1]
  if (moving.data.locked) return withEdge(graph, edge, {})
  const shift = horizontal ? { x: 0, y: -off * sign } : { x: -off * sign, y: 0 }
  const moved = withEdge(graph, edge, {})
  return {
    ...moved,
    nodes: moved.nodes.map((node) => (node.id === moving.id ? { ...node, position: { x: node.position.x + shift.x, y: node.position.y + shift.y } } : node)),
  }
}

import type { FlowEdgeDefinition, FlowGraphDefinition, FlowNodeDefinition } from './flowStorage'

// Compact canvas: a node is a slim row, details are revealed on hover, not baked
// into the box. Sizes are fixed per type so older saved flows (which stored the
// tall card dimensions) render with the same compact geometry.
const sizes = {
  start: { w: 110, h: 44 }, request: { w: 256, h: 44 },
  condition: { w: 208, h: 44 }, end: { w: 150, h: 44 }, extract: { w: 208, h: 44 },
}

const COLUMN_GAP = 112
const ROW_GAP = 104

export function flowNodeSize(node: FlowNodeDefinition) {
  return sizes[node.type] ?? sizes.request
}

/** Lay out connected steps in execution order; retain branches and cycle edges. */
export function layoutFlow(graph: FlowGraphDefinition): FlowGraphDefinition {
  const ranks = new Map<string, number>()
  const remaining = new Map(graph.nodes.map(node => [node.id, graph.edges.filter(edge => edge.target === node.id).length]))
  const queue = graph.nodes.filter(node => !remaining.get(node.id)).map(node => node.id)
  if (!queue.length && graph.nodes[0]) queue.push(graph.nodes[0].id)
  for (const id of queue) {
    if (!ranks.has(id)) ranks.set(id, 0)
    for (const edge of graph.edges.filter(edge => edge.source === id)) {
      if (queue.includes(edge.target)) continue
      ranks.set(edge.target, Math.max(ranks.get(edge.target) ?? 0, (ranks.get(id) ?? 0) + 1))
      remaining.set(edge.target, (remaining.get(edge.target) ?? 1) - 1)
      if (remaining.get(edge.target) === 0) queue.push(edge.target)
    }
  }
  // Cycles have no topological order. Place unvisited nodes once, without changing edges.
  for (const node of graph.nodes) if (!queue.includes(node.id)) {
    ranks.set(node.id, Math.max(0, ...ranks.values()) + 1)
    queue.push(node.id)
  }
  const columns = new Map<number, FlowNodeDefinition[]>()
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id) ?? 0
    columns.set(rank, [...(columns.get(rank) ?? []), node])
  }
  const maxRows = Math.max(1, ...[...columns.values()].map(nodes => nodes.length))
  const positions = new Map<string, { x: number; y: number }>()
  let x = 64
  for (const [, nodes] of [...columns].sort(([a], [b]) => a - b)) {
    nodes.forEach((node, row) => positions.set(node.id, { x, y: 120 + ((maxRows - nodes.length) / 2 + row) * ROW_GAP }))
    x += Math.max(...nodes.map(node => flowNodeSize(node).w)) + COLUMN_GAP
  }
  return { ...graph, nodes: graph.nodes.map(node => ({ ...node, ...positions.get(node.id) })) }
}

export function flowEdgePath(edge: FlowEdgeDefinition, nodes: Map<string, FlowNodeDefinition>) {
  const source = nodes.get(edge.source), target = nodes.get(edge.target)
  if (!source || !target) return null
  const a = flowNodeSize(source), b = flowNodeSize(target)
  const negative = ['false', 'else', 'error'].includes(edge.branch)
  const tx = target.x - 6, ty = target.y + b.h / 2
  const sy = source.y + a.h / 2
  const sx = source.x + a.w + 2

  // A failure branch leaves the bottom of the node so the happy path stays the
  // straight horizontal line the eye follows first.
  if (negative) {
    const bx = source.x + a.w / 2
    const by = source.y + a.h + 2
    return { d: `M ${bx} ${by} C ${bx} ${(by + ty) / 2 + 24}, ${bx + 40} ${ty}, ${tx} ${ty}`, labelX: (bx + tx) / 2, labelY: (by + ty) / 2 + 10 }
  }

  if (tx - sx < 18) {
    const lane = Math.max(source.y + a.h, target.y + b.h) + 48
    return { d: `M ${sx} ${sy} C ${sx + 48} ${sy}, ${sx + 48} ${lane}, ${sx} ${lane} L ${tx - 40} ${lane} Q ${tx - 64} ${lane}, ${tx - 64} ${ty} L ${tx} ${ty}`, labelX: (sx + tx) / 2, labelY: lane }
  }
  const dx = Math.max(20, (tx - sx) * 0.45)
  return { d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`, labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 - 10 }
}

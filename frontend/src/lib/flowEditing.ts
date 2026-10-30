import type { FlowGraphDefinition } from './flowStorage'

export function deleteFlowNode(graph: FlowGraphDefinition, id: string): FlowGraphDefinition {
  const node = graph.nodes.find(item => item.id === id)
  if (!node || node.type === 'start' || node.type === 'end') return graph
  const incoming = graph.edges.filter(edge => edge.target === id && edge.source !== id)
  const outgoing = graph.edges.filter(edge => edge.source === id && edge.target !== id)
  const targets = [...new Set(outgoing.map(edge => edge.target))]
  const edges = graph.edges.filter(edge => edge.source !== id && edge.target !== id)
  // Preserve the incoming branch when removing a step with one unambiguous successor.
  if (targets.length === 1) for (const edge of incoming) {
    if (edge.source !== targets[0] && !edges.some(item => item.source === edge.source && item.target === targets[0] && item.branch === edge.branch)) edges.push({ ...edge, target: targets[0] })
  }
  return { ...graph, nodes: graph.nodes.filter(item => item.id !== id), edges }
}

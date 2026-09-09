import { describe, expect, it } from 'vitest'
import { createDefaultFlowGraph } from './flowStorage'
import { flowEdgePath, flowNodeSize, layoutFlow } from './flowLayout'

describe('Flow canvas layout', () => {
  it('separates every node while retaining the execution branches', () => {
    const original = createDefaultFlowGraph()
    const graph = layoutFlow(original)
    expect(graph.edges).toEqual(original.edges)
    for (const a of graph.nodes) for (const b of graph.nodes) {
      if (a.id === b.id) continue
      const sa = flowNodeSize(a), sb = flowNodeSize(b)
      expect(a.x + sa.w <= b.x || b.x + sb.w <= a.x || a.y + sa.h <= b.y || b.y + sb.h <= a.y).toBe(true)
    }
    for (const edge of graph.edges) {
      const source = graph.nodes.find(node => node.id === edge.source)!
      const target = graph.nodes.find(node => node.id === edge.target)!
      expect(target.x - (source.x + flowNodeSize(source).w)).toBeGreaterThanOrEqual(112)
      expect(flowEdgePath(edge, new Map(graph.nodes.map(node => [node.id, node])))?.d).not.toContain('NaN')
    }
  })
})

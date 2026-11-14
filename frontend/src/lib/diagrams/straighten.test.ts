import { describe, expect, it } from 'vitest'
import { createEdge, createNode } from './graphOps'
import { sequenceFromText } from './sequence'
import { straightenEdge } from './straighten'

describe('straighten a connector', () => {
  it('moves the target so a nearly horizontal line is exactly horizontal, and drops the bends', () => {
    const a = createNode('process', { x: 0, y: 0 })
    const b = createNode('process', { x: 400, y: 23 })
    const edge = createEdge({ source: a.id, target: b.id, sourceHandle: 'right-50', targetHandle: 'left-50' }, 'orthogonal', { waypoints: [{ x: 200, y: 90 }] })
    const graph = straightenEdge({ nodes: [a, b], edges: [edge] }, edge.id)
    expect(graph.nodes[1].position).toEqual({ x: 400, y: 0 })
    expect(graph.edges[0].data?.waypoints).toEqual([])
    expect(straightenEdge(graph, edge.id)).toBe(graph)
  })

  it('snaps a slanted sequence message to the source row', () => {
    const seq = sequenceFromText('A->>B: one\nB-->>A: two')
    const crooked = { ...seq, edges: seq.edges.map((edge, index) => (index === 0 ? { ...edge, targetHandle: 'L3' } : edge)) }
    expect(straightenEdge(crooked, seq.edges[0].id).edges[0].targetHandle).toBe('L0')
  })
})

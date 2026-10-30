import { describe, expect, it } from 'vitest'
import { deleteFlowNode } from './flowEditing'
import type { FlowGraphDefinition } from './flowStorage'
const graph = { nodes: [{id:'start',type:'start'},{id:'request',type:'request'},{id:'end',type:'end'}], edges:[{id:'a',source:'start',target:'request',branch:'true'},{id:'b',source:'request',target:'end',branch:'next'}] } as FlowGraphDefinition

describe('flow node deletion', () => {
  it('reconnects the incoming branch without mutating the original graph', () => {
    const result = deleteFlowNode(graph,'request')
    expect(result.nodes.map(node=>node.id)).toEqual(['start','end'])
    expect(result.edges).toEqual([{id:'a',source:'start',target:'end',branch:'true'}])
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(2)
  })
  it('keeps structural nodes and missing nodes unchanged', () => {
    for (const id of ['start','end','missing']) expect(deleteFlowNode(graph,id)).toBe(graph)
  })
  it('does not silently choose an outcome when removing a branch', () => {
    const branched = {...graph,edges:[...graph.edges,{id:'c',source:'request',target:'other',branch:'false' as const}]}
    expect(deleteFlowNode(branched,'request').edges).toEqual([])
  })
})

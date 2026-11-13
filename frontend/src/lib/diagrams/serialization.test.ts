import { describe, expect, it } from 'vitest'
import { createEdge, createNode, groupNodes } from './graphOps'
import { emptyHistory, HISTORY_LIMIT, record, redo, undo } from './history'
import { DIAGRAM_FORMAT_VERSION, emptyDiagram, type DiagramDocument, type DiagramGraph } from './model'
import { DiagramFormatError, orderParentsFirst, parseDiagram, serializeDiagram } from './serialization'
import { searchShapes, shapeOf } from './shapes'

function sample(): DiagramDocument {
  const a = { ...createNode('go-service', { x: 10, y: 20 }), id: 'a', selected: true, measured: { width: 170, height: 76 } }
  const b = { ...createNode('database', { x: 300, y: 20 }), id: 'b' }
  const grouped = groupNodes({ nodes: [a, b], edges: [] }, ['a', 'b'])
  const edge = { ...createEdge({ source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' }, 'orthogonal', { label: 'SQL', flow: true, waypoints: [{ x: 200, y: 40 }] }), id: 'e1' }
  return { ...emptyDiagram('Orders'), ...grouped.graph, edges: [edge], viewport: { x: 12, y: -4, zoom: 1.5 } }
}

describe('diagram serialization', () => {
  it('round-trips nodes, groups, edge styles, waypoints and the viewport', () => {
    const doc = sample()
    const back = parseDiagram(serializeDiagram(doc))
    expect(back.name).toBe('Orders')
    expect(back.viewport).toEqual({ x: 12, y: -4, zoom: 1.5 })
    expect(back.nodes.map((node) => node.id)).toEqual(doc.nodes.map((node) => node.id))
    expect(back.nodes.find((node) => node.id === 'a')).toMatchObject({ parentId: doc.nodes[0].id, data: { label: 'Go service', subtitle: 'Go' } })
    expect(back.edges[0]).toMatchObject({ sourceHandle: 'right', data: { label: 'SQL', flow: true, routing: 'orthogonal', waypoints: [{ x: 200, y: 40 }] } })
  })

  it('does not save what only the canvas needs', () => {
    const file = JSON.parse(serializeDiagram(sample())) as { format: string; version: number; nodes: Record<string, unknown>[] }
    expect(file).toMatchObject({ format: 'adomnia-diagram', version: DIAGRAM_FORMAT_VERSION })
    expect(file.nodes.some((node) => 'selected' in node || 'measured' in node)).toBe(false)
  })

  it('fills missing fields, drops edges to missing nodes and keeps unknown shapes', () => {
    const doc = parseDiagram(JSON.stringify({
      format: 'adomnia-diagram', version: 1, name: '',
      nodes: [{ id: 'x', position: { x: 1, y: 2 }, data: { shape: 'from-the-future', label: 'X', locked: true } }],
      edges: [{ id: 'e', source: 'x', target: 'gone' }, { id: 'f', source: 'x', target: 'x' }],
    }))
    expect(doc.name).toBe('Untitled diagram')
    expect(doc.nodes[0]).toMatchObject({ draggable: false, data: { shape: 'from-the-future', rotation: 0, style: { strokeWidth: 1.5 } } })
    expect(doc.edges.map((edge) => edge.id)).toEqual(['f'])
    expect(doc.edges[0].data).toMatchObject({ arrowEnd: 'arrow', waypoints: [] })
    expect(shapeOf('from-the-future').id).toBe('process')
  })

  it('refuses what it cannot read, with a reason', () => {
    expect(() => parseDiagram('{oops')).toThrow(DiagramFormatError)
    expect(() => parseDiagram('{"format":"other"}')).toThrow(/not an adOmnia diagram/)
    expect(() => parseDiagram(JSON.stringify({ format: 'adomnia-diagram', version: 99, nodes: [], edges: [] }))).toThrow(/newer adOmnia/)
    expect(() => parseDiagram(JSON.stringify({ format: 'adomnia-diagram', version: 1, nodes: [{ id: 'n' }], edges: [] }))).toThrow(/Node 1 is incomplete/)
  })

  it('puts containers before their children and frees nodes whose container is missing', () => {
    const child = { ...createNode('process', { x: 0, y: 0 }), id: 'child', parentId: 'box' }
    const box = { ...createNode('container', { x: 0, y: 0 }), id: 'box' }
    const orphan = { ...createNode('process', { x: 0, y: 0 }), id: 'orphan', parentId: 'nowhere' }
    const ordered = orderParentsFirst([child, orphan, box])
    expect(ordered.map((node) => node.id)).toEqual(['box', 'child', 'orphan'])
    expect(ordered[2].parentId).toBeUndefined()
  })
})

describe('diagram history', () => {
  const g = (label: string): DiagramGraph => ({ nodes: [{ ...createNode('process', { x: 0, y: 0 }), id: 'a', data: { ...createNode('process', { x: 0, y: 0 }).data, label } }], edges: [] })

  it('undoes and redoes snapshots, and a new change clears redo', () => {
    let history = record(emptyHistory(), g('one'))
    const undone = undo(history, g('two'))!
    expect(undone.graph.nodes[0].data.label).toBe('one')
    const redone = redo(undone.history, undone.graph)!
    expect(redone.graph.nodes[0].data.label).toBe('two')
    history = record(undone.history, g('one'))
    expect(history.future).toEqual([])
    expect(undo(emptyHistory(), g('x'))).toBeNull()
    expect(redo(emptyHistory(), g('x'))).toBeNull()
  })

  it('keeps a bounded number of steps and no selection state', () => {
    let history = emptyHistory()
    for (let index = 0; index < HISTORY_LIMIT + 20; index++) history = record(history, g(String(index)))
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    const selected = { nodes: [{ ...g('s').nodes[0], selected: true }], edges: [] }
    expect(record(emptyHistory(), selected).past[0].nodes[0].selected).toBeUndefined()
  })
})

describe('shape library search', () => {
  it('matches labels, categories and keywords, every word', () => {
    expect(searchShapes('kafka').map((shape) => shape.id)).toContain('kafka-topic')
    expect(searchShapes('uml interface').map((shape) => shape.id)).toEqual(['uml-interface'])
    expect(searchShapes('osgi').map((shape) => shape.id)).toContain('osgi-bundle')
    expect(searchShapes('')).toHaveLength(searchShapes(' ').length)
    expect(searchShapes('nothing-like-this')).toEqual([])
  })
})

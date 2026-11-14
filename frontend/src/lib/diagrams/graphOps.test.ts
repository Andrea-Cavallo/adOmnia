import { describe, expect, it } from 'vitest'
import {
  absolutePosition, alignNodes, copySelection, createEdge, createNode, deleteElements, distributeNodes, duplicateSelection,
  groupNodes, indexNodes, moveLayer, pasteClipboard, reparentByDrop, setLocked, ungroup, updateEdgeData, updateNodeData,
} from './graphOps'
import type { DiagramGraph, DiagramNode } from './model'

const at = (id: string, x: number, y: number, shape = 'process'): DiagramNode => ({ ...createNode(shape, { x, y }), id })
const link = (source: string, target: string) => ({ ...createEdge({ source, target, sourceHandle: null, targetHandle: null }, 'orthogonal'), id: `${source}-${target}` })
const graph = (nodes: DiagramNode[], edges = [] as ReturnType<typeof link>[]): DiagramGraph => ({ nodes, edges })
const byId = (g: DiagramGraph, id: string) => g.nodes.find((node) => node.id === id)!

describe('diagram graph operations', () => {
  it('creates nodes from the shape catalog with its size, label and container layer', () => {
    const service = createNode('go-service', { x: 10, y: 20 })
    expect(service).toMatchObject({ type: 'shape', position: { x: 10, y: 20 }, width: 170, height: 76, zIndex: 0 })
    expect(service.data).toMatchObject({ shape: 'go-service', label: 'Go service', subtitle: 'Go', icon: 'server', locked: false })
    expect(createNode('container', { x: 0, y: 0 }).zIndex).toBeLessThan(0)
    expect(createNode('uml-class', { x: 0, y: 0 }).data.attributes).toContain('id: String')
  })

  it('deletes nodes with their edges, keeps locked nodes and frees the children of a removed container', () => {
    const g = groupNodes(graph([at('a', 100, 100), at('b', 400, 100), at('c', 700, 100)], [link('a', 'b'), link('b', 'c')]), ['a', 'b'])
    const groupId = g.groupId!
    const locked = setLocked(g.graph, ['c'], true)
    const after = deleteElements(locked, [groupId, 'c'])
    expect(after.nodes.map((node) => node.id).sort()).toEqual(['a', 'b', 'c'])
    expect(byId(after, 'a').parentId).toBeUndefined()
    expect(byId(after, 'a').position).toEqual({ x: 100, y: 100 })
    expect(deleteElements(after, ['b']).edges.map((edge) => edge.id)).toEqual([])
  })

  it('copies a container with its children and pastes them with fresh ids and remapped links', () => {
    const grouped = groupNodes(graph([at('a', 0, 0), at('b', 300, 0)], [link('a', 'b')]), ['a', 'b'])
    const clipboard = copySelection(grouped.graph, [grouped.groupId!])
    expect(clipboard.nodes).toHaveLength(3)
    expect(clipboard.edges).toHaveLength(1)
    const pasted = pasteClipboard(grouped.graph, clipboard, { x: 50, y: 50 })
    expect(pasted.graph.nodes).toHaveLength(6)
    expect(pasted.graph.edges).toHaveLength(2)
    const newIds = new Set(pasted.nodeIds)
    const copiedEdge = pasted.graph.edges[1]
    expect(newIds.has(copiedEdge.source) && newIds.has(copiedEdge.target)).toBe(true)
    const copiedChildren = pasted.graph.nodes.filter((node) => newIds.has(node.id) && node.parentId)
    expect(copiedChildren.every((node) => newIds.has(node.parentId!))).toBe(true)
  })

  it('duplicates a node beside the original and selects only the copy', () => {
    const { graph: g, nodeIds } = duplicateSelection(graph([{ ...at('a', 10, 10), selected: true }]), ['a'])
    expect(byId(g, nodeIds[0]).position).toEqual({ x: 34, y: 34 })
    expect(g.nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(nodeIds)
  })

  it('groups nodes into a container around them and ungroups them back in place', () => {
    const start = graph([at('a', 100, 200), at('b', 400, 260)])
    const { graph: grouped, groupId } = groupNodes(start, ['a', 'b'])
    const container = byId(grouped, groupId!)
    expect(grouped.nodes[0].id).toBe(groupId)
    expect(container.width).toBeGreaterThan(460)
    const index = indexNodes(grouped.nodes)
    expect(absolutePosition(byId(grouped, 'b'), index)).toEqual({ x: 400, y: 260 })
    const back = ungroup(grouped, groupId!)
    expect(back.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(byId(back, 'b').position).toEqual({ x: 400, y: 260 })
    expect(groupNodes(start, ['a']).groupId).toBeNull()
  })

  it('moves a dropped node into the container under it and out again', () => {
    const box = { ...at('box', 0, 0, 'container'), width: 400, height: 300 }
    const inside = reparentByDrop(graph([box, at('a', 100, 100)]), 'a')
    expect(byId(inside, 'a')).toMatchObject({ parentId: 'box', position: { x: 100, y: 100 } })
    const moved = { ...inside, nodes: inside.nodes.map((node) => (node.id === 'a' ? { ...node, position: { x: 900, y: 900 } } : node)) }
    const outside = reparentByDrop(moved, 'a')
    expect(byId(outside, 'a').parentId).toBeUndefined()
    expect(byId(outside, 'a').position).toEqual({ x: 900, y: 900 })
  })

  it('aligns and distributes unlocked nodes', () => {
    const g = graph([at('a', 0, 10), at('b', 100, 80), at('c', 500, 40)])
    expect(alignNodes(g, ['a', 'b', 'c'], 'top').nodes.map((node) => node.position.y)).toEqual([10, 10, 10])
    const right = alignNodes(g, ['a', 'b'], 'right')
    expect(byId(right, 'a').position.x).toBe(100)
    const spread = distributeNodes(graph([at('a', 0, 0), at('b', 50, 0), at('c', 640, 0)]), ['a', 'b', 'c'], 'horizontal')
    expect(byId(spread, 'b').position.x).toBe(320)
    const locked = setLocked(g, ['a'], true)
    expect(byId(alignNodes(locked, ['a', 'b', 'c'], 'left'), 'a').position).toEqual({ x: 0, y: 10 })
  })

  it('reorders layers and keeps containers behind the rest', () => {
    const g = graph([at('a', 0, 0), at('b', 0, 0), { ...at('box', 0, 0, 'container') }])
    const front = moveLayer(g, ['a'], 'front')
    expect(byId(front, 'a').zIndex).toBeGreaterThan(byId(front, 'b').zIndex ?? 0)
    const back = moveLayer(g, ['a', 'box'], 'back')
    expect(byId(back, 'a').zIndex).toBeGreaterThan(byId(back, 'box').zIndex!)
  })

  it('updates node style and edge data without touching other elements', () => {
    const g = graph([at('a', 0, 0), at('b', 0, 0)], [link('a', 'b')])
    const styled = updateNodeData(g, ['a'], { label: 'Orders', style: { ...g.nodes[0].data.style, stroke: '#3fb96b' } })
    expect(byId(styled, 'a').data).toMatchObject({ label: 'Orders', style: { stroke: '#3fb96b', strokeWidth: 1.5 } })
    expect(byId(styled, 'b')).toBe(g.nodes[1])
    expect(updateEdgeData(g, ['a-b'], { flow: true, routing: 'bezier' }).edges[0].data).toMatchObject({ flow: true, routing: 'bezier', arrowEnd: 'arrow' })
  })

  it('locks nodes against dragging and deletion', () => {
    const locked = setLocked(graph([at('a', 0, 0)]), ['a'], true)
    expect(locked.nodes[0]).toMatchObject({ draggable: false, deletable: false, data: { locked: true } })
    expect(setLocked(locked, ['a'], false).nodes[0]).toMatchObject({ draggable: true, deletable: true })
  })
})

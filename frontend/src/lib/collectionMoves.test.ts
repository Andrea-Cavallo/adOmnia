import { describe, expect, it } from 'vitest'
import { blankRequest, type Collection, type TreeNode } from './types'
import { moveCollectionNodes } from './collectionMoves'

const request = (id: string) => ({ ...blankRequest(), id, name: id })
const collection = (id: string, children: TreeNode[]): Collection => ({ id, name: id, children })
const sources = (...ids: string[]) => ids.map(nodeId => ({ collectionId: 'one', nodeId }))

describe('atomic collection moves', () => {
  it('moves forward and backward without index drift, in visual order', () => {
    const original = [collection('one', ['a', 'b', 'c', 'd'].map(request))]
    const next = moveCollectionNodes(original, sources('b', 'a'), 'one', null, 4)
    expect(next[0].children.map(n => n.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(moveCollectionNodes(next, sources('b', 'a'), 'one', null, 0)[0].children.map(n => n.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(original[0].children.map(n => n.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('moves across collections into a folder without losing nodes', () => {
    const original = [collection('one', ['a', 'b'].map(request)), collection('two', [{ id: 'folder', name: 'folder', type: 'folder', children: [] }])]
    const next = moveCollectionNodes(original, sources('b', 'a'), 'two', 'folder', 0)
    expect(next[0].children).toEqual([])
    expect(next[1].children[0]).toMatchObject({ children: [{ id: 'a' }, { id: 'b' }] })
  })
  it('ignores descendants selected alongside their parent and rejects cycles', () => {
    const original = [collection('one', [{ id: 'folder', name: 'folder', type: 'folder', children: [request('a')] }]), collection('two', [])]
    expect(moveCollectionNodes(original, sources('folder'), 'one', 'folder', 0)).toBe(original)
    const next = moveCollectionNodes(original, sources('folder', 'a'), 'two', null, 0)
    expect(next[1].children).toHaveLength(1)
    expect(next[1].children[0]).toMatchObject({ id: 'folder', children: [{ id: 'a' }] })
  })
  it('rejects missing, request, and foreign collection destinations', () => {
    const original = [collection('one', [request('a')]), collection('two', [])]
    for (const parent of ['missing', 'a']) expect(moveCollectionNodes(original, sources('a'), 'two', parent, 0)).toBe(original)
    expect(moveCollectionNodes(original, sources('a'), 'missing', null, 0)).toBe(original)
    expect(moveCollectionNodes(original, [{ collectionId: 'two', nodeId: 'a' }], 'two', null, 0)).toBe(original)
  })
})

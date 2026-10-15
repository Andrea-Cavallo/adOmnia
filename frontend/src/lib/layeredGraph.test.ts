import { describe, expect, it } from 'vitest'
import { LAYERED_BOX, layoutLayered, reduceTransitive, type LayeredLayout, type LayeredLink, type LayeredPoint } from './layeredGraph'

const items = (...ids: string[]) => ids.map((id, index) => ({ id, weight: ids.length - index, data: null }))
const link = (from: string, to: string, value = 1): LayeredLink => ({ from, to, value })

type Segment = [LayeredPoint, LayeredPoint]
const segments = (points: LayeredPoint[]): Segment[] => points.slice(1).map((point, index) => [points[index], point])

function insideNode(layout: LayeredLayout<null>, point: LayeredPoint, skip: Set<string>): boolean {
  const { width, height } = LAYERED_BOX
  return layout.nodes.some((node) => !skip.has(node.id) && point.x > node.x && point.x < node.x + width && point.y > node.y && point.y < node.y + height)
}

/** Nessun punto di un tratto dell'arco cade dentro un nodo diverso dai suoi estremi. */
function pathsAvoidNodes(layout: LayeredLayout<null>): boolean {
  return layout.edges.every((edge) => segments(edge.path ?? []).every(([a, b]) => {
    for (let step = 0; step <= 24; step++) {
      const point = { x: a.x + ((b.x - a.x) * step) / 24, y: a.y + ((b.y - a.y) * step) / 24 }
      if (insideNode(layout, point, new Set([edge.from.id, edge.to.id]))) return false
    }
    return true
  }))
}

function intersects([a, b]: Segment, [c, d]: Segment): boolean {
  const side = (p: LayeredPoint, q: LayeredPoint, r: LayeredPoint) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function crossings(layout: LayeredLayout<null>): number {
  let total = 0
  const all = layout.edges.map((edge) => segments(edge.path ?? []))
  for (let first = 0; first < all.length; first++) {
    for (let second = first + 1; second < all.length; second++) {
      for (const one of all[first]) for (const other of all[second]) if (intersects(one, other)) total++
    }
  }
  return total
}

describe('layoutLayered', () => {
  it('puts callees below callers and keeps edges out of unrelated nodes', () => {
    const layout = layoutLayered(items('a', 'b', 'c', 'd'), [link('a', 'b'), link('b', 'c'), link('a', 'c'), link('a', 'd'), link('d', 'c')])
    const layer = (id: string) => layout.nodes.find((node) => node.id === id)!.layer
    expect([layer('a'), layer('b'), layer('c')]).toEqual([0, 1, 2])
    expect(pathsAvoidNodes(layout)).toBe(true)
  })

  it('routes an edge that spans several layers through a free lane', () => {
    const layout = layoutLayered(items('a', 'b', 'c', 'd'), [link('a', 'b'), link('b', 'c'), link('c', 'd'), link('a', 'd')])
    const long = layout.edges.find((edge) => edge.from.id === 'a' && edge.to.id === 'd')!
    expect(long.path!.length).toBeGreaterThan(4)
    expect(pathsAvoidNodes(layout)).toBe(true)
  })

  it('reorders layers to remove avoidable crossings', () => {
    // Pesi scelti perché l'ordine iniziale (a, b, c / z, y, x) incroci tutto.
    const layout = layoutLayered(items('a', 'b', 'c', 'z', 'y', 'x'), [link('a', 'x'), link('b', 'y'), link('c', 'z')])
    expect(crossings(layout)).toBe(0)
  })

  it('draws a cycle edge as a dashed-able back edge leaving the top of the caller', () => {
    const layout = layoutLayered(items('a', 'b'), [link('a', 'b'), link('b', 'a')])
    const back = layout.edges.find((edge) => edge.back)!
    expect(back.from.id).toBe('b')
    expect(back.path![0].y).toBe(back.from.y)
    expect(back.path![back.path!.length - 1].y).toBe(back.to.y + LAYERED_BOX.height)
  })

  it('spreads the ports of a node along its border', () => {
    const layout = layoutLayered(items('a', 'b', 'c', 'd'), [link('a', 'b'), link('a', 'c'), link('a', 'd')])
    const starts = layout.edges.map((edge) => edge.path![0].x)
    expect(new Set(starts).size).toBe(3)
    const root = layout.nodes.find((node) => node.id === 'a')!
    expect(starts.every((x) => x > root.x && x < root.x + LAYERED_BOX.width)).toBe(true)
  })

  it('handles an empty graph and ignores links to unknown nodes', () => {
    expect(layoutLayered([], []).nodes).toEqual([])
    expect(layoutLayered(items('a'), [link('a', 'missing'), link('a', 'a')]).edges).toEqual([])
  })

  it('stays fast on a dense graph of 120 nodes', () => {
    const ids = Array.from({ length: 120 }, (_, index) => `n${index}`)
    const dense = ids.flatMap((id, index) => [1, 2, 3, 7].map((step) => link(id, ids[(index + step) % 120])))
    const started = performance.now()
    const layout = layoutLayered(items(...ids), dense)
    expect(layout.nodes).toHaveLength(120)
    expect(performance.now() - started).toBeLessThan(5000)
  })
})

describe('reduceTransitive', () => {
  it('drops a→c when a→b→c already exists', () => {
    const result = reduceTransitive([link('a', 'b'), link('b', 'c'), link('a', 'c')])
    expect(result.links.map((item) => `${item.from}>${item.to}`)).toEqual(['a>b', 'b>c'])
    expect(result.removed).toBe(1)
  })

  it('keeps edges that close a cycle and edges without an alternative path', () => {
    const result = reduceTransitive([link('a', 'b'), link('b', 'a'), link('b', 'c')])
    expect(result.links).toHaveLength(3)
    expect(result.removed).toBe(0)
  })
})

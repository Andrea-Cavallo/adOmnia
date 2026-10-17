import { describe, expect, it } from 'vitest'
import { impactContext, type GraphImpact } from './workspaceGraph'

const node = (label: string, file = '') => ({ id: label, kind: 'function', label, file, line: 3 })

describe('impactContext', () => {
  it('lists the neighbourhood every chat receives, compact and bounded', () => {
    const callers = Array.from({ length: 10 }, (_, index) => ({ node: node(`pkg.Caller${index}`, 'a.go'), depth: index + 1 }))
    const text = impactContext({
      target: node('store.memStore.Get', 'store/store.go'), risk: 'high', riskReasons: ['no test reaches this code'],
      callers, tests: [], endpoints: [{ node: node('GET /orders/{id}'), depth: 2 }], queries: [{ node: node('orders'), depth: 1, via: ['query'] }],
    } as unknown as GraphImpact)
    expect(text).toContain('store.memStore.Get (store/store.go:3) — change risk high: no test reaches this code.')
    expect(text).toContain('- pkg.Caller1 [2 calls away] (a.go:3)')
    expect(text).toContain('- … 2 more')
    expect(text).toContain('HTTP routes served through it:\n- GET /orders/{id}')
    expect(text).toContain('- orders (query)')
    expect(text).not.toContain('Tests that reach it')
  })
})

describe('impactMapGraph', () => {
  it('hangs callers above the target through their path and touched resources below', async () => {
    const { impactMapGraph } = await import('./workspaceGraph')
    const node = (id: string, label = id) => ({ id, kind: 'function', label }) as never
    const impact = {
      target: node('t', 'pkg.Target'), risk: 'low', riskReasons: [],
      callers: [{ node: node('a', 'pkg.A'), depth: 1 }, { node: node('b', 'pkg.B'), depth: 2, via: ['pkg.A'] }],
      tests: [{ node: node('test', 'pkg.TestB'), depth: 3, via: ['pkg.A', 'pkg.B'] }],
      queries: [{ node: node('tbl', 'orders'), depth: 1 }],
    } as never
    const { items, links } = impactMapGraph(impact)
    expect(items.map((item) => `${item.id}:${item.data.role}`).sort()).toEqual(['a:upstream', 'b:upstream', 't:target', 'tbl:downstream', 'test:upstream'])
    expect(links).toEqual(expect.arrayContaining([{ from: 'a', to: 't', value: 1 }, { from: 'b', to: 'a', value: 1 }, { from: 'test', to: 'b', value: 1 }, { from: 't', to: 'tbl', value: 1 }]))
  })
})

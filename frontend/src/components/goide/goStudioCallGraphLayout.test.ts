import { describe, expect, it } from 'vitest'
import { layoutCallGraph } from './goStudioCallGraphLayout'
import type { ProfileFunction, ProfileNode } from './goStudioProfiles'

const fn = (name: string, extra: Partial<ProfileFunction> = {}) => ({ name, short: name, package: 'example.com/app', relative: 'main.go', ...extra }) as ProfileFunction
const node = (name: string, cum: number, extra: Partial<ProfileFunction> = {}) => ({ function: fn(name, extra), flat: [0], cum: [cum] }) as ProfileNode

describe('layoutCallGraph', () => {
  it('layers callers above callees and weights edges, also with recursion', () => {
    const top = [node('main', 100), node('serve', 90), node('parse', 60), node('walk', 40), node('runtime.mallocgc', 30, { relative: '', runtime: true, package: 'runtime' })]
    const edges = [
      { caller: fn('main'), callee: fn('serve'), value: [90] },
      { caller: fn('serve'), callee: fn('parse'), value: [60] },
      { caller: fn('parse'), callee: fn('walk'), value: [40] },
      { caller: fn('walk'), callee: fn('walk'), value: [10] },
      { caller: fn('walk'), callee: fn('parse'), value: [5] },
      { caller: fn('parse'), callee: fn('runtime.mallocgc'), value: [30] },
    ]
    const layout = layoutCallGraph(top, edges, 0)
    const layer = (name: string) => layout.nodes.find((item) => item.fn.name === name)!.layer
    expect(layer('main')).toBe(0)
    expect(layer('serve')).toBeLessThan(layer('parse'))
    expect(layer('parse')).toBeLessThan(layer('runtime.mallocgc'))
    expect(layout.edges.some((edge) => edge.from === edge.to)).toBe(false)
    expect(layout.maxEdge).toBe(90)
    expect(layout.width).toBeGreaterThan(0)
    expect(layoutCallGraph(top, edges, 0, { hideRuntime: true }).nodes.map((item) => item.fn.name)).not.toContain('runtime.mallocgc')
  })

  it('keeps only the most expensive functions', () => {
    const many = Array.from({ length: 40 }, (_, index) => node(`f${index}`, 100 - index))
    expect(layoutCallGraph(many, [], 0, { limit: 10 }).nodes).toHaveLength(10)
  })
})

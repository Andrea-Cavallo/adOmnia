import { describe, expect, it } from 'vitest'
import { dependencyHeatmap, packageRuntime } from './dependencyHeatmap'

describe('dependency heatmap', () => {
  const fn = (pkg: string, relative?: string) => ({ name: `${pkg}.f`, short: 'f', package: pkg, relative })
  const report = {
    name: 'cpu.pprof', sampleTypes: [{ name: 'samples', unit: 'count' }, { name: 'cpu', unit: 'nanoseconds' }], totals: [10, 100],
    topCum: [
      { function: fn('main', 'main.go'), flat: [], cum: [1, 100] },
      { function: fn('example.com/app/store', 'store/store.go'), flat: [], cum: [1, 90] },
      { function: fn('crypto/sha256'), flat: [], cum: [1, 85] },
    ],
    edges: [{ caller: fn('main', 'main.go'), callee: fn('example.com/app/store', 'store/store.go'), value: [1, 90] }, { caller: fn('example.com/app/store', 'store/store.go'), callee: fn('crypto/sha256'), value: [1, 85] }],
  } as never

  it('measures project folders inclusively and keeps calls between them', () => {
    const runtime = packageRuntime(report)
    expect(runtime.metric).toBe('cpu')
    expect(runtime.byPackage).toEqual({ '.': 100, store: 90 })
    expect(runtime.calls).toEqual(['. → store'])
  })

  it('ranks by runtime share and lists static imports never crossed at runtime', () => {
    const input = {
      packages: [
        { package: 'example.com/app', fanIn: 0, fanOut: 2, blastRadius: 0, functions: 3, dir: '.' },
        { package: 'example.com/app/store', fanIn: 1, fanOut: 0, blastRadius: 1, functions: 2, dir: 'store' },
        { package: 'example.com/app/legacy', fanIn: 1, fanOut: 1, blastRadius: 1, functions: 1, dir: 'legacy' },
      ],
      imports: [['example.com/app', 'example.com/app/store'], ['example.com/app', 'example.com/app/legacy']] as Array<[string, string]>,
    }
    const { rows, untraversed } = dependencyHeatmap(input, packageRuntime(report))
    expect(rows.map((row) => row.package)).toEqual(['example.com/app', 'example.com/app/store', 'example.com/app/legacy'])
    expect(rows[1].runtimeShare).toBeCloseTo(0.9)
    expect(untraversed).toEqual(['example.com/app → example.com/app/legacy'])
    expect(dependencyHeatmap(input, null).untraversed).toEqual([])
  })
})

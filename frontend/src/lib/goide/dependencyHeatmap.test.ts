import { describe, expect, it } from 'vitest'
import { dependencyHeatmap, packageRuntime } from './dependencyHeatmap'

describe('dependency heatmap', () => {
  const fn = (pkg: string) => ({ name: `${pkg}.f`, short: 'f', package: pkg })
  const report = {
    name: 'cpu.pprof', sampleTypes: [{ name: 'samples', unit: 'count' }, { name: 'cpu', unit: 'nanoseconds' }],
    topFlat: [{ function: fn('app/api'), flat: [1, 30], cum: [] }, { function: fn('app/store'), flat: [1, 70], cum: [] }],
    edges: [{ caller: fn('app/api'), callee: fn('app/store'), value: [1, 70] }, { caller: fn('app/api'), callee: fn('app/api'), value: [1, 1] }],
  } as never

  it('sums the profile per package and keeps cross-package calls', () => {
    const runtime = packageRuntime(report)
    expect(runtime.metric).toBe('cpu')
    expect(runtime.byPackage).toEqual({ 'app/api': 30, 'app/store': 70 })
    expect(runtime.calls).toEqual(['app/api → app/store'])
  })

  it('ranks by runtime share and lists static imports never crossed at runtime', () => {
    const input = {
      packages: [
        { package: 'app/api', fanIn: 0, fanOut: 2, blastRadius: 0, functions: 3 },
        { package: 'app/store', fanIn: 1, fanOut: 0, blastRadius: 1, functions: 2 },
        { package: 'app/legacy', fanIn: 1, fanOut: 1, blastRadius: 1, functions: 1 },
      ],
      imports: [['app/api', 'app/store'], ['app/api', 'app/legacy']] as Array<[string, string]>,
    }
    const { rows, untraversed } = dependencyHeatmap(input, packageRuntime(report))
    expect(rows.map((row) => row.package)).toEqual(['app/store', 'app/api', 'app/legacy'])
    expect(rows[0].runtimeShare).toBeCloseTo(0.7)
    expect(untraversed).toEqual(['app/api → app/legacy'])
    expect(dependencyHeatmap(input, null).untraversed).toEqual([])
    expect(dependencyHeatmap(input, null).rows[0].package).toBe('app/legacy') // coupling 1×1 first without a profile
  })
})

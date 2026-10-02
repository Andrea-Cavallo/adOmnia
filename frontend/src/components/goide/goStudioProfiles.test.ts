import { describe, expect, it } from 'vitest'
import {
  defaultSampleIndex, diffProfiles, filterNodes, formatProfileValue, groupByPackage, isRuntimeFunction,
  percentOf, sampleValue, sortTop, type ProfileNode, type ProfileReport,
} from './goStudioProfiles'

function fn(name: string, pkg: string, extra: Partial<ProfileNode['function']> = {}): ProfileNode['function'] {
  return { name, short: name.split('.').pop() ?? name, package: pkg, ...extra }
}

function node(name: string, pkg: string, flat: number, cum: number, runtime = false): ProfileNode {
  return { function: fn(name, pkg, { runtime }), flat: [flat, flat], cum: [cum, cum] }
}

function report(nodes: ProfileNode[]): ProfileReport {
  return {
    path: '/p/cpu.pprof', name: 'cpu.pprof', kind: 'cpu', durationNanos: 0,
    periodType: { name: 'cpu', unit: 'nanoseconds' }, period: 1, time: '',
    sampleTypes: [{ name: 'samples', unit: 'count' }, { name: 'cpu', unit: 'nanoseconds' }],
    totals: [10, 1000], samples: 10, topFlat: nodes, topCum: nodes, flame: null, edges: [], lines: [],
  }
}

describe('goStudioProfiles', () => {
  it('uses the last sample type by default and reads values safely', () => {
    const r = report([])
    expect(defaultSampleIndex(r)).toBe(1)
    expect(sampleValue([1, 2, 3], 2)).toBe(3)
    expect(sampleValue([1], 5)).toBe(1)
    expect(sampleValue(undefined, 0)).toBe(0)
    expect(percentOf(25, 100)).toBe(25)
    expect(percentOf(1, 0)).toBe(0)
  })

  it('formats cpu and byte values', () => {
    expect(formatProfileValue(1_500_000, 'nanoseconds')).toBe('1.50 ms')
    expect(formatProfileValue(2_048, 'bytes')).toBe('2.0 KiB')
    expect(formatProfileValue(42, 'count')).toBe('42')
  })

  it('sorts and filters runtime internals', () => {
    const nodes = [node('main.work', 'main', 5, 10), node('runtime.gc', 'runtime', 20, 20, true)]
    expect(sortTop(nodes, 1, 'flat')[0].function.name).toBe('runtime.gc')
    expect(sortTop(nodes, 1, 'cum')[0].function.name).toBe('runtime.gc')
    expect(filterNodes(nodes, { hideRuntime: true }).map((n) => n.function.name)).toEqual(['main.work'])
    expect(filterNodes(nodes, { query: 'main' }).map((n) => n.function.name)).toEqual(['main.work'])
    expect(isRuntimeFunction(nodes[1].function)).toBe(true)
  })

  it('groups by package keeping the biggest group first', () => {
    const groups = groupByPackage([node('a.one', 'a', 1, 1), node('a.two', 'a', 2, 2), node('b.one', 'b', 10, 10)], 1, 'cum')
    expect(groups.map((g) => g.package)).toEqual(['b', 'a'])
    expect(groups[1].value).toBe(3)
    expect(groups[1].nodes).toHaveLength(2)
  })

  it('diffs two profiles by function name', () => {
    const base = report([node('main.work', 'main', 100, 100), node('main.slow', 'main', 10, 10)])
    const target = report([node('main.work', 'main', 50, 50), node('main.slow', 'main', 30, 30)])
    const deltas = diffProfiles(base, target, 1, 'cum')
    expect(deltas[0].function.name).toBe('main.work')
    expect(deltas[0].delta).toBe(-50)
    expect(deltas[0].ratio).toBeCloseTo(-0.5)
    const slow = deltas.find((d) => d.function.name === 'main.slow')!
    expect(slow.delta).toBe(20)
  })
})

describe('diffProfiles across kinds', () => {
  it('matches the sample type by name and refuses profiles of a different kind', async () => {
    const { diffProfiles: diff } = await import('./goStudioProfiles')
    const node = (name: string, value: number[]) => ({ function: { name, short: name, package: 'p', file: '', relative: '', line: 0, runtime: false }, flat: value, cum: value })
    const report = (types: string[], nodes: ReturnType<typeof node>[]) => ({ sampleTypes: types.map((name) => ({ name, unit: 'count' })), topFlat: nodes, topCum: nodes, totals: [], edges: [], lines: [], flame: null }) as unknown as Parameters<typeof diff>[0]
    const base = report(['samples', 'cpu'], [node('f', [1, 10])])
    const reordered = report(['cpu', 'samples'], [node('f', [30, 2])])
    expect(diff(base, reordered, 1)[0]).toMatchObject({ base: 10, target: 30, delta: 20 })
    const heap = report(['alloc_space', 'inuse_space'], [node('f', [5, 6])])
    expect(diff(base, heap, 1)).toEqual([])
  })
})

describe('codeOrigin', () => {
  it('classifies project, dependency, standard library and runtime frames', async () => {
    const { codeOrigin } = await import('./goStudioProfiles')
    expect(codeOrigin({ package: 'example.com/app/api', relative: 'api/handler.go' })).toBe('project')
    expect(codeOrigin({ package: 'github.com/jackc/pgx/v5' })).toBe('dependency')
    expect(codeOrigin({ package: 'encoding/json' })).toBe('stdlib')
    expect(codeOrigin({ package: 'runtime', runtime: true })).toBe('runtime')
    expect(codeOrigin({ package: '' })).toBe('runtime')
  })
})

import { describe, expect, it } from 'vitest'
import { benchmarkBaselines, compareBenchmarkSamples, defaultBaselineKey, mannWhitneyPValue, significancePossible } from './goStudioBenchmarkCompare'
import type { GoStudioBenchmarkHistoryEntry } from './goStudioBenchmarkHistory'

const ns = (...values: number[]) => values.map((value) => ({ iterations: 100, metrics: [{ unit: 'ns/op', value }] }))

function entry(runId: string, startedAt: string, branch: string, commit: string, values: number[], dirty = false): GoStudioBenchmarkHistoryEntry {
  const samples = ns(...values)
  return { id: `${runId}:x`, runId, package: 'p', name: 'BenchmarkX', startedAt, measurement: samples[0], samples, branch, commit, dirty }
}

describe('benchmark comparison', () => {
  it('computes exact Mann-Whitney p-values like benchstat', () => {
    expect(mannWhitneyPValue([1, 2, 3, 4], [5, 6, 7, 8])).toBeCloseTo(2 / 70, 6)
    expect(mannWhitneyPValue([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.1, 6)
    expect(mannWhitneyPValue([1, 5, 2, 6], [3, 7, 4, 8])).toBeGreaterThan(0.05)
    expect(mannWhitneyPValue([1, 1, 2, 2, 3], [3, 4, 4, 5, 5])).toBeLessThan(0.05)
    expect(significancePossible(3, 3)).toBe(false)
    expect(significancePossible(4, 4)).toBe(true)
  })

  it('flags a significant slowdown above the threshold as a regression', () => {
    const [ns0] = compareBenchmarkSamples(ns(120, 121, 119, 122), ns(100, 101, 99, 102), 5)
    expect(ns0).toMatchObject({ unit: 'ns/op', direction: 'worse', significant: true, regression: true })
    expect(ns0.changePercent).toBeCloseTo(20, 0)
    expect(compareBenchmarkSamples(ns(120, 121, 119, 122), ns(100, 101, 99, 102), 25)[0].regression).toBe(false)
    expect(compareBenchmarkSamples(ns(101, 99, 103, 98), ns(100, 102, 97, 104), 0)[0].regression).toBe(false)
    expect(compareBenchmarkSamples(ns(110), ns(100), 5)[0]).toMatchObject({ significant: null, regression: true })
  })

  it('groups history by commit and prefers the pinned baseline, then main', () => {
    const history = [
      entry('r1', '2026-10-01T10:00:00Z', 'main', 'aaa', [100, 101]),
      entry('r2', '2026-10-01T11:00:00Z', 'main', 'aaa', [99]),
      entry('r3', '2026-10-02T10:00:00Z', 'feature', 'bbb', [90]),
      entry('r4', '2026-10-02T11:00:00Z', 'feature', 'bbb', [91], true),
    ]
    const baselines = benchmarkBaselines(history, { runId: 'current', package: 'p', name: 'BenchmarkX' })
    expect(baselines.map((item) => item.key)).toEqual(['commit:aaa', 'run:r4', 'commit:bbb'])
    expect(baselines[0].samples).toHaveLength(3)
    expect(defaultBaselineKey(baselines, 'feature')).toBe('commit:aaa')
    expect(defaultBaselineKey(baselines, 'main')).toBe('run:r4')
    const pinned = benchmarkBaselines(history, { runId: 'current', package: 'p', name: 'BenchmarkX' }, 'r3')
    expect(defaultBaselineKey(pinned, 'feature')).toBe('pinned')
  })
})

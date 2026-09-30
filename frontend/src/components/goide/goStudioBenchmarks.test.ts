import { describe, expect, it } from 'vitest'
import { benchmarkRunDurationMillis, compareBenchmarkMetrics, parseBenchmarkMeasurement, previousBenchmarkRun } from './goStudioBenchmarks'

describe('Go Studio benchmark measurements', () => {
  it('keeps standard and custom ReportMetric measurements', () => {
    expect(parseBenchmarkMeasurement('100 12.5 ns/op 24 B/op 2 allocs/op 8.2 widgets/op')).toEqual({
      iterations: 100,
      metrics: [
        { value: 12.5, unit: 'ns/op' }, { value: 24, unit: 'B/op' }, { value: 2, unit: 'allocs/op' }, { value: 8.2, unit: 'widgets/op' },
      ],
    })
  })

  it('marks lower per-operation costs and higher throughput as improvements', () => {
    const now = parseBenchmarkMeasurement('100 8 ns/op 120 MB/s')!
    const before = parseBenchmarkMeasurement('100 10 ns/op 100 MB/s')!
    expect(compareBenchmarkMetrics(now, before)).toMatchObject([
      { current: { unit: 'ns/op' }, changePercent: -20, direction: 'better' },
      { current: { unit: 'MB/s' }, changePercent: 20, direction: 'better' },
    ])
  })

  it('uses the closest older run containing the same benchmark', () => {
    const result = { package: 'example.com/p', name: 'BenchmarkParse', status: 'bench', benchmark: '1 10 ns/op' }
    const current = { runId: 'new', startedAt: '2026-09-30T12:00:00Z', results: [result] }
    const older = { runId: 'old', startedAt: '2026-09-30T11:00:00Z', results: [result] }
    const unrelated = { runId: 'other', startedAt: '2026-09-30T11:30:00Z', results: [{ ...result, name: 'BenchmarkOther' }] }
    expect(previousBenchmarkRun([current, unrelated, older] as any, current as any, result as any)?.runId).toBe('old')
  })

  it('uses the runner timestamps for duration, never a benchmark metric', () => {
    expect(benchmarkRunDurationMillis({ startedAt: '2026-09-30T12:00:00.000Z', finishedAt: '2026-09-30T12:00:01.250Z' } as any)).toBe(1250)
    expect(benchmarkRunDurationMillis({ startedAt: '2026-09-30T12:00:00.000Z', finishedAt: undefined } as any)).toBeNull()
  })
})

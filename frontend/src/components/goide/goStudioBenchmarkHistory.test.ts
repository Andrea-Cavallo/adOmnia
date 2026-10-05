import { beforeEach, describe, expect, it, vi } from 'vitest'
import { benchmarkHistoryCsv, loadBenchmarkCompareSettings, saveBenchmarkCompareSettings, benchmarkHistoryKey, clearBenchmarkHistory, loadBenchmarkHistory, previousSavedBenchmark, saveBenchmarkHistory } from './goStudioBenchmarkHistory'

const values = new Map<string, string>()
const project = 'C:/work/acme-api'

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})

function run(id: string, startedAt: string, benchmark = 'BenchmarkParse') {
  return { runId: id, status: 'finished', startedAt, finishedAt: startedAt, results: [{ id: benchmark, package: 'example.com/acme', name: benchmark, status: 'bench', benchmark: '100 12 ns/op 4 B/op' }] } as any
}

describe('Go Studio benchmark history', () => {
  it('persists compact metrics per project and finds the previous matching measurement', () => {
    saveBenchmarkHistory(project, [run('old', '2026-09-30T10:00:00Z'), run('new', '2026-09-30T11:00:00Z')])
    const history = loadBenchmarkHistory(project)
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ runId: 'new', measurement: { metrics: expect.arrayContaining([{ unit: 'ns/op', value: 12 }]) } })
    expect(previousSavedBenchmark(history, '2026-09-30T12:00:00Z', 'example.com/acme', 'BenchmarkParse')?.runId).toBe('new')
    expect(loadBenchmarkHistory('C:/work/other')).toEqual([])
    expect(benchmarkHistoryCsv(history)).toContain('2026-09-30T11:00:00Z,2026-09-30T11:00:00Z,example.com/acme,BenchmarkParse,100,ns/op,12')
  })

  it('does not archive running runs and permits a project-scoped clear', () => {
    expect(saveBenchmarkHistory(project, [{ ...run('live', '2026-09-30T10:00:00Z'), status: 'running' }])).toEqual([])
    saveBenchmarkHistory(project, [run('done', '2026-09-30T10:00:00Z')])
    clearBenchmarkHistory(project)
    expect(values.has(benchmarkHistoryKey(project))).toBe(false)
  })

  it('stamps new runs with the Git context once and keeps -count samples', () => {
    const repeated = { ...run('a', '2026-09-30T10:00:00Z'), results: [{ id: 'B', package: 'example.com/acme', name: 'BenchmarkParse', status: 'bench', benchmark: '100 13 ns/op', benchmarkSamples: ['100 12 ns/op', '100 13 ns/op'] }] } as any
    saveBenchmarkHistory(project, [repeated], { branch: 'main', commit: 'abc', dirty: false })
    const [saved] = saveBenchmarkHistory(project, [repeated], { branch: 'feature', commit: 'def', dirty: true })
    expect(saved).toMatchObject({ branch: 'main', commit: 'abc', dirty: false })
    expect(saved.samples?.map((sample) => sample.metrics[0].value)).toEqual([12, 13])
    expect(benchmarkHistoryCsv([saved])).toContain(',main,abc')
  })

  it('persists the pinned baseline and validates the regression threshold', () => {
    expect(loadBenchmarkCompareSettings(project)).toEqual({ pinnedRunId: null, thresholdPercent: 5 })
    saveBenchmarkCompareSettings(project, { pinnedRunId: 'r1', thresholdPercent: 12 })
    expect(loadBenchmarkCompareSettings(project)).toEqual({ pinnedRunId: 'r1', thresholdPercent: 12 })
    values.set([...values.keys()].find((key) => key.includes('compare'))!, '{"thresholdPercent":-3}')
    expect(loadBenchmarkCompareSettings(project).thresholdPercent).toBe(5)
  })
})

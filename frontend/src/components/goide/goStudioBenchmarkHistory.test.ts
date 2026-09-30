import { beforeEach, describe, expect, it, vi } from 'vitest'
import { benchmarkHistoryCsv, benchmarkHistoryKey, clearBenchmarkHistory, loadBenchmarkHistory, previousSavedBenchmark, saveBenchmarkHistory } from './goStudioBenchmarkHistory'

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
})

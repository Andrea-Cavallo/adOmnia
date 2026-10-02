import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoIDETestResult, GoIDETestRun } from '@/lib/goide-tests-api'
import { clearFlakyHistory, flakyRecords, loadFlakyHistory, saveFlakyHistory } from './goStudioFlakyHistory'

const result = (name: string, runs: number, failures: number) => ({ id: `p\u0000${name}`, package: 'p', name, status: 'fail', elapsedMillis: 0, runs, failures }) as unknown as GoIDETestResult
const run = (runId: string, startedAt: string, results: GoIDETestResult[], status = 'finished') => ({ runId, startedAt, status, results }) as unknown as GoIDETestRun

describe('flaky history', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  })

  it('keeps only tests that both passed and failed in finished repeated runs', () => {
    const saved = saveFlakyHistory('/repo', [
      run('r1', '2026-10-01T10:00:00Z', [result('TestFlaky', 10, 2), result('TestBroken', 10, 10), result('TestOnce', 1, 1)]),
      run('r2', '2026-10-02T10:00:00Z', [result('TestFlaky', 20, 1)], 'running'),
    ])
    expect(saved.map((entry) => entry.name)).toEqual(['TestFlaky'])
    expect(loadFlakyHistory('/repo')).toHaveLength(1)
    expect(loadFlakyHistory('/other')).toEqual([])
  })

  it('aggregates occurrences per test and clears per project', () => {
    saveFlakyHistory('/repo', [run('r1', '2026-10-01T10:00:00Z', [result('TestFlaky', 10, 2)])])
    const entries = saveFlakyHistory('/repo', [run('r2', '2026-10-02T10:00:00Z', [result('TestFlaky', 20, 1)])])
    expect(flakyRecords(entries).get('p\u0000TestFlaky')).toEqual({ occurrences: 2, failures: 3, runs: 30, lastSeen: '2026-10-02T10:00:00Z' })
    clearFlakyHistory('/repo')
    expect(loadFlakyHistory('/repo')).toEqual([])
  })
})

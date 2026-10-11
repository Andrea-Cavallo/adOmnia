import { describe, expect, it } from 'vitest'
import { compareSnapshots, type RuntimeSnapshot } from './runtimeSnapshot'

const snapshot = (partial: Partial<RuntimeSnapshot>): RuntimeSnapshot => ({ version: 1, label: '', takenAt: '', service: 'api', goroutines: null, heap: null, requests: [], messages: [], queries: [], logs: [], traces: [], errors: [], ...partial })

describe('compareSnapshots', () => {
  it('reports what moved between two snapshots', () => {
    const before = snapshot({ goroutines: { total: 5, byFunction: [{ name: 'main.serve', count: 2 }] }, heap: { inuseBytes: 1000, byFunction: [{ name: 'main.cache', bytes: 100 }] }, errors: ['old error'] })
    const after = snapshot({
      goroutines: { total: 105, byFunction: [{ name: 'main.serve', count: 2 }, { name: 'main.worker', count: 100 }] },
      heap: { inuseBytes: 9000, byFunction: [{ name: 'main.cache', bytes: 8100 }] },
      requests: [{ method: 'GET', url: '/x', state: 'done', status: 500 }],
      errors: ['old error', 'new: connection refused'],
    })
    const result = compareSnapshots(before, after)
    expect(result.summary.find((row) => row.label === 'Goroutines')).toEqual({ label: 'Goroutines', before: 5, after: 105 })
    expect(result.summary.find((row) => row.label === 'Failed requests')?.after).toBe(1)
    expect(result.goroutines).toEqual([{ label: 'main.worker', before: 0, after: 100 }])
    expect(result.heap[0]).toEqual({ label: 'main.cache', before: 100, after: 8100 })
    expect(result.newErrors).toEqual(['new: connection refused'])
  })
})

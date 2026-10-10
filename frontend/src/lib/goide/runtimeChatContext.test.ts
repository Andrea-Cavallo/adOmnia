import { describe, expect, it } from 'vitest'
import { runtimeChatContext } from './runtimeChatContext'

describe('runtimeChatContext', () => {
  it('summarizes spans, profile hot lines and logs of the active file, errors first', () => {
    const text = runtimeChatContext({
      root: '/proj', file: 'api/api.go',
      lens: [{ file: '/proj/api/api.go', line: 20, name: 'SELECT orders', count: 4, errors: 1, p50Ms: 3, p95Ms: 9 }, { file: '/proj/other.go', line: 1, name: 'x', count: 9, errors: 0, p50Ms: 1, p95Ms: 1 }] as never,
      costs: [{ file: 'api/api.go', line: 21, metric: 'cpu', unit: 'nanoseconds', value: 5e6, profile: 'cpu.pprof', at: '' }],
      logs: Array.from({ length: 30 }, (_, index) => ({ seq: index, sessionId: 's', at: '', stream: 'stdout', text: index === 3 ? 'query failed: timeout' : `line ${index}` })),
    })
    expect(text).toContain('- line 20 SELECT orders: 4 calls · p95 9.0 ms · 1 err, p50 3.0 ms')
    expect(text).not.toContain('other.go')
    expect(text).toContain('- line 21: 5.0 ms CPU')
    expect(text).toContain('- query failed: timeout')
    expect(text).toContain('- line 29')
    expect(text.split('\n').filter((line) => line.startsWith('- line 1')).length).toBeLessThan(5)
  })

  it('is empty when nothing ran', () => {
    expect(runtimeChatContext({ root: '/p', file: 'a.go', lens: [], costs: [], logs: [] })).toBe('')
  })
})

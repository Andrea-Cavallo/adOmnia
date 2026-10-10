import { describe, expect, it } from 'vitest'
import type { OtlpLensStat } from '@/lib/otlp-api'
import { fileCounts, lensFlags, lensTitle } from './runtimeLens'

const solo = { max: 12, atMax: 1 }

const stat = (over: Partial<OtlpLensStat>): OtlpLensStat => ({
  file: '/src/a.go', line: 10, name: 'SELECT', count: 12, errors: 0, avgMs: 5, p50Ms: 4, p95Ms: 9, p99Ms: 12, maxMs: 14, lastMs: 100_000, category: 'db', ...over,
})

describe('runtime lens', () => {
  it('summarizes calls, percentiles, errors and recency', () => {
    expect(lensTitle(stat({ errors: 1 }), solo, 103_000)).toBe('runtime: 12 calls · p50 4.0 ms · p95 9.0 ms · 1 error · 3s ago · hot path')
    expect(lensTitle(stat({ retries: 3 }), solo, 103_000)).toContain('· 3 retries ·')
    expect(lensTitle(stat({ kind: 'consumer', firstMs: 100_000 - 120_000 }), solo, 103_000)).toMatch(/^runtime: 12 messages · 6\.0 msg\/min ·/)
    expect(lensTitle(stat({ count: 1, p50Ms: 1200, p95Ms: 1200 }), solo, 100_000 + 120_000)).toBe('runtime: 1 call · p50 1.2 s · p95 1.2 s · 2m ago · slow path')
  })

  it('flags hot and slow paths', () => {
    expect(lensFlags(stat({}), solo)).toEqual({ hot: true, slow: false })
    expect(lensFlags(stat({ count: 3 }), solo).hot).toBe(false)
    expect(lensFlags(stat({}), fileCounts([stat({}), stat({ line: 20 })])).hot).toBe(false) // a tie is not a hot path
    expect(lensFlags(stat({ p50Ms: 2, p95Ms: 20 }), solo).slow).toBe(true) // tail 10× the median
    expect(lensFlags(stat({ count: 2, p50Ms: 2, p95Ms: 20 }), solo).slow).toBe(false) // too few calls for a tail
  })
})

describe('runtimeByNode', () => {
  it('gives routes their server spans and functions the spans inside them', async () => {
    const { runtimeByNode, runtimeText } = await import('./runtimeLens')
    const stat = (file: string, line: number, name: string, count: number, p95Ms: number, errors = 0) => ({ file, line, name, count, errors, p95Ms } as never)
    const nodes = [
      { id: 'r', kind: 'endpoint', label: 'GET /orders' },
      { id: 'h', kind: 'function', label: 'api.List', file: 'api/api.go', line: 10 },
      { id: 'f', kind: 'function', label: 'api.find', file: 'api/api.go', line: 20 },
    ]
    const result = runtimeByNode([
      stat(['C:', 'proj', 'api', 'api.go'].join(String.fromCharCode(92)), 12, 'GET /orders', 4, 30),
      stat('C:/proj/api/api.go', 22, 'SELECT orders', 4, 12, 1),
      stat('api.go', 25, 'SELECT more', 1, 50),
    ], ['C:', 'proj'].join(String.fromCharCode(92)), nodes)
    expect(result.get('r')).toEqual({ count: 4, errors: 0, p95Ms: 30 })
    expect(result.get('h')).toEqual({ count: 4, errors: 0, p95Ms: 30 })
    expect(result.get('f')).toEqual({ count: 5, errors: 1, p95Ms: 50 })
    expect(runtimeText(result.get('f')!)).toBe('5 calls · p95 50 ms · 1 err')
  })
})

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

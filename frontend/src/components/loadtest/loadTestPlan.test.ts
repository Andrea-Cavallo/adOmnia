import { describe, expect, it } from 'vitest'
import { buildLoadPlan, type LoadInputs } from './loadTestPlan'

const base: LoadInputs = { concurrency: 10, totalReqs: 100, durationS: 30, useDuration: false, warmupReqs: 5, rampUpS: 0, thinkTimeMs: 0, burst: 5, gapRequests: 2, gapMs: 200 }

describe('buildLoadPlan', () => {
  it('fires a burst all at once as a probe', () => {
    expect(buildLoadPlan('burst', base)).toEqual({ executor: 'probe', count: 5 })
  })
  it('spaces the starts of the gap probe', () => {
    expect(buildLoadPlan('gap', base)).toEqual({ executor: 'probe', count: 2, gapMs: 200 })
  })
  it('runs a fixed number of iterations with its warm-up', () => {
    expect(buildLoadPlan('load', base)).toEqual({ executor: 'vus', vus: 10, iterations: 100, warmupIterations: 5 })
  })
  it('runs for a duration, ramping up when asked', () => {
    expect(buildLoadPlan('load', { ...base, useDuration: true })).toEqual({ executor: 'vus', vus: 10, durationS: 30, warmupIterations: 5 })
    expect(buildLoadPlan('load', { ...base, useDuration: true, rampUpS: 10, thinkTimeMs: 250 })).toEqual({
      executor: 'vus',
      thinkTimeMs: 250,
      stages: [{ durationS: 10, targetVUs: 10, unmeasured: true }, { durationS: 30, targetVUs: 10 }],
    })
  })
  it('clamps nonsense and never lets the warm-up swallow the run', () => {
    expect(buildLoadPlan('burst', { ...base, burst: 99999 })).toEqual({ executor: 'probe', count: 2000 })
    expect(buildLoadPlan('gap', { ...base, gapRequests: 0, gapMs: -5 })).toEqual({ executor: 'probe', count: 2, gapMs: 0 })
    expect(buildLoadPlan('load', { ...base, totalReqs: 3, warmupReqs: 50 })).toMatchObject({ iterations: 3, warmupIterations: 2 })
    expect(buildLoadPlan('load', { ...base, concurrency: 50000 })).toMatchObject({ vus: 2000 })
  })
})

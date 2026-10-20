import { describe, expect, it } from 'vitest'
import { buildLoadPlan, type LoadInputs } from './loadTestPlan'

const base: LoadInputs = { concurrency: 10, totalReqs: 100, durationS: 30, useDuration: false, warmupReqs: 5, burst: 5, gapRequests: 2, gapMs: 200 }

describe('buildLoadPlan', () => {
  it('fires a burst all at once with no warmup', () => {
    expect(buildLoadPlan('burst', base)).toEqual({ concurrency: 5, totalReqs: 5, warmupReqs: 0, staggerMs: 0 })
  })
  it('spaces the starts of the gap probe', () => {
    expect(buildLoadPlan('gap', base)).toEqual({ concurrency: 2, totalReqs: 2, warmupReqs: 0, staggerMs: 200 })
  })
  it('keeps the classic load shape and its warmup', () => {
    expect(buildLoadPlan('load', base)).toEqual({ concurrency: 10, totalReqs: 100, warmupReqs: 5, staggerMs: 0 })
    expect(buildLoadPlan('load', { ...base, useDuration: true })).toMatchObject({ durationS: 30 })
  })
  it('clamps nonsense', () => {
    expect(buildLoadPlan('burst', { ...base, burst: 9999 }).totalReqs).toBe(200)
    expect(buildLoadPlan('gap', { ...base, gapRequests: 0, gapMs: -5 })).toMatchObject({ totalReqs: 2, staggerMs: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import { createStressAccumulator, percentile, type StressSample } from './flowStressStats'

const sample = (patch: Partial<StressSample>): StressSample => ({
  t: 0, vu: 0, iteration: 0, nodeId: 'a', step: 'Login', status: 'success', httpStatus: 200, stepMs: 10, ...patch,
})

describe('percentile', () => {
  it('uses nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(sorted, 50)).toBe(50)
    expect(percentile(sorted, 95)).toBe(95)
    expect(percentile(sorted, 99)).toBe(99)
    expect(percentile([7], 99)).toBe(7)
    expect(percentile([], 50)).toBe(0)
  })
})

describe('createStressAccumulator', () => {
  it('is empty before any sample', () => {
    const stats = createStressAccumulator().snapshot(0)
    expect(stats).toMatchObject({ totalRequests: 0, rps: 0, steps: [], timeline: [] })
    expect(stats.slowestStep).toBeUndefined()
  })

  it('aggregates per step, prefers HTTP latency and buckets per second', () => {
    const acc = createStressAccumulator()
    acc.add(sample({ t: 100, latencyMs: 20, stepMs: 35 }))
    acc.add(sample({ t: 900, latencyMs: 40 }))
    acc.add(sample({ t: 2100, status: 'failed', httpStatus: 500, latencyMs: 60 }))
    acc.add(sample({ t: 2200, nodeId: 'b', step: 'Me', status: 'failed', httpStatus: undefined, stepMs: 5 }))
    acc.iteration(true)
    acc.iteration(false)
    const stats = acc.snapshot(4000)

    const login = stats.steps.find((step) => step.nodeId === 'a')!
    expect(login).toMatchObject({ count: 3, errors: 1, errorPct: 33.3, min: 20, max: 60, avg: 40, p50: 40 })
    expect(login.statuses).toEqual({ 200: 2, 500: 1 })
    expect(stats.steps.find((step) => step.nodeId === 'b')!.statuses).toEqual({ ERR: 1 })
    expect(stats).toMatchObject({ totalRequests: 4, totalErrors: 2, iterationsOk: 1, iterationsFailed: 1, rps: 1, slowestStep: 'Login' })
    expect(stats.timeline).toEqual([
      { s: 0, requests: 2, errors: 0 },
      { s: 1, requests: 0, errors: 0 },
      { s: 2, requests: 2, errors: 2 },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import type { LoadTestResult } from './loadtest-api'
import { fromStressStats, toStressSamples, toStressStats } from './flowStressResult'

const result: LoadTestResult = {
  totalRequests: 12, successful: 8, failed: 2, warmupSkipped: 2, iterations: 5, failedIterations: 1,
  measuredTimeMs: 2000, bytesReceived: 4000, totalTimeMs: 2500,
  avgMs: 12.34, minMs: 1.04, maxMs: 90, p50Ms: 10, p75Ms: 11, p90Ms: 20, p95Ms: 40.06, p99Ms: 88, p999Ms: 90,
  throughput: 5.04, errorRate: 20, statusCodes: { 200: 8, 500: 1 },
  steps: [
    { id: 'login', step: 'Login', count: 5, errors: 0, errorPct: 0, minMs: 1, avgMs: 5, p50Ms: 5, p90Ms: 8, p95Ms: 9, p99Ms: 9, maxMs: 9, statusCodes: { 200: 5 } },
    { id: 'pay', step: 'Pay', count: 5, errors: 2, errorPct: 40, minMs: 2, avgMs: 20, p50Ms: 15, p90Ms: 60, p95Ms: 80, p99Ms: 88, maxMs: 90, statusCodes: { 200: 3, 500: 1, ERR: 1 } },
  ],
  distribution: [{ fromMs: 0, toMs: 10, count: 6, percentage: 60 }, { fromMs: 90, toMs: 0, count: 1, percentage: 10, overflow: true }],
  apdex: { thresholdMs: 500, satisfied: 8, tolerated: 0, frustrated: 2, score: 0.8 },
  errorGroups: [{ code: 'HTTP_5xx', message: 'HTTP 500', count: 1, steps: ['Pay'], status: 500 }, { code: 'TIMEOUT', message: 'request timed out', count: 1, steps: ['Pay'] }],
  throughputTimeline: [{ second: 0, reqs: 6, errors: 1, avgMs: 10, p95Ms: 30, p99Ms: 40, vus: 3 }],
  timeline: [{ timeMs: 15.6, latencyMs: 12.4, status: 200, ok: true, step: 'Login', stepId: 'login', vu: 2, iteration: 3, bytes: 10, measured: true }],
}

describe('Go result → Stress dock stats', () => {
  it('maps totals, steps, statuses, distribution, APDEX and the slowest step', () => {
    const stats = toStressStats(result)
    expect(stats).toMatchObject({ totalRequests: 10, totalErrors: 2, excludedRequests: 2, iterationsOk: 4, iterationsFailed: 1, rps: 5, bytesPerSecond: 2000, measuredElapsedMs: 2000 })
    expect(stats.overall).toEqual({ min: 1, avg: 12.3, p50: 10, p90: 20, p95: 40.1, p99: 88, max: 90 })
    expect(stats.statuses).toEqual({ 200: 8, 500: 1, ERR: 1 })
    expect(stats.steps.map((s) => s.nodeId)).toEqual(['login', 'pay'])
    expect(stats.slowestStep).toBe('Pay')
    expect(stats.distribution[1]).toMatchObject({ toMs: Number.POSITIVE_INFINITY, overflow: true })
    expect(stats.errorGroups[1]).toEqual({ fingerprint: 'request timed out', count: 1, steps: ['Pay'], statuses: ['ERR'] })
    expect(stats.timeline).toEqual([{ s: 0, requests: 6, errors: 1, activeVus: 3 }])
    expect(stats.apdex.score).toBe(0.8)
  })

  it('turns the timeline into the raw request log with 0-based VU and iteration', () => {
    expect(toStressSamples(result.timeline)).toEqual([{ t: 16, vu: 1, iteration: 2, nodeId: 'login', step: 'Login', status: 'success', httpStatus: 200, latencyMs: 12, stepMs: 12, bytes: 10, error: undefined, measured: true }])
  })

  it('imports an old history entry so it reads back the same in the dock', () => {
    const stats = toStressStats(result)
    const back = toStressStats(fromStressStats('Checkout', '2026-01-01T00:00:00Z', false, stats))
    expect(back.overall).toEqual(stats.overall)
    expect(back.totalRequests).toBe(stats.totalRequests)
    expect(back.totalErrors).toBe(stats.totalErrors)
    expect(back.steps.map((step) => step.p95)).toEqual(stats.steps.map((step) => step.p95))
  })
})

import { describe, expect, it } from 'vitest'
import { chartPoints, distributionChartModel, latencyChartModel, niceScaleMax, timelineChartModel, trendChartModel, workloadChartModel } from './flowStressCharts'
import type { StepStats } from './flowStressStats'

const step = (name: string, p50: number, p95: number, p99: number): StepStats => ({
  nodeId: name, step: name, count: 20, errors: 0, errorPct: 0,
  min: 10, avg: 30, p50, p90: p95, p95, p99, max: p99, statuses: { 200: 20 },
})

describe('stress chart models', () => {
  it('uses readable rounded scales', () => {
    expect(niceScaleMax(0)).toBe(1)
    expect(niceScaleMax(73)).toBe(100)
    expect(niceScaleMax(201)).toBe(500)
  })

  it('gives throughput and error rate independent axes', () => {
    const model = timelineChartModel([
      { s: 0, requests: 40, errors: 1 },
      { s: 1, requests: 80, errors: 20 },
    ])
    expect(model.requestMax).toBe(100)
    expect(model.errorRateMax).toBe(50)
    expect(model.errorRatePoints[1].value).toBe(25)
    expect(model.requestPoints.every((point) => point.y >= model.plot.top)).toBe(true)
    expect(chartPoints(model.requestPoints)).toContain(',')
  })

  it('keeps the SLO threshold and observed p99 in the latency domain', () => {
    const model = latencyChartModel([step('Checkout', 80, 180, 260)], 200)
    expect(model.maxMs).toBe(500)
    expect(model.thresholdX).toBeGreaterThan(model.rows[0].p95X)
    expect(model.rows[0].p99X).toBeGreaterThan(model.thresholdX!)
  })

  it('makes actual VU activity and latency bands chartable', () => {
    const workload = workloadChartModel([{ s: 0, requests: 1, errors: 0, activeVus: 1 }, { s: 1, requests: 3, errors: 0, activeVus: 8 }])
    expect(workload.maxVus).toBe(10)
    expect(workload.points[1].value).toBe(8)
    const distribution = distributionChartModel([{ fromMs: 0, toMs: 100, count: 8, percentage: 80 }, { fromMs: 100, toMs: Infinity, count: 2, percentage: 20, overflow: true }])
    expect(distribution.bars).toHaveLength(2)
    expect(distribution.bars[0].height).toBeGreaterThan(distribution.bars[1].height)
  })

  it('plots persisted runs in chronological order with independent scales', () => {
    const stats = { overall: { p95: 200 }, rps: 20 }
    const model = trendChartModel([
      { flowName: 'x', startedAt: '2026-02-02', status: 'completed', config: {} as never, stats: { ...stats, overall: { p95: 200 } } as never },
      { flowName: 'x', startedAt: '2026-02-01', status: 'completed', config: {} as never, stats: { ...stats, overall: { p95: 100 }, rps: 10 } as never },
    ])
    expect(model.p95Points.map((point) => point.value)).toEqual([100, 200])
    expect(model.p95Max).toBe(200)
    expect(model.rpsMax).toBe(20)
  })
})

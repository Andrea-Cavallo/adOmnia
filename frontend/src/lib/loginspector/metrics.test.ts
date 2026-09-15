import { describe, expect, it } from 'vitest'
import { analyzeLog } from './analyze'
import { buildExecutionMetrics, compareVersions } from './metrics'
import { parseLogText } from './parse'

function record(id: string, version: string, duration: number, status: number) {
  return JSON.stringify({ timestamp: `2026-09-15T10:00:0${id.slice(-1)}Z`, correlation_id: id, service: { name: 'orders', version }, message: 'request completed', duration_ms: duration, http: { method: 'POST', route: '/orders', status_code: status } })
}

describe('execution metrics', () => {
  it('reports denominator, coverage and percentiles from chain durations', () => {
    const analysis = analyzeLog(parseLogText([record('c1', '1.0', 10, 200), record('c2', '1.0', 20, 500), record('c3', '1.0', 30, 200)].join('\n')).events)
    const metric = buildExecutionMetrics(analysis, 'route')[0]
    expect(metric).toMatchObject({ sampleCount: 3, timedSamples: 3, explicitTimedSamples: 3, errorCount: 1, p50Ms: 20, p95Ms: 30 })
  })

  it('compares before and after versions with the explaining sample chains', () => {
    const lines = [record('c1', '1.0', 10, 200), record('c2', '1.0', 20, 200), record('c3', '2.0', 50, 500), record('c4', '2.0', 80, 200)]
    const comparison = compareVersions(analyzeLog(parseLogText(lines.join('\n')).events), '1.0', '2.0')[0]
    expect(comparison.p95DeltaMs).toBe(60)
    expect(comparison.errorRateDelta).toBe(0.5)
    expect(comparison.current?.chainKeys).toHaveLength(2)
  })
})

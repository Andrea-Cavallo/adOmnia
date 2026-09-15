import { describe, expect, it } from 'vitest'
import { DEFAULT_STRESS_CONFIG } from './flowStress'
import { analyzeStressRun } from './flowStressAnalysis'
import { createStressAccumulator, type StressSample } from './flowStressStats'

function stats(latencies: number[], failed = 0) {
  const acc = createStressAccumulator()
  latencies.forEach((latency, index) => acc.add({
    t: index * 10,
    vu: index % 2,
    iteration: index,
    nodeId: index % 2 ? 'b' : 'a',
    step: index % 2 ? 'Call B' : 'Call A',
    status: index < failed ? 'failed' : 'success',
    httpStatus: index < failed ? 500 : 200,
    latencyMs: latency,
    stepMs: latency,
    error: index < failed ? 'HTTP 500 order 12345' : undefined,
  } satisfies StressSample))
  return acc.snapshot(1000)
}

describe('stress run analysis', () => {
  it('fails explicit SLOs and explains the bottleneck and error concentration', () => {
    const assessment = analyzeStressRun(stats([...Array.from({ length: 17 }, () => 20), 900, 1500, 1800], 4), {
      ...DEFAULT_STRESS_CONFIG,
      maxP95Ms: 500,
      maxErrorPct: 5,
      minRps: 25,
    })
    expect(assessment.verdict).toBe('fail')
    expect(assessment.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(['p95', 'errors', 'throughput'])
    expect(assessment.insights.map((item) => item.title)).toEqual(expect.arrayContaining(['Long latency tail', 'Errors concentrate in one step', 'Primary bottleneck']))
  })

  it('marks tiny samples inconclusive and detects a baseline regression', () => {
    const baseline = stats(Array.from({ length: 20 }, () => 100))
    const assessment = analyzeStressRun(stats([200, 240, 260]), { ...DEFAULT_STRESS_CONFIG, maxP95Ms: 1000, maxErrorPct: 1, minRps: 0 }, baseline)
    expect(assessment.verdict).toBe('inconclusive')
    expect(assessment.insights.map((item) => item.title)).toContain('Small sample')
    expect(assessment.insights.map((item) => item.title)).toContain('Latency regression')
  })
})

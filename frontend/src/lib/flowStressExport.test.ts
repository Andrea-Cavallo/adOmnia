import { describe, expect, it } from 'vitest'
import type { StressRun } from './flowStress'
import { createStressAccumulator, type StressSample } from './flowStressStats'
import { baselineStep, deltaPct, parseStressJson, sparklinePoints, stressCsv, stressFileName, stressHtml, stressJson, utf8ToBase64 } from './flowStressExport'

const samples: StressSample[] = [
  { t: 12, vu: 0, iteration: 0, nodeId: 'a', step: 'Login, "v2"', status: 'success', httpStatus: 200, latencyMs: 20, stepMs: 25, bytes: 100 },
  { t: 1500, vu: 1, iteration: 1, nodeId: 'a', step: 'Login, "v2"', status: 'failed', stepMs: 3, error: 'line1\nline2' },
]

const run = (): StressRun => {
  const acc = createStressAccumulator()
  samples.forEach(acc.add)
  return {
    config: { vus: 2, rampUpS: 0, mode: 'iterations', iterations: 2, durationS: 30, thinkTimeMs: 0 },
    startedAt: '2026-09-11T10:20:30.000Z', finishedAt: '2026-09-11T10:20:32.000Z', status: 'completed',
    stats: acc.snapshot(2000), samples, truncated: false,
  }
}

describe('flow stress export', () => {
  it('writes one quoted CSV row per sample', () => {
    const lines = stressCsv(samples).trimEnd().split('\r\n')
    expect(lines[0]).toBe('t_ms,vu,iteration,step,status,http_status,latency_ms,step_ms,bytes,error')
    expect(lines[1]).toBe('12,0,0,"Login, ""v2""",success,200,20,25,100,')
    expect(stressCsv(samples)).toContain('"line1\nline2"')
  })

  it('tags the JSON export', () => {
    const parsed = JSON.parse(stressJson(run(), 'Checkout'))
    expect(parsed).toMatchObject({ format: 'adomnia-flow-stress', version: 1, flowName: 'Checkout', status: 'completed' })
    expect(parsed.samples).toHaveLength(2)
  })

  it('escapes names in the HTML report', () => {
    const html = stressHtml(run(), '<script>x</script>')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Login, &quot;v2&quot;')
  })

  it('builds safe file names, base64 and sparkline points', () => {
    expect(stressFileName('My Flow / v2', '2026-09-11T10:20:30.000Z', 'csv')).toBe('my-flow-v2-stress-2026-09-11-10-20-30.csv')
    expect(atob(utf8ToBase64('ok'))).toBe('ok')
    expect(utf8ToBase64('è')).toBe('w6g=')
    expect(sparklinePoints([{ s: 0, requests: 2, errors: 0 }, { s: 1, requests: 1, errors: 1 }], 100, 10)).toBe('0,0 100,5')
  })

  it('reads its own JSON export back as a baseline', () => {
    const baseline = parseStressJson(stressJson(run(), 'Checkout'))
    expect(baseline).toMatchObject({ flowName: 'Checkout', startedAt: '2026-09-11T10:20:30.000Z' })
    expect(baseline.stats.steps[0].nodeId).toBe('a')
  })

  it('rejects files that are not stress exports', () => {
    expect(() => parseStressJson('nope')).toThrow('not valid JSON')
    expect(() => parseStressJson('null')).toThrow('not an adOmnia')
    expect(() => parseStressJson('{"format":"adomnia-flow-stress","version":2}')).toThrow('version 2')
    expect(() => parseStressJson('{"format":"adomnia-flow-stress","version":1,"stats":{"rps":1,"steps":[{"nodeId":"a"}]}}')).toThrow('no valid statistics')
  })

  it('computes deltas and matches steps by id, then label', () => {
    expect(deltaPct(120, 100)).toBe(20)
    expect(deltaPct(90, 100)).toBe(-10)
    expect(deltaPct(5, 0)).toBeUndefined()
    const stats = run().stats
    const current = { ...stats.steps[0], nodeId: 'recreated' }
    expect(baselineStep(stats, stats.steps[0])?.nodeId).toBe('a')
    expect(baselineStep(stats, current)?.nodeId).toBe('a')
    expect(baselineStep(stats, { ...current, step: 'Other' })).toBeUndefined()
  })
})

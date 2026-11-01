import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'
import { resourceChartPath, resourceProcessSummary, resourceReport, resourceStats, resourcesToCSV, resourcesToHTML } from './resourceReport'

const sample = (second: number, cpu: number | null, interval = 1): Snapshot => ({ at: new Date(Date.UTC(2026, 9, 19, 10, 0, 0) + second * 1000).toISOString(), ram: 1024 * (second + 1), cpu: cpu ?? 0, processes: [{ pid: 7, createdAt: 12, parentPid: 1, parentName: 'adOmnia', name: '<script>|"', ram: 1024, cpu, cpuSeconds: second, cpuIntervalSeconds: interval, workspace: 'C:\\x,foo', role: 'language-server', attribution: 'managed-session' }], runtime: { memoryLimit: 536870912, heapAlloc: 0, heapSys: 0, numGC: 2, gcCpuFraction: 0, goroutines: 1 }, rootPid: 1, logicalCores: 8, instances: 1, incomplete: false, cpuComplete: cpu != null } as Snapshot)

describe('resource diagnostics export', () => {
  it('retains observed editor context alongside each JSON sample', () => {
    const observed = { ...sample(1, 5), uiContext: { view: 'codestudio', openDocuments: 20, activeFile: 'service.go' } }
    expect(resourceReport(observed, [observed]).samples[0].uiContext).toEqual(observed.uiContext)
  })
  it('preserves every process in every sample, null CPU and separate process identity', () => {
    const report = resourceReport(sample(2, 10), [sample(0, null), sample(2, 10)], 'Idle')
    expect(report.samples[0].processes[0].cpu).toBeNull()
    expect(report.summary.cpuAverage).toBe(10)
    expect(report.summary.durationSeconds).toBe(2)
    expect(report.processes[0].createdAt).toBe(12)
    expect(report.processes[0].samples).toBe(2)
    expect(resourcesToCSV(sample(2, 10), [sample(0, null), sample(2, 10)])).toContain('"<script>|"""')
  })

  it('does not draw CPU warming up as zero and uses elapsed time', () => {
    expect(resourceChartPath([sample(0, null), sample(2, 10), sample(8, 20)], 'cpu').path).toMatch(/^ M150\.00/)
    expect(resourceStats([sample(0, null)]).cpuAverage).toBeNull()
  })

  it('escapes user-controlled paths and names in the portable HTML', () => {
    const exported = resourcesToHTML(sample(2, 10), [], '</pre><script>alert(1)</script>')
    expect(exported).not.toContain('<script>')
    expect(exported).toContain('&lt;script&gt;')
    expect(exported).toContain('<svg')
  })

  it('keeps recycled PIDs separate and retains gaps when a process exits', () => {
    const a = sample(0, 10), b = sample(2, 20)
    b.processes[0].createdAt = 99
    expect(resourceProcessSummary([a, b])).toHaveLength(2)
    const missing = { ...sample(4, null), processes: [] }
    expect(resourceChartPath([a, missing, sample(8, 5)], 'ram').path).toMatch(/M.* M/)
  })

  it('does not export spreadsheet formulas from untrusted process names', () => {
    const s = sample(2, 10); s.processes[0].name = '=cmd()'
    expect(resourcesToCSV(s, [])).toContain("\"'=cmd()\"")
  })

  // A 5 s live sample and a 1 s recording sample must not carry the same weight.
  it('weights the CPU average by the interval each sample measured', () => {
    const report = resourceReport(sample(21, 100, 20), [sample(0, null), sample(1, 10, 1), sample(21, 100, 20)])
    // (10 x 1 s + 100 x 20 s) / 21 s, not the arithmetic mean 55.
    expect(report.summary.cpuAverage).toBe(95.71)
    expect(report.summary.cpuWeighting).toBe('time')
    expect(report.summary.cpuAverageCores).toBe(7.66)
  })

  it('marks a silence instead of drawing it as a continuous line', () => {
    const report = resourceReport(sample(60, 5), [sample(0, 10), sample(1, 10), sample(60, 5)])
    expect(report.samples[2].gapSeconds).toBe(59)
    expect(report.samples[1].gapSeconds).toBeNull()
    expect(report.quality.gaps).toBe(1)
    expect(report.quality.medianIntervalSeconds).toBe(30)
    expect(resourceChartPath([sample(0, 10), sample(1, 10), sample(60, 5)], 'cpu').path).toMatch(/M.* M/)
  })

  it('says when a window cannot support an average', () => {
    const report = resourceReport(sample(3, 10), [sample(0, 10), sample(3, 10)])
    expect(report.quality.sufficient).toBe(false)
    expect(report.quality.caveats.join(' ')).toContain('only 2 samples')
    expect(report.quality.caveats.join(' ')).toContain('below 30 s')
  })

  it('records which machine and build produced the numbers', () => {
    const report = resourceReport(sample(2, 10), [], 'Idle', { appVersion: '1.0.7', os: 'windows', logicalCores: 28, memoryBudgetSource: 'automatic' })
    expect(report.environment.appVersion).toBe('1.0.7')
    expect(report.environment.logicalCores).toBe(28)
    expect(report.environment.memoryBudgetSource).toBe('automatic')
    expect(resourceReport(sample(2, 10), []).environment.logicalCores).toBe(8)
  })

  it('normalises timestamps and joins identity back into every CSV row', () => {
    const s = sample(2, 10); s.at = '2026-10-19T12:00:02+02:00'; s.processes[0].owner = 'Code Studio / gopls'
    const csv = resourcesToCSV(s, [])
    expect(csv).toContain('2026-10-19T10:00:02.000Z')
    expect(csv).toContain('Code Studio / gopls')
    expect(csv).toContain('"7:12"')
    const empty = { ...sample(4, null), processes: [] }
    const rows = resourcesToCSV(empty, [s, empty]).split('\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[2]).toContain('2026-10-19T10:00:04.000Z')
    expect(rows[2]).toContain('"2"')
  })
})

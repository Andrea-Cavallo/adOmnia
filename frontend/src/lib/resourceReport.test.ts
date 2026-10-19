import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../bindings/adomnia/internal/resources/models'
import { resourceChartPath, resourceProcessSummary, resourceReport, resourceStats, resourcesToCSV, resourcesToHTML } from './resourceReport'
const sample = (second: number, cpu: number | null): Snapshot => ({ at: `2026-10-19T10:00:${String(second).padStart(2,'0')}Z`, ram: 1024*(second+1), cpu: cpu ?? 0, processes: [{pid:7,createdAt:12,parentPid:1,parentName:'adOmnia',name:'<script>|"',ram:1024,cpu,workspace:'C:\\x,foo',role:'language-server'}], runtime:{memoryLimit:536870912,numGC:2},rootPid:1,logicalCores:8,instances:1,incomplete:false } as Snapshot)
describe('resource diagnostics export',()=>{
  it('preserves every process in every sample, null CPU and separate process identity',()=>{
    const report=resourceReport(sample(2,10),[sample(0,null),sample(2,10)],'Idle')
    expect(report.samples[0].processes[0].cpu).toBeNull()
    expect(report.summary.cpuAverage).toBe(10)
    expect(report.summary.durationSeconds).toBe(2)
    expect(report.samples[1].processes[0].createdAt).toBe(12)
    expect(resourcesToCSV(sample(2,10),report.samples)).toContain('"<script>|"""')
  })
  it('does not draw CPU warming up as zero and uses elapsed time',()=>{
    expect(resourceChartPath([sample(0,null),sample(2,10),sample(8,20)],'cpu').path).toMatch(/^ M150\.00/)
    expect(resourceStats([sample(0,null)]).cpuAverage).toBeNull()
  })
  it('escapes user-controlled paths and names in the portable HTML',()=>{
    const exported=resourcesToHTML(sample(2,10),[],'</pre><script>alert(1)</script>')
    expect(exported).not.toContain('<script>')
    expect(exported).toContain('&lt;script&gt;')
    expect(exported).toContain('<svg')
  })
  it('keeps recycled PIDs separate and retains gaps when a process exits',()=>{
    const a=sample(0,10),b=sample(2,20)
    b.processes[0].createdAt=99
    expect(resourceProcessSummary([a,b])).toHaveLength(2)
    const missing={...sample(4,null),processes:[]}
    expect(resourceChartPath([a,missing,sample(8,5)],'ram').path).toMatch(/M.* M/)
  })
  it('does not export spreadsheet formulas from untrusted process names',()=>{
    const s=sample(2,10);s.processes[0].name='=cmd()'
    expect(resourcesToCSV(s,[])).toContain("\"'=cmd()\"")
  })

})

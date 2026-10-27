import type { Snapshot } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'

export function resourceStats(history: Snapshot[]) {
  const cpus = history.filter(s => s.processes.some(p => p.cpu != null)).map(s => s.cpu)
  const ram = history.map(s => s.ram)
  return {
    samples: history.length,
    durationSeconds: history.length > 1 ? Math.max(0, (Date.parse(history[history.length-1].at) - Date.parse(history[0].at)) / 1000) : 0,
    cpuAverage: cpus.length ? cpus.reduce((a,b) => a+b,0) / cpus.length : null,
    cpuPeak: cpus.length ? Math.max(...cpus) : null,
    cpuMeasuredSamples: cpus.length,
    cpuCompleteSamples: history.filter(s => s.cpuComplete).length,
    ramPeak: ram.length ? Math.max(...ram) : null,
    ramChange: ram.length > 1 ? ram[ram.length-1] - ram[0] : null,
  }
}

export function resourceReport(sample: Snapshot, history: Snapshot[], scenario = 'Observation') {
  const samples = history.length ? history : [sample]
  return {
    schemaVersion: 1,
    kind: 'adomnia-resource-report',
    scenario,
    exportedAt: new Date().toISOString(),
    methodology: {
      scope: 'One adOmnia root PID and observed descendants only; unrelated applications excluded.',
      cpu: 'Percent of total logical CPU capacity. Null means no baseline or unavailable; never zero-filled. CPUSeconds is cumulative user+system time; CPUIntervalSeconds is the actual delta window. cpuComplete=false means the aggregate omits unavailable process CPU. Averages are arithmetic means of available samples, not time-weighted.',
      ram: 'Process RSS in bytes, summed. Shared pages can be counted multiple times; not private committed memory.',
      identity: 'PID plus createdAt (Unix milliseconds); PIDs can be reused.',
      provenance: 'managed-session = Code Studio registration; observed-parent = current OS parent, not proof of original creator.',
      limits: 'Go GOMEMLIMIT is a soft GC budget, not an RSS or CPU cap. Backend runtime and gopls limits are independent.',
      privacy: 'No raw command-line arguments, environment values (except GOMEMLIMIT), credentials or source code.',
      csvSafety: 'Formula-like string cells are prefixed with an apostrophe in CSV; JSON retains exact original strings.',
      coverage: 'Bounded to 256 processes and depth 16. Incomplete snapshots and OS access errors are retained. History is limited to 300 samples. Activity/visibility may cause gaps.',
    },
    summary: resourceStats(samples),
    processes: resourceProcessSummary(samples),
    snapshot: sample,
    samples,
  }
}

export function resourceProcessSummary(samples: Snapshot[]) {
  const rows = new Map<string,{pid:number;createdAt:number;name:string;role?:string;parentPid:number;firstSeen:string;lastSeen:string;samples:number;ramPeakBytes:number;cpuPeak:number|null;cpuAverage:number|null;cpuSamples:number}>()
  for(const s of samples) for(const p of s.processes){
    const id=`${p.pid}:${p.createdAt}`
    const row=rows.get(id) ?? {pid:p.pid,createdAt:p.createdAt,name:p.name,role:p.role,parentPid:p.parentPid,firstSeen:s.at,lastSeen:s.at,samples:0,ramPeakBytes:0,cpuPeak:null,cpuAverage:null,cpuSamples:0}
    row.samples++;row.lastSeen=s.at;row.ramPeakBytes=Math.max(row.ramPeakBytes,p.ram)
    if(p.cpu!=null){row.cpuAverage=((row.cpuAverage??0)*row.cpuSamples+p.cpu)/(row.cpuSamples+1);row.cpuSamples++;row.cpuPeak=Math.max(row.cpuPeak??0,p.cpu)}
    rows.set(id,row)
  }
  return [...rows.values()].sort((a,b)=>(b.cpuAverage??-1)-(a.cpuAverage??-1)||b.ramPeakBytes-a.ramPeakBytes)
}

const csvCell = (value: unknown) => {
  const safe=typeof value==='string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value ?? '')
  return `"${safe.replace(/"/g, '""')}"`
}
export function resourcesToCSV(sample: Snapshot, history: Snapshot[]) {
  const header = ['at','rootPid','logicalCores','pid','createdAtUnixMs','parentPid','parentName','name','role','owner','sessionId','workspace','executable','attribution','ramBytes','cpuPercentTotalCapacity','cpuSeconds','cpuIntervalSeconds','cpuComplete','goMemoryLimit','backendGoMemoryLimitBytes','heapAllocBytes','numGC','gcCpuFractionLifetime','incomplete','error']
  const rows = (history.length ? history : [sample]).flatMap(s => s.processes.map(p => [s.at,s.rootPid,s.logicalCores,p.pid,p.createdAt,p.parentPid,p.parentName,p.name,p.role,p.owner,p.sessionId,p.workspace,p.executable,p.attribution,p.ram,p.cpu,p.cpuSeconds,p.cpuIntervalSeconds,s.cpuComplete,p.memoryLimit,s.runtime?.memoryLimit,s.runtime?.heapAlloc,s.runtime?.numGC,s.runtime?.gcCpuFraction,s.incomplete,p.error].map(csvCell).join(',')))
  return [header.join(','),...rows].join('\r\n')
}

/** Real timestamps, distinct scales; missing CPU values break the line. */
export function resourceChartPath(samples: Snapshot[], metric: 'cpu' | 'ram', width = 600, height = 88) {
  const times = samples.map(s => Date.parse(s.at))
  const start = times[0], span = Math.max(1, times[times.length-1] - start)
  const max = metric === 'cpu' ? 100 : Math.max(1, ...samples.map(s => s.ram)) * 1.1
  let pen = false
  const path = samples.map((s,i) => {
    if (!Number.isFinite(times[i]) || !s.processes.length || (metric === 'cpu' && !s.processes.some(p => p.cpu != null))) { pen=false; return '' }
    const x = ((times[i]-start)/span*width).toFixed(2)
    const y = (height - Math.min(max, s[metric])/max*(height-4)).toFixed(2)
    const next = `${pen ? 'L' : 'M'}${x},${y}`; pen=true; return next
  }).join(' ')
  return { path, max }
}

const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function resourcesToHTML(sample: Snapshot, history: Snapshot[], scenario: string) {
  const report = resourceReport(sample,history,scenario)
  const charts = (['cpu','ram'] as const).map(metric => {
    const graph = resourceChartPath(report.samples,metric)
    return `<h2>${metric === 'cpu' ? 'CPU · 0–100% total capacity' : `RAM · 0–${(graph.max/1048576).toFixed(0)} MiB RSS`}</h2><svg viewBox="0 0 600 88" role="img" aria-label="${metric} over time"><path d="${graph.path}" fill="none" stroke="#e7984c" stroke-width="2"/></svg>`
  }).join('')
  const rows = sample.processes.map(p => `<tr>${[p.pid,p.parentPid,p.parentName,p.name,p.role,p.owner,p.workspace,(p.ram/1048576).toFixed(1),p.cpu?.toFixed(2) ?? 'unavailable',p.error].map(x=>`<td>${html(x)}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>adOmnia resource report</title><style>body{font:14px system-ui;background:#101010;color:#eee;max-width:1100px;margin:40px auto;padding:24px}h1{letter-spacing:-1px}h2{font-size:14px;margin-top:28px}svg{width:100%;border-bottom:1px solid #555}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #444;padding:9px;text-align:left;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#bbb}summary{cursor:pointer}</style><h1>adOmnia · Resource report</h1><p>${html(scenario)} · ${html(sample.at)}</p><pre>${html(JSON.stringify(report.summary,null,2))}</pre>${charts}<p>RAM and CPU use separate scales. First CPU sample is unavailable. RSS sums shared pages. Historical observation does not prove the cause of a spike.</p><table><thead><tr>${['PID','Parent','Parent name','Process','Role','Owner','Workspace','MiB RSS','CPU %','Error'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><details><summary>Full machine-readable recording and methodology</summary><pre>${html(JSON.stringify(report,null,2))}</pre></details></html>`
}

import { currentActivityPhase } from '@/stores/activity'
import { visibleInterval } from '@/lib/visiblePolling'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Activity, Download } from 'lucide-react'
import type { Snapshot } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'
import { useUiTranslation } from '@/lib/uiI18n'
import { saveTextFile } from '@/lib/fileUtils'
import { resourcesToMarkdown } from '@/lib/resourcesMarkdown'
import { resourceReport, resourcesToCSV, resourcesToHTML, resourceStats } from '@/lib/resourceReport'
import { ResourceChart } from './ResourceChart'
const ResourceLowResourceControls = lazy(() => import('./ResourceLowResourceControls').then(m => ({ default: m.ResourceLowResourceControls })))
const ResourceMemoryControls = lazy(() => import('./ResourceMemoryControls').then(m=>({default:m.ResourceMemoryControls})))

// Indicatore della status bar: ogni campione legge la tabella dei processi del sistema.
const RESOURCE_POLL_MS = 5000
const HISTORY_SAMPLES = 300
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MiB`

/** Campiona le risorse dell'app ogni 5 s finché il componente che lo usa è montato (e la finestra è attiva). */
export function useResourceSample() {
  const [sample, setSample] = useState<Snapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const history = useRef<Snapshot[]>([])
  const [recordUntil, setRecordUntil] = useState(0)
  const [scenario, setScenario] = useState('Observation')
  const [hasRecording,setHasRecording]=useState(false)
  const startRecording = (seconds: number) => { history.current = []; setHasRecording(true); setRecordUntil(Date.now() + seconds * 1000) }
  const stopRecording = () => setRecordUntil(0)
  const resumeHistory = () => { history.current=[]; setHasRecording(false); setRecordUntil(0) }
  useEffect(() => {
    let disposed = false
    let inFlight = false
    const poll = async () => {
      if (inFlight || disposed) return
      if (recordUntil && Date.now() >= recordUntil) { setRecordUntil(0); return }
      if (currentActivityPhase() === 'Active' || (recordUntil && !document.hidden)) {
        inFlight = true
        try { const { ResourceUsage } = await import('../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'); const next = await ResourceUsage(); if (!disposed) { if((!hasRecording || recordUntil) && history.current[history.current.length-1]?.at !== next.at) history.current = [...history.current, next].slice(-HISTORY_SAMPLES); setSample(next); setFailed(false) } }
        catch { if (!disposed) setFailed(true) }
        finally { inFlight = false }
      }
    }
    void poll()
    const stop = recordUntil ? (()=>{ const timer=window.setInterval(()=>void poll(),1000); return ()=>window.clearInterval(timer) })() : visibleInterval(() => { void poll() }, RESOURCE_POLL_MS, { kind: "decorative" })
    return () => { disposed = true; stop() }
  }, [recordUntil,hasRecording])
  return { sample, failed, history, recordUntil, startRecording, stopRecording, scenario, setScenario,hasRecording,resumeHistory }
}

interface ResourceDetailsProps {
  sample: Snapshot | null
  failed: boolean
  history: { current: Snapshot[] }
  className?: string
  recordUntil: number
  startRecording: (seconds: number) => void
  stopRecording: () => void
  scenario: string
  setScenario: (value: string) => void
  hasRecording: boolean
  resumeHistory: () => void
}

/** Il pannello "Application resources": budget, processi e l'export in Markdown. Condiviso da status bar e stripe di Code Studio. */
export function ResourceDetails({ sample, failed, history, className = '', recordUntil, startRecording, stopRecording, scenario, setScenario,hasRecording,resumeHistory }: ResourceDetailsProps) {
  const tr = useUiTranslation()
  const [format, setFormat]=useState('json')
  const [exportError,setExportError]=useState('')
  const [duration,setDuration]=useState(60)
  const [chartProcess,setChartProcess]=useState('all')
  const processOptions=Array.from(new Map(history.current.flatMap(s=>s.processes.map(p=>[`${p.pid}:${p.createdAt}`,p] as const))).entries())
  const chartSamples=chartProcess==='all'?history.current:history.current.map(s=>{
    const p=s.processes.find(proc=>`${proc.pid}:${proc.createdAt}`===chartProcess)
    return {...s,ram:p?.ram??0,cpu:p?.cpu??0,processes:p?[p]:[]}
  })
  const stats=resourceStats(history.current)
  const exportReport=async()=>{
    if(!sample)return
    setExportError('')
    const selected=hasRecording?history.current[history.current.length-1]??sample:sample
    const content=format==='json'?JSON.stringify(resourceReport(selected,history.current,scenario),null,2):format==='csv'?resourcesToCSV(selected,history.current):format==='html'?resourcesToHTML(selected,history.current,scenario):resourcesToMarkdown(selected,history.current)
    try{await saveTextFile(`adomnia-resources.${format}`,content,format==='json'?'application/json':format==='csv'?'text/csv':format==='html'?'text/html':'text/markdown')}catch(e){setExportError(String(e))}
  }
  return <div className={`max-h-[80vh] overflow-auto rounded-lg border border-border-2 bg-surface-1 p-3 text-text-2 shadow-xl ${className}`}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="api-dot-label">{tr('Application resources')}</h3>
      {sample && <div className="flex gap-1"><select aria-label={tr('Report format')} value={format} onChange={e=>setFormat(e.target.value)} className="rounded border border-border-1 bg-surface-0 px-1"><option value="json">JSON</option><option value="csv">CSV</option><option value="md">Markdown</option><option value="html">HTML + {tr('Charts')}</option></select><button type="button" onClick={() => void exportReport()} title={tr('Export full resource recording')} className="flex h-6 items-center gap-1.5 rounded border border-border-1 px-2 font-medium text-text-2 hover:bg-surface-3"><Download size={11} aria-hidden="true" /> {tr('Export')}</button></div>}
    </div>
    <p className="mb-2 text-text-4">{tr('Application and child processes. CPU is measured across all logical cores. Refresh pauses during inactivity.')}</p>
    <Suspense fallback={null}><ResourceLowResourceControls /></Suspense>
    {failed && <p className="text-warning">{tr('Resources unavailable')}</p>}
    {!sample && !failed && <p className="text-text-4">{tr('Measuring resources…')}</p>}
    {exportError&&<p role="alert" className="text-error">{exportError}</p>}
    <div className="my-2 flex flex-wrap items-center gap-2">
      <input aria-label={tr('Recording scenario')} value={scenario} onChange={e=>setScenario(e.target.value)} maxLength={100} className="min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 py-1"/>
      <select aria-label={tr('Recording duration')} value={duration} disabled={!!recordUntil} onChange={e=>setDuration(Number(e.target.value))} className="rounded border border-border-1 bg-surface-0 px-1 py-1">{[30,60,120].map(s=><option key={s} value={s}>{s} s</option>)}</select>
      <button type="button" onClick={()=>recordUntil?stopRecording():startRecording(duration)} className="rounded border border-border-2 px-2 py-1 hover:bg-surface-3">{recordUntil?tr('Stop recording'):tr('Record CPU and RAM')}</button>
      {hasRecording&&!recordUntil&&<button type="button" onClick={resumeHistory} className="rounded border border-border-2 px-2 py-1 hover:bg-surface-3">{tr('Live history')}</button>}
    </div>
    <p role="status" className="font-mono text-text-4">{stats.samples} {tr('Samples')} · {stats.durationSeconds.toFixed(0)} s{recordUntil?` · ${tr('Recording')} (${Math.max(0,Math.ceil((recordUntil-Date.now())/1000))} s)`:hasRecording?` · ${tr('Recording stopped; charts and export are frozen.')}`:''} · CPU {tr('Average')} {stats.cpuAverage?.toFixed(1)??'—'}% / {tr('Peak')} {stats.cpuPeak?.toFixed(1)??'—'}%</p>
    <select aria-label={tr('Chart process')} value={chartProcess} onChange={e=>setChartProcess(e.target.value)} className="my-1 max-w-full rounded border border-border-1 bg-surface-0 px-2 py-1"><option value="all">{tr('All application processes')}</option>{processOptions.map(([id,p])=><option key={id} value={id}>{p.name} #{p.pid} · {p.role}</option>)}</select>
    <ResourceChart samples={chartSamples}/>
    {sample?.incomplete&&<p role="status" className="text-warning">{tr('Incomplete process sample')}: {sample.warnings?.join('; ')}</p>}
    {sample&&!sample.cpuComplete&&sample.processes.some(p=>p.cpu!=null)&&<p className="text-warning">{tr('CPU total is partial: some processes have no baseline or could not be measured.')}</p>}
    {sample?.runtime && <Suspense fallback={null}><ResourceMemoryControls sample={sample}/></Suspense>}
    {sample?.runtime && <p className="my-2 font-mono text-text-4">Go heap {mib(sample.runtime.heapAlloc)} · GOMEMLIMIT {sample.runtime.memoryLimit>1e15?'∞':mib(sample.runtime.memoryLimit)} · GC {sample.runtime.numGC} · {tr('GC CPU since startup')} {(sample.runtime.gcCpuFraction*100).toFixed(2)}% · {sample.runtime.goroutines} goroutines</p>}
    {sample?.budget && <div className="mb-2 rounded border border-border-1 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span>{tr('Memory target')} <span className="font-mono">{mib(sample.budget.target)}</span></span>
        {sample.budget.pressure && <span className="text-warning">{tr('Memory pressure')}</span>}
      </div>
      <p className="mt-1 text-text-4">{tr('Soft target for the application and child processes. Active work stays protected; shared pages may be counted more than once.')}</p>
    </div>}
    {sample && <p className="mb-1 font-mono tabular-nums text-text-3">RAM {mib(sample.ram)} · CPU {sample.processes.some(p => p.cpu != null) ? `${sample.cpu.toFixed(1)}%` : '…'}{sample.instances > 0 ? ` · ${tr('Servers')} ${sample.instances}` : ''}</p>}
    <p className="my-2 text-text-4">{tr('Parent PID is the observed OS parent. WebView uses separate browser, renderer, GPU and utility processes.')}</p>
    <div className="max-h-72 overflow-auto">
      {sample?.processes.map(p => <div key={p.pid} className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-border-1 py-1.5 font-mono tabular-nums">
        <span className="min-w-0" title={[p.executable,p.attribution,p.sessionId].filter(Boolean).join('\n')}>{p.name} <span className="text-text-4">#{p.pid} ← {p.parentName || '?'} #{p.parentPid ?? '?'}</span><span className="block truncate text-text-4">{[p.role,p.owner,p.memoryLimit&&`GOMEMLIMIT=${p.memoryLimit}`].filter(Boolean).join(' · ')}</span>{p.workspace && <span className="block truncate text-text-4">{p.workspace}</span>}</span>
        <span>{p.error ? '—' : mib(p.ram)}</span><span>{p.cpu == null ? '—' : `${p.cpu.toFixed(1)}%`}</span>
      </div>)}
    </div>
  </div>
}

export function ResourceStatus() {
  const tr = useUiTranslation()
  const [expanded,setExpanded]=useState(false)
  const monitor = useResourceSample()
  const { sample, failed } = monitor
  const cpuReady = sample?.processes.some(p => p.cpu != null)
  const servers = sample?.instances ?? 0
  const pressure = sample?.budget?.pressure === true
  return <details className="relative" onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary className={`flex cursor-pointer list-none items-center gap-2 rounded px-1 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent ${pressure ? 'text-warning' : 'text-text-3'}`} aria-label={tr('Application resources')}>
      <Activity size={12} className={pressure ? 'text-warning' : 'text-accent'} aria-hidden="true" />
      <span className="font-mono tabular-nums">{failed ? tr('Resources unavailable') : sample ? `RAM ${mib(sample.ram)} · CPU ${cpuReady ? `${sample.cpu.toFixed(1)}%` : '…'}${servers > 0 ? ` · ${tr('Servers')} ${servers}` : ''}` : tr('Measuring resources…')}</span>
    </summary>
    {expanded && <ResourceDetails {...monitor} className="absolute bottom-full left-0 z-50 mb-2 w-[min(720px,95vw)]" />}
  </details>
}

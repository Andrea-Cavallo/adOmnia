import { currentActivityPhase } from '@/stores/activity'
import { visibleInterval } from '@/lib/visiblePolling'
import { useEffect, useRef, useState } from 'react'
import { Activity, Download } from 'lucide-react'
import type { Snapshot } from '../../../bindings/adomnia/internal/resources/models'
import { useUiTranslation } from '@/lib/uiI18n'
import { saveTextFile } from '@/lib/fileUtils'
import { resourcesToMarkdown } from '@/lib/resourcesMarkdown'

// Indicatore della status bar: ogni campione legge la tabella dei processi del sistema.
const RESOURCE_POLL_MS = 5000
const HISTORY_SAMPLES = 60
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MB`

/** Campiona le risorse dell'app ogni 5 s finché il componente che lo usa è montato (e la finestra è attiva). */
export function useResourceSample() {
  const [sample, setSample] = useState<Snapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const history = useRef<Snapshot[]>([])
  useEffect(() => {
    let disposed = false
    const poll = async () => {
      if (currentActivityPhase() === 'Active') {
        try { const { ResourceUsage } = await import('../../../bindings/adomnia/goide'); const next = await ResourceUsage(); if (!disposed) { history.current = [...history.current, next].slice(-HISTORY_SAMPLES); setSample(next); setFailed(false) } }
        catch { if (!disposed) setFailed(true) }
      }
    }
    void poll()
    const stop = visibleInterval(() => { void poll() }, RESOURCE_POLL_MS, { kind: "decorative" })
    return () => { disposed = true; stop() }
  }, [])
  return { sample, failed, history }
}

interface ResourceDetailsProps {
  sample: Snapshot | null
  failed: boolean
  history: { current: Snapshot[] }
  className?: string
}

/** Il pannello "Application resources": budget, processi e l'export in Markdown. Condiviso da status bar e stripe di Code Studio. */
export function ResourceDetails({ sample, failed, history, className = '' }: ResourceDetailsProps) {
  const tr = useUiTranslation()
  return <div className={`rounded-lg border border-border-2 bg-surface-1 p-3 text-text-2 shadow-xl ${className}`}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="api-dot-label">{tr('Application resources')}</h3>
      {sample && <button type="button" onClick={() => { void saveTextFile('application-resources.md', resourcesToMarkdown(sample, history.current), 'text/markdown').catch(() => undefined) }} title={tr('Export processes, memory budget and recent samples as a Markdown report')} className="flex h-6 items-center gap-1.5 rounded border border-border-1 px-2 font-medium text-text-2 hover:bg-surface-3"><Download size={11} aria-hidden="true" /> {tr('Export as MD')}</button>}
    </div>
    <p className="mb-2 text-text-4">{tr('Application and child processes. CPU is measured across all logical cores. Refresh pauses during inactivity.')}</p>
    {failed && <p className="text-warning">{tr('Resources unavailable')}</p>}
    {!sample && !failed && <p className="text-text-4">{tr('Measuring resources…')}</p>}
    {sample?.budget && <div className="mb-2 rounded border border-border-1 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span>{tr('Memory target')} <span className="font-mono">{mib(sample.budget.target)}</span></span>
        {sample.budget.pressure && <span className="text-warning">{tr('Memory pressure')}</span>}
      </div>
      <p className="mt-1 text-text-4">{tr('Soft target for the application and child processes. Active work stays protected; shared pages may be counted more than once.')}</p>
    </div>}
    {sample && <p className="mb-1 font-mono tabular-nums text-text-3">RAM {mib(sample.ram)} · CPU {sample.processes.some(p => p.cpu != null) ? `${sample.cpu.toFixed(1)}%` : '…'}{sample.instances > 0 ? ` · ${tr('Servers')} ${sample.instances}` : ''}</p>}
    <div className="max-h-60 overflow-auto">
      {sample?.processes.map(p => <div key={p.pid} className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-border-1 py-1.5 font-mono tabular-nums">
        <span className="min-w-0 truncate" title={p.workspace}>{p.name} <span className="text-text-4">#{p.pid}</span>{p.workspace && <span className="block truncate text-text-4">{p.workspace}</span>}</span>
        <span>{p.error ? '—' : mib(p.ram)}</span><span>{p.cpu == null ? '—' : `${p.cpu.toFixed(1)}%`}</span>
      </div>)}
    </div>
  </div>
}

export function ResourceStatus() {
  const tr = useUiTranslation()
  const { sample, failed, history } = useResourceSample()
  const cpuReady = sample?.processes.some(p => p.cpu != null)
  const servers = sample?.instances ?? 0
  const pressure = sample?.budget?.pressure === true
  return <details className="relative">
    <summary className={`flex cursor-pointer list-none items-center gap-2 rounded px-1 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent ${pressure ? 'text-warning' : 'text-text-3'}`} aria-label={tr('Application resources')}>
      <Activity size={12} className={pressure ? 'text-warning' : 'text-accent'} aria-hidden="true" />
      <span className="font-mono tabular-nums">{failed ? tr('Resources unavailable') : sample ? `RAM ${mib(sample.ram)} · CPU ${cpuReady ? `${sample.cpu.toFixed(1)}%` : '…'}${servers > 0 ? ` · ${tr('Servers')} ${servers}` : ''}` : tr('Measuring resources…')}</span>
    </summary>
    <ResourceDetails sample={sample} failed={failed} history={history} className="absolute bottom-full left-0 z-50 mb-2 w-[min(520px,90vw)]" />
  </details>
}

import { currentActivityPhase } from '@/stores/activity'
import { visibleInterval } from '@/lib/visiblePolling'
import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import type { Snapshot } from '../../../bindings/adomnia/internal/resources/models'
import { useUiTranslation } from '@/lib/uiI18n'

// Indicatore della status bar: ogni campione legge la tabella dei processi del sistema.
const RESOURCE_POLL_MS = 5000
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MB`
export function ResourceStatus() {
  const tr = useUiTranslation()
  const [sample, setSample] = useState<Snapshot | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let disposed = false
    const poll = async () => {
      if (currentActivityPhase() === 'Active') {
        try { const { ResourceUsage } = await import('../../../bindings/adomnia/goide'); const next = await ResourceUsage(); if (!disposed) { setSample(next); setFailed(false) } }
        catch { if (!disposed) setFailed(true) }
      }
    }
    void poll()
    const stop = visibleInterval(() => { void poll() }, RESOURCE_POLL_MS, { kind: "decorative" })
    return () => { disposed = true; stop() }
  }, [])
  const cpuReady = sample?.processes.some(p => p.cpu != null)
  return <details className="relative">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 text-text-3 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" aria-label={tr('Application resources')}>
      <Activity size={12} className="text-accent" aria-hidden="true" />
      <span className="font-mono tabular-nums">{failed ? tr('Resources unavailable') : sample ? `RAM ${mib(sample.ram)} · CPU ${cpuReady ? `${sample.cpu.toFixed(1)}%` : '…'} · gopls ${sample.processes.filter(p => p.name === 'gopls').length}` : tr('Measuring resources…')}</span>
    </summary>
    <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(520px,90vw)] rounded-lg border border-border-2 bg-surface-1 p-3 text-text-2 shadow-xl">
      <h3 className="api-dot-label mb-2">{tr('Application resources')}</h3>
      <p className="mb-2 text-text-4">{tr('Application and child processes. CPU is measured across all logical cores. Refresh pauses during inactivity.')}</p>
      {failed && <p className="text-warning">{tr('Resources unavailable')}</p>}
      {sample?.budget && <div className="mb-2 rounded border border-border-1 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span>{tr('Memory target')} <span className="font-mono">{mib(sample.budget.target)}</span></span>
          {sample.budget.pressure && <span className="text-warning">{tr('Memory pressure')}</span>}
        </div>
        <p className="mt-1 text-text-4">{tr('Soft target for the application and child processes. Active work stays protected; shared pages may be counted more than once.')}</p>
      </div>}
      <div className="max-h-60 overflow-auto">
        {sample?.processes.map(p => <div key={p.pid} className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-border-1 py-1.5 font-mono tabular-nums">
          <span className="min-w-0 truncate" title={p.workspace}>{p.name} <span className="text-text-4">#{p.pid}</span>{p.workspace && <span className="block truncate text-text-4">{p.workspace}</span>}</span>
          <span>{p.error ? '—' : mib(p.ram)}</span><span>{p.cpu == null ? '—' : `${p.cpu.toFixed(1)}%`}</span>
        </div>)}
      </div>
    </div>
  </details>
}

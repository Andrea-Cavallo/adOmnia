import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileCode, FileJson, FileSpreadsheet, Gauge, Loader2, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FlowGraphDefinition } from '@/lib/flowStorage'
import {
  DEFAULT_STRESS_CONFIG, MAX_STRESS_VUS, runFlowStress, validateStressConfig,
  type FlowStressConfig, type StressProgress, type StressRun,
} from '@/lib/flowStress'
import { sparklinePoints, stressCsv, stressFileName, stressHtml, stressJson, utf8ToBase64 } from '@/lib/flowStressExport'
import { saveBase64File } from '@/lib/fileUtils'

interface FlowStressPanelProps {
  graph: FlowGraphDefinition
  flowName: string
  /** Why a run cannot start right now (invalid flow, normal run active) */
  blockedReason?: string
  getInitialVars: () => Record<string, string>
  onRunningChange: (running: boolean) => void
}

const fieldClass = 'h-8 w-full rounded-lg border border-border-2 bg-surface-0 px-2.5 font-mono text-xs text-text-1 outline-none transition-colors focus:border-accent disabled:opacity-50'
const exportButton = 'inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-2 bg-surface-0 px-2.5 text-[11px] text-text-2 transition-colors hover:border-accent/50 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent'

function NumberField({ label, value, min, max, step = 1, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className="block truncate text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">{label}</span>
      <input
        type="number" min={min} max={max} step={step} disabled={disabled}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))}
        className={fieldClass}
      />
    </label>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'error' | 'success' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-1 bg-surface-0 px-2.5 py-1.5">
      <div className="truncate text-[10px] text-text-4">{label}</div>
      <div className={cn('truncate font-mono text-[13px] text-text-1', tone === 'error' && 'text-error', tone === 'success' && 'text-success')}>{value}</div>
    </div>
  )
}

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export function FlowStressPanel({ graph, flowName, blockedReason, getInitialVars, onRunningChange }: FlowStressPanelProps) {
  const [config, setConfig] = useState<FlowStressConfig>(DEFAULT_STRESS_CONFIG)
  const [progress, setProgress] = useState<StressProgress | null>(null)
  const [run, setRun] = useState<StressRun | null>(null)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const configErrors = validateStressConfig(config)
  const problem = configErrors[0] ?? blockedReason
  const patch = (next: Partial<FlowStressConfig>) => setConfig((current) => ({ ...current, ...next }))

  const start = async () => {
    if (running || problem) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    onRunningChange(true)
    setRun(null)
    setProgress(null)
    setNotice(null)
    try {
      setRun(await runFlowStress(graph, config, { initialVars: getInitialVars(), signal: controller.signal, onProgress: setProgress }))
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), ok: false })
    } finally {
      abortRef.current = null
      setRunning(false)
      onRunningChange(false)
    }
  }

  const exportRun = async (ext: 'csv' | 'json' | 'html') => {
    if (!run) return
    const text = ext === 'csv' ? stressCsv(run.samples) : ext === 'json' ? stressJson(run, flowName) : stressHtml(run, flowName)
    try {
      const path = await saveBase64File(stressFileName(flowName, run.startedAt, ext), utf8ToBase64(text))
      setNotice({ text: path ? `Saved ${path}` : 'Export cancelled.', ok: true })
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Export failed', ok: false })
    }
  }

  const stats = run?.stats ?? progress?.stats
  const elapsedMs = run ? run.stats.elapsedMs : progress?.elapsedMs ?? 0
  const done = run ? run.stats.iterationsOk + run.stats.iterationsFailed : progress?.iterationsDone ?? 0
  const pct = config.mode === 'iterations'
    ? Math.min(100, (done / Math.max(1, config.iterations)) * 100)
    : Math.min(100, (elapsedMs / Math.max(1, config.durationS * 1000)) * 100)
  const errorPct = stats?.totalRequests ? Math.round((stats.totalErrors / stats.totalRequests) * 1000) / 10 : 0
  const truncated = run?.truncated ?? progress?.truncated ?? false

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section aria-label="Stress test configuration" className="flex shrink-0 flex-col gap-2.5 border-b border-border-1 p-3 lg:w-[272px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={`Virtual users (max ${MAX_STRESS_VUS})`} value={config.vus} min={1} max={MAX_STRESS_VUS} disabled={running} onChange={(vus) => patch({ vus })} />
          <NumberField label="Ramp-up (s)" value={config.rampUpS} min={0} max={600} disabled={running} onChange={(rampUpS) => patch({ rampUpS })} />
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border-2 bg-surface-0 p-0.5" role="radiogroup" aria-label="Stop condition">
          {(['iterations', 'duration'] as const).map((mode) => (
            <button
              key={mode} role="radio" aria-checked={config.mode === mode} disabled={running}
              onClick={() => patch({ mode })}
              className={cn('h-7 rounded-md text-[11px] font-medium capitalize transition-colors disabled:opacity-50', config.mode === mode ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1')}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {config.mode === 'iterations'
            ? <NumberField label="Total iterations" value={config.iterations} min={1} max={100000} disabled={running} onChange={(iterations) => patch({ iterations })} />
            : <NumberField label="Duration (s)" value={config.durationS} min={1} max={3600} disabled={running} onChange={(durationS) => patch({ durationS })} />}
          <NumberField label="Think time (ms)" value={config.thinkTimeMs} min={0} max={60000} step={50} disabled={running} onChange={(thinkTimeMs) => patch({ thinkTimeMs })} />
        </div>
        {problem && !running && (
          <p className="flex items-start gap-1.5 text-[11px] text-warning"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{problem}</p>
        )}
        <button
          onClick={() => running ? abortRef.current?.abort() : void start()}
          disabled={!running && Boolean(problem)}
          className={cn('mt-auto flex h-8 items-center justify-center gap-2 rounded-lg text-xs font-medium text-white transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45', running ? 'bg-error hover:bg-error/85' : 'bg-accent hover:bg-accent-hover')}
        >
          {running ? <Square size={11} fill="currentColor" /> : <Gauge size={13} />}
          {running ? 'Stop stress test' : 'Start stress test'}
        </button>
      </section>

      <section aria-label="Stress test results" aria-live="polite" className="flex min-w-0 flex-1 flex-col gap-2.5 p-3 lg:overflow-y-auto">
        {!stats ? (
          <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-border-2 px-4 py-6 text-center text-xs text-text-3">
            <div className="max-w-md space-y-1">
              <p className="text-text-2">Run this flow under concurrent load.</p>
              <p>Each virtual user repeats the whole flow with its own variables. Latency is the HTTP time measured by the executor; step time also includes app overhead.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              {running && <Loader2 size={12} className="shrink-0 animate-spin text-accent" />}
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className={cn('h-full rounded-full transition-transform duration-300', run?.status === 'stopped' ? 'bg-warning' : 'bg-accent')} style={{ width: '100%', transform: `translateX(${pct - 100}%)` }} />
              </div>
              <span className="shrink-0 font-mono text-[11px] text-text-3">
                {config.mode === 'iterations' ? `${done}/${config.iterations}` : `${formatSeconds(elapsedMs)}/${config.durationS}s`}
                {run && ` · ${run.status}`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Requests" value={String(stats.totalRequests)} />
              <Kpi label="Throughput" value={`${stats.rps} req/s`} />
              <Kpi label="Errors" value={`${stats.totalErrors} · ${errorPct}%`} tone={stats.totalErrors ? 'error' : undefined} />
              <Kpi label="Iterations ok / failed" value={`${stats.iterationsOk} / ${stats.iterationsFailed}`} tone={stats.iterationsFailed ? 'error' : stats.iterationsOk ? 'success' : undefined} />
              <Kpi label="Active users" value={`${progress?.activeVus ?? 0}/${config.vus}`} />
              <Kpi label="Elapsed" value={formatSeconds(elapsedMs)} />
            </div>

            {stats.timeline.length > 1 && (
              <svg viewBox="0 0 300 40" preserveAspectRatio="none" className="h-10 w-full rounded-lg border border-border-1 bg-surface-0" role="img" aria-label="Requests and errors per second">
                <polyline fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={sparklinePoints(stats.timeline, 300, 38)} />
                <polyline fill="none" stroke="var(--color-error)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={sparklinePoints(stats.timeline, 300, 38, 'errors')} />
              </svg>
            )}

            <div className="overflow-x-auto rounded-lg border border-border-1">
              <table className="w-full font-mono text-[11px]">
                <thead className="bg-surface-2 text-[10px] text-text-4">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Step</th>
                    {['Count', 'p50', 'p90', 'p95', 'p99', 'Max', 'Errors'].map((head) => <th key={head} className="px-2.5 py-1.5 text-right font-semibold">{head}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {stats.steps.map((step) => (
                    <tr key={step.nodeId} className="border-t border-border-1 text-text-2">
                      <td className="max-w-[220px] truncate px-2.5 py-1.5 text-left text-text-1" title={Object.entries(step.statuses).map(([code, n]) => `${code}×${n}`).join(' ')}>
                        {step.step}{step.step === stats.slowestStep && stats.steps.length > 1 && <span className="ml-1.5 text-[9px] uppercase text-warning">slowest</span>}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">{step.count}</td>
                      <td className="px-2.5 py-1.5 text-right">{step.p50}</td>
                      <td className="px-2.5 py-1.5 text-right">{step.p90}</td>
                      <td className="px-2.5 py-1.5 text-right text-text-1">{step.p95}</td>
                      <td className="px-2.5 py-1.5 text-right">{step.p99}</td>
                      <td className="px-2.5 py-1.5 text-right">{step.max}</td>
                      <td className={cn('px-2.5 py-1.5 text-right', step.errors ? 'text-error' : 'text-text-3')}>{step.errorPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {truncated && <p className="text-[11px] text-warning">Raw request log is capped; statistics still cover every request.</p>}

            {run && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Export</span>
                <button onClick={() => void exportRun('csv')} className={exportButton}><FileSpreadsheet size={12} /> CSV log</button>
                <button onClick={() => void exportRun('json')} className={exportButton}><FileJson size={12} /> JSON</button>
                <button onClick={() => void exportRun('html')} className={exportButton}><FileCode size={12} /> HTML report</button>
              </div>
            )}
          </>
        )}
        {notice && <p className={cn('truncate text-[11px]', notice.ok ? 'text-text-3' : 'text-error')} title={notice.text}>{notice.text}</p>}
      </section>
    </div>
  )
}

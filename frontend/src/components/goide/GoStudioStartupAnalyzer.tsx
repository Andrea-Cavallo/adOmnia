import { useState } from 'react'
import { create } from 'zustand'
import { Loader2, Rocket, X } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { ShutdownReport, StartupReport } from '../../../bindings/adomnia/internal/goide/models'
import { shutdownChecks } from '@/lib/goide/shutdownChecks'

export const useStartupDrawer = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

const DB = /PostgreSQL|MySQL|SQL Server|Oracle|Redis|MongoDB|Cassandra|Elasticsearch|Memcached/
const BROKER = /Kafka|NATS|RabbitMQ/
const CONFIG = /\b(config|configuration|settings|env|environment|loaded|loading)\b/i
const GAP_MS = 150

const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(value < 10 ? 1 : 0)} ms`)

/** Category of a timeline event, for the colour and the legend. */
export function startupCategory(kind: string, detail: string): 'db' | 'broker' | 'config' | 'listen' | 'ready' | 'problem' | 'output' | 'connect' {
  if (kind === 'connect') return DB.test(detail) ? 'db' : BROKER.test(detail) ? 'broker' : 'connect'
  if (kind === 'listen') return 'listen'
  if (kind === 'ready') return 'ready'
  if (kind === 'exit' || kind === 'timeout') return 'problem'
  return CONFIG.test(detail) ? 'config' : 'output'
}

const TONE: Record<ReturnType<typeof startupCategory>, string> = {
  db: 'text-accent', broker: 'text-warning', config: 'text-info', listen: 'text-success', ready: 'text-success font-semibold', problem: 'text-danger', output: 'text-text-3', connect: 'text-text-2',
}

/** Startup Analyzer: how long a service takes to be ready and where the time goes. */
export function GoStudioStartupAnalyzer({ sessionId }: { sessionId: string }) {
  const { open, setOpen } = useStartupDrawer()
  const [target, setTarget] = useState('.')
  const [health, setHealth] = useState('')
  const [report, setReport] = useState<StartupReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [shutdown, setShutdown] = useState<ShutdownReport | null>(null)
  const [grace, setGrace] = useState('10')
  const [error, setError] = useState<string | null>(null)
  if (!open) return null
  const analyze = async () => {
    setBusy(true)
    setError(null)
    try { setShutdown(null); setReport(await GoIDE.StartupAnalysis(sessionId, target, health, 30)) } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) } finally { setBusy(false) }
  }
  const analyzeShutdown = async () => {
    setShutdown(null)
    setBusy(true)
    setError(null)
    try { setReport(null); setShutdown(null); setShutdown(await GoIDE.ShutdownAnalysis(sessionId, target, health, Number(grace) || 10)) } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) } finally { setBusy(false) }
  }
  const events = report?.events ?? []
  return (
    <aside aria-label="Startup analyzer" className="fixed bottom-12 right-3 top-12 z-[300] flex w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-1 text-[11.5px] shadow-2xl shadow-black/50">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-3">
        <Rocket size={14} className="text-accent" />
        <span className="font-semibold text-text-1">Startup &amp; shutdown analyzer</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={13} /></button>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-3 py-2">
        <label htmlFor="startup-target" className="text-text-4">Main package</label>
        <input id="startup-target" value={target} onChange={(event) => setTarget(event.target.value)} className="h-7 w-40 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent" />
        <label htmlFor="startup-health" className="text-text-4">Ready when</label>
        <input id="startup-health" value={health} onChange={(event) => setHealth(event.target.value)} placeholder="the port opens (or /healthz)" className="h-7 w-44 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent" />
        <button type="button" onClick={() => void analyze()} disabled={busy} className="flex h-7 items-center gap-1 rounded bg-accent px-2.5 font-semibold text-on-accent hover:opacity-90 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}Analyze startup</button>
        <span className="ml-auto flex items-center gap-1">
          <label htmlFor="shutdown-grace" className="text-text-4">Grace (s)</label>
          <input id="shutdown-grace" value={grace} onChange={(event) => setGrace(event.target.value)} className="h-7 w-12 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent" />
          <button type="button" onClick={() => void analyzeShutdown()} disabled={busy} title="Start it, send an interrupt once ready and watch it stop" className="flex h-7 items-center gap-1 rounded px-2 text-accent hover:bg-accent/10 disabled:opacity-50">Analyze shutdown</button>
        </span>
      </div>
      {error && <p className="shrink-0 whitespace-pre-wrap border-b border-danger/30 bg-danger/10 px-3 py-1 text-danger">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {shutdown && (
          <div aria-label="Shutdown result">
            <p className="text-[13px] font-semibold text-text-1">{shutdown.ready ? `Ready in ${ms(shutdown.readyMs)}, interrupt sent` : 'It never became ready: the interrupt went to a starting process'}</p>
            <ul aria-label="Shutdown checks" className="mt-2 space-y-1">
              {shutdownChecks(shutdown).map((check) => (
                <li key={check.label} className="flex items-baseline gap-2">
                  <span className={`w-20 shrink-0 text-[10px] font-semibold uppercase ${check.status === 'ok' ? 'text-success' : check.status === 'bad' ? 'text-danger' : check.status === 'warn' ? 'text-warning' : 'text-text-4'}`}>{check.status === 'unknown' ? 'n/a' : check.status}</span>
                  <span className="w-44 shrink-0 text-text-1">{check.label}</span>
                  <span className="min-w-0 flex-1 text-text-3">{check.detail}</span>
                </li>
              ))}
            </ul>
            <h4 className="mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">After the signal</h4>
            <ol className="space-y-0.5">
              {(shutdown.events ?? []).map((event, index) => (
                <li key={`${event.atMs}-${index}`} className="flex gap-2 font-mono">
                  <span className="w-20 shrink-0 text-right text-text-4">+{ms(event.atMs - shutdown.shutdown.signalAtMs)}</span>
                  <span className="min-w-0 flex-1 truncate text-text-2" title={event.detail}>{event.kind === 'output' ? event.detail : `${event.kind} ${event.detail}`}</span>
                </li>
              ))}
            </ol>
            {shutdown.shutdown.goroutineDump && <><h4 className="mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Why it does not exit (goroutines)</h4><pre className="max-h-72 overflow-auto rounded bg-surface-0 p-2 font-mono text-[10.5px] text-text-2">{shutdown.shutdown.goroutineDump}</pre></>}
          </div>
        )}
        {!report && !shutdown && !busy && <p className="text-text-4">Builds the package, starts it with the run environment and <code>GODEBUG=inittrace=1</code>, records every output line, the first connection to each database or broker and the moment it listens (or answers the health path), then stops it. Nothing stays running.</p>}
        {report && (
          <>
            <p className={`text-[13px] font-semibold ${report.ready ? 'text-success' : 'text-danger'}`} aria-label="Startup result">
              {report.ready ? `Ready in ${ms(report.readyMs)}${report.port ? ` on :${report.port}` : ''}` : 'Not ready'} · init functions {ms(report.initMs)}
            </p>
            <section className="mt-3">
              <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Timeline</h4>
              <ol aria-label="Startup timeline" className="space-y-0.5">
                {events.map((event, index) => {
                  const gap = index > 0 ? event.atMs - events[index - 1].atMs : event.atMs
                  const category = startupCategory(event.kind, event.detail)
                  return (
                    <li key={`${event.atMs}-${index}`} className="flex items-baseline gap-2 font-mono">
                      <span className="w-16 shrink-0 text-right text-text-4">{ms(event.atMs)}</span>
                      {gap >= GAP_MS ? <span className="w-16 shrink-0 text-warning" title="Time spent before this event">+{ms(gap)}</span> : <span className="w-16 shrink-0" />}
                      <span className={`min-w-0 flex-1 truncate ${TONE[category]}`} title={event.detail}>{event.kind === 'output' ? event.detail : `${event.kind} ${event.detail}`}</span>
                    </li>
                  )
                })}
              </ol>
            </section>
            {!!report.inits?.length && (
              <section className="mt-3">
                <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Slowest init functions</h4>
                <ul className="space-y-0.5">
                  {report.inits.slice(0, 15).map((step) => (
                    <li key={step.package} className="flex gap-2 font-mono">
                      <span className="w-16 shrink-0 text-right text-text-1">{ms(step.clockMs)}</span>
                      <span className="min-w-0 flex-1 truncate text-text-2">{step.package}</span>
                      <span className="shrink-0 text-text-4">{step.allocs} allocs</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

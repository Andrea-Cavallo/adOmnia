import { useEffect, useRef, useState } from 'react'
import { Activity, Loader2, Pause, Play, XOctagon } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { cn } from '@/lib/utils'
import { OP_KINDS, rates, readCurrentOps, readServerStatus, type RunningOp, type ServerRates, type ServerSample } from './serverStats'
import type { RunMongo } from './useMongoBrowser'
import { ErrorBox, errorText, firstDocument, formatBytes, secondaryButton } from './ui'

const POLL_MS = 2000
const HISTORY = 60

interface PerformanceTabProps {
  runMongo: RunMongo
  db: string
}

/** Live server view: op rates, connections, network and the slowest running operations. */
export function PerformanceTab({ runMongo, db }: PerformanceTabProps) {
  const [paused, setPaused] = useState(false)
  const [sample, setSample] = useState<ServerSample | null>(null)
  const [series, setSeries] = useState<ServerRates[]>([])
  const [ops, setOps] = useState<RunningOp[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const last = useRef<ServerSample | null>(null)

  useEffect(() => {
    if (paused) return
    let alive = true
    const tick = async () => {
      try {
        const [statusReply, opsReply] = await Promise.all([
          runMongo({ operation: 'runCommand', database: 'admin', command: { serverStatus: 1, repl: 0, metrics: 0, locks: 0 }, canonical: true }),
          runMongo({ operation: 'runCommand', database: 'admin', command: { currentOp: 1, active: true }, canonical: true }).catch(() => null),
        ])
        if (!alive) return
        const next = readServerStatus(firstDocument(statusReply))
        const prev = last.current
        last.current = next
        setSample(next)
        if (prev) setSeries((s) => [...s, rates(prev, next)].slice(-HISTORY))
        setOps(opsReply ? readCurrentOps(firstDocument(opsReply)) : [])
        setError('')
      } catch (e) {
        if (alive) setError(errorText(e))
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [paused, runMongo])

  const kill = async (op: RunningOp) => {
    const ok = await confirm({ title: 'Kill operation', message: `Kill operation ${String(op.opid)} (${op.op} on ${op.ns || 'server'})?`, confirmLabel: 'Kill operation', variant: 'danger' })
    if (!ok) return
    try {
      await runMongo({ operation: 'runCommand', database: 'admin', command: { killOp: 1, op: op.opid } }, { confirm: true })
      setNotice(`Operation ${String(op.opid)} killed`)
    } catch (e) {
      setNotice(`Kill failed: ${errorText(e)}`)
    }
  }

  const current = series[series.length - 1]

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 flex-none items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border-1 bg-surface-1 px-3">
        <button type="button" onClick={() => setPaused((p) => !p)} className={secondaryButton}>
          {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Resume' : 'Pause'}
        </button>
        {!paused && !error && <span className="flex items-center gap-1.5 text-[11px] text-text-3"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live · every {POLL_MS / 1000}s</span>}
        {sample && <span className="ml-auto min-w-0 truncate text-[11px] text-text-3">MongoDB {sample.version}{sample.uptimeSec != null && <> · up {formatUptime(sample.uptimeSec)}</>} · server-wide, not only {db}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ErrorBox message={error} className="mb-3" />
        {notice && <div role="status" className="mb-3 rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-[11.5px] text-text-1">{notice}</div>}
        {!sample && !error ? (
          <div className="grid h-40 place-items-center"><Loader2 size={16} className="animate-spin text-text-4" /></div>
        ) : sample && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
              <Tile label="Operations / s" value={current ? fmtRate(current.totalOps) : '—'} spark={series.map((r) => r.totalOps)} />
              <Tile label="Connections" value={sample.connections?.toLocaleString() ?? '—'} detail={sample.availableConnections != null ? `${sample.availableConnections.toLocaleString()} available` : undefined} />
              <Tile label="Network in / out" value={current ? `${formatBytes(current.bytesInPerSec)}/s` : '—'} detail={current ? `out ${formatBytes(current.bytesOutPerSec)}/s` : undefined} spark={series.map((r) => r.bytesInPerSec ?? 0)} />
              <Tile label="Resident memory" value={sample.residentMb != null ? `${sample.residentMb.toLocaleString()} MB` : '—'} />
            </div>
            <div className="rounded-md border border-border-1 bg-surface-1 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Operations by type / s</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 @3xl:grid-cols-6">
                {OP_KINDS.map((k) => (
                  <div key={k} className="min-w-0">
                    <div className="text-[10.5px] text-text-3">{k}</div>
                    <div className="font-mono text-[13px] font-semibold tabular-nums text-text-1">{current ? fmtRate(current.ops[k]) : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-border-1 bg-surface-1">
              <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3 text-[11px] font-semibold text-text-2">
                <Activity size={13} className="text-accent" /> Running operations <span className="font-normal text-text-4">{ops.length}</span>
              </div>
              {ops.length === 0 ? (
                <div className="px-3 py-4 text-[11.5px] text-text-4">No active operations (or the user lacks the inprog privilege).</div>
              ) : (
                <div className="divide-y divide-border-1">
                  {ops.slice(0, 50).map((op) => (
                    <div key={String(op.opid)} className="group flex items-start gap-3 px-3 py-2">
                      <span className={cn('w-14 flex-none pt-px text-right font-mono text-[11.5px] tabular-nums', op.secs >= 5 ? 'text-error' : op.secs >= 1 ? 'text-warning' : 'text-text-3')}>{op.secs}s</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="flex-none text-[11.5px] font-semibold text-text-1">{op.op || op.desc}</span>
                          <span className="truncate font-mono text-[11px] text-text-2">{op.ns}</span>
                          <span className="ml-auto flex-none truncate text-[10.5px] text-text-4">{op.client}</span>
                        </div>
                        {op.command && <div className="truncate font-mono text-[10.5px] text-text-4" title={op.command}>{op.command}</div>}
                      </div>
                      <button type="button" onClick={() => void kill(op)} aria-label={`Kill operation ${String(op.opid)}`} title="Kill operation" className="grid h-6 w-6 flex-none place-items-center rounded text-text-4 opacity-0 hover:bg-surface-3 hover:text-error focus:opacity-100 group-hover:opacity-100"><XOctagon size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function fmtRate(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

function Tile({ label, value, detail, spark }: { label: string; value: string; detail?: string; spark?: number[] }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border-1 bg-surface-1 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-4">{label}</div>
      <div className="mt-0.5 truncate text-[16px] font-semibold tabular-nums text-text-1">{value}</div>
      <div className="h-4 truncate text-[10.5px] text-text-3">{detail}</div>
      {spark && spark.length > 1 && <Sparkline values={spark} />}
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const points = values.map((v, i) => `${(i / (HISTORY - 1)) * 100},${30 - (v / max) * 28}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 w-full text-accent opacity-40">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

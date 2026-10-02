import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, FileWarning, Flame, GitBranch, Loader2, RefreshCw, Search } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { listGoIDETraceFiles, loadGoIDETrace, type GoIDEProfileFile } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import {
  formatTraceDuration, longRunningGoroutines, traceSpanLeft, traceSpanPercent, traceSpanTone, traceStatChips,
  visibleGoroutines, goroutinesByWait, frameFunction,
  type TraceEvent, type TraceFrame, type TraceGoroutine, type TraceReport, type TraceSpan,
} from './goStudioTrace'

interface GoStudioTracePanelProps {
  session: GoIDESession
}

type TraceTab = 'timeline' | 'scheduler' | 'waits' | 'events'

const TABS: Array<{ id: TraceTab; label: string; icon: typeof Flame }> = [
  { id: 'timeline', label: 'Goroutine timeline', icon: GitBranch },
  { id: 'scheduler', label: 'Scheduler', icon: Cpu },
  { id: 'waits', label: 'Blocking', icon: Activity },
  { id: 'events', label: 'Events', icon: FileWarning },
]

const LONG_RUNNING_NANOS = 5_000_000 // 5 ms

function openFrame(frame: TraceFrame | undefined): void {
  if (!frame) return
  const store = useGoIDEStore.getState()
  if (frame.relative) void store.openLocation(frame.relative, frame.line || 1)
  else if (frame.file && frame.file.endsWith('.go')) void store.openExternalLocation(frame.file, frame.line || 1)
}

function TraceTrack({ spans, duration, onSelect }: { spans: TraceSpan[]; duration: number; onSelect: (span: TraceSpan) => void }) {
  return (
    <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-2">
      {spans.map((span, index) => (
        <button
          key={`${span.start}-${index}`}
          type="button"
          onClick={() => onSelect(span)}
          title={`${span.state}${span.reason ? ` · ${span.reason}` : ''} · ${formatTraceDuration(span.end - span.start)}`}
          className="absolute inset-y-0 rounded-[2px] opacity-90 hover:opacity-100"
          style={{ left: `${traceSpanLeft(span, duration)}%`, width: `${Math.max(0.2, traceSpanPercent(span, duration))}%`, background: traceSpanTone(span) }}
        />
      ))}
    </div>
  )
}

function GoroutineRow({ goroutine, duration, onSelect }: { goroutine: TraceGoroutine; duration: number; onSelect: (span: TraceSpan) => void }) {
  const start = goroutine.startStack?.[0]
  return (
    <div className="flex items-center gap-2 px-3 py-0.5">
      <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-text-4">#{goroutine.id}</span>
      <span className="w-56 shrink-0 truncate font-mono text-[11px] text-text-2" title={start?.function}>{start ? frameFunction(start) : '(unknown)'}</span>
      <TraceTrack spans={goroutine.spans} duration={duration} onSelect={onSelect} />
      <span className="w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-text-4">{formatTraceDuration(goroutine.running + goroutine.waiting + goroutine.syscall)}</span>
    </div>
  )
}

/** Viewer della traccia Go: timeline per goroutine, scheduler, attese e eventi runtime, con salto al codice. */
export function GoStudioTracePanel({ session }: GoStudioTracePanelProps) {
  const sessionId = session.id
  const [files, setFiles] = useState<GoIDEProfileFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState('')
  const [report, setReport] = useState<TraceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TraceTab>('timeline')
  const [search, setSearch] = useState('')

  const refresh = useCallback(async () => {
    setFilesLoading(true)
    try {
      const found = await listGoIDETraceFiles(sessionId)
      setFiles(found)
      setSelectedPath((current) => (found.some((file) => file.relative === current) ? current : found[0]?.relative ?? ''))
      setError(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not list traces')
    } finally {
      setFilesLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    let cancelled = false
    if (!selectedPath) { setReport(null); return }
    setLoading(true)
    loadGoIDETrace(sessionId, selectedPath)
      .then((loaded) => { if (!cancelled) { setReport(loaded); setError(null) } })
      .catch((problem) => { if (!cancelled) { setReport(null); setError(problem instanceof Error ? problem.message : 'Could not read the trace') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId, selectedPath])

  const duration = report?.durationNanos ?? 0
  const chips = useMemo(() => (report ? traceStatChips(report) : []), [report])
  const goroutines = useMemo(() => (report ? visibleGoroutines(report, search, 60) : []), [report, search])
  const longRunning = useMemo(() => (report ? longRunningGoroutines(report, LONG_RUNNING_NANOS, 12) : []), [report])
  const network = useMemo(() => (report ? goroutinesByWait(report, 'network') : []), [report])
  const sync = useMemo(() => (report ? goroutinesByWait(report, 'sync') : []), [report])
  const gcWait = useMemo(() => (report ? goroutinesByWait(report, 'gc') : []), [report])
  const events = useMemo(() => (report ? report.events.slice(0, 500) : []), [report])

  const onSelectSpan = (span: TraceSpan) => openFrame(span.stack?.[0])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="go-studio-tool-header flex-wrap gap-2">
        <span className="go-studio-tool-title">Trace</span>
        <select aria-label="Trace file" value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)} className="h-7 max-w-72 rounded-lg border-0 bg-[var(--gs-raised)] px-2 font-mono text-[11.5px] text-text-1 outline-none focus:ring-1 focus:ring-accent">
          {files.length === 0 && <option value="">No trace.out in the project</option>}
          {files.map((file) => <option key={file.relative} value={file.relative}>{file.relative}</option>)}
        </select>
        <label className="flex h-7 w-52 items-center gap-2 rounded-lg bg-[var(--gs-ground)] px-2.5 text-text-4 focus-within:ring-1 focus-within:ring-accent">
          <Search size={12} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter goroutine" aria-label="Filter goroutine" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-text-2 outline-none" />
        </label>
        <button type="button" onClick={() => void refresh()} aria-label="Refresh traces" title="Refresh" className="go-studio-icon-button h-7 w-7"><RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} /></button>
        {loading && <Loader2 size={14} className="animate-spin text-accent" aria-label="Loading trace" />}
      </div>

      {error && <p className="border-b border-danger/30 bg-danger/10 px-3 py-1 text-[11.5px] text-danger">{error}</p>}

      {!report && !loading && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-4">
          <Activity size={22} />
          <p className="text-[12.5px]">No trace loaded. Run a test with the Execution trace (`-trace`) profiling option, then open the generated <span className="font-mono">trace.out</span> here.</p>
        </div>
      )}

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-1 px-3 py-1 text-[11px]">
            {chips.map((chip) => (
              <span key={chip.label} className="flex items-center gap-1 text-text-4">{chip.label}<span className="font-mono tabular-nums" style={{ color: chip.tone }}>{chip.value}</span></span>
            ))}
            {report.truncated && <span className="text-warning">Trace truncated to keep the UI responsive</span>}
          </div>
          <div className="flex items-center gap-1 border-b border-border-1 px-2 pt-0.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded-t-md px-2.5 py-1 text-[11.5px] ${tab === id ? 'bg-surface-2 text-text-1' : 'text-text-3 hover:text-text-1'}`}><Icon size={12} />{label}</button>
            ))}
          </div>

          {tab === 'timeline' && (
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {goroutines.length === 0 && <p className="p-4 text-[12px] text-text-4">No goroutine matches the filter.</p>}
              {goroutines.map((goroutine) => <GoroutineRow key={goroutine.id} goroutine={goroutine} duration={duration} onSelect={onSelectSpan} />)}
            </div>
          )}

          {tab === 'scheduler' && (
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {report.procs.length === 0 && <p className="p-4 text-[12px] text-text-4">No scheduler activity captured.</p>}
              {report.procs.map((proc) => (
                <div key={proc.id} className="flex items-center gap-2 px-3 py-0.5">
                  <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-text-4">P{proc.id}</span>
                  <TraceTrack spans={proc.spans} duration={duration} onSelect={onSelectSpan} />
                  <span className="w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-text-4">{formatTraceDuration(proc.running)}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'waits' && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <WaitSection title="Network blocking" rows={network} onSelect={onSelectSpan} />
              <WaitSection title="Synchronization" rows={sync} onSelect={onSelectSpan} />
              <WaitSection title="GC blocking" rows={gcWait} onSelect={onSelectSpan} />
              <h4 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-text-4">Long-running / live goroutines</h4>
              {longRunning.length === 0 && <p className="text-[11.5px] text-text-4">None over {formatTraceDuration(LONG_RUNNING_NANOS)}.</p>}
              {longRunning.map((goroutine) => (
                <button key={goroutine.id} type="button" onClick={() => openFrame(goroutine.startStack?.[0])} className="flex w-full items-center gap-2 border-b border-border-1/50 py-0.5 text-left hover:bg-surface-2/60">
                  <span className="w-14 shrink-0 font-mono text-[10.5px] text-text-4">#{goroutine.id}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-2">{goroutine.startStack?.[0] ? frameFunction(goroutine.startStack[0]) : '(unknown)'}</span>
                  {goroutine.alive && <span className="rounded bg-warning/15 px-1 text-[10px] text-warning">live</span>}
                  <span className="w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-text-4">{formatTraceDuration(goroutine.running + goroutine.waiting + goroutine.syscall)}</span>
                </button>
              ))}
            </div>
          )}

          {tab === 'events' && (
            <div className="min-h-0 flex-1 overflow-auto">
              {events.length === 0 && <p className="p-4 text-[12px] text-text-4">No runtime events in this trace.</p>}
              {events.map((event, index) => <EventRow key={`${event.time}-${index}`} event={event} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function WaitSection({ title, rows, onSelect }: { title: string; rows: Array<{ goroutine: TraceGoroutine; span: TraceSpan }>; onSelect: (span: TraceSpan) => void }) {
  return (
    <div className="mb-3">
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-4">{title}</h4>
      {rows.length === 0 && <p className="text-[11.5px] text-text-4">None.</p>}
      {rows.map(({ goroutine, span }) => (
        <button key={goroutine.id} type="button" onClick={() => onSelect(span)} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border-1/50 py-0.5 text-left hover:bg-surface-2/60">
          <span className="font-mono text-[10.5px] text-text-4">#{goroutine.id}</span>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-text-2" title={span.reason}>{span.reason || '(waiting)'}</span>
          <span className="font-mono text-[10.5px] tabular-nums text-text-4">{formatTraceDuration(span.end - span.start)}</span>
        </button>
      ))}
    </div>
  )
}

function EventRow({ event }: { event: TraceEvent }) {
  return (
    <button
      type="button"
      onClick={() => openFrame(event.stack?.[0])}
      className="grid w-full grid-cols-[5rem_auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border-1/50 px-3 py-0.5 text-left hover:bg-surface-2/60"
    >
      <span className="font-mono text-[10.5px] tabular-nums text-text-4">{formatTraceDuration(event.time)}</span>
      <span className="rounded bg-surface-3 px-1 text-[10px] uppercase tracking-wide text-text-3">{event.category}</span>
      <span className="min-w-0 truncate text-[11.5px] text-text-2" title={event.label}>{event.label || '(event)'}</span>
      {event.goroutine ? <span className="font-mono text-[10.5px] text-text-4">#{event.goroutine}</span> : <span />}
    </button>
  )
}

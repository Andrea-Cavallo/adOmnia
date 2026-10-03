import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, FileWarning, Flame, GitBranch, Loader2, RefreshCw, Search } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { listGoIDETraceFiles, loadGoIDETrace, type GoIDEProfileFile } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import {
  formatTraceDuration, longRunningGoroutines, traceStatChips, goroutineTotal,
  visibleGoroutines, goroutinesByWait, frameFunction,
  type TraceEvent, type TraceFrame, type TraceGoroutine, type TraceReport, type TraceSpan,
} from './goStudioTrace'
import { GoStudioTraceTimeline, type TraceTimelineRow } from './GoStudioTraceTimeline'
import { VizBar, VizSegmented } from './GoStudioVizKit'
import { GoStudioPerfExport } from './GoStudioPerfExport'
import { traceToMarkdown, markdownFileName } from './goStudioPerfMarkdown'

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
  const goroutineRows = useMemo<TraceTimelineRow[]>(() => goroutines.map((goroutine) => {
    const start = goroutine.startStack?.[0]
    const name = start ? frameFunction(start) : '(unknown)'
    return {
      key: `g${goroutine.id}`,
      title: start?.function ?? name,
      label: <span className="flex items-baseline gap-2"><span className="w-12 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-text-4">#{goroutine.id}</span><span className="truncate font-mono text-[11.5px] text-text-2">{name}</span></span>,
      spans: goroutine.spans,
      total: formatTraceDuration(goroutine.running + goroutine.waiting + goroutine.syscall),
    }
  }), [goroutines])
  const procRows = useMemo<TraceTimelineRow[]>(() => (report?.procs ?? []).map((proc) => ({
    key: `p${proc.id}`,
    title: `P${proc.id}`,
    label: <span className="font-mono text-[11.5px] text-text-2">P{proc.id}</span>,
    spans: proc.spans,
    total: formatTraceDuration(proc.running),
  })), [report])

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
        {report && <span className="ml-auto"><GoStudioPerfExport fileName={markdownFileName(report.name, 'trace')} build={() => traceToMarkdown(report)} /></span>}
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 border-b border-border-1 px-3 py-2.5">
            {chips.map((chip) => (
              <div key={chip.label} className="rounded-[10px] bg-[var(--gs-ground)] px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[10.5px] text-text-4">
                  {chip.tone && <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ background: chip.tone }} />}{chip.label}
                </div>
                <div className="mt-0.5 font-mono text-[13px] font-semibold text-text-1">{chip.value}</div>
              </div>
            ))}
          </div>
          {report.truncated && <p className="border-b border-warning/30 bg-warning/10 px-3 py-1 text-[11px] text-warning">Trace truncated to keep the UI responsive.</p>}
          <div className="flex items-center gap-3 border-b border-border-1 px-3 py-1.5">
            <VizSegmented segments={TABS} value={tab} onChange={setTab} label="Trace views" />
          </div>

          {tab === 'timeline' && (
            <GoStudioTraceTimeline rows={goroutineRows} durationNanos={duration} gc={report.gc} labelHeader="Goroutine" empty="No goroutine matches the filter." onSelect={onSelectSpan} />
          )}

          {tab === 'scheduler' && (
            <GoStudioTraceTimeline rows={procRows} durationNanos={duration} gc={report.gc} labelHeader="Processor (P)" empty="No scheduler activity captured." onSelect={onSelectSpan} />
          )}

          {tab === 'waits' && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <WaitSection title="Network blocking" rows={network} onSelect={onSelectSpan} />
              <WaitSection title="Synchronization" rows={sync} onSelect={onSelectSpan} />
              <WaitSection title="GC blocking" rows={gcWait} onSelect={onSelectSpan} />
              <h4 className="mb-1.5 mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Long-running / live goroutines</h4>
              {longRunning.length === 0 && <p className="text-[11.5px] text-text-4">None over {formatTraceDuration(LONG_RUNNING_NANOS)}.</p>}
              {longRunning.map((goroutine) => (
                <button key={goroutine.id} type="button" onClick={() => openFrame(goroutine.startStack?.[0])} className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)_140px_4.5rem] items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-surface-2/60">
                  <span className="text-right font-mono text-[10.5px] tabular-nums text-text-4">#{goroutine.id}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[11.5px] text-text-2">{goroutine.startStack?.[0] ? frameFunction(goroutine.startStack[0]) : '(unknown)'}</span>
                    {goroutine.alive && <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning">live at end</span>}
                  </span>
                  <GoroutineMix goroutine={goroutine} />
                  <span className="text-right font-mono text-[10.5px] tabular-nums text-text-3">{formatTraceDuration(goroutine.running + goroutine.waiting + goroutine.syscall)}</span>
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
  const max = rows.reduce((value, row) => Math.max(value, row.span.end - row.span.start), 0)
  return (
    <section className="mb-4">
      <h4 className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{title}<span className="font-normal normal-case tracking-normal">· {rows.length}</span></h4>
      {rows.length === 0 && <p className="text-[11.5px] text-text-4">None.</p>}
      {rows.map(({ goroutine, span }) => (
        <button key={goroutine.id} type="button" onClick={() => onSelect(span)} title={span.stack?.[0]?.function} className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)_140px_4.5rem] items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-surface-2/60">
          <span className="text-right font-mono text-[10.5px] tabular-nums text-text-4">#{goroutine.id}</span>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-text-2" title={span.reason}>{span.reason || '(waiting)'}</span>
          <VizBar value={span.end - span.start} max={max} color="var(--gs-viz-wait)" width={140} />
          <span className="text-right font-mono text-[10.5px] tabular-nums text-text-3">{formatTraceDuration(span.end - span.start)}</span>
        </button>
      ))}
    </section>
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
      <span className="rounded-full bg-surface-3 px-2 py-px text-[10px] font-medium uppercase tracking-wide text-text-3">{event.category}</span>
      <span className="min-w-0 truncate text-[11.5px] text-text-2" title={event.label}>{event.label || '(event)'}</span>
      {event.goroutine ? <span className="font-mono text-[10.5px] text-text-4">#{event.goroutine}</span> : <span />}
    </button>
  )
}

/** Composizione del tempo di una goroutine in una barra impilata: running, syscall, runnable, attesa. */
function GoroutineMix({ goroutine }: { goroutine: TraceGoroutine }) {
  const total = goroutineTotal(goroutine)
  const parts = [
    { key: 'running', value: goroutine.running, color: 'var(--gs-viz-running)' },
    { key: 'syscall', value: goroutine.syscall, color: 'var(--gs-viz-syscall)' },
    { key: 'runnable', value: goroutine.runnable, color: 'var(--gs-viz-runnable)' },
    { key: 'waiting', value: goroutine.waiting, color: 'var(--gs-viz-wait)' },
  ].filter((part) => part.value > 0)
  return (
    <span className="flex h-[6px] w-[140px] gap-[2px] overflow-hidden rounded-full" style={{ background: 'var(--gs-viz-track)' }} title={parts.map((part) => `${part.key} ${formatTraceDuration(part.value)}`).join(' · ')}>
      {parts.map((part) => <span key={part.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${total > 0 ? (part.value / total) * 100 : 0}%`, background: part.color }} />)}
    </span>
  )
}

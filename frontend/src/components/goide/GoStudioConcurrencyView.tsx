import { useMemo } from 'react'
import { ArrowLeftRight, ArrowRight, Droplets, Lock, OctagonAlert, RefreshCw, Rocket, Zap, type LucideIcon } from 'lucide-react'
import type { GoIDEGoroutine } from '@/lib/goide-debug-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEDebugStore, type GoIDEDebugView } from '@/stores/goideDebug'
import { useGoIDETestsStore } from '@/stores/goideTests'
import {
  diagnoseConcurrency, groupGoroutines, isBlocked, parseRaceReports, raceDiagnostics, waitResources,
  type ConcurrencyDiagnostic, type DiagnosticKind, type RaceFrame, type RaceReport,
} from './goStudioConcurrency'
import { GOROUTINE_STATES, PaneHeader, StateDot, shortLocation, stateMeta } from './GoStudioDebugUi'

const MAX_RUNS_SCANNED = 5
const MAX_CHIPS_PER_LANE = 24

const DIAGNOSTIC_ICON: Record<DiagnosticKind, LucideIcon> = {
  deadlock: OctagonAlert,
  channel: ArrowLeftRight,
  mutex: Lock,
  leak: Droplets,
  race: Zap,
}

const SEVERITY_CLASS = {
  error: 'border-danger/40 bg-danger/10 text-danger',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-border-2 bg-surface-2/60 text-text-3',
}

/** Report del race detector dai test, dalle esecuzioni e dalle console di debug del progetto. */
export function useRaceReports(sessionId: string): RaceReport[] {
  const testRuns = useGoIDETestsStore((state) => state.runs[sessionId])
  const executions = useGoIDEStore((state) => state.executions)
  const consoleByRun = useGoIDEStore((state) => state.consoleByRun)
  const debuggers = useGoIDEDebugStore((state) => state.debuggers)
  return useMemo(() => {
    const texts: string[] = []
    for (const run of (testRuns ?? []).slice(0, MAX_RUNS_SCANNED)) texts.push(...(run.raceReports ?? []))
    for (const execution of executions.filter((item) => item.sessionId === sessionId).slice(-MAX_RUNS_SCANNED)) {
      texts.push((consoleByRun[execution.id] ?? []).map((chunk) => chunk.text).join(''))
    }
    for (const view of Object.values(debuggers)) {
      if (view.info.sessionId === sessionId) texts.push(view.console.map((line) => line.text).join('\n'))
    }
    return parseRaceReports(texts.join('\n'))
  }, [consoleByRun, debuggers, executions, sessionId, testRuns])
}

function openPath(path: string | undefined, line: number | undefined) {
  if (path && line) void useGoIDEStore.getState().openLocation(path, line, 1)
}

interface GoStudioConcurrencyViewProps {
  view: GoIDEDebugView | null
  sessionId: string
}

/** Vista Concurrency: diagnosi, flusso funzione → goroutine → risorse attese, e race navigabili. */
export function GoStudioConcurrencyView({ view, sessionId }: GoStudioConcurrencyViewProps) {
  const goroutines = useMemo(() => view?.goroutines?.goroutines ?? [], [view?.goroutines])
  const races = useRaceReports(sessionId)
  const diagnostics = useMemo(() => [...raceDiagnostics(races), ...diagnoseConcurrency(goroutines)], [goroutines, races])
  const selectGoroutine = (id: number) => { if (view) void useGoIDEDebugStore.getState().selectThread(view.info.id, id) }
  const paused = view?.info.state === 'stopped'
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.8fr)_minmax(360px,1.6fr)] divide-x divide-border-1">
      <section aria-label="Concurrency diagnostics" className="flex min-h-0 flex-col">
        <PaneHeader title="Diagnostics" count={diagnostics.length}>
          {view && paused && <button type="button" onClick={() => void useGoIDEDebugStore.getState().refreshGoroutines(view.info.id)} title="Take a new goroutine snapshot" aria-label="Refresh goroutines" className="go-studio-icon-button h-6 w-6"><RefreshCw size={13} className={view.goroutinesLoading ? 'animate-spin' : ''} /></button>}
        </PaneHeader>
        <StateSummary goroutines={goroutines} />
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto px-2 pb-2">
          {diagnostics.length === 0 && (
            <p className="px-1 py-2 text-[11.5px] leading-5 text-text-4">
              {paused ? 'No deadlocks, blocked channels, mutex contention or leaks in this snapshot.' : 'Pause a debug session to analyse goroutines.'} Run tests with the race detector (Run › Test Current Package with Race Detector) to find data races.
            </p>
          )}
          {diagnostics.map((diagnostic) => <DiagnosticCard key={diagnostic.id} diagnostic={diagnostic} onSelect={selectGoroutine} />)}
        </div>
      </section>
      <section aria-label="Goroutine flow" className="flex min-h-0 flex-col">
        <PaneHeader title="Goroutine flow" />
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-3">
          {races.map((report) => <RaceCard key={report.id} report={report} />)}
          <GoroutineFlow goroutines={goroutines} selectedId={view?.threadId ?? null} onSelect={selectGoroutine} />
          {goroutines.length === 0 && races.length === 0 && <p className="py-2 text-[11.5px] text-text-4">The flow appears when the debugger is paused: which function started each goroutine and what it is waiting on.</p>}
        </div>
      </section>
    </div>
  )
}

function StateSummary({ goroutines }: { goroutines: GoIDEGoroutine[] }) {
  if (goroutines.length === 0) return null
  const counts = new Map<string, number>()
  for (const goroutine of goroutines) counts.set(goroutine.state, (counts.get(goroutine.state) ?? 0) + 1)
  return (
    <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-2">
      {Object.keys(GOROUTINE_STATES).filter((state) => counts.has(state)).map((state) => (
        <span key={state} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2"><StateDot state={state} />{counts.get(state)} {stateMeta(state).label.toLowerCase()}</span>
      ))}
    </div>
  )
}

function DiagnosticCard({ diagnostic, onSelect }: { diagnostic: ConcurrencyDiagnostic; onSelect: (id: number) => void }) {
  const Icon = DIAGNOSTIC_ICON[diagnostic.kind]
  return (
    <div className={`rounded-lg border p-2.5 ${SEVERITY_CLASS[diagnostic.severity]}`}>
      <div className="flex items-center gap-2 text-[12px] font-semibold"><Icon size={14} />{diagnostic.title}</div>
      <p className="mt-1 text-[11.5px] leading-5 text-text-2">{diagnostic.detail}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {diagnostic.relativePath && <button type="button" onClick={() => openPath(diagnostic.relativePath, diagnostic.line)} className="rounded-md bg-surface-0/60 px-1.5 py-0.5 font-mono text-[11px] text-text-2 hover:text-accent">{shortLocation(diagnostic.relativePath, diagnostic.line)}</button>}
        {diagnostic.goroutineIds.slice(0, 8).map((id) => <button key={id} type="button" onClick={() => onSelect(id)} className="rounded-md bg-surface-0/60 px-1.5 py-0.5 font-mono text-[11px] text-text-2 hover:text-accent">#{id}</button>)}
        {diagnostic.goroutineIds.length > 8 && <span className="text-[11px] text-text-4">+{diagnostic.goroutineIds.length - 8}</span>}
      </div>
    </div>
  )
}

/** Una corsia per funzione di avvio: chi l'ha avviata, le sue goroutine e cosa stanno aspettando. */
function GoroutineFlow({ goroutines, selectedId, onSelect }: { goroutines: GoIDEGoroutine[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const lanes = useMemo(() => groupGoroutines(goroutines).flatMap((entry) => entry.groups), [goroutines])
  const resources = useMemo(() => waitResources(goroutines), [goroutines])
  const sharedKeys = useMemo(() => new Set(resources.filter((resource) => new Set(resource.goroutines.map((item) => item.origin?.name)).size > 1).map((resource) => resource.key)), [resources])
  return (
    <>
      {lanes.map((lane) => {
        const laneResources = resources.filter((resource) => resource.goroutines.some((goroutine) => goroutine.origin?.name === lane.key || (!goroutine.origin && lane.key === 'runtime')))
        return (
          <div key={lane.key} className="grid grid-cols-[minmax(150px,0.9fr)_20px_minmax(160px,1.4fr)_20px_minmax(150px,1fr)] items-center gap-1">
            <button type="button" onClick={() => openPath(lane.relativePath, lane.line)} title={lane.key} className="flex min-w-0 flex-col rounded-lg border border-border-2 bg-surface-2/60 px-2.5 py-2 text-left hover:border-accent/50">
              <span className="flex items-center gap-1.5 truncate font-mono text-[12px] text-text-1"><Rocket size={12} className="shrink-0 text-info" />{lane.name}()</span>
              <span className="mt-0.5 text-[11px] text-text-4">{shortLocation(lane.relativePath, lane.line) || 'runtime'} · {lane.goroutines.length} goroutine{lane.goroutines.length === 1 ? '' : 's'}</span>
            </button>
            <ArrowRight size={14} className="justify-self-center text-text-4" />
            <div className="flex flex-wrap gap-1">
              {lane.goroutines.slice(0, MAX_CHIPS_PER_LANE).map((goroutine) => (
                <button key={goroutine.id} type="button" onClick={() => onSelect(goroutine.id)} title={`${stateMeta(goroutine.state).label}${goroutine.blockedOn ? ` on ${goroutine.blockedOn}` : ''}`}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] ${goroutine.id === selectedId ? 'border-accent bg-accent/15 text-text-1' : 'border-border-1 bg-surface-0/50 text-text-2 hover:border-border-2'}`}>
                  <StateDot state={goroutine.state} />#{goroutine.id}
                </button>
              ))}
              {lane.goroutines.length > MAX_CHIPS_PER_LANE && <span className="self-center text-[11px] text-text-4">+{lane.goroutines.length - MAX_CHIPS_PER_LANE}</span>}
            </div>
            <ArrowRight size={14} className={`justify-self-center ${laneResources.length ? 'text-text-4' : 'invisible'}`} />
            <div className="flex min-w-0 flex-col gap-1">
              {laneResources.map((resource) => {
                const meta = stateMeta(resource.state)
                const Icon = meta.icon
                return (
                  <button key={resource.key} type="button" onClick={() => openPath(resource.relativePath, resource.line)} title={resource.sourceLine}
                    className={`flex min-w-0 flex-col rounded-lg border px-2.5 py-1.5 text-left ${sharedKeys.has(resource.key) ? 'border-warning/50 bg-warning/10' : 'border-border-1 bg-surface-0/50'} hover:border-accent/50`}>
                    <span className={`flex items-center gap-1.5 truncate font-mono text-[11.5px] ${meta.tone}`}><Icon size={12} className="shrink-0" />{resource.target || meta.label}</span>
                    <span className="text-[10.5px] text-text-4">{meta.label} · {resource.goroutines.length} waiting · {shortLocation(resource.relativePath, resource.line)}{sharedKeys.has(resource.key) ? ' · shared' : ''}</span>
                  </button>
                )
              })}
              {laneResources.length === 0 && lane.goroutines.every((goroutine) => !isBlocked(goroutine.state)) && <span className="text-[11px] text-text-4">not blocked</span>}
            </div>
          </div>
        )
      })}
    </>
  )
}

function RaceCard({ report }: { report: RaceReport }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-danger"><Zap size={14} />Data race</div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {report.accesses.map((access, index) => (
          <div key={`${access.kind}-${index}`} className="min-w-0 rounded-md bg-surface-0/60 p-2">
            <div className="text-[11.5px] font-medium text-text-1">{access.kind} by goroutine {access.goroutine} <span className="font-mono text-text-4">{access.address}</span></div>
            <RaceFrames frames={access.frames} />
            {report.goroutines.filter((goroutine) => goroutine.id === access.goroutine).map((goroutine) => (
              <div key={goroutine.id} className="mt-1 border-t border-border-1 pt-1">
                <div className="text-[10.5px] text-text-4">Goroutine {goroutine.id} ({goroutine.state}) created at</div>
                <RaceFrames frames={goroutine.createdAt} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function RaceFrames({ frames }: { frames: RaceFrame[] }) {
  return (
    <div className="mt-1 space-y-0.5">
      {frames.slice(0, 6).map((frame, index) => (
        <button key={`${frame.path}:${frame.line}:${index}`} type="button" onClick={() => openPath(frame.path, frame.line)} title={`${frame.path}:${frame.line}`} className="flex w-full min-w-0 items-center gap-2 rounded px-1 text-left font-mono text-[11px] hover:bg-surface-2">
          <span className={`min-w-0 flex-1 truncate ${index === 0 ? 'text-text-1' : 'text-text-3'}`}>{frame.func}</span>
          <span className="shrink-0 text-text-4">{shortLocation(frame.path, frame.line)}</span>
        </button>
      ))}
    </div>
  )
}

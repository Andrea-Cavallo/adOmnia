import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, ArrowRight, Copy, Droplets, Gauge, Layers, Lock, OctagonAlert, RefreshCw, Rocket, Search, Trash2, Users, Zap, type LucideIcon } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import type { GoIDEGoroutine } from '@/lib/goide-debug-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEDebugStore, type GoIDEDebugView } from '@/stores/goideDebug'
import { useGoIDETestsStore } from '@/stores/goideTests'
import {
  diagnoseConcurrency, groupGoroutines, isBlocked, mergeRaceSources, raceDiagnostics, waitResources,
  type ConcurrencyDiagnostic, type DiagnosticEvidence, type DiagnosticKind, type RaceFrame, type RaceReport, type RaceSource,
} from './goStudioConcurrency'
import { clearRaceHistory, loadRaceHistory, saveRaceHistory, type RaceHistorySource } from './goStudioRaceHistory'
import { staticConcurrencyDiagnostics } from './goStudioLifecycleInspector'
import { raceRegressionTestStarter } from './goStudioRaceRegression'
import { GOROUTINE_STATES, PaneHeader, StateDot, shortLocation, stateMeta } from './GoStudioDebugUi'

const MAX_RUNS_SCANNED = 5
const MAX_CHIPS_PER_LANE = 24

const DIAGNOSTIC_ICON: Record<DiagnosticKind, LucideIcon> = {
  deadlock: OctagonAlert,
  channel: ArrowLeftRight,
  mutex: Lock,
  leak: Droplets,
  race: Zap,
  waitgroup: Users,
  count: Layers,
  pool: Gauge,
}

const EVIDENCE: Record<DiagnosticEvidence, { label: string; title: string; className: string }> = {
  static: { label: 'STATIC', title: 'Found by reading the code', className: 'bg-surface-3 text-text-3' },
  observed: { label: 'OBSERVED', title: 'Seen in the runtime snapshot of this pause', className: 'bg-info/15 text-info' },
  confirmed: { label: 'CONFIRMED', title: 'Reported by the Go runtime (race detector)', className: 'bg-danger/15 text-danger' },
}

const SEVERITY_CLASS = {
  error: 'border-danger/40 bg-danger/10 text-danger',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-border-2 bg-surface-2/60 text-text-3',
}

/** Report del race detector dai test, dalle esecuzioni e dalle console di debug, confrontati tra run. */
export function useRaceReports(sessionId: string): { reports: RaceReport[]; latest: string | null; savedCount: number; clearSaved: () => void } {
  const testRuns = useGoIDETestsStore((state) => state.runs[sessionId])
  const executions = useGoIDEStore((state) => state.executions)
  const consoleByRun = useGoIDEStore((state) => state.consoleByRun)
  const debuggers = useGoIDEDebugStore((state) => state.debuggers)
  const projectRoot = useGoIDEStore((state) => state.sessions.find((session) => session.id === sessionId)?.project.rootPath ?? '')
  const [savedSources, setSavedSources] = useState<RaceHistorySource[]>([])
  const liveSources = useMemo(() => {
    const sources: Array<RaceSource & { at: number }> = []
    for (const run of (testRuns ?? []).slice(0, MAX_RUNS_SCANNED)) {
      if (run.raceReports?.length) sources.push({ id: run.runId, label: `test ${run.runId.slice(-6)}`, text: run.raceReports.join('\n'), at: Date.parse(String(run.startedAt)) || 0 })
    }
    executions.filter((item) => item.sessionId === sessionId).slice(-MAX_RUNS_SCANNED).forEach((execution, index) => {
      sources.push({ id: execution.id, label: `${execution.kind} ${execution.id.slice(-6)}`, text: (consoleByRun[execution.id] ?? []).map((chunk) => chunk.text).join(''), at: index })
    })
    for (const view of Object.values(debuggers)) {
      if (view.info.sessionId === sessionId) sources.push({ id: view.info.id, label: `debug ${view.info.title}`, text: view.console.map((line) => line.text).join('\n'), at: Date.parse(String(view.info.startedAt)) || 0 })
    }
    return sources.filter((source) => source.text.includes('WARNING: DATA RACE')).sort((left, right) => right.at - left.at)
  }, [consoleByRun, debuggers, executions, sessionId, testRuns])
  useEffect(() => { setSavedSources(loadRaceHistory(projectRoot)) }, [projectRoot])
  useEffect(() => {
    if (liveSources.length > 0) setSavedSources(saveRaceHistory(projectRoot, liveSources))
  }, [liveSources, projectRoot])
  return useMemo(() => {
    const liveIds = new Set(liveSources.map((source) => source.id))
    const history = savedSources
      .filter((source) => !liveIds.has(source.id))
      .map((source) => ({ ...source, id: `saved:${source.id}`, label: `saved ${source.label}` }))
    const sources = [...liveSources, ...history].sort((left, right) => right.at - left.at)
    return {
      reports: mergeRaceSources(sources),
      latest: sources[0]?.label ?? null,
      savedCount: savedSources.length,
      clearSaved: () => { clearRaceHistory(projectRoot); setSavedSources([]) },
    }
  }, [liveSources, projectRoot, savedSources])
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
  const { reports: races, latest, savedCount, clearSaved } = useRaceReports(sessionId)
  const selectGoroutine = (id: number) => { if (view) void useGoIDEDebugStore.getState().selectThread(view.info.id, id) }
  const paused = view?.info.state === 'stopped'
  const sourceFrame = view?.frames.find((frame) => frame.id === view.frameId && frame.relativePath) ?? view?.frames.find((frame) => frame.relativePath)
  const [staticDiagnostics, setStaticDiagnostics] = useState<ConcurrencyDiagnostic[]>([])
  const [sourceInspection, setSourceInspection] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  useEffect(() => {
    setStaticDiagnostics([])
    setSourceInspection('idle')
  }, [view?.info.id, sourceFrame?.relativePath])
  const inspectStaticLifecycle = async () => {
    if (!sourceFrame?.relativePath || sourceInspection === 'loading') return
    setSourceInspection('loading')
    try {
      const document = await useGoIDEStore.getState().ensureDocumentLoaded(sourceFrame.relativePath)
      if (!document) throw new Error('source is unavailable')
      setStaticDiagnostics(staticConcurrencyDiagnostics(document.buffer, document.document.relativePath))
      setSourceInspection('done')
    } catch {
      setStaticDiagnostics([])
      setSourceInspection('error')
    }
  }
  const diagnostics = useMemo(() => [...raceDiagnostics(races), ...staticDiagnostics, ...diagnoseConcurrency(goroutines)], [goroutines, races, staticDiagnostics])
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.8fr)_minmax(360px,1.6fr)] divide-x divide-border-1">
      <section aria-label="Concurrency diagnostics" className="flex min-h-0 flex-col">
        <PaneHeader title="Diagnostics" count={diagnostics.length}>
          {(goroutines.length > 0 || races.length > 0) && <button type="button" onClick={() => void WailsClipboard.SetText(JSON.stringify({ takenAt: new Date().toISOString(), session: view?.info.title, goroutines, diagnostics, races: races.map(({ raw, ...rest }) => ({ ...rest, raw })) }, null, 2))} title="Copy this snapshot as JSON (goroutines, diagnostics, races)" aria-label="Copy snapshot" className="go-studio-icon-button h-6 w-6"><Copy size={13} /></button>}
          {savedCount > 0 && <button type="button" onClick={clearSaved} title={`Clear ${savedCount} saved local race session${savedCount === 1 ? '' : 's'}`} aria-label="Clear saved race sessions" className="go-studio-icon-button h-6 w-6"><Trash2 size={13} /></button>}
          {view && paused && sourceFrame?.relativePath && <button type="button" onClick={() => void inspectStaticLifecycle()} disabled={sourceInspection === 'loading'} title="Inspect selected debug source for lifecycle and lock-order risks" aria-label="Inspect source concurrency" className="go-studio-icon-button h-6 w-6 disabled:opacity-50"><Search size={13} className={sourceInspection === 'loading' ? 'animate-pulse' : ''} /></button>}
          {view && paused && <button type="button" onClick={() => void useGoIDEDebugStore.getState().refreshGoroutines(view.info.id)} title="Take a new goroutine snapshot" aria-label="Refresh goroutines" className="go-studio-icon-button h-6 w-6"><RefreshCw size={13} className={view.goroutinesLoading ? 'animate-spin' : ''} /></button>}
        </PaneHeader>
        <StateSummary goroutines={goroutines} />
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto px-2 pb-2">
          {diagnostics.length === 0 && (
            <p className="px-1 py-2 text-[11.5px] leading-5 text-text-4">
              {paused ? 'No deadlocks, blocked channels, mutex contention or leaks in this snapshot.' : 'Pause a debug session to analyse goroutines.'} Run tests with the race detector (Run › Test Current Package with Race Detector) to find data races.
            </p>
          )}
          {sourceInspection === 'done' && staticDiagnostics.length === 0 && <p className="px-1 py-1 text-[11px] leading-4 text-text-4">Static source check: no missing local cleanup or opposite lock order found in this file.</p>}
          {sourceInspection === 'error' && <p className="px-1 py-1 text-[11px] leading-4 text-danger">Static source check could not load this frame’s file.</p>}
          {diagnostics.map((diagnostic) => <DiagnosticCard key={diagnostic.id} diagnostic={diagnostic} onSelect={selectGoroutine} />)}
        </div>
      </section>
      <section aria-label="Goroutine flow" className="flex min-h-0 flex-col">
        <PaneHeader title="Goroutine flow" />
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-3">
          {view && view.timeline.length > 1 && <GoroutineTimeline view={view} />}
          {races.map((report) => <RaceCard key={report.id} report={report} latest={latest} />)}
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
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        <Icon size={14} />{diagnostic.title}
        <span title={EVIDENCE[diagnostic.evidence].title} className={`ml-auto rounded px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-wide ${EVIDENCE[diagnostic.evidence].className}`}>{EVIDENCE[diagnostic.evidence].label}</span>
      </div>
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

function raceHistory(report: RaceReport, latest: string | null): string {
  if (latest && !report.sources.includes(latest)) return 'not in the latest run'
  if (report.sources.length === 1) return 'new in the latest run'
  return `recurring in ${report.sources.length} runs`
}

function RaceCard({ report, latest }: { report: RaceReport; latest: string | null }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-danger">
        <Zap size={14} />Data race
        <span className="font-normal text-text-3">· {raceHistory(report, latest)}{report.occurrences > 1 ? ` · reported ${report.occurrences}×` : ''}</span>
        <span title={report.sources.join('\n')} className="ml-auto truncate font-mono text-[10.5px] font-normal text-text-4">{report.sources.join(' · ')}</span>
      </div>
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={() => void WailsClipboard.SetText(raceRegressionTestStarter(report))} className="rounded px-1.5 py-0.5 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1" title="Copy an editable Go regression-test starter with both race locations">Copy regression test starter</button>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {report.accesses.map((access, index) => (
          <div key={`${access.kind}-${index}`} className="min-w-0 rounded-md bg-surface-0/60 p-2">
            <div className="flex items-center gap-2 text-[11.5px] font-medium text-text-1">
              <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${access.kind.startsWith('Previous') ? 'bg-surface-3 text-text-3' : 'bg-danger/15 text-danger'}`}>{access.kind.startsWith('Previous') ? 'EARLIER' : 'LATER'}</span>
              {access.kind} by goroutine {access.goroutine} <span className="font-mono text-text-4">{access.address}</span>
            </div>
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

/** Goroutine per stato a ogni pausa: una crescita continua tra una pausa e l'altra fa pensare a un leak. */
function GoroutineTimeline({ view }: { view: GoIDEDebugView }) {
  const max = Math.max(...view.timeline.map((sample) => sample.total), 1)
  const states = Object.keys(GOROUTINE_STATES)
  return (
    <div className="rounded-lg border border-border-1 bg-surface-0/40 p-2.5">
      <div className="flex items-center gap-2 text-[11.5px] font-semibold text-text-2">
        Timeline
        <span className="font-normal text-text-4">{view.timeline.length} pauses · {view.timeline[0].total} → {view.timeline[view.timeline.length - 1].total} goroutines</span>
      </div>
      <div className="mt-2 flex h-16 items-end gap-1" role="img" aria-label="Goroutines per state at each pause">
        {view.timeline.map((sample, index) => (
          <div key={`${sample.pause}-${index}`} title={`Pause ${index + 1}: ${sample.total} goroutines\n${Object.entries(sample.counts).map(([state, count]) => `${stateMeta(state).label}: ${count}`).join('\n')}`}
            className="flex min-w-[6px] max-w-6 flex-1 flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${Math.max(8, (sample.total / max) * 100)}%` }}>
            {states.filter((state) => sample.counts[state]).map((state) => (
              <span key={state} className={stateMeta(state).dot} style={{ height: `${(sample.counts[state] / sample.total) * 100}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

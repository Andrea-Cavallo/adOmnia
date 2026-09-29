import { memo, useEffect, useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Bug, Network, Pause, Play, Redo2, RotateCcw, Square, Workflow } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import type { GoIDEDebugStepAction } from '@/lib/goide-debug-api'
import { activeDebugView, useGoIDEDebugStore, type GoIDEDebugView } from '@/stores/goideDebug'
import { diagnoseConcurrency, raceDiagnostics } from './goStudioConcurrency'
import { GoStudioConcurrencyView, useRaceReports } from './GoStudioConcurrencyView'
import { GoStudioDebugSession } from './GoStudioDebugSession'

type DebugTab = 'session' | 'concurrency'

interface GoStudioDebugPanelProps {
  session: GoIDESession
}

const STATE_LABEL: Record<string, { label: string; tone: string; dot: string }> = {
  starting: { label: 'Starting Delve…', tone: 'text-text-3', dot: 'bg-text-4 animate-pulse' },
  running: { label: 'Running', tone: 'text-success', dot: 'bg-success animate-pulse' },
  stopped: { label: 'Paused', tone: 'text-warning', dot: 'bg-warning' },
  terminated: { label: 'Finished', tone: 'text-text-4', dot: 'bg-text-4' },
}

function ToolButton({ label, shortcut, disabled, onClick, children, tone }: { label: string; shortcut?: string; disabled?: boolean; onClick: () => void; children: ReactNode; tone?: string }) {
  const title = shortcut ? `${label} · ${shortcut}` : label
  return (
    <button type="button" title={title} aria-label={label} disabled={disabled} onClick={onClick}
      className={`go-studio-icon-button h-8 w-8 ${tone ?? ''}`}>
      {children}
    </button>
  )
}

function DebugToolbar({ view, sessionId, tab, onTab, alerts }: { view: GoIDEDebugView; sessionId: string; tab: DebugTab; onTab: (tab: DebugTab) => void; alerts: number }) {
  const debuggers = useGoIDEDebugStore((state) => state.debuggers)
  const { step, stop, restart, selectDebugger } = useGoIDEDebugStore.getState()
  const paused = view.info.state === 'stopped'
  const live = view.info.state !== 'terminated'
  const sessionDebuggers = Object.values(debuggers).filter((item) => item.info.sessionId === sessionId)
  const run = (action: GoIDEDebugStepAction) => void step(view.info.id, action)
  const state = STATE_LABEL[view.info.state] ?? STATE_LABEL.running
  return (
    <div role="toolbar" aria-label="Debugger" className="flex h-11 shrink-0 items-center gap-1 px-2">
      <div className="flex items-center gap-0.5 rounded-[10px] bg-surface-2/70 p-0.5">
        <ToolButton label="Rerun" disabled={!view.request} onClick={() => void restart(view.info.id)}><RotateCcw size={15} /></ToolButton>
        {paused || !live
          ? <ToolButton label="Resume Program" shortcut="F9 / F5" disabled={!paused} tone="text-success" onClick={() => run('continue')}><Play size={15} fill="currentColor" /></ToolButton>
          : <ToolButton label="Pause Program" disabled={view.info.state !== 'running'} onClick={() => run('pause')}><Pause size={15} /></ToolButton>}
        <ToolButton label="Stop" shortcut="Ctrl+F2" disabled={!live} tone="text-danger" onClick={() => void stop(view.info.id)}><Square size={12} fill="currentColor" /></ToolButton>
      </div>
      <div className="flex items-center gap-0.5 rounded-[10px] bg-surface-2/70 p-0.5">
        <ToolButton label="Step Over" shortcut="F8 / F6 / F10" disabled={!paused} tone="text-info" onClick={() => run('next')}><Redo2 size={15} /></ToolButton>
        <ToolButton label="Step Into" shortcut="F7" disabled={!paused} tone="text-info" onClick={() => run('stepIn')}><ArrowDownToLine size={15} /></ToolButton>
        <ToolButton label="Step Out" shortcut="Shift+F8" disabled={!paused} tone="text-info" onClick={() => run('stepOut')}><ArrowUpFromLine size={15} /></ToolButton>
      </div>
      <div role="tablist" aria-label="Debug view" className="ml-2 flex items-center gap-0.5 rounded-[10px] bg-surface-2/70 p-0.5">
        <button type="button" role="tab" aria-selected={tab === 'session'} onClick={() => onTab('session')} className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] ${tab === 'session' ? 'bg-[var(--gs-raised)] font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}><Bug size={13} />Session</button>
        <button type="button" role="tab" aria-selected={tab === 'concurrency'} onClick={() => onTab('concurrency')} className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] ${tab === 'concurrency' ? 'bg-[var(--gs-raised)] font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}>
          <Workflow size={13} />Concurrency
          {alerts > 0 && <span className="rounded-full bg-danger/20 px-1.5 text-[10.5px] font-semibold text-danger">{alerts}</span>}
        </button>
      </div>
      {sessionDebuggers.length > 1 && (
        <select aria-label="Debug session" value={view.info.id} onChange={(event) => selectDebugger(sessionId, event.target.value)}
          className="ml-2 h-8 max-w-56 rounded-lg border-0 bg-surface-2 px-2 text-[12px] text-text-2 outline-none focus:ring-1 focus:ring-accent">
          {sessionDebuggers.map((item) => <option key={item.info.id} value={item.info.id}>{item.info.title} · {STATE_LABEL[item.info.state]?.label ?? item.info.state}</option>)}
        </select>
      )}
      <span className="ml-auto flex min-w-0 items-center gap-3">
        <span className="truncate text-[12px] text-text-3" title={view.info.title}>{view.info.title}</span>
        <span role="status" aria-label="Debugger state" className={`flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] font-semibold ${state.tone}`}>
          <span className={`h-2 w-2 rounded-full ${state.dot}`} aria-hidden="true" />
          {state.label}{view.info.stopReason && paused ? ` · ${view.info.stopReason}` : ''}
        </span>
      </span>
    </div>
  )
}

function DebugEmptyState({ session, races, onShowRaces }: { session: GoIDESession; races: number; onShowRaces: () => void }) {
  const breakpointCount = useGoIDEDebugStore((state) => Object.values(state.breakpoints[session.id] ?? {}).reduce((total, lines) => total + lines.length, 0))
  const error = useGoIDEDebugStore((state) => state.error)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent"><Bug size={20} /></div>
      <p className="max-w-xl text-[12.5px] leading-5 text-text-2">Click a line number to add a breakpoint, then press ▶ next to <span className="font-mono">func main</span> or a test and choose Debug, or press Shift+F9.</p>
      <p className="text-[11.5px] text-text-4">{breakpointCount === 1 ? '1 breakpoint' : `${breakpointCount} breakpoints`} · F8 or F6 step over · F7 step into · Shift+F8 step out · F9 resume</p>
      <p className="flex items-center gap-1.5 text-[11.5px] text-text-4"><Network size={12} />When paused, the Concurrency view shows every goroutine, what it waits on and possible deadlocks.</p>
      {races > 0 && <button type="button" onClick={onShowRaces} className="rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] font-semibold text-danger hover:bg-danger/25">{races} data race{races === 1 ? '' : 's'} found in recent runs · Show</button>}
      {error && <p role="alert" className="text-[11.5px] text-danger">{error}</p>}
    </div>
  )
}

/** Tool window Debug: controlli, vista Session (goroutine, stack, variabili, console) e vista Concurrency. */
export const GoStudioDebugPanel = memo(function GoStudioDebugPanel({ session }: GoStudioDebugPanelProps) {
  const view = useGoIDEDebugStore((state) => activeDebugView(state, session.id))
  const loadBreakpoints = useGoIDEDebugStore((state) => state.loadBreakpoints)
  const races = useRaceReports(session.id).reports
  const [tab, setTab] = useState<DebugTab>('session')
  useEffect(() => { void loadBreakpoints(session.id) }, [loadBreakpoints, session.id])
  const alerts = raceDiagnostics(races).length + diagnoseConcurrency(view?.goroutines?.goroutines ?? []).filter((item) => item.severity !== 'info').length
  if (!view && tab === 'concurrency') {
    return <div className="flex h-full min-h-0 flex-col"><GoStudioConcurrencyView view={null} sessionId={session.id} /></div>
  }
  if (!view) return <DebugEmptyState session={session} races={races.length} onShowRaces={() => setTab('concurrency')} />
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DebugToolbar view={view} sessionId={session.id} tab={tab} onTab={setTab} alerts={alerts} />
      {tab === 'session' ? <GoStudioDebugSession view={view} sessionId={session.id} /> : <GoStudioConcurrencyView view={view} sessionId={session.id} />}
    </div>
  )
})

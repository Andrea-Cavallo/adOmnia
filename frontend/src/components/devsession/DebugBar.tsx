import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Bug, Columns2, Pause, Play, Redo2, ScrollText, Square } from 'lucide-react'
import type { DebugAction, LiveSession } from '@/lib/devsession-api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useDevSessionStore, useLiveCore } from '@/stores/devSession'
import { liveSessions, primarySession } from '@/stores/devSessionModel'
import { openFrameInGoStudio, openRunSource } from '@/lib/devsession/navigation'
import { basename, LiveDot, stateLabel } from './liveUi'
import { PortEditor } from './PortEditor'

function BarButton({ label, shortcut, disabled, onClick, children, tone }: { label: string; shortcut?: string; disabled?: boolean; onClick: () => void; children: ReactNode; tone?: string }) {
  return (
    <button type="button" title={shortcut ? `${label} · ${shortcut}` : label} aria-label={label} disabled={disabled} onClick={onClick}
      className={cn('grid h-6 w-6 place-items-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1 disabled:pointer-events-none disabled:opacity-30 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent', tone)}>
      {children}
    </button>
  )
}

/** JetBrains debugger keys, active outside Go Studio (which has its own) while a service is debugged. */
function debugKey(event: KeyboardEvent): DebugAction | 'stop' | null {
  if (event.ctrlKey && event.key === 'F2') return 'stop'
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  if (event.key === 'F9' && !event.shiftKey) return 'continue'
  if (event.key === 'F8') return event.shiftKey ? 'stepOut' : 'next'
  if (event.key === 'F7' && !event.shiftKey) return 'stepIn'
  return null
}

/**
 * Persistent bar shown in every adOmnia tool while a Go service started from
 * Go Studio is live: state, paused location, debugger controls and the
 * request that is in flight. The debug session belongs to adOmnia, not only
 * to the Go Studio page.
 */
export function DebugBar() {
  const activeRail = useAppStore((s) => s.activeRail)
  useLiveCore()
  const state = useDevSessionStore.getState()
  const session = primarySession(state, state.focusedSessionId)
  const live = liveSessions(state)
  const hidden = !session || activeRail === 'goide'

  useEffect(() => {
    if (hidden || session?.kind !== 'debug') return
    const onKey = (event: KeyboardEvent) => {
      const action = debugKey(event)
      if (!action) return
      if (action !== 'stop' && action !== 'continue' && session.state !== 'paused') return
      event.preventDefault()
      if (action === 'stop') void useDevSessionStore.getState().stop(session.id)
      else void useDevSessionStore.getState().step(session.id, action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidden, session?.id, session?.kind, session?.state])

  if (hidden || !session) return null
  const paused = session.state === 'paused'
  const debug = session.kind === 'debug'
  const run = inFlightRun(state, session)
  const step = (action: DebugAction) => void state.step(session.id, action)

  return (
    <div role="toolbar" aria-label="Live development session" className="flex h-7 shrink-0 items-center gap-2 border-t border-border-1 bg-surface-1 px-2.5 text-[11px] text-text-3">
      <SessionPicker session={session} sessions={live} onPick={(id) => state.focus(id)} />
      <PortEditor session={session} />
      <span className={cn('font-semibold uppercase tracking-[0.08em]', paused ? 'text-warning' : session.state === 'error' ? 'text-error' : 'text-text-4')}>
        {stateLabel(session)}
      </span>
      {paused && session.pause && (
        <button type="button" onClick={() => void openFrameInGoStudio(session)} title="Open in Go Studio"
          className="min-w-0 truncate font-mono text-text-2 hover:text-accent hover:underline">
          {basename(session.pause.relativePath || session.pause.file || '')}:{session.pause.line}
          <span className="ml-1.5 text-text-4">{session.pause.function}()</span>
        </button>
      )}
      {debug && (
        <div className="flex items-center gap-0.5 rounded-md bg-surface-2/70 p-0.5">
          {paused
            ? <BarButton label="Continue" shortcut="F9" tone="text-success" onClick={() => step('continue')}><Play size={12} fill="currentColor" /></BarButton>
            : <BarButton label="Pause" disabled={session.state !== 'running'} onClick={() => step('pause')}><Pause size={12} /></BarButton>}
          <BarButton label="Step Over" shortcut="F8" disabled={!paused} tone="text-info" onClick={() => step('next')}><Redo2 size={12} /></BarButton>
          <BarButton label="Step Into" shortcut="F7" disabled={!paused} tone="text-info" onClick={() => step('stepIn')}><ArrowDownToLine size={12} /></BarButton>
          <BarButton label="Step Out" shortcut="Shift+F8" disabled={!paused} tone="text-info" onClick={() => step('stepOut')}><ArrowUpFromLine size={12} /></BarButton>
        </div>
      )}
      <BarButton label={debug ? 'Stop debugging' : 'Stop service'} shortcut={debug ? 'Ctrl+F2' : undefined} tone="text-error" onClick={() => void state.stop(session.id)}><Square size={10} fill="currentColor" /></BarButton>
      <span className="ml-auto flex min-w-0 items-center gap-2">
        {run && (
          <button type="button" onClick={() => openRunSource(run)} title={run.tabId ? 'Open the request' : `Sent from ${run.name}`}
            className="flex min-w-0 items-center gap-1.5 truncate text-text-3 hover:text-text-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span className="font-semibold text-text-2">{run.method}</span>
            <span className="truncate">{pathOf(run.url)}</span>
            <span className="text-text-4">{run.state === 'paused' ? 'at breakpoint' : 'in flight'}{run.tabId ? '' : ` · ${run.name}`}</span>
          </button>
        )}
        {run?.tabId && paused && (
          <BarButton label="Split Debug View" onClick={() => state.openSplit(run.tabId ?? null)}><Columns2 size={12} /></BarButton>
        )}
        <BarButton label="Service logs" onClick={() => openServiceLogs(session)}><ScrollText size={12} /></BarButton>
        {debug && <BarButton label="Open in Go Studio" onClick={() => void openFrameInGoStudio(session)}><Bug size={12} /></BarButton>}
      </span>
      {state.error && <ErrorFlash message={state.error} onDone={state.clearError} />}
    </div>
  )
}

function inFlightRun(state: ReturnType<typeof useDevSessionStore.getState>, session: LiveSession) {
  for (let i = state.runOrder.length - 1; i >= 0; i--) {
    const run = state.runs[state.runOrder[i]]
    if (run?.sessionId === session.id && (run.state === 'sent' || run.state === 'paused')) return run
  }
  return null
}

const pathOf = (url: string) => {
  try { const parsed = new URL(url); return parsed.pathname + parsed.search } catch { return url }
}

function openServiceLogs(session: LiveSession) {
  document.dispatchEvent(new CustomEvent('adomnia:live-logs', { detail: { sessionId: session.id } }))
}

function SessionPicker({ session, sessions, onPick }: { session: LiveSession; sessions: LiveSession[]; onPick: (id: string) => void }) {
  if (sessions.length < 2) {
    return (
      <span className="flex items-center gap-1.5 font-semibold text-text-1">
        <LiveDot session={session} />{session.service}
      </span>
    )
  }
  return (
    <label className="flex items-center gap-1.5 font-semibold text-text-1">
      <LiveDot session={session} />
      <select aria-label="Live service" value={session.id} onChange={(event) => onPick(event.target.value)}
        className="h-5 max-w-44 rounded border-0 bg-transparent pr-1 text-[11px] font-semibold text-text-1 outline-none focus:ring-1 focus:ring-accent">
        {sessions.map((s) => <option key={s.id} value={s.id}>{s.service}{s.kind === 'debug' ? ' (debug)' : ''}</option>)}
      </select>
    </label>
  )
}

function ErrorFlash({ message, onDone }: { message: string; onDone: () => void }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => { setVisible(false); onDone() }, 5000)
    return () => window.clearTimeout(timer)
  }, [message, onDone])
  return visible ? <span role="alert" className="max-w-72 truncate text-error" title={message}>{message}</span> : null
}

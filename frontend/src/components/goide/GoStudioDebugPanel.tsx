import { memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Bug, ChevronDown, ChevronRight, Pause, Play, Plus, Redo2, RotateCcw, Square, X } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import type { GoIDEDebugFrame, GoIDEDebugStepAction, GoIDEDebugVariable } from '@/lib/goide-debug-api'
import { activeDebugView, useGoIDEDebugStore, type GoIDEDebugConsoleLine, type GoIDEDebugView, type GoIDEWatchValue } from '@/stores/goideDebug'

const EMPTY_WATCHES: string[] = []
const MAX_EVALUATE_HISTORY = 50

interface GoStudioDebugPanelProps {
  session: GoIDESession
}

const STATE_LABEL: Record<string, { label: string; className: string }> = {
  starting: { label: 'Starting Delve…', className: 'text-text-3' },
  running: { label: 'Running', className: 'text-success' },
  stopped: { label: 'Paused', className: 'text-warning' },
  terminated: { label: 'Finished', className: 'text-text-4' },
}

function ToolButton({ title, disabled, onClick, children, danger }: { title: string; disabled?: boolean; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded disabled:opacity-30 ${danger ? 'text-danger hover:bg-danger/10' : 'text-text-2 hover:bg-surface-3 hover:text-text-1'}`}>
      {children}
    </button>
  )
}

function DebugToolbar({ view, sessionId }: { view: GoIDEDebugView; sessionId: string }) {
  const debuggers = useGoIDEDebugStore((state) => state.debuggers)
  const { step, stop, restart, selectDebugger } = useGoIDEDebugStore.getState()
  const paused = view.info.state === 'stopped'
  const live = view.info.state !== 'terminated'
  const sessionDebuggers = Object.values(debuggers).filter((item) => item.info.sessionId === sessionId)
  const run = (action: GoIDEDebugStepAction) => void step(view.info.id, action)
  const state = STATE_LABEL[view.info.state] ?? STATE_LABEL.running
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border-1 bg-surface-1 px-2">
      <ToolButton title="Rerun" disabled={!view.request} onClick={() => void restart(view.info.id)}><RotateCcw size={12} /></ToolButton>
      {paused || !live
        ? <ToolButton title="Resume Program · F9" disabled={!paused} onClick={() => run('continue')}><Play size={12} /></ToolButton>
        : <ToolButton title="Pause Program" disabled={view.info.state !== 'running'} onClick={() => run('pause')}><Pause size={12} /></ToolButton>}
      <ToolButton title="Stop · Ctrl+F2" disabled={!live} danger onClick={() => void stop(view.info.id)}><Square size={10} fill="currentColor" /></ToolButton>
      <span className="mx-1 h-4 w-px bg-border-1" />
      <ToolButton title="Step Over · F8" disabled={!paused} onClick={() => run('next')}><Redo2 size={12} /></ToolButton>
      <ToolButton title="Step Into · F7" disabled={!paused} onClick={() => run('stepIn')}><ArrowDownToLine size={12} /></ToolButton>
      <ToolButton title="Step Out · Shift+F8" disabled={!paused} onClick={() => run('stepOut')}><ArrowUpFromLine size={12} /></ToolButton>
      {sessionDebuggers.length > 1 && (
        <select aria-label="Debug session" value={view.info.id} onChange={(event) => selectDebugger(sessionId, event.target.value)}
          className="ml-2 h-6 max-w-56 rounded border border-border-1 bg-surface-2 px-1.5 text-[10px] text-text-2">
          {sessionDebuggers.map((item) => <option key={item.info.id} value={item.info.id}>{item.info.title} · {STATE_LABEL[item.info.state]?.label ?? item.info.state}</option>)}
        </select>
      )}
      <span className="ml-2 truncate text-[10px] text-text-3" title={view.info.title}>{sessionDebuggers.length > 1 ? '' : view.info.title}</span>
      <span role="status" aria-label="Debugger state" className={`ml-auto text-[10px] font-semibold ${state.className}`}>{state.label}{view.info.stopReason && paused ? ` · ${view.info.stopReason}` : ''}</span>
    </div>
  )
}

function FramesPane({ view }: { view: GoIDEDebugView }) {
  const { selectFrame, selectThread } = useGoIDEDebugStore.getState()
  const paused = view.info.state === 'stopped'
  return (
    <div className="flex min-h-0 flex-col border-r border-border-1">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border-1 px-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-text-4">Frames</span>
        {paused && view.threads.length > 0 && (
          <select aria-label="Goroutine" value={view.threadId ?? ''} onChange={(event) => void selectThread(view.info.id, Number(event.target.value))}
            className="ml-auto h-5 min-w-0 max-w-[70%] rounded border border-border-1 bg-surface-2 px-1 text-[10px] text-text-2">
            {view.threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.name}</option>)}
          </select>
        )}
      </div>
      <div role="listbox" aria-label="Stack frames" className="min-h-0 flex-1 overflow-auto py-0.5 font-mono text-[10px]">
        {!paused && <p className="px-2 py-1 font-sans text-text-4">{view.info.state === 'running' ? 'Pause the program or hit a breakpoint to inspect frames.' : 'No frames.'}</p>}
        {paused && view.frames.map((frame) => <FrameRow key={frame.id} frame={frame} selected={frame.id === view.frameId} onSelect={() => void selectFrame(view.info.id, frame.id)} />)}
      </div>
    </div>
  )
}

function FrameRow({ frame, selected, onSelect }: { frame: GoIDEDebugFrame; selected: boolean; onSelect: () => void }) {
  const location = frame.relativePath ? `${frame.relativePath.split('/').pop()}:${frame.line}` : frame.path ? `${frame.path.split(/[\\/]/).pop()}:${frame.line}` : ''
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onSelect} title={`${frame.name}\n${frame.relativePath || frame.path || ''}:${frame.line}`}
      className={`flex w-full items-center gap-2 px-2 py-0.5 text-left ${selected ? 'bg-accent/15 text-text-1' : 'hover:bg-surface-2'} ${frame.relativePath ? 'text-text-2' : 'text-text-4'}`}>
      <span className="min-w-0 flex-1 truncate">{frame.name}</span>
      <span className="shrink-0 text-text-4">{location}</span>
    </button>
  )
}

interface VariableRowProps {
  debugId: string
  name: string
  value: string
  type?: string
  reference: number
  depth: number
  error?: boolean
  muted?: boolean
  onRemove?: () => void
}

/** Riga dell'albero variabili: i figli si caricano da Delve solo alla prima espansione. */
const VariableRow = memo(function VariableRow({ debugId, name, value, type, reference, depth, error, muted, onRemove }: VariableRowProps) {
  const [expanded, setExpanded] = useState(false)
  const children = useGoIDEDebugStore((state) => (reference > 0 ? state.debuggers[debugId]?.children[reference] : undefined))
  const expandable = reference > 0
  const toggle = () => {
    if (!expandable) return
    if (!expanded) void useGoIDEDebugStore.getState().loadChildren(debugId, reference)
    setExpanded(!expanded)
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' || (event.key === 'ArrowRight' && !expanded) || (event.key === 'ArrowLeft' && expanded)) { event.preventDefault(); toggle() }
  }
  return (
    <>
      <div role="treeitem" aria-expanded={expandable ? expanded : undefined} aria-level={depth + 1} tabIndex={0} onClick={toggle} onKeyDown={onKeyDown}
        className="group flex min-h-5 cursor-default items-center gap-1 pr-2 font-mono text-[10px] outline-none hover:bg-surface-2 focus-visible:bg-accent/10"
        style={{ paddingLeft: 6 + depth * 12 }} title={type ? `${name} (${type})` : name}>
        <span className="grid w-3 shrink-0 place-items-center text-text-4">{expandable ? (expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}</span>
        <span className="shrink-0 text-accent">{name}</span>
        <span className="shrink-0 text-text-4">=</span>
        <span className={`min-w-0 flex-1 truncate ${muted ? 'italic text-text-4' : error ? 'text-danger' : 'text-text-1'}`}>{value}</span>
        {type && <span className="hidden shrink-0 text-text-4 sm:inline">{type}</span>}
        {onRemove && <button type="button" aria-label={`Remove watch ${name}`} title="Remove watch" onClick={(event) => { event.stopPropagation(); onRemove() }} className="grid h-4 w-4 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"><X size={10} /></button>}
      </div>
      {expanded && (children ?? []).map((child: GoIDEDebugVariable, index: number) => (
        <VariableRow key={`${child.name}-${index}`} debugId={debugId} name={child.name} value={child.value} type={child.type} reference={child.variablesReference} depth={depth + 1} />
      ))}
      {expanded && !children && <div className="py-0.5 text-[10px] text-text-4" style={{ paddingLeft: 24 + depth * 12 }}>Loading…</div>}
    </>
  )
})

function VariablesPane({ view, sessionId }: { view: GoIDEDebugView; sessionId: string }) {
  const watches = useGoIDEDebugStore((state) => state.watches[sessionId] ?? EMPTY_WATCHES)
  const { addWatch, removeWatch } = useGoIDEDebugStore.getState()
  const [draft, setDraft] = useState('')
  const paused = view.info.state === 'stopped'
  const pending: GoIDEWatchValue = { value: paused ? '…' : 'not available while running', reference: 0 }
  return (
    <div className="flex min-h-0 flex-col border-r border-border-1">
      <form onSubmit={(event) => { event.preventDefault(); addWatch(sessionId, draft); setDraft('') }} className="flex h-7 shrink-0 items-center gap-1 border-b border-border-1 px-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-text-4">Variables</span>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add watch (e.g. len(items))" aria-label="New watch expression"
          className="ml-auto h-5 w-44 min-w-0 rounded border border-border-1 bg-surface-0 px-1.5 font-mono text-[10px] text-text-1 outline-none focus:border-accent" />
        <button type="submit" disabled={!draft.trim()} title="Add watch" aria-label="Add watch" className="grid h-5 w-5 place-items-center rounded text-text-3 hover:bg-surface-3 disabled:opacity-30"><Plus size={11} /></button>
      </form>
      <div role="tree" aria-label="Variables" className="min-h-0 flex-1 overflow-auto py-0.5">
        {watches.map((expression) => {
          const watch = view.watchValues[expression] ?? pending
          return <VariableRow key={`watch-${expression}`} debugId={view.info.id} name={expression} value={watch.value} type={watch.type} reference={paused ? watch.reference : 0} depth={0} error={watch.error} muted={watch.outOfScope} onRemove={() => removeWatch(sessionId, expression)} />
        })}
        {!paused && watches.length === 0 && <p className="px-2 py-1 text-[10px] text-text-4">Variables appear when the program is paused.</p>}
        {paused && view.loading && view.scopes.length === 0 && <p className="px-2 py-1 text-[10px] text-text-4">Reading variables…</p>}
        {paused && view.scopes.map((scope) => (
          <div key={scope.variablesReference}>
            <div className="px-2 pt-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">{scope.name}</div>
            {(view.children[scope.variablesReference] ?? []).map((variable, index) => (
              <VariableRow key={`${scope.variablesReference}-${variable.name}-${index}`} debugId={view.info.id} name={variable.name} value={variable.value} type={variable.type} reference={variable.variablesReference} depth={0} />
            ))}
            {scope.expensive && !view.children[scope.variablesReference] && <p className="px-2 text-[10px] text-text-4">Not loaded automatically.</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

const LINE_CLASS: Record<GoIDEDebugConsoleLine['category'], string> = {
  stdout: 'text-text-2',
  stderr: 'text-danger',
  console: 'text-text-4',
  input: 'text-accent',
  result: 'text-text-1',
  error: 'text-danger',
}

function ConsolePane({ view }: { view: GoIDEDebugView }) {
  const [expression, setExpression] = useState('')
  const history = useRef<string[]>([])
  const cursor = useRef(-1)
  const scroller = useRef<HTMLDivElement | null>(null)
  const paused = view.info.state === 'stopped'
  useEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [view.console.length])
  const submit = () => {
    const value = expression.trim()
    if (!value) return
    history.current = [value, ...history.current.filter((item) => item !== value)].slice(0, MAX_EVALUATE_HISTORY)
    cursor.current = -1
    setExpression('')
    void useGoIDEDebugStore.getState().evaluate(view.info.id, value)
  }
  const browseHistory = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const next = Math.max(-1, Math.min(history.current.length - 1, cursor.current + (event.key === 'ArrowUp' ? 1 : -1)))
    cursor.current = next
    setExpression(next < 0 ? '' : history.current[next])
  }
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center border-b border-border-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-text-4">Console</div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-surface-0 px-2 py-1 font-mono text-[10px] leading-4">
        {view.console.length === 0 && <p className="font-sans text-text-4">Program output and evaluation results appear here.</p>}
        {view.console.map((line) => (
          <div key={line.id} className={`whitespace-pre-wrap break-all ${LINE_CLASS[line.category]}`}>{line.category === 'input' ? `› ${line.text}` : line.text}</div>
        ))}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); submit() }} className="flex h-7 shrink-0 items-center border-t border-border-1 bg-surface-1 px-2">
        <span className="mr-1.5 font-mono text-[10px] text-accent">›</span>
        <input value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={browseHistory} disabled={!paused}
          placeholder={paused ? 'Evaluate in the selected frame, e.g. len(items) or f(x)' : 'Pause the program to evaluate'} aria-label="Evaluate expression"
          className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-text-1 outline-none disabled:opacity-50" />
      </form>
    </div>
  )
}

function DebugEmptyState({ session }: { session: GoIDESession }) {
  const breakpointCount = useGoIDEDebugStore((state) => Object.values(state.breakpoints[session.id] ?? {}).reduce((total, lines) => total + lines.length, 0))
  const error = useGoIDEDebugStore((state) => state.error)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-0 px-6 text-center">
      <Bug size={20} className="text-text-4" />
      <p className="text-[11px] text-text-2">Click a line number to add a breakpoint, then press ▶ next to func main or a test and choose Debug, or press Shift+F9.</p>
      <p className="text-[10px] text-text-4">{breakpointCount === 1 ? '1 breakpoint' : `${breakpointCount} breakpoints`} in this project · F8 step over · F7 step into · F9 resume</p>
      {error && <p role="alert" className="text-[10px] text-danger">{error}</p>}
    </div>
  )
}

/** Tool window Debug: controlli, frame e goroutine, variabili e watch, console con evaluate. */
export const GoStudioDebugPanel = memo(function GoStudioDebugPanel({ session }: GoStudioDebugPanelProps) {
  const view = useGoIDEDebugStore((state) => activeDebugView(state, session.id))
  const loadBreakpoints = useGoIDEDebugStore((state) => state.loadBreakpoints)
  useEffect(() => { void loadBreakpoints(session.id) }, [loadBreakpoints, session.id])
  if (!view) return <DebugEmptyState session={session} />
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <DebugToolbar view={view} sessionId={session.id} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(160px,0.9fr)_minmax(200px,1.2fr)_minmax(180px,1fr)]">
        <FramesPane view={view} />
        <VariablesPane view={view} sessionId={session.id} />
        <ConsolePane view={view} />
      </div>
    </div>
  )
})

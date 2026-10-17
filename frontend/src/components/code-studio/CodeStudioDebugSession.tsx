import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import { cancellationPath, contextChainOf, goroutineOrigin, type ContextLink, type GoroutineOrigin } from '@/lib/code-studio/goroutineWhy'
import { useEffect, useState, useRef, type ReactNode } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useCodeStudioBreakpointUi, breakpointSummary } from './codeStudioBreakpoints'
import { useKnownUiTranslation } from '@/lib/uiI18n'
import { Eye, EyeOff, GitFork, MapPin, OctagonAlert, Rocket } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { GoroutineCreation, PendingDefer } from '../../../bindings/adomnia/internal/goide/models'
import { getGoIDEDebugDisassembly, getGoIDEDebugScopes, getGoIDEDebugVariables, readGoIDEDebugMemory, type GoIDEDebugFrame, type GoIDEDebugInstruction, type GoIDEDebugMemory, type GoIDEDebugVariable, type GoIDEGoroutine } from '@/lib/code-studio-debug-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioDebugStore, type GoIDEDebugView } from '@/stores/codeStudioDebug'
import { CodeStudioGoroutineTree } from './CodeStudioGoroutineTree'
import { CodeStudioDebugConsole, CodeStudioDebugVariables } from './CodeStudioDebugVariables'
import { PaneHeader, StateBadge, shortLocation } from './CodeStudioDebugUi'
import { goroutineRelations, splitFunctionName, type GoroutineRelation } from './codeStudioConcurrency'
import { panicSnapshot, panicValueFromVariables } from './codeStudioPanicInspector'
import { sourceDeferredCallsBefore, type CodeStudioSourceDeferredCall } from './codeStudioDeferredCalls'
import { memoryDumpRows } from './codeStudioMemoryDump'

const RELATION_LABEL: Record<GoroutineRelation, string> = {
  channel: 'channel', mutex: 'mutex', rwmutex: 'RWMutex', waitgroup: 'WaitGroup', context: 'context', network: 'network', database: 'database', timer: 'timer',
}

interface CodeStudioDebugSessionProps {
  view: GoIDEDebugView
  sessionId: string
  editor?: ReactNode
}

function openFrame(frame: GoIDEDebugFrame | null | undefined) {
  if (!frame) return
  const path = frame.relativePath || frame.path
  if (path) void useCodeStudioStore.getState().openLocation(path, frame.line, frame.column || 1)
}

const clampColumn = (value: number) => Math.max(180, Math.min(value, 720))

/** Trascina un bordo verticale: `direction` -1 per la colonna di destra, che cresce spostando il bordo a sinistra. */
function dragColumn(event: React.MouseEvent, start: number, direction: 1 | -1, apply: (width: number) => void) {
  event.preventDefault()
  const startX = event.clientX
  const move = (next: MouseEvent) => apply(start + (next.clientX - startX) * direction)
  const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', stop)
}

/** Vista Session: goroutine, dettaglio e stack della goroutine scelta, variabili e console. */
export function CodeStudioDebugSession({ view, sessionId, editor }: CodeStudioDebugSessionProps) {
  const tr = useKnownUiTranslation()
  const paused = view.info.state === 'stopped'
  const selected = view.goroutines?.goroutines.find((goroutine) => goroutine.id === view.threadId) ?? null
  const selectGoroutine = (goroutine: GoIDEGoroutine) => void useCodeStudioDebugStore.getState().selectThread(view.info.id, goroutine.id)
  const [dock, setDock] = useState<'Console' | 'Breakpoints' | 'Memory' | 'Disassembly'>('Console')
  const [dockOpen, setDockOpen] = useState(true)
  const [height, setHeight] = useState(180)
  const [details, setDetails] = useState(false)
  const [leftWidth, setLeftWidth] = useState(300)
  const [rightWidth, setRightWidth] = useState(360)
  const container = useRef<HTMLDivElement>(null)
  const dragCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanup.current?.(), [])
  const resize = (value: number) => setHeight(Math.max(80, Math.min(value, (container.current?.clientHeight ?? 600) * .55)))
  const frame = view.frames.find(item => item.id === view.frameId) ?? null
  return (
    <div ref={container} className="flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-0 flex-1">
      <section aria-label="Goroutines and call stack" className="flex min-h-0 min-w-0 shrink-0 flex-col" style={{ width: leftWidth }}>
        <div className="flex min-h-0 flex-1 flex-col border-b border-border-1">
        <PaneHeader title="Goroutines" count={view.goroutines?.goroutines.length} />
        {paused && <p className="px-3 pb-1 text-[11.5px] text-text-4">{tr('Runtime states captured at pause; session controls are above.')}</p>}
        {paused
          ? <CodeStudioGoroutineTree overview={view.goroutines} loading={view.goroutinesLoading} selectedId={view.threadId} onSelect={selectGoroutine} />
          : <p className="px-3 py-2 text-[13px] text-text-4">{view.info.state === 'running' ? 'Running. Pause or hit a breakpoint to inspect goroutines.' : 'No goroutines.'}</p>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 px-3 pt-1 text-[12.5px] text-text-3">
          <span className="min-w-0 flex-1 truncate">Goroutine #{view.threadId ?? '—'}</span>
          {selected && <span title="Last runtime state reported for this goroutine; independent of the session pause state"><StateBadge state={selected.state} compact /></span>}
          <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} aria-label={tr('Goroutine details')} title={tr('Goroutine details')} className="code-studio-icon-button h-6 w-6">{details ? '−' : '⋯'}</button>
        </div>
        {paused && details && <div className="max-h-48 overflow-auto"><GoroutineDetail goroutine={selected} threadId={view.threadId} debugId={view.info.id} onSelectGoroutine={(id) => void useCodeStudioDebugStore.getState().selectThread(view.info.id, id)} /><DeferredCallInspector debugId={view.info.id} threadId={view.threadId} frame={frame} /></div>}
        <FramesPane view={view} />
        </div>
      </section>
      <ResizeHandle label="Resize goroutines column" onArrow={(delta) => setLeftWidth(clampColumn(leftWidth + delta))} onDoubleClick={() => setLeftWidth(300)} onMouseDown={(event) => dragColumn(event, leftWidth, 1, (value) => setLeftWidth(clampColumn(value)))} />
      <section aria-label="Debug source editor" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {paused && <PanicInspector view={view} />}
        {editor ?? <button type="button" onClick={() => openFrame(frame)} className="m-auto text-accent">Open selected frame in editor</button>}
      </section>
      <ResizeHandle label="Resize variables column" onArrow={(delta) => setRightWidth(clampColumn(rightWidth - delta))} onDoubleClick={() => setRightWidth(360)} onMouseDown={(event) => dragColumn(event, rightWidth, -1, (value) => setRightWidth(clampColumn(value)))} />
      <div className="flex min-h-0 min-w-0 shrink-0 flex-col" style={{ width: rightWidth }}><CodeStudioDebugVariables view={view} sessionId={sessionId} /></div>
    </div>
    {dockOpen && <ResizeHandle orientation="horizontal" label="Resize debug console" onArrow={delta => resize(height - delta)} onDoubleClick={() => setHeight(180)} onMouseDown={event => {
      event.preventDefault(); dragCleanup.current?.()
      const startY = event.clientY, startHeight = height
      const move = (next: MouseEvent) => resize(startHeight + startY - next.clientY)
      const done = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', done); dragCleanup.current = null }
      dragCleanup.current = done; window.addEventListener('mousemove', move); window.addEventListener('mouseup', done)
    }} />}
    <div className="flex h-8 shrink-0 items-center gap-1 border-t border-border-1 px-2">
      <div role="tablist" aria-label={tr('Debug tools')} className="flex flex-1 gap-1">{(['Console', 'Breakpoints', 'Memory', 'Disassembly'] as const).map(tab => <button type="button" key={tab} role="tab" aria-selected={dockOpen && dock === tab} onClick={() => { setDock(tab); setDockOpen(true) }} className={`rounded px-2 py-1 text-[12.5px] ${dockOpen && dock === tab ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:bg-surface-2'}`}>{tr(tab)}</button>)}</div>
      <button type="button" aria-label={dockOpen ? 'Collapse debug tools' : 'Expand debug tools'} aria-expanded={dockOpen} onClick={() => setDockOpen(!dockOpen)} className="code-studio-icon-button h-6 w-6">{dockOpen ? '−' : '+'}</button>
    </div>
    {dockOpen && <div role="tabpanel" aria-label={dock} className="flex shrink-0 flex-col overflow-auto" style={{ height }}>
      {dock === 'Console' && <CodeStudioDebugConsole view={view} />}
      {dock === 'Breakpoints' && <DebugBreakpoints sessionId={sessionId} />}
      {dock === 'Memory' && (paused ? <MemoryInspector debugId={view.info.id} frameId={view.frameId} /> : <p className="p-3 text-xs text-text-4">Pause the session to read memory.</p>)}
      {dock === 'Disassembly' && (paused ? <DisassemblyInspector debugId={view.info.id} frame={frame} /> : <p className="p-3 text-xs text-text-4">Pause the session to inspect instructions.</p>)}
    </div>}
    </div>
  )
}

function DebugBreakpoints({ sessionId }: { sessionId: string }) {
  const breakpoints = useCodeStudioDebugStore(state => state.breakpoints[sessionId])
  return <section aria-label="Debug breakpoints" className="p-2 text-xs">
    <button type="button" onClick={() => useCodeStudioBreakpointUi.getState().setDialogOpen(true)} className="mb-2 text-accent">Manage all breakpoints…</button>
    {Object.entries(breakpoints ?? {}).flatMap(([path, entries]) => entries.map(entry => <div key={`${path}:${entry.line}`} className="flex items-center gap-2 border-b border-border-1 py-1">
      <input type="checkbox" aria-label={`Enable breakpoint ${path}:${entry.line}`} checked={!entry.disabled} onChange={() => void useCodeStudioDebugStore.getState().updateBreakpoint(sessionId, path, entry.line, { disabled: !entry.disabled })} />
      <button type="button" onClick={() => void useCodeStudioStore.getState().openLocation(path, entry.line)} className="min-w-0 flex-1 truncate text-left font-mono hover:text-accent">{path}:{entry.line}</button><span className="text-text-4">{breakpointSummary(entry)}</span>
    </div>))}
  </section>
}

const MEMORY_SIZES = [64, 256, 1024]

/** Memoria del processo in pausa da un indirizzo o dall'indirizzo di un'espressione del frame. */
function MemoryInspector({ debugId, frameId }: { debugId: string; frameId: number | null }) {
  const [location, setLocation] = useState('')
  const [size, setSize] = useState(64)
  const [memory, setMemory] = useState<GoIDEDebugMemory | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const read = async () => {
    if (!location.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      setMemory(await readGoIDEDebugMemory(debugId, location.trim(), size, frameId ?? 0))
    } catch (reason) {
      setMemory(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { setMemory(null); setError('') }, [debugId, frameId])
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-lg border border-border-1 bg-surface-0/40 p-2.5 text-[12.5px]">
      <form onSubmit={(event) => { event.preventDefault(); void read() }} className="flex items-center gap-1.5">
        <b className="text-text-2">Memory</b>
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="&buf[0] or 0xc000…" aria-label="Memory address or expression" className="h-6 min-w-0 flex-1 rounded border border-border-1 bg-surface-1 px-1.5 font-mono text-[12px] text-text-1 outline-none focus:border-accent" />
        <select value={size} onChange={(event) => setSize(Number(event.target.value))} aria-label="Bytes to read" className="h-6 rounded border border-border-1 bg-surface-1 px-1 text-[12px] text-text-2">
          {MEMORY_SIZES.map((value) => <option key={value} value={value}>{value} B</option>)}
        </select>
        <button type="submit" disabled={loading || !location.trim()} className="rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-50">{loading ? 'Reading…' : 'Read'}</button>
      </form>
      {memory && (
        <div role="table" aria-label="Memory dump" className="mt-1.5 max-h-56 overflow-auto font-mono text-[12px] leading-[18px] text-text-2">
          {memoryDumpRows(memory.address, memory.bytes).map((row) => (
            <div key={row.address} role="row" className="flex gap-3 whitespace-pre">
              <span className="shrink-0 text-text-4">{row.address}</span>
              <span>{row.hex.join(' ')}</span>
              <span className="text-text-3">{row.ascii}</span>
            </div>
          ))}
          {memory.error && <p className="mt-1 whitespace-normal font-sans text-warning">{memory.error}</p>}
        </div>
      )}
      {error && <p className="mt-1 text-danger">{error}</p>}
    </div>
  )
}

/** Codice macchina del frame scelto, raggruppato per riga Go; si carica solo su richiesta. */
function DisassemblyInspector({ debugId, frame }: { debugId: string; frame: GoIDEDebugFrame | null }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [instructions, setInstructions] = useState<GoIDEDebugInstruction[]>([])
  const [error, setError] = useState('')
  const address = frame?.instructionPointer ?? ''
  const load = async () => {
    if (!address || state === 'loading') return
    setState('loading')
    try {
      setInstructions(await getGoIDEDebugDisassembly(debugId, address))
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setState('error')
    }
  }
  useEffect(() => { setState('idle'); setInstructions([]) }, [debugId, frame?.id, address])
  if (!address) return null
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-lg border border-border-1 bg-surface-0/40 p-2.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        <b className="text-text-2">Disassembly</b>
        <span className="font-mono text-[12px] text-text-4">{address}</span>
        <button type="button" onClick={() => void (state === 'ready' ? setState('idle') : load())} disabled={state === 'loading'} className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-50">{state === 'loading' ? 'Reading…' : state === 'ready' ? 'Hide' : 'Disassemble'}</button>
      </div>
      {state === 'ready' && (
        <div role="list" aria-label="Machine instructions" className="mt-1.5 max-h-56 overflow-auto font-mono text-[12px] leading-[18px]">
          {instructions.map((instruction, index) => {
            const location = instruction.relativePath || instruction.path
            const newLine = location && instruction.line && (index === 0 || instructions[index - 1].line !== instruction.line || (instructions[index - 1].relativePath || instructions[index - 1].path) !== location)
            return (
              <div key={instruction.address} role="listitem">
                {newLine && <button type="button" onClick={() => void useCodeStudioStore.getState().openLocation(location, instruction.line ?? 1, 1)} className="mt-1 block truncate text-left text-[11.5px] text-text-4 hover:text-accent">{shortLocation(location, instruction.line ?? 0)}</button>}
                <div aria-current={instruction.current || undefined} className={`flex gap-2 rounded px-1 ${instruction.current ? 'bg-warning/15 text-text-1' : 'text-text-2'}`}>
                  <span className="w-3 shrink-0 text-warning">{instruction.current ? '▶' : ''}</span>
                  <span className="shrink-0 text-text-4">{instruction.address}</span>
                  <span className="truncate">{instruction.instruction}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {state === 'error' && <p className="mt-1 text-danger">{error}</p>}
    </div>
  )
}

function DeferredCallInspector({ debugId, threadId, frame }: { debugId: string; threadId: number | null; frame: GoIDEDebugFrame | null }) {
  const [state, setState] = useState<'idle' | 'loading' | 'runtime' | 'source' | 'error'>('idle')
  const [pending, setPending] = useState<PendingDefer[]>([])
  const [calls, setCalls] = useState<CodeStudioSourceDeferredCall[]>([])
  const [reason, setReason] = useState('')
  const inspect = async () => {
    if (state === 'loading' || threadId === null) return
    setState('loading')
    try {
      setPending(await GoIDEBindings.DebugPendingDefers(debugId, threadId) ?? [])
      setState('runtime')
      return
    } catch (error) {
      setReason(error instanceof Error ? error.message : String(error))
    }
    // Il runtime non è leggibile (binario ottimizzato, target remoto): restano i candidati da sorgente.
    try {
      const document = frame?.relativePath ? await useCodeStudioStore.getState().ensureDocumentLoaded(frame.relativePath) : null
      if (!document || !frame) throw new Error('source is unavailable')
      setCalls(sourceDeferredCallsBefore(document.buffer, frame.line))
      setState('source')
    } catch {
      setState('error')
    }
  }
  useEffect(() => { setState('idle'); setPending([]); setCalls([]) }, [threadId, frame?.id])
  if (threadId === null) return null
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-lg border border-border-1 bg-surface-0/40 p-2.5 text-[12.5px]">
      <div className="flex items-center gap-2"><b className="text-text-2">Deferred calls</b><button type="button" onClick={() => void inspect()} disabled={state === 'loading'} className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-50">{state === 'loading' ? 'Reading…' : state === 'idle' ? 'Inspect' : 'Refresh'}</button></div>
      {state === 'runtime' && (pending.length > 0 ? (
        <ol className="mt-1 space-y-0.5 text-[12px]">
          {pending.map((entry) => (
            <li key={entry.order}>
              <button type="button" disabled={!entry.location} onClick={() => openFrame(entry.location)} title={entry.wrapper || undefined} className="flex w-full min-w-0 items-baseline gap-1.5 rounded text-left enabled:hover:bg-surface-3">
                <span className="w-4 shrink-0 text-right text-text-4">{entry.order}</span>
                <span className="shrink-0 text-text-3">{entry.location?.name ? splitFunctionName(entry.location.name).name : '?'}</span>
                <span className="truncate font-mono text-text-2">{entry.sourceLine || entry.wrapper}</span>
                {entry.location && <span className="ml-auto shrink-0 font-mono text-text-4">{shortLocation(entry.location.relativePath || entry.location.path, entry.location.line)}</span>}
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="mt-1 text-text-4">No pending <code>defer</code> on this goroutine.</p>)}
      {state === 'runtime' && pending.length > 0 && <p className="mt-1 text-[12px] leading-4 text-text-4">Registered at runtime, in the order they will run (1 first). Only defers that actually executed are listed.</p>}
      {state === 'source' && (calls.length > 0 ? <ol className="mt-1 space-y-0.5 font-mono text-[12px]">{calls.map((call) => <li key={call.line}><span className="mr-1 text-text-4">{call.line}</span>{call.expression}</li>)}</ol> : <p className="mt-1 text-text-4">No earlier <code>defer</code> in this source function.</p>)}
      {state === 'source' && <p className="mt-1 text-[12px] leading-4 text-text-4">The runtime defer chain is not readable here ({reason}); showing source candidates of this function instead.</p>}
      {state === 'error' && <p className="mt-1 text-danger">Neither the runtime nor the source is available for this frame.</p>}
    </div>
  )
}

function PanicInspector({ view }: { view: GoIDEDebugView }) {
  const panic = panicSnapshot(view.info.stopReason, view.frames)
  if (!panic) return null
  return <PanicInspectorDetail debugId={view.info.id} panic={panic} />
}

function PanicInspectorDetail({ debugId, panic }: { debugId: string; panic: NonNullable<ReturnType<typeof panicSnapshot>> }) {
  const [panicValue, setPanicValue] = useState<GoIDEDebugVariable | null>(null)
  const [valueStatus, setValueStatus] = useState<'loading' | 'unavailable'>('loading')
  useEffect(() => {
    let cancelled = false
    if (!panic.runtimeFrame) {
      setPanicValue(null)
      setValueStatus('unavailable')
      return () => { cancelled = true }
    }
    setPanicValue(null)
    setValueStatus('loading')
    void (async () => {
      try {
        const scopes = await getGoIDEDebugScopes(debugId, panic.runtimeFrame!.id)
        for (const scope of scopes) {
          if (scope.variablesReference <= 0) continue
          const value = panicValueFromVariables(await getGoIDEDebugVariables(debugId, scope.variablesReference))
          if (value) {
            if (!cancelled) setPanicValue(value)
            return
          }
        }
      } catch {
        // Il frame runtime non è sempre esposto dal DAP: il frame origine resta comunque utile.
      }
      if (!cancelled) setValueStatus('unavailable')
    })()
    return () => { cancelled = true }
  }, [debugId, panic.runtimeFrame])
  return (
    <div role="alert" className="mx-2 mt-2 shrink-0 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-[13px]">
      <div className="flex items-center gap-1.5 font-semibold text-danger"><OctagonAlert size={13} /> Panic stop</div>
      <p className="mt-1 text-text-2">Delve stopped on <span className="font-mono">{panic.reason}</span>{panic.runtimeFrame ? ` in ${splitFunctionName(panic.runtimeFrame.name).name}` : ''}.</p>
      {panic.originFrame && <button type="button" onClick={() => openFrame(panic.originFrame)} className="mt-1.5 flex max-w-full items-center gap-1 rounded font-mono text-text-2 hover:text-accent"><MapPin size={11} className="shrink-0" />Open origin: {splitFunctionName(panic.originFrame.name).name} · {shortLocation(panic.originFrame.relativePath || panic.originFrame.path, panic.originFrame.line)}</button>}
      {panicValue && <p className="mt-1.5 break-all font-mono text-[12px] text-text-2">Panic value: <span className="text-text-1">{panicValue.value}</span>{panicValue.type && <span className="text-text-4"> ({panicValue.type})</span>}</p>}
      {!panicValue && <p className="mt-1.5 text-[12px] leading-4 text-text-4">{valueStatus === 'loading' ? 'Reading panic value from the runtime frame…' : 'The DAP adapter did not expose a panic value for this stop.'}</p>}
      <p className="mt-1 text-[12px] leading-4 text-text-4">Pending deferred calls (they may recover the panic) are listed under Deferred calls.</p>
    </div>
  )
}

/** "Why is this running?": the request or message it was born from, how long it lives, its context. */
function WhyRunning({ goroutine, debugId }: { goroutine: GoIDEGoroutine; debugId: string }) {
  const view = useCodeStudioDebugStore((state) => state.debuggers[debugId])
  const seen = view?.firstSeen?.[goroutine.id]
  const [origin, setOrigin] = useState<GoroutineOrigin | null>(null)
  const [context, setContext] = useState<{ frame: string; variable: string; chain: ContextLink[] } | null | 'loading' | 'none'>(null)
  useEffect(() => {
    let cancelled = false
    setContext(null)
    void (async () => {
      const sessionId = view?.info.sessionId ?? ''
      const [{ getDevContext }, { cachedArchitecture }] = await Promise.all([import('@/lib/devcontext-api'), import('@/lib/code-studio/architectureCache')])
      const snapshot = await getDevContext(sessionId).catch(() => null)
      const routes = (snapshot?.entities ?? []).filter((entity) => entity.kind === 'route')
      const entries = cachedArchitecture(sessionId)?.report.entries ?? []
      if (!cancelled) setOrigin(goroutineOrigin(goroutine.frames ?? [], routes, entries))
    })()
    return () => { cancelled = true }
  }, [goroutine.id, debugId]) // eslint-disable-line react-hooks/exhaustive-deps
  const inspectContext = async () => {
    setContext('loading')
    try { setContext((await contextChainOf(debugId, goroutine.id)) ?? 'none') } catch { setContext('none') }
  }
  const startedAt = view ? new Date(view.info.startedAt).getTime() : 0
  return (
    <section aria-label="Why is this running" className="mt-2 rounded-md bg-surface-0/60 p-2 text-[13px]">
      <h4 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-4">Why is this running?</h4>
      <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-text-4">Born from</dt>
        <dd className="text-text-2">{origin?.request ? `request ${origin.request.route} (handler ${origin.request.handler})` : origin?.message ? `message on ${origin.message.topics.join(', ') || 'a topic'} (consumer ${origin.message.consumer})` : goroutine.origin ? `go statement in ${splitFunctionName(goroutine.origin.name).name}` : 'the main goroutine or the runtime'}</dd>
        <dt className="text-text-4">Lifetime</dt>
        <dd className="text-text-2">{seen ? `alive for at least ${Math.max(0, Math.round((Date.now() - seen.at) / 1000))} s (seen in ${seen.pauses} pause${seen.pauses === 1 ? '' : 's'}${startedAt ? `, at most ${Math.round((Date.now() - startedAt) / 1000)} s since the debug session started` : ''})` : 'refresh the goroutines to start tracking it'}</dd>
        <dt className="text-text-4">Context</dt>
        <dd className="text-text-2">
          {context === null && <button type="button" onClick={() => void inspectContext()} className="text-accent hover:underline">Inspect its context</button>}
          {context === 'loading' && 'reading the stack…'}
          {context === 'none' && 'no context.Context in its project frames'}
          {context && typeof context === 'object' && (
            <span className="font-mono">{context.variable} in {splitFunctionName(context.frame).name}: {context.chain.map((link) => `${link.type}${link.deadline ? ` (deadline ${link.deadline})` : ''}`).join(' → ') || 'context.Context'}</span>
          )}
        </dd>
        {context && typeof context === 'object' && (
          <>
            <dt className="text-text-4">Cancelled when</dt>
            <dd className="text-text-2">{cancellationPath(context.chain).join('; or ')}</dd>
          </>
        )}
      </dl>
    </section>
  )
}

function GoroutineDetail({ goroutine, threadId, debugId, onSelectGoroutine }: { goroutine: GoIDEGoroutine | null; threadId: number | null; debugId: string; onSelectGoroutine: (id: number) => void }) {
  if (!goroutine) return <div className="shrink-0 px-3 pt-2.5 text-[12.5px] font-semibold text-text-1">Goroutine #{threadId ?? '?'}</div>
  const origin = goroutine.origin ? splitFunctionName(goroutine.origin.name) : null
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-lg border border-border-1 bg-surface-0/40 p-2.5 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-text-1">Goroutine #{goroutine.id}</span>
        {goroutine.current && <span className="text-[12px] text-accent">current</span>}
        <span className="ml-auto"><StateBadge state={goroutine.state} /></span>
      </div>
      {goroutineRelations(goroutine).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Related to">
          {goroutineRelations(goroutine).map((relation) => <span key={relation} className="rounded-full bg-surface-3/70 px-1.5 text-[12px] text-text-2">{RELATION_LABEL[relation]}</span>)}
        </div>
      )}
      <dl className="mt-2 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 text-[13px]">
        {goroutine.blockedOn && <><dt className="text-text-4">Blocked on</dt><dd className="truncate font-mono text-warning">{goroutine.blockedOn}</dd></>}
        {origin && (
          <>
            <dt className="text-text-4">Started in</dt>
            <dd className="min-w-0"><button type="button" onClick={() => openFrame(goroutine.origin)} className="flex max-w-full items-center gap-1 truncate font-mono text-text-2 hover:text-accent"><Rocket size={11} className="shrink-0" />{origin.name}()</button></dd>
          </>
        )}
        <GoroutineCreatedAt debugId={debugId} goroutineId={goroutine.id} onSelectGoroutine={onSelectGoroutine} />
        {goroutine.location && (
          <>
            <dt className="text-text-4">Location</dt>
            <dd className="min-w-0"><button type="button" onClick={() => openFrame(goroutine.location)} className="flex items-center gap-1 font-mono text-text-2 hover:text-accent"><MapPin size={11} />{shortLocation(goroutine.location.relativePath, goroutine.location.line)}</button></dd>
          </>
        )}
      </dl>
      <WhyRunning goroutine={goroutine} debugId={debugId} />
      {goroutine.sourceLine && goroutine.location && (
        <button type="button" onClick={() => openFrame(goroutine.location)} title="Open in editor" className="mt-2 flex w-full items-center gap-2 overflow-hidden rounded-md bg-surface-0 px-2 py-1 text-left font-mono text-[13px] hover:ring-1 hover:ring-accent/40">
          <span className="shrink-0 text-text-4">{goroutine.location.line}</span>
          <span className="text-border-2">│</span>
          <span className="truncate text-text-1">{goroutine.sourceLine}</span>
        </button>
      )}
    </div>
  )
}

function FramesPane({ view }: { view: GoIDEDebugView }) {
  const [showLibrary, setShowLibrary] = useState(false)
  const paused = view.info.state === 'stopped'
  const frames = showLibrary ? view.frames : view.frames.filter((frame, index) => frame.relativePath || index === 0)
  const hidden = view.frames.length - frames.length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="Call stack" count={paused ? view.frames.length : undefined}>
        {paused && view.frames.length > 0 && (
          <button type="button" onClick={() => setShowLibrary(!showLibrary)} aria-pressed={showLibrary} aria-label="Show runtime and library frames" title={showLibrary ? 'Hide runtime and library frames' : 'Show runtime and library frames'} className="code-studio-icon-button h-6 w-6">
            {showLibrary ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        )}
      </PaneHeader>
      <div role="listbox" aria-label="Stack frames" className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {!paused && <p className="px-2 py-1 text-[13px] text-text-4">Frames appear when the program is paused.</p>}
        {paused && frames.map((frame) => (
          <button key={frame.id} type="button" role="option" aria-selected={frame.id === view.frameId} onClick={() => void useCodeStudioDebugStore.getState().selectFrame(view.info.id, frame.id)}
            title={`${frame.name}\n${frame.relativePath || frame.path || ''}:${frame.line}`}
            className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${frame.id === view.frameId ? 'code-studio-tree-row-selected' : 'hover:bg-surface-2'}`}>
            <span className={`min-w-0 flex-1 truncate font-mono ${frame.relativePath ? 'text-text-1' : 'text-text-4'}`}>{splitFunctionName(frame.name).name}</span>
            <span className="shrink-0 font-mono text-[12.5px] text-text-4">{shortLocation(frame.relativePath || frame.path, frame.line)}</span>
          </button>
        ))}
        {paused && hidden > 0 && <button type="button" onClick={() => setShowLibrary(true)} className="px-2 py-1 text-[12.5px] text-text-4 hover:text-text-2">+ {hidden} runtime and library frames</button>}
      </div>
    </div>
  )
}

/** Riga dell'istruzione go che ha creato la goroutine (dal runtime) e la goroutine che l'ha eseguita. */
function GoroutineCreatedAt({ debugId, goroutineId, onSelectGoroutine }: { debugId: string; goroutineId: number; onSelectGoroutine: (id: number) => void }) {
  const [creation, setCreation] = useState<GoroutineCreation | null>(null)
  useEffect(() => {
    let cancelled = false
    setCreation(null)
    GoIDEBindings.DebugGoroutineCreation(debugId, goroutineId).then((value) => { if (!cancelled) setCreation(value) }).catch(logBackgroundError('goroutine creation lookup'))
    return () => { cancelled = true }
  }, [debugId, goroutineId])
  if (!creation?.location && !creation?.parentId) return null
  return (
    <>
      <dt className="text-text-4">Created at</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2">
        {creation.location && (
          <button type="button" onClick={() => openFrame(creation.location)} title={creation.sourceLine || undefined} className="flex max-w-full items-center gap-1 truncate font-mono text-text-2 hover:text-accent">
            <GitFork size={11} className="shrink-0" />{shortLocation(creation.location.relativePath || creation.location.path, creation.location.line)}
          </button>
        )}
        {!!creation.parentId && <button type="button" onClick={() => onSelectGoroutine(creation.parentId!)} className="text-[12px] text-text-4 hover:text-accent">by goroutine #{creation.parentId}</button>}
      </dd>
    </>
  )
}

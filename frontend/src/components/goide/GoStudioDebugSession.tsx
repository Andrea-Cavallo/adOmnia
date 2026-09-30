import { useEffect, useState } from 'react'
import { Eye, EyeOff, MapPin, OctagonAlert, Rocket } from 'lucide-react'
import { getGoIDEDebugScopes, getGoIDEDebugVariables, type GoIDEDebugFrame, type GoIDEDebugVariable, type GoIDEGoroutine } from '@/lib/goide-debug-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEDebugStore, type GoIDEDebugView } from '@/stores/goideDebug'
import { GoStudioGoroutineTree } from './GoStudioGoroutineTree'
import { GoStudioDebugConsole, GoStudioDebugVariables } from './GoStudioDebugVariables'
import { PaneHeader, StateBadge, shortLocation } from './GoStudioDebugUi'
import { goroutineRelations, splitFunctionName, type GoroutineRelation } from './goStudioConcurrency'
import { panicSnapshot, panicValueFromVariables } from './goStudioPanicInspector'
import { sourceDeferredCallsBefore, type GoStudioSourceDeferredCall } from './goStudioDeferredCalls'

const RELATION_LABEL: Record<GoroutineRelation, string> = {
  channel: 'channel', mutex: 'mutex', rwmutex: 'RWMutex', waitgroup: 'WaitGroup', context: 'context', network: 'network', database: 'database', timer: 'timer',
}

interface GoStudioDebugSessionProps {
  view: GoIDEDebugView
  sessionId: string
}

function openFrame(frame: GoIDEDebugFrame | null | undefined) {
  if (!frame) return
  const path = frame.relativePath || frame.path
  if (path) void useGoIDEStore.getState().openLocation(path, frame.line, frame.column || 1)
}

/** Vista Session: goroutine, dettaglio e stack della goroutine scelta, variabili e console. */
export function GoStudioDebugSession({ view, sessionId }: GoStudioDebugSessionProps) {
  const paused = view.info.state === 'stopped'
  const selected = view.goroutines?.goroutines.find((goroutine) => goroutine.id === view.threadId) ?? null
  const selectGoroutine = (goroutine: GoIDEGoroutine) => void useGoIDEDebugStore.getState().selectThread(view.info.id, goroutine.id)
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,1fr)_minmax(240px,1.05fr)_minmax(240px,1.15fr)_minmax(220px,1fr)] divide-x divide-border-1">
      <section aria-label="Goroutines" className="flex min-h-0 flex-col">
        <PaneHeader title="Goroutines" count={view.goroutines?.goroutines.length} />
        {paused
          ? <GoStudioGoroutineTree overview={view.goroutines} loading={view.goroutinesLoading} selectedId={view.threadId} onSelect={selectGoroutine} />
          : <p className="px-3 py-2 text-[11.5px] text-text-4">{view.info.state === 'running' ? 'Running. Pause or hit a breakpoint to inspect goroutines.' : 'No goroutines.'}</p>}
      </section>
      <section aria-label="Goroutine and call stack" className="flex min-h-0 flex-col">
        {paused && <GoroutineDetail goroutine={selected} threadId={view.threadId} />}
        {paused && <PanicInspector view={view} />}
        {paused && <DeferredCallInspector frame={view.frames.find((frame) => frame.id === view.frameId) ?? null} />}
        <FramesPane view={view} />
      </section>
      <GoStudioDebugVariables view={view} sessionId={sessionId} />
      <GoStudioDebugConsole view={view} />
    </div>
  )
}

function DeferredCallInspector({ frame }: { frame: GoIDEDebugFrame | null }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [calls, setCalls] = useState<GoStudioSourceDeferredCall[]>([])
  const inspect = async () => {
    if (!frame?.relativePath || state === 'loading') return
    setState('loading')
    try {
      const document = await useGoIDEStore.getState().ensureDocumentLoaded(frame.relativePath)
      if (!document) throw new Error('source is unavailable')
      setCalls(sourceDeferredCallsBefore(document.buffer, frame.line))
      setState('ready')
    } catch {
      setCalls([])
      setState('error')
    }
  }
  useEffect(() => { setState('idle'); setCalls([]) }, [frame?.id])
  if (!frame?.relativePath) return null
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-lg border border-border-1 bg-surface-0/40 p-2.5 text-[11px]">
      <div className="flex items-center gap-2"><b className="text-text-2">Deferred calls</b><button type="button" onClick={() => void inspect()} disabled={state === 'loading'} className="ml-auto rounded px-1.5 py-0.5 text-[10.5px] text-accent hover:bg-accent/10 disabled:opacity-50">{state === 'loading' ? 'Reading…' : 'Inspect source'}</button></div>
      {state === 'ready' && (calls.length > 0 ? <ol className="mt-1 space-y-0.5 font-mono text-[10.5px]">{calls.map((call) => <li key={call.line}><span className="mr-1 text-text-4">{call.line}</span>{call.expression}</li>)}</ol> : <p className="mt-1 text-text-4">No earlier <code>defer</code> in this source function.</p>)}
      {state === 'error' && <p className="mt-1 text-danger">Source is unavailable for this frame.</p>}
      {(state === 'idle' || state === 'ready') && <p className="mt-1 text-[10.5px] leading-4 text-text-4">Source candidates only: branches may mean a defer was not registered; Delve does not expose the pending runtime order.</p>}
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
    <div role="alert" className="mx-2 mt-2 shrink-0 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-[11.5px]">
      <div className="flex items-center gap-1.5 font-semibold text-danger"><OctagonAlert size={13} /> Panic stop</div>
      <p className="mt-1 text-text-2">Delve stopped on <span className="font-mono">{panic.reason}</span>{panic.runtimeFrame ? ` in ${splitFunctionName(panic.runtimeFrame.name).name}` : ''}.</p>
      {panic.originFrame && <button type="button" onClick={() => openFrame(panic.originFrame)} className="mt-1.5 flex max-w-full items-center gap-1 rounded font-mono text-text-2 hover:text-accent"><MapPin size={11} className="shrink-0" />Open origin: {splitFunctionName(panic.originFrame.name).name} · {shortLocation(panic.originFrame.relativePath || panic.originFrame.path, panic.originFrame.line)}</button>}
      {panicValue && <p className="mt-1.5 break-all font-mono text-[10.5px] text-text-2">Panic value: <span className="text-text-1">{panicValue.value}</span>{panicValue.type && <span className="text-text-4"> ({panicValue.type})</span>}</p>}
      {!panicValue && <p className="mt-1.5 text-[10.5px] leading-4 text-text-4">{valueStatus === 'loading' ? 'Reading panic value from the runtime frame…' : 'The DAP adapter did not expose a panic value for this stop.'}</p>}
      <p className="mt-1 text-[10.5px] leading-4 text-text-4">Recovered/deferred state requires additional Delve data and is not inferred here.</p>
    </div>
  )
}

function GoroutineDetail({ goroutine, threadId }: { goroutine: GoIDEGoroutine | null; threadId: number | null }) {
  if (!goroutine) return <div className="shrink-0 px-3 pt-2.5 text-[12.5px] font-semibold text-text-1">Goroutine #{threadId ?? '?'}</div>
  const origin = goroutine.origin ? splitFunctionName(goroutine.origin.name) : null
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-lg border border-border-1 bg-surface-0/40 p-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-text-1">Goroutine #{goroutine.id}</span>
        {goroutine.current && <span className="text-[10.5px] text-accent">current</span>}
        <span className="ml-auto"><StateBadge state={goroutine.state} /></span>
      </div>
      {goroutineRelations(goroutine).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Related to">
          {goroutineRelations(goroutine).map((relation) => <span key={relation} className="rounded-full bg-surface-3/70 px-1.5 text-[10.5px] text-text-2">{RELATION_LABEL[relation]}</span>)}
        </div>
      )}
      <dl className="mt-2 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 text-[11.5px]">
        {goroutine.blockedOn && <><dt className="text-text-4">Blocked on</dt><dd className="truncate font-mono text-warning">{goroutine.blockedOn}</dd></>}
        {origin && (
          <>
            <dt className="text-text-4">Started in</dt>
            <dd className="min-w-0"><button type="button" onClick={() => openFrame(goroutine.origin)} className="flex max-w-full items-center gap-1 truncate font-mono text-text-2 hover:text-accent"><Rocket size={11} className="shrink-0" />{origin.name}()</button></dd>
          </>
        )}
        {goroutine.location && (
          <>
            <dt className="text-text-4">Location</dt>
            <dd className="min-w-0"><button type="button" onClick={() => openFrame(goroutine.location)} className="flex items-center gap-1 font-mono text-text-2 hover:text-accent"><MapPin size={11} />{shortLocation(goroutine.location.relativePath, goroutine.location.line)}</button></dd>
          </>
        )}
      </dl>
      {goroutine.sourceLine && goroutine.location && (
        <button type="button" onClick={() => openFrame(goroutine.location)} title="Open in editor" className="mt-2 flex w-full items-center gap-2 overflow-hidden rounded-md bg-surface-0 px-2 py-1 text-left font-mono text-[11.5px] hover:ring-1 hover:ring-accent/40">
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
          <button type="button" onClick={() => setShowLibrary(!showLibrary)} aria-pressed={showLibrary} title={showLibrary ? 'Hide runtime and library frames' : 'Show runtime and library frames'} className="go-studio-icon-button h-6 w-6">
            {showLibrary ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        )}
      </PaneHeader>
      <div role="listbox" aria-label="Stack frames" className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {!paused && <p className="px-2 py-1 text-[11.5px] text-text-4">Frames appear when the program is paused.</p>}
        {paused && frames.map((frame) => (
          <button key={frame.id} type="button" role="option" aria-selected={frame.id === view.frameId} onClick={() => void useGoIDEDebugStore.getState().selectFrame(view.info.id, frame.id)}
            title={`${frame.name}\n${frame.relativePath || frame.path || ''}:${frame.line}`}
            className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] ${frame.id === view.frameId ? 'go-studio-tree-row-selected' : 'hover:bg-surface-2'}`}>
            <span className={`min-w-0 flex-1 truncate font-mono ${frame.relativePath ? 'text-text-1' : 'text-text-4'}`}>{splitFunctionName(frame.name).name}</span>
            <span className="shrink-0 font-mono text-[11px] text-text-4">{shortLocation(frame.relativePath || frame.path, frame.line)}</span>
          </button>
        ))}
        {paused && hidden > 0 && <button type="button" onClick={() => setShowLibrary(true)} className="px-2 py-1 text-[11px] text-text-4 hover:text-text-2">+ {hidden} runtime and library frames</button>}
      </div>
    </div>
  )
}

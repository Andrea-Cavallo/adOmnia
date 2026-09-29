import { useState } from 'react'
import { Eye, EyeOff, MapPin, Rocket } from 'lucide-react'
import type { GoIDEDebugFrame, GoIDEGoroutine } from '@/lib/goide-debug-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEDebugStore, type GoIDEDebugView } from '@/stores/goideDebug'
import { GoStudioGoroutineTree } from './GoStudioGoroutineTree'
import { GoStudioDebugConsole, GoStudioDebugVariables } from './GoStudioDebugVariables'
import { PaneHeader, StateBadge, shortLocation } from './GoStudioDebugUi'
import { goroutineRelations, splitFunctionName, type GoroutineRelation } from './goStudioConcurrency'

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
        <FramesPane view={view} />
      </section>
      <GoStudioDebugVariables view={view} sessionId={sessionId} />
      <GoStudioDebugConsole view={view} />
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

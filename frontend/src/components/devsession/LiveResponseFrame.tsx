import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { showModule } from '@/lib/moduleRouting'
import { ArrowDownToLine, Bug, Check, Columns2, Loader2, Play, Redo2, RotateCcw, Square, X } from 'lucide-react'
import { useTabsStore } from '@/stores/tabs'
import type { LiveSession, RequestRun } from '@/lib/devsession-api'
import { liveLogs, liveMessages, liveQueries } from '@/lib/devsession-api'
import { cn } from '@/lib/utils'
import { useDevSessionStore, type DebugRequestProgress } from '@/stores/devSession'
import { runForTab } from '@/stores/devSessionModel'
import { openFrameInGoStudio } from '@/lib/devsession/navigation'
import { streamSessionToLogInspector } from '@/lib/devsession/logInspectorSource'
import { requestLogInspectorQuery } from '@/lib/loginspector/handoff'
import { LiveLogList, LiveMessageList, LiveQueryList, RequestSummary, RequestTimeline } from './LiveRequestViews'
import { basename, LiveDot } from './liveUi'
import { SaveReproductionButton } from './RequestContextView'

type LiveTab = 'response' | 'logs' | 'debug' | 'timeline' | 'db' | 'kafka'

const PROGRESS_STEPS: Array<{ step: DebugRequestProgress['step']; label: string }> = [
  { step: 'service', label: 'Service' },
  { step: 'debugger', label: 'Delve' },
  { step: 'ready', label: 'Ready' },
  { step: 'sending', label: 'Request' },
]

/**
 * Wraps the response panel of an API tab with what the live service did:
 * the Debug Request progress, the PAUSED AT BREAKPOINT state while the
 * handler is stopped, and after completion the Logs / Debug / Timeline /
 * DB / Kafka views of that request.
 */
export function LiveResponseFrame({ tabId, loading, children }: { tabId: string; loading: boolean; children: ReactNode }) {
  const run = useDevSessionStore((state) => runForTab(state, tabId))
  const session = useDevSessionStore((state) => (run ? state.sessions[run.sessionId] ?? null : null))
  const progress = useDevSessionStore((state) => state.progress[tabId])
  const [tab, setTab] = useState<LiveTab>('response')
  useEffect(() => { setTab('response') }, [run?.id])
  useEffect(() => {
    const onLogs = () => setTab('logs')
    document.addEventListener('adomnia:live-response-logs', onLogs)
    return () => document.removeEventListener('adomnia:live-response-logs', onLogs)
  }, [])

  if (progress) return <ProgressCard tabId={tabId} progress={progress} />
  if (!run) return <>{children}</>
  if (run.state === 'paused' && session) return <PausedCard run={run} session={session} />
  const inFlight = run.state === 'sent' || loading

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="tablist" aria-label="Live request views" className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap border-b border-border-1 bg-surface-1 px-2 text-[11px] [scrollbar-width:none]">
        {session && <span className="mr-2 flex items-center gap-1.5 text-text-3" title={`${session.service} · live session`}><LiveDot session={session} />{session.service}</span>}
        {(['response', 'logs', 'debug', 'timeline', 'db', 'kafka'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn('relative h-8 shrink-0 px-2.5 transition-colors', tab === id ? 'text-text-1' : 'text-text-3 hover:text-text-2')}>
            {TAB_LABEL[id](run)}
            {tab === id && <span className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-t bg-accent" />}
          </button>
        ))}
        {inFlight && <span className="ml-auto flex items-center gap-1 text-text-4"><Loader2 size={11} className="animate-spin" />in flight</span>}
        {!inFlight && run.completedAt && <span className="ml-auto shrink-0"><SaveReproductionButton run={run} compact /></span>}
      </div>
      {!inFlight && run.completedAt && tab === 'response' && <RequestSummary run={run} onTab={setTab} />}
      {tab === 'response' ? children : <LiveView tab={tab} run={run} session={session} />}
    </div>
  )
}

const TAB_LABEL: Record<LiveTab, (run: RequestRun) => string> = {
  response: () => 'Response',
  logs: (run) => `Logs${run.logs ? ` ${run.logs}` : ''}`,
  debug: (run) => `Debug${run.hits.length ? ` ${run.hits.length}` : ''}`,
  timeline: () => 'Timeline',
  db: (run) => `DB${run.queries ? ` ${run.queries}` : ''}`,
  kafka: (run) => `Kafka${run.messages ? ` ${run.messages}` : ''}`,
}

function LiveView({ tab, run, session }: { tab: Exclude<LiveTab, 'response'>; run: RequestRun; session: LiveSession | null }) {
  // Every service's lines: a consumer elsewhere logs the request's trace id too.
  const allLogs = useDevSessionStore((state) => state.logs)
  const storeLogs = useMemo(() => Object.values(allLogs).flat().filter((entry) => entry.requestRunId === run.id).sort((a, b) => a.seq - b.seq), [allLogs, run.id])
  const storeQueries = useDevSessionStore((state) => state.queries)
  const storeMessages = useDevSessionStore((state) => state.messages)
  const [fetched, setFetched] = useState<{ logs: typeof storeLogs; queries: typeof storeQueries; messages: typeof storeMessages } | null>(null)
  // Lines logged before this view existed live only in the backend buffer.
  useEffect(() => {
    let cancelled = false
    void Promise.all([liveLogs(run.sessionId, run.id), liveQueries(run.id), liveMessages(run.id)])
      .then(([logs, queries, messages]) => { if (!cancelled) setFetched({ logs: logs ?? [], queries: queries ?? [], messages: messages ?? [] }) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [run.id, run.sessionId, run.logs, run.queries, run.messages])
  const logs = useMemo(() => mergeBy(fetched?.logs ?? [], storeLogs, (entry) => String(entry.seq)), [fetched, storeLogs])
  const queries = useMemo(() => mergeBy(fetched?.queries ?? [], storeQueries.filter((q) => q.requestRunId === run.id), (q) => q.id), [fetched, storeQueries, run.id])
  const messages = useMemo(() => mergeBy(fetched?.messages ?? [], storeMessages.filter((m) => m.requestRunId === run.id), (m) => m.id), [fetched, storeMessages, run.id])

  if (tab === 'logs') {
    return (
      <LiveLogList entries={logs} goSessionId={session?.goSessionId} ownerSessionId={run.sessionId} empty={`No log line tied to this request yet. Lines that carry ${run.correlationId}, or are logged while it is in flight, appear here.`}
        toolbar={session && (
          <button type="button" title={`Stream ${session.service} into the Log Inspector, filtered on this request`}
            onClick={() => { streamSessionToLogInspector(session.id, session.service); requestLogInspectorQuery(run.correlationId); showModule('loginspector') }}
            className="shrink-0 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent">Log Inspector</button>
        )} />
    )
  }
  if (tab === 'db') return <LiveQueryList queries={queries} run={run} goSessionId={session?.goSessionId} />
  if (tab === 'kafka') return <LiveMessageList messages={messages} run={run} />
  if (tab === 'timeline') return <RequestTimeline run={run} session={session} logs={logs} queries={queries} messages={messages} />
  return <HitList run={run} session={session} />
}

function mergeBy<T>(first: T[], second: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of [...first, ...second]) {
    const id = key(item)
    if (!seen.has(id)) { seen.add(id); out.push(item) }
  }
  return out
}

function HitList({ run, session }: { run: RequestRun; session: LiveSession | null }) {
  if (run.hits.length === 0) {
    return <p className="px-6 py-8 text-center text-[12px] text-text-3">No breakpoint was hit. Set one in Go Studio and use Debug Request to stop inside the handler.</p>
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-border-1 overflow-auto">
      {run.hits.map((hit, index) => (
        <li key={index} className="flex items-center gap-3 px-3 py-2 text-[12px]">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-text-1">{basename(hit.relativePath || hit.file || '')}:{hit.line} <span className="text-text-3">{hit.function}()</span></span>
            {hit.confidence === 'probable' && <span className="text-[10.5px] text-text-4">Several requests were in flight: probably this one.</span>}
          </span>
          {session && <button type="button" onClick={() => void openFrameInGoStudio(session, hit)} className="shrink-0 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent">Open in Go Studio</button>}
        </li>
      ))}
    </ul>
  )
}

function ActionButton({ onClick, children, tone, title }: { onClick: () => void; children: ReactNode; tone?: 'primary' | 'danger'; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn('flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        tone === 'primary' ? 'border-accent/50 bg-accent/15 text-accent hover:bg-accent/25'
          : tone === 'danger' ? 'border-border-2 text-error hover:bg-error/10'
            : 'border-border-2 text-text-2 hover:bg-surface-3 hover:text-text-1')}>
      {children}
    </button>
  )
}

/** Replay at a breakpoint: a copy of the tab is sent while the original waits for the debugger. */
function replay(tabId: string) {
  useTabsStore.getState().duplicateTab(tabId)
  requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('adomnia:send-active-request', { detail: { handled: false } })))
}

/** PAUSED AT BREAKPOINT: the request is stopped inside the service. */
function PausedCard({ run, session }: { run: RequestRun; session: LiveSession }) {
  const { step, stop, openSplit } = useDevSessionStore.getState()
  const hit = run.hits[run.hits.length - 1]
  const where = session.pause ?? hit
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 py-8" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
        <span className="h-2 w-2 animate-pulse rounded-full bg-warning" aria-hidden="true" />Paused at breakpoint
      </div>
      {where && (
        <button type="button" onClick={() => void openFrameInGoStudio(session, where)} className="group text-center">
          <span className="block font-mono text-[15px] text-text-1 group-hover:text-accent">{basename(where.relativePath || where.file || '')}:{where.line}</span>
          <span className="block font-mono text-[12px] text-text-3">{where.function}()</span>
        </button>
      )}
      <div className="flex w-full max-w-md items-center gap-2 text-[10.5px] text-text-4" aria-label="Request lifecycle">
        <span>Request</span>
        <span className="h-px flex-1 bg-accent/60" />
        <span className="h-3 w-3 rounded-full border-2 border-warning bg-warning/30" title="Breakpoint" />
        <span className="h-px flex-1 border-t border-dashed border-border-2" />
        <span>Response</span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ActionButton tone="primary" onClick={() => void openFrameInGoStudio(session, where)}><Bug size={13} />Open in Go Studio</ActionButton>
        <ActionButton onClick={() => void step(session.id, 'continue')} title="F9"><Play size={12} fill="currentColor" />Continue</ActionButton>
        <ActionButton onClick={() => void step(session.id, 'next')} title="F8"><Redo2 size={13} />Step Over</ActionButton>
        <ActionButton onClick={() => void step(session.id, 'stepIn')} title="F7"><ArrowDownToLine size={13} />Step Into</ActionButton>
        <ActionButton onClick={() => openSplit(run.tabId ?? null)}><Columns2 size={13} />Split view</ActionButton>
        {run.tabId && <ActionButton title="Send the same request again from a copy of this tab (edit its body first if needed)" onClick={() => replay(run.tabId!)}><RotateCcw size={12} />Replay</ActionButton>}
        <ActionButton tone="danger" onClick={() => void stop(session.id)}><Square size={10} fill="currentColor" />Stop</ActionButton>
      </div>
      <p className="text-[12px] text-text-4">Waiting for debugger… the response arrives when execution resumes.</p>
      {hit?.confidence === 'probable' && <p className="max-w-md text-center text-[11px] text-text-4">Several requests were in flight when the debugger stopped: this is the most recent one.</p>}
    </div>
  )
}

/** Debug Request steps: find the service, start Delve, wait for its port, send. */
function ProgressCard({ tabId, progress }: { tabId: string; progress: DebugRequestProgress }) {
  const setProgress = useDevSessionStore((state) => state.setProgress)
  const current = PROGRESS_STEPS.findIndex((item) => item.step === progress.step)
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 py-8" role="status" aria-live="polite">
      <ol className="flex items-center gap-2" aria-label="Debug Request progress">
        {PROGRESS_STEPS.map((item, index) => {
          const done = index < current
          const active = index === current
          return (
            <li key={item.step} className="flex items-center gap-2">
              <span className={cn('flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium',
                progress.error && active ? 'bg-error/15 text-error' : done ? 'bg-success/15 text-success' : active ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-text-4')}>
                {done ? <Check size={11} /> : active && !progress.error ? <Loader2 size={11} className="animate-spin" /> : null}
                {item.label}
              </span>
              {index < PROGRESS_STEPS.length - 1 && <span className="h-px w-5 bg-border-2" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
      <p className={cn('max-w-lg text-center text-[12.5px]', progress.error ? 'text-error' : 'text-text-2')}>{progress.error ?? progress.message}</p>
      {progress.error && <ActionButton onClick={() => setProgress(tabId, null)}><X size={12} />Dismiss</ActionButton>}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { showModule } from '@/lib/moduleRouting'
import { Database, MessageSquare, ScrollText, Search } from 'lucide-react'
import type { LiveLogEntry, LiveMessage, LiveQuery, LiveSession, RequestRun } from '@/lib/devsession-api'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { showEntityNotice } from '@/lib/entities/notice'
import { appendMockEndpoints, createMockEndpointFromRequest } from '@/lib/mockEndpointStore'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import { codePathFor, timeOf } from '@/stores/devSessionModel'
import { openFrameInGoStudio, openLocationInGoStudio, openRequestTab } from '@/lib/devsession/navigation'
import { useDevSessionStore } from '@/stores/devSession'
import { basename } from './liveUi'

const LEVEL_TONE: Record<string, string> = { error: 'text-error', warn: 'text-warning', info: 'text-text-2', debug: 'text-text-4' }
const time = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0')
}

function MatchHint({ match }: { match?: string }) {
  if (!match) return null
  return (
    <span title={match === 'id' ? 'Carries the request id' : 'Logged while the request was in flight (by time: a guess)'}
      className={cn('shrink-0 rounded px-1 text-[9.5px] font-semibold uppercase tracking-wide', match === 'id' ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-text-4')}>
      {match === 'id' ? 'id' : 'time'}
    </span>
  )
}

const GO_LOCATION = /([\w./-]+\.go):(\d+)/

/** Service log lines, filterable; used by the response Logs tab and the service logs drawer. */
export function LiveLogList({ entries, empty, goSessionId, toolbar }: { entries: LiveLogEntry[]; empty: string; goSessionId?: string; toolbar?: React.ReactNode }) {
  const runs = useDevSessionStore((state) => state.runs)
  const [filter, setFilter] = useState('')
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all')
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return entries.filter((entry) =>
      (!needle || entry.text.toLowerCase().includes(needle))
      && (level === 'all' || entry.level === 'error' || (level === 'warn' && entry.level === 'warn')))
  }, [entries, filter, level])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 px-2">
        <Search size={12} className="text-text-4" aria-hidden="true" />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter log lines" aria-label="Filter log lines"
          className="h-6 min-w-0 flex-1 bg-transparent text-[11.5px] text-text-1 outline-none placeholder:text-text-4" />
        <select aria-label="Minimum level" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}
          className="h-6 rounded border border-border-2 bg-surface-2 px-1 text-[11px] text-text-2 outline-none focus:border-accent">
          <option value="all">All levels</option>
          <option value="warn">Warnings+</option>
          <option value="error">Errors</option>
        </select>
        <span className="text-[10.5px] text-text-4">{shown.length}/{entries.length}</span>
        {toolbar}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[11.5px] leading-[18px]" role="log" aria-live="polite">
        {shown.length === 0 && <p className="px-3 py-6 text-center font-sans text-[12px] text-text-4">{entries.length ? 'No line matches the filter.' : empty}</p>}
        {shown.map((entry) => (
          <div key={entry.seq} className="flex items-start gap-2 px-2 hover:bg-surface-2/60">
            <span className="shrink-0 text-text-4">{time(entry.at)}</span>
            <MatchHint match={entry.match} />
            <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-all', LEVEL_TONE[entry.level ?? ''] ?? 'text-text-2', entry.stream === 'stderr' && !entry.level && 'text-text-3')}>{entry.text}</span>
            <LineActions entry={entry} goSessionId={goSessionId} tabId={entry.requestRunId ? runs[entry.requestRunId]?.tabId : undefined} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Go to code (a file.go:N in the line) and back to the request that caused it. */
function LineActions({ entry, goSessionId, tabId }: { entry: LiveLogEntry; goSessionId?: string; tabId?: string }) {
  const location = goSessionId ? GO_LOCATION.exec(entry.text) : null
  if (!location && !tabId) return null
  return (
    <span className="flex shrink-0 items-center gap-1 font-sans">
      {location && goSessionId && (
        <button type="button" title={`Open ${location[1]}:${location[2]} in Go Studio`} onClick={() => void openLocationInGoStudio(goSessionId, { function: '', relativePath: location[1].replace(/^\.\//, ''), line: Number(location[2]) })}
          className="rounded px-1 text-[10px] text-text-4 hover:bg-surface-3 hover:text-accent">code</button>
      )}
      {tabId && <button type="button" title="Open the request that logged this line" onClick={() => openRequestTab(tabId)} className="rounded px-1 text-[10px] text-text-4 hover:bg-surface-3 hover:text-accent">request</button>}
    </span>
  )
}

/** SQL statements the request caused; each opens in Database Studio without running. */
export function LiveQueryList({ queries, run }: { queries: LiveQuery[]; run?: RequestRun | null }) {
  if (queries.length === 0) {
    return <EmptyNote icon={<Database size={16} />} text="No SQL seen for this request. Queries appear when the service logs them, or through SQL capture (debug bar → service tools)." />
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-border-1 overflow-auto">
      {queries.map((query) => (
        <li key={query.id} className="flex items-start gap-2 px-3 py-2">
          <span className="mt-0.5 shrink-0 text-[10.5px] text-text-4">{time(query.at)}</span>
          <MatchHint match={query.match} />
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[11.5px] text-text-1">{query.sql}</code>
          <button type="button" onClick={() => openQuery(query, run)}
            className="shrink-0 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent">Open in Database</button>
        </li>
      ))}
    </ul>
  )
}

function openQuery(query: LiveQuery, run?: RequestRun | null) {
  const label = run ? `${run.method} ${pathOf(run.url)}` : 'live query'
  handoffToPanel('database', { kind: 'table', id: `sql:${query.id}`, label, attrs: {} }, 'sql', {
    sql: query.sql,
    back: run?.tabId ? { label: 'Open request', run: () => openRequestTab(run.tabId) } : undefined,
  })
}

/** Broker messages the request produced; each opens its topic in Broker Studio. */
export function LiveMessageList({ messages, run }: { messages: LiveMessage[]; run?: RequestRun | null }) {
  if (messages.length === 0) {
    return <EmptyNote icon={<MessageSquare size={16} />} text="No message seen for this request. Watch the service's topics from the debug bar (service tools) to see what it produces." />
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-border-1 overflow-auto">
      {messages.map((message) => (
        <li key={message.id} className="flex items-start gap-2 px-3 py-2 text-[11.5px]">
          <span className="mt-0.5 shrink-0 text-[10.5px] text-text-4">{time(message.at)}</span>
          <MatchHint match={message.match} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="font-semibold text-text-1">{message.topic}</span>
              <span className="text-text-3">partition {message.partition}</span>
              <span className="text-text-3">offset {message.offset}</span>
              {message.key && <span className="font-mono text-text-3">key {message.key}</span>}
            </div>
            {message.preview && <code className="mt-1 block max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-text-2">{message.preview}</code>}
          </div>
          <button type="button" onClick={() => openMessage(message, run)}
            className="shrink-0 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent">Open in Kafka</button>
        </li>
      ))}
    </ul>
  )
}

export function openMessage(message: LiveMessage, run?: RequestRun | null) {
  handoffToPanel('broker', { kind: 'topic', id: `topic:${message.topic}`, label: message.topic, attrs: { broker: 'kafka', partition: String(message.partition), offset: String(message.offset) } }, 'open', {
    back: run?.tabId ? { label: 'Open request', run: () => openRequestTab(run.tabId) } : undefined,
  })
}

function EmptyNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <span className="text-text-4">{icon}</span>
      <p className="max-w-md text-[12px] leading-5 text-text-3">{text}</p>
    </div>
  )
}

const pathOf = (url: string) => {
  try { const parsed = new URL(url); return parsed.pathname + parsed.search } catch { return url }
}

type TimelineStep = { at: string; kind: 'sent' | 'frame' | 'hit' | 'sql' | 'message' | 'log' | 'response'; label: string; detail?: string; onOpen?: () => void }

/** Local lifecycle of one request: what the debugger, the logs, the database and the broker saw, in order. */
export function RequestTimeline({ run, session, logs, queries, messages }: { run: RequestRun; session: LiveSession | null; logs: LiveLogEntry[]; queries: LiveQuery[]; messages: LiveMessage[] }) {
  const steps: TimelineStep[] = [{ at: run.startedAt, kind: 'sent', label: `${run.method} ${pathOf(run.url)}`, detail: 'sent' }]
  for (const hit of run.hits) {
    const frames = [...(hit.stack ?? [])].reverse().filter((frame) => frame.relativePath && !frame.relativePath.startsWith('..'))
    for (const frame of frames.slice(0, -1)) {
      steps.push({ at: hit.at, kind: 'frame', label: `${frame.function.split('/').pop()}()`, detail: `${basename(frame.relativePath ?? '')}:${frame.line}`, onOpen: session ? () => void openFrameInGoStudio(session, frame) : undefined })
    }
    steps.push({ at: hit.at, kind: 'hit', label: `${hit.function.split('/').pop()}()`, detail: `breakpoint · ${basename(hit.relativePath || hit.file || '')}:${hit.line}${hit.confidence === 'probable' ? ' · probable' : ''}`, onOpen: session ? () => void openFrameInGoStudio(session, hit) : undefined })
  }
  for (const query of queries) steps.push({ at: query.at, kind: 'sql', label: query.sql.split(/\s+/).slice(0, 4).join(' '), detail: 'SQL' })
  for (const message of messages) steps.push({ at: message.at, kind: 'message', label: message.topic, detail: `produced · p${message.partition} · offset ${message.offset}` })
  const errors = logs.filter((entry) => entry.level === 'error')
  for (const entry of errors.slice(0, 5)) steps.push({ at: entry.at, kind: 'log', label: entry.text.slice(0, 80), detail: 'error log' })
  if (run.completedAt) steps.push({ at: run.completedAt, kind: 'response', label: run.state === 'error' ? run.error || 'Failed' : `Response ${run.status}`, detail: `${run.durationMs ?? 0} ms` })
  steps.sort((a, b) => (a.kind === 'sent' ? -1 : b.kind === 'sent' ? 1 : a.kind === 'response' ? 1 : b.kind === 'response' ? -1 : timeOf(a.at) - timeOf(b.at)))

  return (
    <ol className="min-h-0 flex-1 overflow-auto px-4 py-3" aria-label="Request timeline">
      {steps.map((step, index) => (
        <li key={index} className="relative flex gap-3 pb-3 last:pb-0">
          {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-border-2" />}
          <span aria-hidden="true" className={cn('relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 bg-surface-0',
            step.kind === 'hit' ? 'border-warning bg-warning' : step.kind === 'response' ? (run.state === 'error' || (run.status ?? 0) >= 400 ? 'border-error' : 'border-success') : step.kind === 'log' ? 'border-error' : step.kind === 'sent' ? 'border-accent' : 'border-border-2')} />
          <div className="min-w-0 flex-1">
            {step.onOpen
              ? <button type="button" onClick={step.onOpen} className="max-w-full truncate text-left font-mono text-[12px] text-text-1 hover:text-accent hover:underline">{step.label}</button>
              : <span className="block truncate font-mono text-[12px] text-text-1">{step.label}</span>}
            {step.detail && <span className="block text-[10.5px] text-text-4">{step.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Mock from runtime: the response the service really returned becomes a Mock Server endpoint. */
async function mockRunResponse(run: RequestRun) {
  const tab = useTabsStore.getState().tabs.find((item) => item.id === run.tabId)
  if (!tab) return showEntityNotice('The request tab was closed.')
  const endpoint = createMockEndpointFromRequest({ ...tab.request, url: run.url }, tab.response)
  if (!endpoint) return showEntityNotice(`${run.method} cannot be mocked.`)
  try {
    await appendMockEndpoints([endpoint])
    showEntityNotice(`Mock endpoint ${endpoint.method} ${endpoint.path} added with the captured ${run.status} response.`, { label: 'Open Mock Server', run: () => showModule('mock') })
  } catch (error) {
    showEntityNotice(`Could not add the mock endpoint: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** REQUEST COMPLETED: one glance at what a request touched. */
export function RequestSummary({ run, onTab }: { run: RequestRun; onTab: (tab: 'logs' | 'debug' | 'timeline' | 'db' | 'kafka') => void }) {
  const path = codePathFor(run)
  const ok = run.state === 'completed' && (run.status ?? 0) < 400
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-1 bg-surface-1 px-3 py-1.5 text-[11px] text-text-3">
      <span className={cn('font-semibold', ok ? 'text-success' : 'text-error')}>{run.state === 'error' ? 'Failed' : `${run.status}`}</span>
      <span>{run.durationMs ?? 0} ms</span>
      {path.length > 0 && <button type="button" onClick={() => onTab('timeline')} className="max-w-[40ch] truncate font-mono hover:text-text-1" title={path.join(' → ')}>{path.map(basename).join(' → ')}</button>}
      <button type="button" onClick={() => onTab('db')} className="hover:text-text-1"><Database size={11} className="mr-1 inline" />{run.queries} {run.queries === 1 ? 'query' : 'queries'}</button>
      <button type="button" onClick={() => onTab('kafka')} className="hover:text-text-1"><MessageSquare size={11} className="mr-1 inline" />{run.messages} {run.messages === 1 ? 'event' : 'events'}</button>
      <button type="button" onClick={() => onTab('logs')} className="hover:text-text-1"><ScrollText size={11} className="mr-1 inline" />{run.logs} log {run.logs === 1 ? 'line' : 'lines'}</button>
      <button type="button" onClick={() => onTab('debug')} className="hover:text-text-1">{run.hits.length} {run.hits.length === 1 ? 'breakpoint' : 'breakpoints'} hit</button>
      {run.tabId && run.state === 'completed' && <button type="button" onClick={() => void mockRunResponse(run)} className="ml-auto hover:text-text-1" title="Add this real response to the Mock Server">Mock this response</button>}
      {run.tabId && <button type="button" onClick={() => openRequestTab(run.tabId)} className={cn('hover:text-text-1', run.state !== 'completed' && 'ml-auto')}>Open request</button>}
    </div>
  )
}

import type { LiveEvent, LiveLogEntry, LiveMessage, LiveQuery, LiveSession, LiveSnapshot, RequestRun } from '@/lib/devsession-api'

/** Pure state of the Live Development Sessions, updated only through applyLiveEvent. */
export interface LiveModel {
  sessions: Record<string, LiveSession>
  order: string[]
  runs: Record<string, RequestRun>
  runOrder: string[]
  /** Newest request run of each API tab. */
  runByTab: Record<string, string>
  /** Log lines per session (capped). */
  logs: Record<string, LiveLogEntry[]>
  queries: LiveQuery[]
  messages: LiveMessage[]
}

export const MAX_UI_LOGS = 2000
const MAX_UI_ITEMS = 300
const MAX_UI_RUNS = 200

/** Instants from Go carry a local offset (+02:00), from JS a Z: compare them as numbers, never as strings. */
export const timeOf = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0)

export const emptyModel = (): LiveModel => ({ sessions: {}, order: [], runs: {}, runOrder: [], runByTab: {}, logs: {}, queries: [], messages: [] })

export function modelFromSnapshot(snapshot: LiveSnapshot): LiveModel {
  return (snapshot.runs ?? []).reduce(
    (model, run) => withRun(model, run),
    (snapshot.sessions ?? []).reduce((model, session) => withSession(model, session), emptyModel()),
  )
}

function withSession(model: LiveModel, session: LiveSession): LiveModel {
  const known = session.id in model.sessions
  return { ...model, sessions: { ...model.sessions, [session.id]: session }, order: known ? model.order : [...model.order, session.id] }
}

function withRun(model: LiveModel, run: RequestRun): LiveModel {
  const known = run.id in model.runs
  const runOrder = known ? model.runOrder : [...model.runOrder, run.id].slice(-MAX_UI_RUNS)
  const runs = known ? { ...model.runs, [run.id]: run } : Object.fromEntries(runOrder.map((id) => [id, id === run.id ? run : model.runs[id]]))
  const runByTab = run.tabId ? { ...model.runByTab, [run.tabId]: latestForTab(model, run) } : model.runByTab
  return { ...model, runs, runOrder, runByTab }
}

/** A late update of an old run never replaces the tab's newer run. */
function latestForTab(model: LiveModel, run: RequestRun): string {
  const current = run.tabId ? model.runs[model.runByTab[run.tabId] ?? ''] : undefined
  return current && current.id !== run.id && timeOf(current.startedAt) > timeOf(run.startedAt) ? current.id : run.id
}

export function applyLiveEvent(model: LiveModel, event: LiveEvent): LiveModel {
  const payload = event.payload as never
  switch (event.type) {
    case 'service.started':
    case 'service.updated':
    case 'service.stopped':
    case 'debug.started':
    case 'debug.paused':
    case 'debug.resumed':
    case 'debug.stopped':
      return resumeRuns(withSession(model, payload as LiveSession), payload as LiveSession)
    case 'request.started':
    case 'request.updated':
    case 'request.completed':
      return withRun(model, payload as RequestRun)
    case 'breakpoint.hit':
      return withRun(model, (payload as { run: RequestRun }).run)
    case 'log.received': {
      const entries = payload as LiveLogEntry[]
      if (!entries?.length || !event.sessionId) return model
      const log = [...(model.logs[event.sessionId] ?? []), ...entries].slice(-MAX_UI_LOGS)
      return { ...model, logs: { ...model.logs, [event.sessionId]: log } }
    }
    case 'database.query':
      return { ...model, queries: [...model.queries, payload as LiveQuery].slice(-MAX_UI_ITEMS) }
    case 'kafka.produced':
      return { ...model, messages: [...model.messages, payload as LiveMessage].slice(-MAX_UI_ITEMS) }
    default:
      return model
  }
}

/** The backend puts paused requests back in flight on resume without an event per request. */
function resumeRuns(model: LiveModel, session: LiveSession): LiveModel {
  if (session.state === 'paused') return model
  const paused = model.runOrder.filter((id) => model.runs[id]?.sessionId === session.id && model.runs[id].state === 'paused')
  if (paused.length === 0) return model
  const runs = { ...model.runs }
  for (const id of paused) runs[id] = { ...runs[id], state: session.endedAt ? 'error' : 'sent' }
  return { ...model, runs }
}

export const liveSessions = (model: LiveModel) => model.order.map((id) => model.sessions[id]).filter((s) => s && !s.endedAt)

/** The session the global debug bar follows: a paused one first, then the newest debugged, then the newest running. */
export function primarySession(model: LiveModel, preferredId?: string | null): LiveSession | null {
  const live = liveSessions(model)
  if (preferredId) {
    const preferred = live.find((s) => s.id === preferredId)
    if (preferred) return preferred
  }
  const newest = (list: LiveSession[]) => list.reduce<LiveSession | null>((best, s) => (!best || timeOf(s.startedAt) > timeOf(best.startedAt) ? s : best), null)
  return newest(live.filter((s) => s.state === 'paused')) ?? newest(live.filter((s) => s.kind === 'debug')) ?? newest(live)
}

export const baseUrlFor = (session: LiveSession) => (session.port ? `http://localhost:${session.port}` : '')

/** Where requests to a service go: its local live session, or a fixed URL (Docker, DEV…). */
export interface ServiceTarget { kind: 'local' | 'docker' | 'remote'; url?: string; label?: string }

/** `{{service:users-service}}` resolves to the selected target of that service. */
export function serviceVars(model: LiveModel, targets: Record<string, ServiceTarget>): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const session of liveSessions(model)) {
    if (session.port && !(`service:${session.service}` in vars)) vars[`service:${session.service}`] = baseUrlFor(session)
  }
  for (const [service, target] of Object.entries(targets)) {
    if (target.kind !== 'local' && target.url) vars[`service:${service}`] = target.url.replace(/\/+$/, '')
  }
  return vars
}

const SERVICE_VAR = /\{\{\s*service:([^}\s]+)\s*\}\}/

/** The service a request is linked to through `{{service:name}}`, if any. */
export function linkedService(url: string): string | null {
  return SERVICE_VAR.exec(url)?.[1] ?? null
}

/** Port of a loopback URL, or 0. */
export function loopbackPort(raw: string): number {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return 0
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) return 0
    if (url.port) return Number(url.port)
    return url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80
  } catch {
    return 0
  }
}

/** The live session a resolved URL talks to, preferring the linked service. */
export function sessionForRequest(model: LiveModel, rawUrl: string, resolvedUrl: string): LiveSession | null {
  const live = liveSessions(model)
  const service = linkedService(rawUrl)
  const port = loopbackPort(resolvedUrl)
  const byPort = port ? live.filter((s) => s.port === port) : []
  if (byPort.length) return byPort.reduce((a, b) => (timeOf(b.startedAt) > timeOf(a.startedAt) ? b : a))
  if (service) {
    const byService = live.filter((s) => s.service === service)
    if (byService.length) return byService.reduce((a, b) => (timeOf(b.startedAt) > timeOf(a.startedAt) ? b : a))
  }
  return null
}

export function runForTab(model: LiveModel, tabId: string): RequestRun | null {
  const id = model.runByTab[tabId]
  return id ? model.runs[id] ?? null : null
}

export function logsForRun(model: LiveModel, run: RequestRun): LiveLogEntry[] {
  return (model.logs[run.sessionId] ?? []).filter((entry) => entry.requestRunId === run.id)
}

export function codePathFor(run: RequestRun): string[] {
  const files: string[] = []
  for (const hit of run.hits) {
    for (const frame of [...(hit.stack ?? [])].reverse()) {
      const file = frame.relativePath
      if (file && !file.startsWith('..') && !files.includes(file)) files.push(file)
    }
  }
  return files
}

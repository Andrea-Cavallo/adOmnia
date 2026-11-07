import { create } from 'zustand'
import type { ApiCodeLink } from '@/lib/api-code-link/types'
import type { LiveQuery, LiveSession, RequestRun, RunState } from '@/lib/devsession-api'

/**
 * Workspace Focus: what the developer is working on across the split — project, service, route,
 * handler, request, live run and query. It is derived from the stores that own each piece (API ↔
 * code link, active request tab, Live Session), never copied, so it cannot drift from them.
 *
 * Identity rule: a piece joins the focus only when it belongs to the same parent. A route linked to
 * another tab, a service of another project or a query of another run is left out, so a navigation
 * never mixes project A's handler with project B's request.
 */
export interface WorkspaceFocus {
  /** Code Studio session: the project identity. */
  sessionId?: string
  /** Live service of that project, when one runs or debugs it. */
  service?: { id: string; name: string; kind: LiveSession['kind']; paused: boolean }
  route?: { id?: string; method: string; path: string }
  handler?: { file: string; line: number; name?: string }
  requestTabId?: string
  run?: { id: string; state: RunState; method: string; url: string; status?: number }
  query?: { id: string; sql: string; datasource?: string }
  /** The linked handler changed after a rescan. */
  stale?: boolean
}

export interface FocusSources {
  link: ApiCodeLink | null
  linkStale: boolean
  activeTabId: string | null
  runs: Record<string, RequestRun>
  runByTab: Record<string, string>
  sessions: Record<string, LiveSession>
  queries: LiveQuery[]
  selectedQueryId: string | null
}

export function deriveFocus(sources: FocusSources): WorkspaceFocus {
  const { link, activeTabId } = sources
  // The link speaks for the request on screen only when it is about that tab (or no tab at all).
  const linkApplies = !!link && (!link.requestTabId || !activeTabId || link.requestTabId === activeTabId)
  const requestTabId = activeTabId ?? (linkApplies ? link?.requestTabId : undefined) ?? undefined
  const runId = requestTabId ? sources.runByTab[requestTabId] : undefined
  const run = runId ? sources.runs[runId] : undefined
  const live = run ? sources.sessions[run.sessionId] : undefined
  const sessionId = linkApplies ? link?.sessionId : live?.goSessionId
  const focus: WorkspaceFocus = { requestTabId, sessionId }
  if (linkApplies && link) {
    focus.route = { id: link.routeId || undefined, method: link.method, path: link.path }
    if (link.file) focus.handler = { file: link.file, line: link.line, name: link.handler || undefined }
    if (sources.linkStale) focus.stale = true
  }
  // A run of another project is not this request's run: it would mix two identities.
  if (run && (!sessionId || live?.goSessionId === sessionId)) {
    focus.run = { id: run.id, state: run.state, method: run.method, url: run.url, status: run.status }
    if (live) focus.service = { id: live.id, name: live.service, kind: live.kind, paused: !!live.pause }
    const query = sources.queries.find((item) => item.id === sources.selectedQueryId && item.requestRunId === run.id)
    if (query) focus.query = { id: query.id, sql: query.sql, datasource: query.datasource }
  }
  return focus
}

/** One line for the split header: `service · GET /orders/:id · paused`. */
export function describeFocus(focus: WorkspaceFocus): string {
  const parts: string[] = []
  if (focus.service) parts.push(focus.service.name)
  if (focus.route) parts.push(`${focus.route.method} ${focus.route.path}`)
  else if (focus.run) parts.push(`${focus.run.method} ${requestPath(focus.run.url)}`)
  if (focus.handler?.name) parts.push(`${focus.handler.name}()`)
  if (focus.run) parts.push(focus.run.state === 'paused' ? 'paused at breakpoint' : focus.run.status ? String(focus.run.status) : focus.run.state)
  if (focus.query) parts.push('query')
  return parts.join(' · ')
}

/** Path of a request URL, for labels; a URL with {{vars}} that does not parse keeps its own text. */
export function requestPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.replace(/^[a-z]+:\/\/[^/]+/i, '') || url
  }
}

interface WorkspaceFocusState {
  /** The query picked from a live run; it joins the focus only while that run is the focused one. */
  selectedQueryId: string | null
  selectQuery: (id: string | null) => void
}

export const useWorkspaceFocusStore = create<WorkspaceFocusState>((set) => ({
  selectedQueryId: null,
  selectQuery: (id) => set({ selectedQueryId: id }),
}))

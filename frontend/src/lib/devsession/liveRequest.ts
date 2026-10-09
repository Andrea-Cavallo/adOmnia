import { CORRELATION_HEADER, beginLiveRequest, endLiveRequest, type LiveSession } from '@/lib/devsession-api'
import { substVars } from '@/lib/substVars'
import { uid, type RequestItem, type ResponseData } from '@/lib/types'
import { useDevSessionStore } from '@/stores/devSession'
import { traceparentFor } from './traceparent'
import { serviceVars, sessionForRequest } from '@/stores/devSessionModel'

/** A request stopped at a breakpoint must not time out: the developer is stepping through it. */
export const DEBUG_REQUEST_TIMEOUT_MS = 30 * 60 * 1000

export interface LiveSend {
  request: RequestItem
  vars: Record<string, string>
  runId: string | null
  session: LiveSession | null
}

/** Variables every request sees: the environment plus `{{service:name}}` of the known services. */
export function liveVars(vars: Record<string, string>): Record<string, string> {
  const state = useDevSessionStore.getState()
  return { ...vars, ...serviceVars(state, state.prefs.targets) }
}

export function withHeader(request: RequestItem, key: string, value: string): RequestItem {
  const exists = request.headers.some((header) => header.enabled && header.key.trim().toLowerCase() === key.toLowerCase())
  if (exists) return request
  return { ...request, headers: [...request.headers, { id: uid(), key, value, enabled: true }] }
}

/**
 * Registers the request with the live session it targets (if any), adds the
 * correlation header and, under a debugger, lifts the timeout.
 */
export async function prepareLiveSend(tabId: string, request: RequestItem, vars: Record<string, string>, sessionId?: string): Promise<LiveSend> {
  const allVars = liveVars(vars)
  const state = useDevSessionStore.getState()
  const resolvedUrl = substVars(request.url, allVars)
  const session = sessionId ? state.sessions[sessionId] ?? null : sessionForRequest(state, request.url, resolvedUrl)
  const plain: LiveSend = { request, vars: allVars, runId: null, session: null }
  if (!session || session.endedAt) return plain
  let runId = ''
  let correlationId = ''
  try {
    const run = await beginLiveRequest({ sessionId: session.id, tabId, name: request.name, method: request.method, url: resolvedUrl })
    runId = run.id
    correlationId = run.correlationId
    if (run.id) useDevSessionStore.getState().apply({ type: 'request.started', sessionId: session.id, payload: run })
  } catch {
    return plain
  }
  if (!runId) return plain
  let live = request
  if (state.prefs.correlationHeader) live = withHeader(withHeader(live, CORRELATION_HEADER, correlationId), 'traceparent', traceparentFor(correlationId))
  if (session.kind === 'debug') live = { ...live, timeout: Math.max(request.timeout ?? 0, DEBUG_REQUEST_TIMEOUT_MS) }
  return { request: live, vars: allVars, runId, session }
}

export async function finishLiveSend(send: LiveSend, response: ResponseData): Promise<void> {
  if (!send.runId) return
  try {
    const run = await endLiveRequest(send.runId, response.status, Math.round(response.ms ?? 0), response.error ? `${response.error.code}: ${response.error.message}` : '')
    useDevSessionStore.getState().apply({ type: 'request.completed', sessionId: run.sessionId, payload: run })
  } catch {
    // The run was pruned: nothing left to update.
  }
}

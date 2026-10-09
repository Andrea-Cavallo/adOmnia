import { waitLiveReady, type LiveSession } from '@/lib/devsession-api'
import { useDevSessionStore } from '@/stores/devSession'
import { sessionForRequest } from '@/stores/devSessionModel'
import { requestPath, routeMatches } from './routeMatch'
import { ensureDebugSession } from './debugRequest'
import { openLocationInGoStudio } from './navigation'

const READY_TIMEOUT_MS = 60_000

export interface WebSocketHandler {
  session: LiveSession
  /** Function that upgrades the connection, and where (the Upgrade/Accept call). */
  handler: string
  relativePath: string
  line: number
  path: string
}

/** The Go handler serving a WebSocket URL on a live service, from the project scan (devcontext). */
export async function websocketHandlerFor(url: string): Promise<WebSocketHandler | null> {
  const session = sessionForRequest(useDevSessionStore.getState(), url, url)
  if (!session?.goSessionId) return null
  const { useDevContextStore } = await import('@/stores/devcontext')
  await useDevContextStore.getState().ensure(session.goSessionId).catch(() => undefined)
  const servers = (useDevContextStore.getState().snapshots[session.goSessionId]?.entities ?? []).filter((entity) => entity.kind === 'websocket' && entity.attrs.role === 'server')
  const pathname = requestPath(url.replace(/^ws/i, 'http')) ?? ''
  const match = servers.find((entity) => entity.attrs.path && routeMatches(entity.attrs.path, pathname)) ?? (servers.length === 1 && !servers[0].attrs.path ? servers[0] : undefined)
  const source = match?.sources[0]
  if (!match || !source) return null
  return { session, handler: match.attrs.handler ?? match.label, relativePath: source.file, line: source.line, path: match.attrs.path ?? '' }
}

export function openWebSocketHandler(target: WebSocketHandler): Promise<boolean> {
  return openLocationInGoStudio(target.session.goSessionId, { function: target.handler, relativePath: target.relativePath, line: target.line })
}

/**
 * Debug handler: a breakpoint on the upgrade, the service under Delve (restarted after confirmation),
 * ready to accept the connection that will stop there.
 */
export async function debugWebSocketHandler(target: WebSocketHandler, progress: (message: string) => void): Promise<LiveSession> {
  const { useGoIDEDebugStore } = await import('@/stores/goideDebug')
  const debug = useGoIDEDebugStore.getState()
  if (!(debug.breakpoints[target.session.goSessionId]?.[target.relativePath] ?? []).some((item) => item.line === target.line)) {
    await debug.toggleBreakpoint(target.session.goSessionId, target.relativePath, target.line)
  }
  const session = await ensureDebugSession(target.session, target.session.service, progress)
  progress(`Waiting for ${session.service}…`)
  await waitLiveReady(session.id, useDevSessionStore.getState().prefs.healthPaths[session.service] ?? '', READY_TIMEOUT_MS)
  return session
}

export interface LiveWebSocketRun {
  runId: string
  sessionId: string
  service: string
  correlationId: string
  /** Sent with the handshake: the service can log them, OpenTelemetry propagates traceparent. */
  headers: Record<string, string>
}

/**
 * A WebSocket connection to a live service is a request run like an HTTP call: the handshake carries
 * the run's correlation id and traceparent, so the lines the handler logs with them are tied to it.
 */
export async function beginLiveWebSocket(url: string): Promise<LiveWebSocketRun | null> {
  const store = useDevSessionStore.getState()
  const session = sessionForRequest(store, url, url)
  if (!session || session.endedAt) return null
  const [{ beginLiveRequest, CORRELATION_HEADER }, { traceparentFor }] = await Promise.all([import('@/lib/devsession-api'), import('./traceparent')])
  const run = await beginLiveRequest({ sessionId: session.id, tabId: '', name: 'WebSocket', method: 'GET', url: url.replace(/^ws/i, 'http') })
  if (!run.id) return null
  useDevSessionStore.getState().apply({ type: 'request.started', sessionId: session.id, payload: run })
  return { runId: run.id, sessionId: session.id, service: session.service, correlationId: run.correlationId, headers: { [CORRELATION_HEADER]: run.correlationId, traceparent: traceparentFor(run.correlationId) } }
}

/** Handshake outcome: 101 when the connection opened. */
export async function endLiveWebSocket(run: LiveWebSocketRun, opened: boolean, durationMs: number, error = ''): Promise<void> {
  try {
    const { endLiveRequest } = await import('@/lib/devsession-api')
    const done = await endLiveRequest(run.runId, opened ? 101 : 0, Math.round(durationMs), error)
    useDevSessionStore.getState().apply({ type: 'request.completed', sessionId: done.sessionId, payload: done })
  } catch {
    // The run was pruned: nothing to update.
  }
}

/** The connection's log lines (and the service's stream) in the Log Inspector. */
export async function openWebSocketLogs(run: LiveWebSocketRun): Promise<void> {
  const [{ streamSessionToLogInspector }, { requestLogInspectorQuery }, { showModule }] = await Promise.all([import('./logInspectorSource'), import('@/lib/loginspector/handoff'), import('@/lib/moduleRouting')])
  streamSessionToLogInspector(run.sessionId, run.service)
  requestLogInspectorQuery(run.correlationId)
  showModule('loginspector')
}

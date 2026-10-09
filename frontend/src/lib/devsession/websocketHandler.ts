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

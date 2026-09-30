import { serviceNameFor, stopLiveSession, waitLiveReady, type LiveSession } from '@/lib/devsession-api'
import { substVars } from '@/lib/substVars'
import type { RequestItem } from '@/lib/types'
import { confirm } from '@/lib/confirmDialog'
import { useAppStore } from '@/stores/app'
import { useDevSessionStore } from '@/stores/devSession'
import { baseUrlFor, linkedService, liveSessions, sessionForRequest } from '@/stores/devSessionModel'
import { liveVars } from './liveRequest'

const START_TIMEOUT_MS = 120_000
const READY_TIMEOUT_MS = 60_000

/** Detail of the `adomnia:go-debug-start` event Go Studio answers. */
export interface GoDebugStartDetail {
  goSessionId: string
  handled: boolean
  done?: (error?: string) => void
}

export class DebugRequestError extends Error {}

/** The gO project behind a service name, or the active project when the request is not linked. */
async function findGoSession(service: string | null): Promise<string | null> {
  const { useGoIDEStore } = await import('@/stores/goide')
  const goide = useGoIDEStore.getState()
  if (!goide.initialized) await goide.initialize()
  const sessions = useGoIDEStore.getState().sessions
  if (service) {
    for (const session of sessions) {
      if ((await serviceNameFor(session.id).catch(() => '')) === service) return session.id
    }
    return null
  }
  return useGoIDEStore.getState().activeSessionId ?? (sessions.length === 1 ? sessions[0].id : null)
}

/** Asks Go Studio to start its active Debug configuration, mounting it (hidden) when never opened. */
export async function startGoDebug(goSessionId: string): Promise<void> {
  const deadline = Date.now() + 15_000
  useAppStore.getState().keepPanel('goide')
  while (Date.now() < deadline) {
    const outcome = await new Promise<string | null | undefined>((resolve) => {
      const detail: GoDebugStartDetail = { goSessionId, handled: false, done: (error) => resolve(error ?? null) }
      document.dispatchEvent(new CustomEvent('adomnia:go-debug-start', { detail }))
      if (!detail.handled) resolve(undefined)
    })
    if (outcome === null) return
    if (typeof outcome === 'string') throw new DebugRequestError(outcome)
    await new Promise((resolve) => setTimeout(resolve, 150)) // Go Studio is still mounting
  }
  throw new DebugRequestError('Go Studio did not start: open the project there and press Debug.')
}

/** Resolves once a live debug session of the project exists, or fails if it errors out. */
function waitForDebugSession(goSessionId: string, since: string): Promise<LiveSession> {
  return new Promise((resolve, reject) => {
    const pick = () => {
      const state = useDevSessionStore.getState()
      const sessions = state.order.map((id) => state.sessions[id]).filter((s) => s && s.goSessionId === goSessionId && s.kind === 'debug' && s.startedAt >= since)
      const failed = sessions.find((s) => s.state === 'error')
      if (failed) return { error: failed.error || 'the debugger stopped' }
      const live = sessions.find((s) => !s.endedAt && s.state !== 'starting')
      return live ? { session: live } : null
    }
    const settle = (result: ReturnType<typeof pick>) => {
      if (!result) return false
      unsubscribe()
      window.clearTimeout(timer)
      if ('error' in result) reject(new DebugRequestError(result.error))
      else resolve(result.session)
      return true
    }
    const unsubscribe = useDevSessionStore.subscribe(() => { settle(pick()) })
    const timer = window.setTimeout(() => { unsubscribe(); reject(new DebugRequestError('The debugger did not start in time.')) }, START_TIMEOUT_MS)
    settle(pick())
  })
}

/** Replaces the origin of a request URL with the live service, keeping path and query. */
export function retarget(url: string, vars: Record<string, string>, baseUrl: string): string {
  const resolved = substVars(url, vars)
  try {
    const parsed = new URL(resolved)
    return `${baseUrl}${parsed.pathname}${parsed.search}`
  } catch {
    const path = url.replace(/^\s*(?:\{\{[^}]+\}\}|[a-z]+:\/\/[^/]+)/i, '')
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }
}

/**
 * One click: find or start the service under Delve, wait until it listens,
 * then hand the request (pointed at that service) back to the sender.
 */
export async function prepareDebugRequest(tabId: string, request: RequestItem, envVars: Record<string, string>): Promise<{ request: RequestItem; session: LiveSession; retargeted: boolean }> {
  const store = useDevSessionStore.getState()
  const progress = (step: 'service' | 'debugger' | 'ready' | 'sending', message: string) => store.setProgress(tabId, { step, message })
  const vars = liveVars(envVars)
  const service = linkedService(request.url)
  progress('service', service ? `Looking for ${service}…` : 'Looking for the service…')
  let session = sessionForRequest(useDevSessionStore.getState(), request.url, substVars(request.url, vars))
  if (!session && service) session = liveSessions(useDevSessionStore.getState()).find((s) => s.service === service) ?? null

  if (!session || session.kind !== 'debug') {
    const goSessionId = session?.goSessionId ?? await findGoSession(service)
    if (!goSessionId) {
      throw new DebugRequestError(service
        ? `Open the ${service} project in Go Studio to debug this request.`
        : 'Open the Go project in Go Studio (or link the request with {{service:name}}) to debug it.')
    }
    if (session) {
      const restart = await confirm({
        title: `Restart ${session.service} with the debugger?`,
        message: `${session.service} is running without Delve. adOmnia will stop it and start the active Debug configuration.`,
        confirmLabel: 'Restart with debugger',
      })
      if (!restart) throw new DebugRequestError('Debug Request cancelled.')
      await stopLiveSession(session.id)
    }
    const since = new Date(Date.now() - 1000).toISOString()
    progress('debugger', `Starting ${service ?? 'the service'} with Delve…`)
    await startGoDebug(goSessionId)
    session = await waitForDebugSession(goSessionId, since)
  }

  progress('ready', session.port ? `Waiting for ${session.service} on :${session.port}…` : `Waiting for ${session.service} to open its port…`)
  await waitLiveReady(session.id, READY_TIMEOUT_MS)
  const ready = useDevSessionStore.getState().sessions[session.id] ?? session
  const base = baseUrlFor(ready)
  const matches = sessionForRequest(useDevSessionStore.getState(), request.url, substVars(request.url, vars))?.id === ready.id
  progress('sending', `Sending to ${ready.service}…`)
  return matches
    ? { request, session: ready, retargeted: false }
    : { request: { ...request, url: retarget(request.url, vars, base) }, session: ready, retargeted: true }
}

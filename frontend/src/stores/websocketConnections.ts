/**
 * The live WebSocket connections of the API workspace, one per request tab. The backend sidecar
 * holds the socket: POST /ws/connect opens a session, /ws/stream (server-sent events) delivers
 * its frames, /ws/send, /ws/ping and /ws/disconnect act on it. A tab keeps its frames while it is
 * open; closing the tab closes its connection.
 */
import { create } from 'zustand'
import { getServerPort, getSidecarToken, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { beginLiveWebSocket, endLiveWebSocket, type LiveWebSocketRun } from '@/lib/devsession/websocketHandler'
import { safeEval } from '@/lib/safeEval'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { connectPayload, outgoingPayload, wsSettings } from '@/lib/websocket/wsRequest'
import type { RequestItem, WebSocketPayloadMode } from '@/lib/types'

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export type WsDirection = 'inbound' | 'outbound' | 'system'
export interface WsFrame {
  id: string
  type: 'message' | 'ping' | 'pong' | 'close' | 'error'
  direction: WsDirection
  content: string
  timestamp: number
  binary?: boolean
  /** Set for frames of the extra parallel clients (#2, #3…). */
  client?: string
}
export interface WsConnection {
  status: WsStatus
  sessionId: string | null
  /** The URL the session was opened on, variables resolved. */
  url: string
  frames: WsFrame[]
  paused: boolean
  /** Frames that arrived while paused, shown on resume. */
  queued: WsFrame[]
  extraClients: string[]
  connectedAt: number | null
  live: LiveWebSocketRun | null
}

export const MAX_FRAMES = 700
const MAX_QUEUED = 200
export const MAX_RECONNECT_ATTEMPTS = 10
export const MAX_EXTRA_CLIENTS = 50
export const MAX_PARALLEL_COPIES = 500

interface Runtime {
  stream: EventSource | null
  extras: Array<{ label: string; sessionId: string; stream: EventSource }>
  reconnect: ReturnType<typeof setTimeout> | null
  attempts: number
  manual: boolean
  /** The request the connection was opened with, for reconnects and the On Message script. */
  request: RequestItem | null
  vars: Record<string, string>
}
const runtimes = new Map<string, Runtime>()
const runtimeOf = (tabId: string): Runtime => {
  let runtime = runtimes.get(tabId)
  if (!runtime) {
    runtime = { stream: null, extras: [], reconnect: null, attempts: 0, manual: false, request: null, vars: {} }
    runtimes.set(tabId, runtime)
  }
  return runtime
}

const frameId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
export const emptyConnection = (): WsConnection => ({
  status: 'disconnected', sessionId: null, url: '', frames: [], paused: false, queued: [], extraClients: [], connectedAt: null, live: null,
})

interface StreamEvent { type?: string; direction?: string; content?: string; timestamp?: number; binary?: boolean }
const toFrame = (event: StreamEvent, client?: string): WsFrame => ({
  id: frameId(),
  type: (event.type as WsFrame['type']) || 'message',
  direction: (event.direction as WsDirection) || 'system',
  content: event.content ?? '',
  timestamp: event.timestamp || Date.now(),
  binary: event.binary,
  client,
})

interface WsConnectionsState {
  connections: Record<string, WsConnection>
  connect: (tabId: string, request: RequestItem, vars: Record<string, string>) => Promise<void>
  disconnect: (tabId: string) => Promise<void>
  /** Sends one message; returns an error to show, or null. */
  send: (tabId: string, raw: string, mode: WebSocketPayloadMode, vars: Record<string, string>) => Promise<string | null>
  ping: (tabId: string) => Promise<void>
  clear: (tabId: string) => void
  setPaused: (tabId: string, paused: boolean) => void
  openExtraClients: (tabId: string, count: number) => Promise<void>
  closeExtraClients: (tabId: string) => Promise<void>
  sendParallel: (tabId: string, commands: string[], copies: number, mode: WebSocketPayloadMode, vars: Record<string, string>) => Promise<void>
  /** Closes the connection of a tab that goes away and forgets it. */
  forget: (tabId: string) => void
}

export const useWsConnections = create<WsConnectionsState>((set, get) => {
  const patch = (tabId: string, change: Partial<WsConnection> | ((current: WsConnection) => Partial<WsConnection>)) => {
    set((state) => {
      const current = state.connections[tabId] ?? emptyConnection()
      const next = { ...current, ...(typeof change === 'function' ? change(current) : change) }
      return { connections: { ...state.connections, [tabId]: next } }
    })
    publishRunning(get().connections)
  }
  const add = (tabId: string, frame: WsFrame) => patch(tabId, (current) => (
    current.paused && frame.direction !== 'system'
      ? { queued: [...current.queued, frame].slice(-MAX_QUEUED) }
      : { frames: [...current.frames, frame].slice(-MAX_FRAMES) }
  ))
  const system = (tabId: string, content: string, type: WsFrame['type'] = 'message') => add(tabId, toFrame({ type, direction: 'system', content }))

  const post = async (path: string, body: unknown): Promise<Response | null> => {
    const port = await getServerPort()
    if (!port) return null
    return sidecarFetch(serverUrl(port, path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }
  const openSession = async (request: RequestItem, vars: Record<string, string>, extraHeaders: Record<string, string> = {}): Promise<{ sessionId?: string; error?: string }> => {
    const response = await post('/ws/connect', connectPayload(request, vars, extraHeaders))
    if (!response) return { error: 'The local server is not ready yet.' }
    return response.json() as Promise<{ sessionId?: string; error?: string }>
  }
  const streamFor = async (sessionId: string): Promise<EventSource | null> => {
    const port = await getServerPort()
    if (!port) return null
    const token = await getSidecarToken()
    return new EventSource(serverUrl(port, `/ws/stream?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`))
  }

  const scheduleReconnect = (tabId: string) => {
    const runtime = runtimeOf(tabId)
    const request = runtime.request
    if (!request || runtime.manual) return
    const settings = wsSettings(request)
    if (!settings.autoReconnect || runtime.attempts >= MAX_RECONNECT_ATTEMPTS) return
    runtime.attempts += 1
    patch(tabId, { status: 'reconnecting' })
    system(tabId, `Reconnecting in ${settings.reconnectDelay}s (${runtime.attempts}/${MAX_RECONNECT_ATTEMPTS})`)
    runtime.reconnect = setTimeout(() => { void get().connect(tabId, request, runtime.vars) }, settings.reconnectDelay * 1000)
  }

  const runScript = (tabId: string, frame: WsFrame) => {
    const script = runtimeOf(tabId).request?.ws?.onMessageScript?.trim()
    if (!script || frame.direction !== 'inbound' || frame.type !== 'message') return
    void safeEval(script, { msg: { ...frame } })
      .then((result) => { if (result !== undefined) system(tabId, `Script → ${typeof result === 'string' ? result : JSON.stringify(result)}`) })
      .catch((error: unknown) => system(tabId, `Script error: ${String(error)}`, 'error'))
  }

  const listen = (tabId: string, stream: EventSource) => {
    stream.onmessage = (event: MessageEvent<string>) => {
      let frame: WsFrame
      try {
        frame = toFrame(JSON.parse(event.data) as StreamEvent)
      } catch {
        system(tabId, 'Malformed stream event received.', 'error')
        return
      }
      add(tabId, frame)
      runScript(tabId, frame)
      if (frame.type === 'close' || frame.type === 'error') {
        stream.close()
        patch(tabId, { sessionId: null, status: frame.type === 'error' ? 'error' : 'disconnected', connectedAt: null })
        scheduleReconnect(tabId)
      }
    }
    stream.onerror = () => {
      stream.close()
      if (get().connections[tabId]?.status !== 'connected') return
      patch(tabId, { sessionId: null, status: 'disconnected', connectedAt: null })
      scheduleReconnect(tabId)
    }
  }

  return {
    connections: {},

    connect: async (tabId, request, vars) => {
      const runtime = runtimeOf(tabId)
      runtime.manual = false
      runtime.request = request
      runtime.vars = vars
      if (runtime.reconnect) clearTimeout(runtime.reconnect)
      runtime.stream?.close()
      const url = connectPayload(request, vars).url
      patch(tabId, { status: runtime.attempts > 0 ? 'reconnecting' : 'connecting', url })
      system(tabId, `${runtime.attempts > 0 ? 'Reconnecting' : 'Connecting'} to ${url}`)
      try {
        // A live Go service: the handshake carries the run's ids, so its log lines are tied to this connection.
        const live = await beginLiveWebSocket(url).catch(() => null)
        const started = performance.now()
        const data = await openSession(request, vars, live?.headers)
        if (live) void endLiveWebSocket(live, !!data.sessionId && !data.error, performance.now() - started, data.error ?? '')
        if (data.error || !data.sessionId) {
          patch(tabId, { status: 'error', live: null })
          system(tabId, data.error ?? 'No session returned', 'error')
          return
        }
        runtime.attempts = 0
        patch(tabId, { status: 'connected', sessionId: data.sessionId, connectedAt: Date.now(), live: live ?? null })
        system(tabId, `Connected to ${url}`)
        const stream = await streamFor(data.sessionId)
        if (!stream) return
        runtime.stream = stream
        listen(tabId, stream)
      } catch (error) {
        patch(tabId, { status: 'error' })
        system(tabId, String(error), 'error')
      }
    },

    disconnect: async (tabId) => {
      const runtime = runtimeOf(tabId)
      runtime.manual = true
      runtime.attempts = 0
      if (runtime.reconnect) clearTimeout(runtime.reconnect)
      runtime.stream?.close()
      runtime.stream = null
      const sessionId = get().connections[tabId]?.sessionId
      if (sessionId) await post('/ws/disconnect', { sessionId }).catch(() => null)
      patch(tabId, { status: 'disconnected', sessionId: null, connectedAt: null, live: null })
      system(tabId, 'Disconnected', 'close')
      await get().closeExtraClients(tabId)
    },

    send: async (tabId, raw, mode, vars) => {
      const sessionId = get().connections[tabId]?.sessionId
      if (!sessionId) return 'Not connected'
      const body: Record<string, string> = { sessionId, content: outgoingPayload(raw, mode, vars) }
      if (mode === 'binary') body.messageType = 'binary'
      try {
        const response = await post('/ws/send', body)
        if (!response) return 'The local server is not ready yet.'
        const data = await response.json() as { error?: string }
        return data.error ? String(data.error) : null
      } catch (error) {
        return String(error)
      }
    },

    ping: async (tabId) => {
      const sessionId = get().connections[tabId]?.sessionId
      if (!sessionId) return
      await post('/ws/ping', { sessionId }).catch((error: unknown) => system(tabId, String(error), 'error'))
    },

    clear: (tabId) => patch(tabId, { frames: [], queued: [] }),

    setPaused: (tabId, paused) => patch(tabId, (current) => (
      paused ? { paused } : { paused, frames: [...current.frames, ...current.queued].slice(-MAX_FRAMES), queued: [] }
    )),

    // Opens `count` more sessions to the same URL; their frames are tagged #2, #3… in the stream.
    openExtraClients: async (tabId, count) => {
      const runtime = runtimeOf(tabId)
      if (!runtime.request) return
      const url = connectPayload(runtime.request, runtime.vars).url
      const offset = runtime.extras.length + 2
      const results = await Promise.all(Array.from({ length: Math.min(count, MAX_EXTRA_CLIENTS) }, async (_, index) => {
        const label = `#${offset + index}`
        try {
          // Every extra client is a run like the main connection, so its handshake
          // carries the same correlation id and traceparent into the service logs.
          const live = await beginLiveWebSocket(url).catch(() => null)
          const started = performance.now()
          const data = await openSession(runtime.request!, runtime.vars, live?.headers)
          if (live) void endLiveWebSocket(live, !!data.sessionId && !data.error, performance.now() - started, data.error ?? '')
          if (data.error || !data.sessionId) return `${label}: ${data.error ?? 'no session'}`
          const stream = await streamFor(data.sessionId)
          if (!stream) return `${label}: the local server is not ready`
          const sessionId = data.sessionId
          const drop = () => {
            stream.close()
            runtime.extras = runtime.extras.filter((client) => client.sessionId !== sessionId)
            patch(tabId, { extraClients: runtime.extras.map((client) => client.label) })
          }
          stream.onmessage = (event: MessageEvent<string>) => {
            try {
              const frame = toFrame(JSON.parse(event.data) as StreamEvent, label)
              add(tabId, frame)
              if (frame.type === 'close' || frame.type === 'error') drop()
            } catch {
              system(tabId, `${label}: malformed stream event received.`, 'error')
            }
          }
          stream.onerror = drop
          return { label, sessionId, stream }
        } catch (error) {
          return `${label}: ${String(error)}`
        }
      }))
      const opened = results.filter((result): result is { label: string; sessionId: string; stream: EventSource } => typeof result !== 'string')
      const failed = results.filter((result): result is string => typeof result === 'string')
      runtime.extras = [...runtime.extras, ...opened]
      patch(tabId, { extraClients: runtime.extras.map((client) => client.label) })
      system(tabId, `Opened ${opened.length}/${results.length} extra clients${failed.length ? ` — ${failed[0]}` : ''}`, failed.length ? 'error' : 'message')
    },

    closeExtraClients: async (tabId) => {
      const runtime = runtimeOf(tabId)
      const clients = runtime.extras
      if (!clients.length) return
      runtime.extras = []
      clients.forEach((client) => client.stream.close())
      await Promise.all(clients.map((client) => post('/ws/disconnect', { sessionId: client.sessionId }).catch(() => null)))
      patch(tabId, { extraClients: [] })
      system(tabId, `Closed ${clients.length} extra client${clients.length === 1 ? '' : 's'}`, 'close')
    },

    // Every command `copies` times, at once, on the main connection and every extra client. {{$i}} is the send index.
    sendParallel: async (tabId, commands, copies, mode, vars) => {
      const main = get().connections[tabId]?.sessionId
      if (!main || !commands.length) return
      const sessions = [main, ...runtimeOf(tabId).extras.map((client) => client.sessionId)]
      const jobs = sessions.flatMap((sessionId) => commands.flatMap((command) => Array.from({ length: Math.min(copies, MAX_PARALLEL_COPIES) }, () => ({ sessionId, command }))))
      const started = performance.now()
      const results = await Promise.all(jobs.map(async (job, index) => {
        const body: Record<string, string> = { sessionId: job.sessionId, content: outgoingPayload(job.command, mode, { ...vars, $i: String(index + 1) }) }
        if (mode === 'binary') body.messageType = 'binary'
        try {
          const response = await post('/ws/send', body)
          const data = response ? await response.json() as { error?: string } : { error: 'not ready' }
          return data.error ?? null
        } catch (error) {
          return String(error)
        }
      }))
      const failed = results.filter(Boolean)
      const elapsed = Math.round(performance.now() - started)
      system(tabId, `Parallel send: ${jobs.length - failed.length}/${jobs.length} ok (${commands.length} × ${copies} × ${sessions.length} client${sessions.length === 1 ? '' : 's'}) in ${elapsed} ms${failed.length ? ` — first error: ${failed[0]}` : ''}`, failed.length ? 'error' : 'message')
    },

    forget: (tabId) => {
      const runtime = runtimes.get(tabId)
      runtimes.delete(tabId)
      if (runtime) {
        runtime.manual = true
        if (runtime.reconnect) clearTimeout(runtime.reconnect)
        runtime.stream?.close()
        runtime.extras.forEach((client) => {
          client.stream.close()
          void post('/ws/disconnect', { sessionId: client.sessionId }).catch(() => null)
        })
      }
      const sessionId = get().connections[tabId]?.sessionId
      if (sessionId) void post('/ws/disconnect', { sessionId }).catch(() => null)
      set((state) => {
        const { [tabId]: _gone, ...rest } = state.connections
        return { connections: rest }
      })
      publishRunning(get().connections)
    },
  }
})

/** The status bar shows a WebSocket indicator while any tab is connected. */
function publishRunning(connections: Record<string, WsConnection>) {
  const running = Object.values(connections).some((connection) => connection.status === 'connected')
  if (useAppStore.getState().websocketRunning !== running) useAppStore.getState().setWebsocketRunning(running)
}

/** Splits a parallel draft into commands: a line holding only `---` separates them. */
export const splitCommands = (text: string) => text.split(/^\s*---\s*$/m).map((part) => part.trim()).filter(Boolean)

// A tab that goes away takes its connection with it, whichever action closed it.
useTabsStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return
  const open = new Set(state.tabs.map((tab) => tab.id))
  const { connections, forget } = useWsConnections.getState()
  Object.keys(connections).filter((tabId) => !open.has(tabId)).forEach((tabId) => forget(tabId))
})

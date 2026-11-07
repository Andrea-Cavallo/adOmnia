/**
 * Streaming gRPC calls of the workspace, one per tab: server streams deliver messages as they arrive; client and
 * bidi streams stay open so the next message is sent from the composer, like a WebSocket. Frames share the
 * WebSocket shape, so the same list and inspector show them.
 */
import { create } from 'zustand'
import { closeStream, sendStreamMessage, streamGrpc, type GrpcStreamEvent } from '@/lib/grpc/grpcApi'
import { grpcCallBody, grpcStatusName, normalizeGrpcStatus, parseMessages } from '@/lib/grpc/grpcRequest'
import type { GrpcRpcKind } from '@/lib/grpc/grpcSchema'
import { substJsonVars } from '@/lib/substVars'
import type { RequestItem } from '@/lib/types'
import type { WsFrame } from '@/stores/websocketConnections'
import { useTabsStore } from '@/stores/tabs'
import { useGrpcDescriptors } from '@/stores/grpcDescriptors'

export type GrpcStreamStatus = 'idle' | 'running' | 'done' | 'error'

export interface GrpcStreamState {
  status: GrpcStreamStatus
  kind: GrpcRpcKind
  frames: WsFrame[]
  /** Set while a client/bidi stream accepts more messages. */
  sessionId: string | null
  grpcStatus: string
  error: string
  startedAt: number | null
  timeMs: number
  headers: Record<string, string>
  trailers: Record<string, string>
}

const MAX_FRAMES = 1000
/** Long-lived interactive streams: the sidecar keeps them open up to 30 minutes. */
const INTERACTIVE_TIMEOUT_MS = 30 * 60 * 1000

export const idleStream = (kind: GrpcRpcKind = 'server'): GrpcStreamState => ({
  status: 'idle', kind, frames: [], sessionId: null, grpcStatus: '', error: '', startedAt: null, timeMs: 0, headers: {}, trailers: {},
})

const controllers = new Map<string, AbortController>()
let frameSeq = 0
const frame = (direction: WsFrame['direction'], content: unknown, type: WsFrame['type'] = 'message'): WsFrame => ({
  id: `g${Date.now().toString(36)}${(frameSeq += 1).toString(36)}`,
  type,
  direction,
  content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  timestamp: Date.now(),
})

interface GrpcStreamStore {
  byTab: Record<string, GrpcStreamState>
  start: (tabId: string, request: RequestItem, vars: Record<string, string>, kind: GrpcRpcKind) => Promise<void>
  /** Sends one more message on an open client/bidi stream; returns an error to show, or null. */
  send: (tabId: string, raw: string, vars: Record<string, string>) => Promise<string | null>
  /** Ends the sending side: the server sends its last replies and the status. */
  closeSend: (tabId: string) => Promise<void>
  cancel: (tabId: string) => void
  clear: (tabId: string) => void
  forget: (tabId: string) => void
}

export const useGrpcStreams = create<GrpcStreamStore>((set, get) => {
  const patch = (tabId: string, change: Partial<GrpcStreamState> | ((current: GrpcStreamState) => Partial<GrpcStreamState>)) => set((state) => {
    const current = state.byTab[tabId] ?? idleStream()
    return { byTab: { ...state.byTab, [tabId]: { ...current, ...(typeof change === 'function' ? change(current) : change) } } }
  })
  const add = (tabId: string, next: WsFrame) => patch(tabId, (current) => ({ frames: [...current.frames, next].slice(-MAX_FRAMES) }))

  const onEvent = (tabId: string, started: number) => (event: GrpcStreamEvent) => {
    if (event.type === 'session' && event.id) patch(tabId, { sessionId: event.id })
    if (event.type === 'headers') patch(tabId, { headers: event.metadata ?? {} })
    if (event.type === 'message') add(tabId, frame('inbound', event.message))
    if (event.type !== 'complete') return
    const ok = normalizeGrpcStatus(event.status ?? '') === 'ok'
    const status = grpcStatusName(event.status ?? 'UNKNOWN')
    add(tabId, frame('system', ok ? `Completed · ${status}` : `${status}: ${event.error ?? ''}`, ok ? 'close' : 'error'))
    patch(tabId, { status: ok ? 'done' : 'error', grpcStatus: status, error: event.error ?? '', sessionId: null, trailers: event.trailers ?? {}, timeMs: event.time_ms ?? Math.round(performance.now() - started) })
  }

  return {
    byTab: {},

    start: async (tabId, request, vars, kind) => {
      get().cancel(tabId)
      const interactive = kind === 'client' || kind === 'bidi'
      let body
      try {
        body = grpcCallBody(request, vars)
      } catch (error) {
        patch(tabId, { ...idleStream(kind), status: 'error', error: error instanceof Error ? error.message : String(error) })
        return
      }
      const controller = new AbortController()
      controllers.set(tabId, controller)
      const started = performance.now()
      const sent = interactive ? body.messages ?? [] : [body.payload]
      set((state) => ({ byTab: { ...state.byTab, [tabId]: { ...idleStream(kind), status: 'running', startedAt: Date.now(), frames: [frame('system', `${body.service}/${body.method} → ${body.address}`), ...sent.map((message) => frame('outbound', message))] } } }))
      try {
        await streamGrpc({ ...body, interactive, timeout_ms: interactive ? body.timeout_ms ?? INTERACTIVE_TIMEOUT_MS : body.timeout_ms }, controller.signal, onEvent(tabId, started))
      } catch (error) {
        if (controller.signal.aborted) {
          add(tabId, frame('system', 'Cancelled', 'close'))
          patch(tabId, { status: 'done', grpcStatus: 'CANCELLED', sessionId: null })
        } else {
          const message = error instanceof Error ? error.message : String(error)
          add(tabId, frame('system', message, 'error'))
          patch(tabId, { status: 'error', error: message, sessionId: null })
        }
      } finally {
        if (controllers.get(tabId) === controller) controllers.delete(tabId)
      }
    },

    send: async (tabId, raw, vars) => {
      const sessionId = get().byTab[tabId]?.sessionId
      if (!sessionId) return 'The stream is not open.'
      try {
        const messages = parseMessages(substJsonVars(raw, vars))
        for (const message of messages) {
          await sendStreamMessage(sessionId, message)
          add(tabId, frame('outbound', message))
        }
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },

    closeSend: async (tabId) => {
      const sessionId = get().byTab[tabId]?.sessionId
      if (!sessionId) return
      patch(tabId, { sessionId: null })
      add(tabId, frame('system', 'Send side closed: waiting for the server'))
      await closeStream(sessionId).catch((error: unknown) => add(tabId, frame('system', String(error), 'error')))
    },

    cancel: (tabId) => {
      controllers.get(tabId)?.abort()
      controllers.delete(tabId)
    },

    clear: (tabId) => patch(tabId, { frames: [] }),

    forget: (tabId) => {
      get().cancel(tabId)
      set((state) => {
        const { [tabId]: _gone, ...rest } = state.byTab
        return { byTab: rest }
      })
    },
  }
})

// A tab that goes away cancels its stream and drops its schemas, whichever action closed it.
useTabsStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return
  const open = new Set(state.tabs.map((tab) => tab.id))
  const known = new Set([...Object.keys(useGrpcStreams.getState().byTab), ...Object.keys(useGrpcDescriptors.getState().byTab)])
  for (const tabId of known) {
    if (open.has(tabId)) continue
    useGrpcStreams.getState().forget(tabId)
    useGrpcDescriptors.getState().forget(tabId)
  }
})

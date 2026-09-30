import * as DevSessionBindings from '../../bindings/adomnia/devsession'

/** Header adOmnia adds to requests sent to a live service, so its logs and messages can be tied back. */
export const CORRELATION_HEADER = 'X-AdOmnia-Request-ID'

export type LiveState = 'starting' | 'running' | 'paused' | 'stopped' | 'error'
export type RunState = 'sent' | 'paused' | 'completed' | 'error'
export type DebugAction = 'continue' | 'next' | 'stepIn' | 'stepOut' | 'pause'

export interface LiveFrame { function: string; file?: string; relativePath?: string; line: number }

export interface LivePause extends LiveFrame {
  threadId: number
  reason?: string
  stack?: LiveFrame[]
  at: string
}

export interface LiveSession {
  id: string
  goSessionId: string
  service: string
  projectRoot: string
  kind: 'run' | 'debug'
  resourceId: string
  title: string
  pid?: number
  port?: number
  portSource?: 'env' | 'output' | 'listening' | 'manual'
  state: LiveState
  pause?: LivePause | null
  error?: string
  startedAt: string
  endedAt?: string | null
}

export interface LiveHit extends LiveFrame {
  stack?: LiveFrame[]
  at: string
  confidence: 'likely' | 'probable'
}

export interface RequestRun {
  id: string
  sessionId: string
  tabId?: string
  name?: string
  method: string
  url: string
  correlationId: string
  state: RunState
  startedAt: string
  completedAt?: string | null
  status?: number
  durationMs?: number
  error?: string
  hits: LiveHit[]
  logs: number
  queries: number
  messages: number
}

export interface LiveLogEntry {
  seq: number
  sessionId: string
  at: string
  stream: string
  text: string
  level?: string
  requestRunId?: string
  match?: 'id' | 'time'
}

export interface LiveQuery {
  id: string
  sessionId: string
  requestRunId?: string
  match?: 'id' | 'time'
  at: string
  sql: string
  source: 'log' | 'proxy'
  datasource?: string
}

export interface LiveMessage {
  id: string
  sessionId: string
  requestRunId?: string
  match?: 'id' | 'time'
  at: string
  broker: string
  topic: string
  partition: number
  offset: number
  key?: string
  headers?: Record<string, string>
  preview?: string
}

export interface LiveSnapshot { sessions: LiveSession[]; runs: RequestRun[] }

export interface LiveEvent { type: string; sessionId?: string; payload?: unknown }

export interface SessionTools {
  kafka?: { brokers: string[]; topics: string[] } | null
  sql?: { kind: string; target: string; listen: string } | null
}

export const getLiveSnapshot = () => DevSessionBindings.GetSnapshot() as Promise<LiveSnapshot>
export const beginLiveRequest = (request: { sessionId: string; tabId: string; name: string; method: string; url: string }) =>
  DevSessionBindings.BeginRequest(request) as Promise<RequestRun>
export const endLiveRequest = (runId: string, status: number, durationMs: number, error: string) =>
  DevSessionBindings.EndRequest(runId, status, durationMs, error) as Promise<RequestRun>
export const stepLiveSession = (sessionId: string, action: DebugAction) => DevSessionBindings.Step(sessionId, action) as Promise<void>
export const stopLiveSession = (sessionId: string) => DevSessionBindings.Stop(sessionId) as Promise<void>
export const setLivePort = (sessionId: string, port: number) => DevSessionBindings.SetPort(sessionId, port) as Promise<void>
export const waitLiveReady = (sessionId: string, timeoutMs: number) => DevSessionBindings.WaitReady(sessionId, timeoutMs) as Promise<void>
export const liveLogs = (sessionId: string, runId: string, limit = 0) => DevSessionBindings.Logs(sessionId, runId, limit) as Promise<LiveLogEntry[]>
export const liveQueries = (runId: string) => DevSessionBindings.Queries(runId) as Promise<LiveQuery[]>
export const liveMessages = (runId: string) => DevSessionBindings.Messages(runId) as Promise<LiveMessage[]>
export const setServiceName = (goSessionId: string, name: string) => DevSessionBindings.SetServiceName(goSessionId, name) as Promise<void>
export const serviceNameFor = (goSessionId: string) => DevSessionBindings.ProjectServiceName(goSessionId) as Promise<string>
export const liveTools = (sessionId: string) => DevSessionBindings.Tools(sessionId) as Promise<SessionTools>
export const watchLiveKafka = (sessionId: string, brokers: string[], topics: string[]) =>
  DevSessionBindings.WatchKafka(sessionId, brokers, topics) as Promise<SessionTools>
export const unwatchLiveKafka = (sessionId: string) => DevSessionBindings.UnwatchKafka(sessionId) as Promise<SessionTools>
export const startSqlCapture = (sessionId: string, kind: string, target: string, port: number) =>
  DevSessionBindings.StartSQLCapture(sessionId, kind, target, port) as Promise<SessionTools>
export const stopSqlCapture = (sessionId: string) => DevSessionBindings.StopSQLCapture(sessionId) as Promise<SessionTools>

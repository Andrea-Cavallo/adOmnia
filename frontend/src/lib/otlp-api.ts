// Local OpenTelemetry receiver (sidecar /otlp/*): services export OTLP to 127.0.0.1 and the
// Trace Studio reads the spans back. Nothing listens until the user starts the receiver.
import { serverUrl, sidecarFetch } from '@/lib/useServerPort'

export interface OtlpStatus {
  running: boolean
  httpAddr?: string
  grpcAddr?: string
  traces: number
  spans: number
  error?: string
}

export interface OtlpSpanEvent {
  name: string
  timeMs: number
  attributes?: Record<string, string>
}

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: string
  service: string
  startMs: number
  durationMs: number
  statusCode: 'UNSET' | 'OK' | 'ERROR' | string
  statusMessage?: string
  category: 'http' | 'db' | 'rpc' | 'messaging' | 'internal' | string
  attributes?: Record<string, string>
  events?: OtlpSpanEvent[]
}

export interface OtlpTraceSummary {
  traceId: string
  root: string
  services: string[]
  startMs: number
  durationMs: number
  spans: number
  errors: number
}

async function call<T>(port: number | null, path: string, body?: unknown): Promise<T> {
  const url = serverUrl(port, path)
  if (!url) throw new Error('Backend not ready')
  const response = await sidecarFetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await response.text()
  const data = text ? JSON.parse(text) as T : ({} as T)
  if (!response.ok && !(data as { error?: string }).error) throw new Error(text || response.statusText)
  return data
}

export interface OtlpLensStat {
  file: string
  line: number
  function?: string
  name: string
  count: number
  retries?: number
  firstMs?: number
  kind?: string
  errors: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  lastMs: number
  category: string
}

export const otlpStatus = (port: number | null) => call<OtlpStatus>(port, '/otlp/status')
export const startOtlp = (port: number | null, httpPort = 4318, grpcPort = 4317) => call<OtlpStatus>(port, '/otlp/start', { httpPort, grpcPort })
export const stopOtlp = (port: number | null) => call<OtlpStatus>(port, '/otlp/stop', {})
export const clearOtlp = (port: number | null) => call<OtlpStatus>(port, '/otlp/clear', {})
export const listOtlpTraces = (port: number | null, limit = 200) => call<OtlpTraceSummary[]>(port, `/otlp/traces?limit=${limit}`)
export const getOtlpTrace = (port: number | null, traceId: string) => call<OtlpSpan[]>(port, `/otlp/trace?id=${encodeURIComponent(traceId)}`)
export const getOtlpLens = (port: number | null) => call<OtlpLensStat[]>(port, '/otlp/lens')

export interface OtlpMapNode {
  id: string
  kind: 'service' | 'database' | 'topic' | 'external'
  label: string
  system?: string
}

export interface OtlpMapEdge {
  from: string
  to: string
  kind: 'http' | 'rpc' | 'db' | 'messaging'
  calls: number
  errors: number
  retries?: number
  p50Ms: number
  p95Ms: number
  ratePerMin: number
  sampleTraceId?: string
  errorTraceId?: string
  sourceFile?: string
  sourceLine?: number
  handlerFile?: string
  handlerLine?: number
}

export interface OtlpServiceMap {
  nodes: OtlpMapNode[]
  edges: OtlpMapEdge[]
  windowMs: number
}

export const getOtlpMap = (port: number | null) => call<OtlpServiceMap>(port, '/otlp/map')

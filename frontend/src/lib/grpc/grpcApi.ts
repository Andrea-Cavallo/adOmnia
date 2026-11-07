/** The sidecar's gRPC endpoints. Every call goes through the local Go sidecar, which owns the connections. */
import { getServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import type { GrpcDescriptors } from './grpcSchema'

export interface GrpcTarget {
  address: string
  tls: boolean
  ca_cert_path?: string
  client_cert_path?: string
  client_key_path?: string
}

export interface GrpcDescriptorSource {
  kind: 'reflection' | 'proto' | 'protoset'
  files?: Record<string, string>
  entry_files?: string[]
  proto_paths?: string[]
  import_paths?: string[]
  protoset_path?: string
  protoset_base64?: string
}

export interface GrpcCallBody extends GrpcTarget {
  service: string
  method: string
  payload?: unknown
  messages?: unknown[]
  metadata?: Record<string, string>
  timeout_ms?: number
  descriptors?: GrpcDescriptorSource
  interactive?: boolean
}

export interface GrpcCallResult {
  response?: unknown
  messages?: unknown[]
  error?: string
  status: string
  time_ms?: number
  response_metadata?: Record<string, string>
  response_trailers?: Record<string, string>
}

export interface GrpcMockRule {
  id: string
  name?: string
  enabled: boolean
  service?: string
  method?: string
  match?: string
  response?: string
  status?: string
  message?: string
  delay_ms?: number
  metadata?: Record<string, string>
}

export interface GrpcMockHit {
  timestamp: number
  method: string
  request: string
  response: string
  status: string
  rule_id?: string
  rule_name?: string
}

export interface GrpcMockStatus {
  running: boolean
  port?: number
  services: GrpcDescriptors['services']
  hits: GrpcMockHit[]
}

async function sidecarPath(path: string): Promise<string> {
  const port = await getServerPort()
  const url = port ? serverUrl(port, path) : ''
  if (!url) throw new Error('The local server is not ready yet.')
  return url
}

/** POSTs JSON to the sidecar; an HTTP error becomes an Error with the server's text. */
export async function grpcPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await sidecarFetch(await sidecarPath(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const text = await response.text()
  if (!response.ok) throw new Error(text.trim() || `HTTP ${response.status}`)
  return (text ? JSON.parse(text) : null) as T
}

export async function grpcGet<T>(path: string): Promise<T> {
  const response = await sidecarFetch(await sidecarPath(path))
  if (!response.ok) throw new Error((await response.text()).trim() || `HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export const reflectServices = (target: GrpcTarget, metadata: Record<string, string>) => grpcPost<GrpcDescriptors>('/grpc/reflect', { ...target, metadata })
export const loadDescriptors = (source: GrpcDescriptorSource) => grpcPost<GrpcDescriptors>('/grpc/descriptors', source)
export const invokeGrpc = (body: GrpcCallBody, signal?: AbortSignal) => grpcPost<GrpcCallResult>('/grpc/invoke', body, signal)

export const startGrpcMock = (port: number, descriptors: GrpcDescriptorSource, rules: GrpcMockRule[]) => grpcPost<{ port: number }>('/grpc/mock/start', { port, descriptors, rules })
export const stopGrpcMock = () => grpcPost<{ ok: boolean }>('/grpc/mock/stop', {})
export const setGrpcMockRules = (rules: GrpcMockRule[]) => grpcPost<{ ok: boolean }>('/grpc/mock/rules', rules)
export const clearGrpcMockHits = () => grpcPost<{ ok: boolean }>('/grpc/mock/hits/clear', {})
export const grpcMockStatus = () => grpcGet<GrpcMockStatus>('/grpc/mock/status')

export interface GrpcStreamEvent {
  type: 'session' | 'headers' | 'message' | 'complete'
  id?: string
  message?: unknown
  metadata?: Record<string, string>
  trailers?: Record<string, string>
  status?: string
  error?: string
  time_ms?: number
}

/** Runs a streaming call and hands every NDJSON event to onEvent as it arrives. */
export async function streamGrpc(body: GrpcCallBody, signal: AbortSignal, onEvent: (event: GrpcStreamEvent) => void): Promise<void> {
  const response = await sidecarFetch(await sidecarPath('/grpc/stream'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!response.ok || !response.body) throw new Error((await response.text()).trim() || `HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const consume = (line: string) => { if (line.trim()) onEvent(JSON.parse(line) as GrpcStreamEvent) }
  for (;;) {
    const { done, value } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    lines.forEach((line) => consume(line))
    if (done) break
  }
  consume(pending)
}

export const sendStreamMessage = (id: string, message: unknown) => grpcPost('/grpc/stream/send', { id, message })
export const closeStream = (id: string) => grpcPost('/grpc/stream/close', { id })

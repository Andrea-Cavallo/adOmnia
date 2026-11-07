/**
 * A gRPC call is a collection request with `method: 'GRPC'`: `url` is the server address (host:port), the
 * headers are its metadata, the auth becomes metadata, the body variants are its saved messages and
 * `request.grpc` holds the rest. This module turns it into the sidecar's call body and the call's outcome into
 * a ResponseData, without any I/O.
 */
import { substJsonVars, substVars } from '@/lib/substVars'
import { blankAuth, blankRequest, uid, type GrpcSettings, type KVRow, type RequestBody, type RequestItem, type ResponseData } from '@/lib/types'
import type { GrpcCallBody, GrpcCallResult, GrpcDescriptorSource, GrpcMockRule, GrpcTarget } from './grpcApi'

export const DEFAULT_GRPC_SETTINGS: GrpcSettings = {
  service: '',
  method: '',
  source: 'reflection',
  protoFiles: [],
  importPaths: [],
  protosetPath: '',
  tls: false,
  caCertPath: '',
  clientCertPath: '',
  clientKeyPath: '',
  timeoutMs: 0,
}

export const isGrpcRequest = (request: Pick<RequestItem, 'method'>) => request.method === 'GRPC'
export const grpcSettings = (request: RequestItem): GrpcSettings => ({ ...DEFAULT_GRPC_SETTINGS, ...request.grpc })

/** `grpcs://host:443` or `grpc://host:50051` as people paste them: the scheme says TLS, the call wants host:port. */
export function parseGrpcAddress(raw: string): { address: string; tls?: boolean } {
  const text = raw.trim()
  const scheme = /^(grpcs?|https?):\/\//i.exec(text)
  if (!scheme) return { address: text.replace(/\/+$/, '') }
  const rest = text.slice(scheme[0].length).replace(/\/.*$/, '')
  const secure = /^(grpcs|https)$/i.test(scheme[1])
  return { address: rest.includes(':') ? rest : `${rest}:${secure ? 443 : 80}`, tls: secure }
}

/** gRPC as a request item: one message, reflection, plaintext. */
export function blankGrpcRequest(name = 'New gRPC call', address = ''): RequestItem {
  return {
    ...blankRequest('GRPC', name),
    url: address,
    params: [],
    cookies: [],
    bodies: [grpcMessage('Message 1', '{}')],
    grpc: { ...DEFAULT_GRPC_SETTINGS },
  }
}

export function grpcMessage(name: string, raw: string): RequestBody {
  return { id: uid(), name, type: 'raw', raw, lang: 'json', form: [] }
}

const enabledRows = (rows: KVRow[] | undefined) => (rows ?? []).filter((row) => row.enabled && row.key.trim())

/** Metadata of the call: the enabled headers, then the auth (Bearer/Basic/API key) as gRPC metadata. */
export function callMetadata(request: RequestItem, vars: Record<string, string>): Record<string, string> {
  const metadata: Record<string, string> = {}
  for (const row of enabledRows(request.headers)) metadata[substVars(row.key, vars).toLowerCase()] = substVars(row.value, vars)
  const auth = request.auth ?? blankAuth()
  if (auth.type === 'bearer' || (auth.type === 'oauth2' && auth.token)) metadata.authorization = `Bearer ${substVars(auth.token, vars)}`
  if (auth.type === 'basic') metadata.authorization = `Basic ${btoa(`${substVars(auth.username, vars)}:${substVars(auth.password, vars)}`)}`
  if (auth.type === 'apikey') metadata[substVars(auth.username || 'x-api-key', vars).toLowerCase()] = substVars(auth.token, vars)
  return metadata
}

/** The schema source of the call; reflection asks the server. */
export function descriptorSource(settings: GrpcSettings): GrpcDescriptorSource {
  if (settings.source === 'protoset') return { kind: 'protoset', protoset_path: settings.protosetPath }
  if (settings.source === 'proto') {
    const files = settings.inlineProtos ?? {}
    return { kind: 'proto', proto_paths: settings.protoFiles, import_paths: settings.importPaths, ...(Object.keys(files).length ? { files } : {}) }
  }
  return { kind: 'reflection' }
}

export function grpcTarget(request: RequestItem, vars: Record<string, string>): GrpcTarget {
  const settings = grpcSettings(request)
  const parsed = parseGrpcAddress(substVars(request.url, vars))
  return {
    address: parsed.address,
    tls: parsed.tls ?? settings.tls,
    ca_cert_path: settings.caCertPath || undefined,
    client_cert_path: settings.clientCertPath || undefined,
    client_key_path: settings.clientKeyPath || undefined,
  }
}

/** The messages of a body: a JSON array is a client stream, a JSON object one message, JSON Lines one per line. */
export function parseMessages(raw: string): unknown[] {
  const text = raw.trim()
  if (!text) return [{}]
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value : [value]
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines.length > 1) return lines.map((line) => JSON.parse(line) as unknown)
    throw new Error('The message is not valid JSON.')
  }
}

export function activeGrpcMessage(request: RequestItem): RequestBody | undefined {
  const bodies = request.bodies ?? []
  return bodies[Math.min(Math.max(request.activeBodyIdx ?? 0, 0), bodies.length - 1)]
}

/** What the sidecar's /grpc/invoke and /grpc/stream need. Throws when the address, method or message is wrong. */
export function grpcCallBody(request: RequestItem, vars: Record<string, string>): GrpcCallBody {
  const settings = grpcSettings(request)
  const target = grpcTarget(request, vars)
  if (!target.address.includes(':')) throw new Error('Set the server address as host:port.')
  if (!settings.service || !settings.method) throw new Error('Pick the service and the method to call.')
  const messages = parseMessages(substJsonVars(activeGrpcMessage(request)?.raw ?? '{}', vars))
  return {
    ...target,
    service: settings.service,
    method: settings.method,
    payload: messages[0] ?? {},
    messages,
    metadata: callMetadata(request, vars),
    timeout_ms: settings.timeoutMs > 0 ? settings.timeoutMs : request.timeout && request.timeout > 0 ? request.timeout : undefined,
    descriptors: descriptorSource(settings),
  }
}

/** gRPC status → the HTTP status a gateway would return: Flows and assertions read 2xx/4xx/5xx. */
const HTTP_STATUS: Record<string, number> = {
  ok: 200, cancelled: 499, unknown: 500, invalidargument: 400, deadlineexceeded: 504, notfound: 404, alreadyexists: 409,
  permissiondenied: 403, resourceexhausted: 429, failedprecondition: 400, aborted: 409, outofrange: 400, unimplemented: 501,
  internal: 500, unavailable: 503, dataloss: 500, unauthenticated: 401,
}

/** NOT_FOUND, NotFound and not_found are the same code. */
export const normalizeGrpcStatus = (status: string) => status.replace(/_/g, '').toLowerCase()

/** The canonical spelling of a gRPC status, as the gRPC docs write it: NOT_FOUND. */
export function grpcStatusName(status: string): string {
  if (!status) return 'UNKNOWN'
  return status.includes('_') || status === status.toUpperCase() ? status.toUpperCase() : status.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()
}

/** A finished call as a response: body is the reply JSON (all replies for a stream), headers are metadata and trailers. */
export function responseFromCall(result: GrpcCallResult): ResponseData {
  const ok = normalizeGrpcStatus(result.status) === 'ok'
  const payload = result.messages && result.messages.length > 0 && result.response === undefined ? result.messages : result.response
  const body = ok || payload !== undefined ? JSON.stringify(payload ?? {}, null, 2) : JSON.stringify({ code: grpcStatusName(result.status), message: result.error ?? '' }, null, 2)
  const headers: Record<string, string> = { 'grpc-status': grpcStatusName(result.status), ...result.response_metadata }
  for (const [key, value] of Object.entries(result.response_trailers ?? {})) headers[`trailer: ${key}`] = value
  if (result.error) headers['grpc-message'] = result.error
  return {
    status: HTTP_STATUS[normalizeGrpcStatus(result.status)] ?? 500,
    statusText: grpcStatusName(result.status),
    headers,
    body,
    contentType: 'application/json',
    ms: result.time_ms ?? 0,
    size: new Blob([body]).size,
  }
}

/** The mock rules of the request in the sidecar's shape. */
export function mockRulesOf(settings: GrpcSettings): GrpcMockRule[] {
  return (settings.mockRules ?? []).map((rule) => ({
    id: rule.id, name: rule.name, enabled: rule.enabled, method: rule.method || undefined, match: rule.match || undefined,
    response: rule.response, status: rule.status || 'OK', message: rule.message, delay_ms: rule.delayMs || undefined,
  }))
}

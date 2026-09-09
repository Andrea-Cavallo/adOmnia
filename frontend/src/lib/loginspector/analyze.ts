import { buildLookup, flattenPayload } from './normalize'
import { sortChronologically } from './correlate'
import type { LogEvent } from './types'

export type RequestStatus = 'success' | 'client-error' | 'server-error' | 'timeout' | 'retry' | 'unknown'

export interface OperationalContext {
  service: string
  serviceVersion: string
  environment: string
  namespace: string
  pod: string
  layer: string
  operation: string
  client: string
  operationStatus: string
  latencyMs: number | null
  error: string
  dean: string
  httpRoute: string
  httpMethod: string
  httpUrl: string
  httpStatus: number | null
  outcome: string
  durationMs: number | null
  sourceFile: string
  sourceFunction: string
  sourceLine: string
  requestBody: unknown | null
  responseBody: unknown | null
}

export interface AnalyzedRequest {
  correlationId: string
  requestId: string
  status: RequestStatus
  startedAt: number | null
  completedAt: number | null
  durationMs: number | null
  operation: string
  endpoint: string
  method: string
  httpStatus: number | null
  service: string
  serviceVersion: string
  downstreams: string[]
  maxDownstreamLatencyMs: number | null
  eventCount: number
  error: string
  eventIds: number[]
}

export interface LogAnomaly {
  kind: 'timeout' | 'slow' | 'server-error' | 'client-error' | 'retry'
  severity: 'error' | 'warn' | 'info'
  correlationId: string
  title: string
  evidence: string
  action: string
}

export interface SensitiveFieldFinding {
  eventId: number
  line: number
  path: string
  kind: string
}

export interface LogAnalysis {
  requests: AnalyzedRequest[]
  anomalies: LogAnomaly[]
  sensitiveFields: SensitiveFieldFinding[]
  environments: string[]
  services: { name: string; version: string }[]
  pods: string[]
}

const contextCache = new WeakMap<LogEvent, OperationalContext>()
const flatCache = new WeakMap<LogEvent, Record<string, unknown>>()
const lookupCache = new WeakMap<LogEvent, ReturnType<typeof buildLookup>>()

function flattened(event: LogEvent): Record<string, unknown> {
  const cached = flatCache.get(event)
  if (cached) return cached
  const source = event.json && typeof event.json === 'object' && !Array.isArray(event.json)
    ? event.json as Record<string, unknown>
    : event.extra
  const flat = flattenPayload(source)
  flatCache.set(event, flat)
  return flat
}

function scalar(event: LogEvent, aliases: string[]): string {
  let lookup = lookupCache.get(event)
  if (!lookup) {
    lookup = buildLookup(flattened(event))
    lookupCache.set(event, lookup)
  }
  for (const alias of aliases) {
    const hit = lookup.get(alias)
    if (!hit || hit.value === null || hit.value === undefined || typeof hit.value === 'object') continue
    const value = String(hit.value).trim()
    if (value) return value
  }
  return ''
}

function numeric(event: LogEvent, aliases: string[]): number | null {
  const raw = scalar(event, aliases)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function payloadValue(event: LogEvent, aliases: string[]): unknown | null {
  let lookup = lookupCache.get(event)
  if (!lookup) {
    lookup = buildLookup(flattened(event))
    lookupCache.set(event, lookup)
  }
  for (const alias of aliases) {
    const hit = lookup.get(alias)
    if (hit && hit.value !== null && hit.value !== undefined && hit.value !== '') return hit.value
  }
  return null
}

/** Enterprise fields used by slog, zap, zerolog and JSON logback encoders. */
export function operationalContext(event: LogEvent): OperationalContext {
  const cached = contextCache.get(event)
  if (cached) return cached

  const context: OperationalContext = {
    service: event.service || scalar(event, ['service.name', 'resource.attributes.service.name', 'service']),
    serviceVersion: scalar(event, ['service.version', 'resource.attributes.service.version', 'service_version', 'version']),
    environment: scalar(event, ['environment', 'env', 'attributes.environment', 'attributes.env', 'deployment.environment', 'resource.attributes.deployment.environment']),
    namespace: event.namespace || scalar(event, ['k8s.namespace.name', 'resource.attributes.k8s.namespace.name', 'kubernetes.namespace_name']),
    pod: event.pod || scalar(event, ['k8s.pod.name', 'resource.attributes.k8s.pod.name', 'kubernetes.pod_name']),
    layer: scalar(event, ['attributes.layer', 'layer']),
    operation: scalar(event, ['attributes.operation', 'operation', 'span.name']),
    client: scalar(event, ['attributes.client', 'client', 'peer.service', 'server.address']),
    operationStatus: scalar(event, ['attributes.status', 'status']),
    latencyMs: numeric(event, ['attributes.latency_ms', 'latency_ms', 'latency.ms']),
    error: scalar(event, ['attributes.error', 'error.message', 'error']),
    dean: scalar(event, ['attributes.dean', 'dean']),
    httpRoute: scalar(event, ['http.route', 'attributes.route', 'url.path', 'route']),
    httpMethod: scalar(event, ['http.method', 'http.request.method', 'attributes.method', 'method']),
    httpUrl: scalar(event, ['http.url', 'url.full', 'attributes.url']),
    httpStatus: numeric(event, ['http.status_code', 'http.response.status_code', 'attributes.http.status_code', 'attributes.http_status_code', 'attributes.status_code', 'attributes.status', 'status_code']),
    outcome: scalar(event, ['event.outcome', 'outcome']),
    durationMs: numeric(event, ['duration_ms', 'attributes.duration_ms', 'http.duration_ms']),
    sourceFile: scalar(event, ['source.file', 'code.filepath', 'caller.file']),
    sourceFunction: scalar(event, ['source.function', 'code.function', 'caller.function']),
    sourceLine: scalar(event, ['source.line', 'code.lineno', 'caller.line']),
    requestBody: payloadValue(event, ['attributes.request_body', 'attributes.request.body', 'http.request.body', 'request_body']),
    responseBody: payloadValue(event, ['attributes.response_body', 'attributes.response.body', 'http.response.body', 'response_body']),
  }
  contextCache.set(event, context)
  return context
}

function lastValue(contexts: OperationalContext[], pick: (value: OperationalContext) => string): string {
  for (let i = contexts.length - 1; i >= 0; i--) {
    const value = pick(contexts[i])
    if (value) return value
  }
  return ''
}

function lastNumber(contexts: OperationalContext[], pick: (value: OperationalContext) => number | null): number | null {
  for (let i = contexts.length - 1; i >= 0; i--) {
    const value = pick(contexts[i])
    if (value !== null) return value
  }
  return null
}

function requestStatus(events: LogEvent[], contexts: OperationalContext[], httpStatus: number | null): RequestStatus {
  const searchable = events.map((event, index) => `${event.message} ${contexts[index].error} ${contexts[index].operationStatus}`).join(' ')
  if (/context deadline exceeded|deadline exceeded|\btimeout\b|timed out/i.test(searchable)) return 'timeout'
  if (httpStatus !== null && httpStatus >= 500) return 'server-error'
  if (httpStatus !== null && httpStatus >= 400) return 'client-error'
  if (/validat|obbligatori|required|bad request|invalid/i.test(searchable) && contexts.some((context) => context.error)) return 'client-error'
  if (events.some((event) => event.level === 'fatal' || event.level === 'error') || contexts.some((context) => /fail|error/i.test(`${context.outcome} ${context.operationStatus}`))) return 'server-error'
  if (/\bretr(?:y|ied|ying)\b/i.test(searchable)) return 'retry'
  if ((httpStatus !== null && httpStatus < 400)
    || contexts.some((context) => /success|ok|completed|complete/i.test(`${context.outcome} ${context.operationStatus}`))
    || /\b(?:success|succeeded|completat[aoe])\b/i.test(searchable)) return 'success'
  return 'unknown'
}

function requestDuration(events: LogEvent[], contexts: OperationalContext[]): number | null {
  const explicit = contexts.flatMap((context) => [context.durationMs, context.latencyMs]).filter((value): value is number => value !== null)
  if (explicit.length) return explicit.reduce((max, value) => Math.max(max, value), 0)
  let min: number | null = null
  let max: number | null = null
  for (const event of events) {
    if (event.ts === null) continue
    min = min === null ? event.ts : Math.min(min, event.ts)
    max = max === null ? event.ts : Math.max(max, event.ts)
  }
  return min !== null && max !== null && min !== max ? max - min : null
}

const SENSITIVE_KEYS: { pattern: RegExp; kind: string }[] = [
  { pattern: /(?:^|\.)(?:fiscal_?code|codice_?fiscale)$/i, kind: 'fiscalCode' },
  { pattern: /(?:^|\.)iban$/i, kind: 'IBAN' },
  { pattern: /(?:^|\.)dean$/i, kind: 'DEAN' },
  { pattern: /(?:^|\.)(?:pan|card_?number)$/i, kind: 'PAN' },
  { pattern: /(?:^|\.)(?:phone|telephone|mobile|telefono)$/i, kind: 'phone' },
  { pattern: /(?:^|\.)(?:authorization|.*token|password|secret|cookie)$/i, kind: 'secret' },
]

function sensitiveFindings(event: LogEvent): SensitiveFieldFinding[] {
  if (!event.json || typeof event.json !== 'object' || Array.isArray(event.json)) return []
  const findings: SensitiveFieldFinding[] = []
  for (const [path, value] of Object.entries(flattened(event))) {
    if (value === null || value === undefined || typeof value === 'object') continue
    const text = String(value).trim()
    if (!text || /^\*+$/.test(text) || /redacted|masked|xxxx/i.test(text)) continue
    const match = SENSITIVE_KEYS.find(({ pattern }) => pattern.test(path))
    if (match) findings.push({ eventId: event.id, line: event.line, path, kind: match.kind })
  }
  return findings
}

/** Build request-level diagnostics without sending log data outside the machine. */
export function analyzeLog(events: LogEvent[]): LogAnalysis {
  const groups = new Map<string, LogEvent[]>()
  for (const event of events) {
    const key = event.correlationId || event.requestId
    if (!key) continue
    const group = groups.get(key)
    if (group) group.push(event)
    else groups.set(key, [event])
  }

  const requests: AnalyzedRequest[] = []
  const anomalies: LogAnomaly[] = []
  const serviceMap = new Map<string, string>()
  const environments = new Set<string>()
  const pods = new Set<string>()

  for (const [groupId, sourceEvents] of groups) {
    const requestEvents = sortChronologically(sourceEvents)
    const contexts = requestEvents.map(operationalContext)
    const httpStatus = lastNumber(contexts, (context) => context.httpStatus)
    const status = requestStatus(requestEvents, contexts, httpStatus)
    const downstreams = [...new Set(contexts.map((context) => context.client).filter(Boolean))]
    const latencies = contexts.map((context) => context.latencyMs).filter((value): value is number => value !== null)
    const maxDownstreamLatencyMs = latencies.length ? latencies.reduce((max, value) => Math.max(max, value), 0) : null
    const durationMs = requestDuration(requestEvents, contexts)
    const service = lastValue(contexts, (context) => context.service)
    const serviceVersion = lastValue(contexts, (context) => context.serviceVersion)
    const error = lastValue(contexts, (context) => context.error)
      || [...requestEvents].reverse().find((event) => event.level === 'error' || event.level === 'fatal')?.message
      || ''

    const request: AnalyzedRequest = {
      correlationId: requestEvents.find((event) => event.correlationId)?.correlationId || groupId,
      requestId: requestEvents.find((event) => event.requestId)?.requestId || '',
      status,
      startedAt: requestEvents.find((event) => event.ts !== null)?.ts ?? null,
      completedAt: [...requestEvents].reverse().find((event) => event.ts !== null)?.ts ?? null,
      durationMs,
      operation: lastValue(contexts, (context) => context.operation),
      endpoint: lastValue(contexts, (context) => context.httpRoute || context.httpUrl),
      method: lastValue(contexts, (context) => context.httpMethod),
      httpStatus,
      service,
      serviceVersion,
      downstreams,
      maxDownstreamLatencyMs,
      eventCount: requestEvents.length,
      error,
      eventIds: requestEvents.map((event) => event.id),
    }
    requests.push(request)

    const target = downstreams.join(', ') || 'downstream'
    if (status === 'timeout') {
      anomalies.push({
        kind: 'timeout', severity: 'error', correlationId: request.correlationId,
        title: `Timeout ${target}`,
        evidence: `${error || 'context deadline exceeded'}${maxDownstreamLatencyMs !== null ? `, ${Math.round(maxDownstreamLatencyMs)} ms` : ''}`,
        action: `Verifica health, latenza e timeout HTTP del client ${target}${maxDownstreamLatencyMs !== null && maxDownstreamLatencyMs >= 10_000 ? ', la deadline scade intorno a 10s' : ''}.`,
      })
    } else if (status === 'server-error' || status === 'client-error') {
      anomalies.push({
        kind: status, severity: status === 'server-error' ? 'error' : 'warn', correlationId: request.correlationId,
        title: `${httpStatus ?? 'Errore'} ${request.endpoint || request.operation || 'request'}`,
        evidence: error || requestEvents[requestEvents.length - 1]?.message || 'failure',
        action: status === 'client-error' ? 'Controlla payload e validazione nell’handler.' : `Ispeziona il servizio ${service || 'coinvolto'} e il downstream ${target}.`,
      })
    } else if (status === 'retry') {
      anomalies.push({ kind: 'retry', severity: 'info', correlationId: request.correlationId, title: 'Retry rilevato', evidence: error || 'retry event', action: 'Controlla numero di tentativi, backoff e idempotenza.' })
    }
    if (status !== 'timeout' && maxDownstreamLatencyMs !== null && maxDownstreamLatencyMs > 500) {
      anomalies.push({ kind: 'slow', severity: 'warn', correlationId: request.correlationId, title: `Latenza alta ${target}`, evidence: `${Math.round(maxDownstreamLatencyMs)} ms`, action: `Verifica la latenza del client ${target}.` })
    }

    for (const context of contexts) {
      if (context.environment) environments.add(context.environment)
      if (context.pod) pods.add(context.pod)
      if (context.service) serviceMap.set(context.service, context.serviceVersion || serviceMap.get(context.service) || '')
    }
  }

  requests.sort((a, b) => (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER))
  const sensitiveFields = events.flatMap(sensitiveFindings).slice(0, 100)
  return {
    requests,
    anomalies,
    sensitiveFields,
    environments: [...environments],
    services: [...serviceMap].map(([name, version]) => ({ name, version })),
    pods: [...pods],
  }
}

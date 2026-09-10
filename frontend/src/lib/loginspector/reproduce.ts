// From a log event to a reproducible API request.
//
// The log rarely contains everything a request needs: the route is often
// recorded without a host, headers are redacted, the body may be truncated.
// The draft therefore reports what is missing instead of inventing it, and
// leaves `{{baseUrl}}` in place so the active environment (and the Vault
// references it holds) supply the rest at send time.

import { blankKVRow, uid, type HttpMethod, type KVRow, type RequestItem } from '@/lib/types'
import { operationalContext } from './analyze'
import { callPayloadForEvent } from './calls'
import { unwrapNestedJson } from './normalize'
import type { LogEvent } from './types'

const HTTP_METHODS: HttpMethod[] = ['GET', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']

/** Headers whose value is machine-local or per-attempt: never replayed as-is. */
const VOLATILE_HEADERS = /^(?:content-length|host|connection|date|expect)$/i

export interface RequestDraft {
  request: RequestItem
  /** What the log did not contain — shown to the user, not guessed. */
  missing: string[]
  /** Where each filled part came from, for the "no manual copy/paste" claim. */
  sources: string[]
}

function toMethod(raw: string): HttpMethod | null {
  const upper = raw.trim().toUpperCase()
  return HTTP_METHODS.includes(upper as HttpMethod) ? upper as HttpMethod : null
}

function headerRows(value: unknown): KVRow[] {
  const unwrapped = unwrapNestedJson(value)
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return []
  return Object.entries(unwrapped as Record<string, unknown>)
    .filter(([key, entry]) => key && !VOLATILE_HEADERS.test(key) && entry !== null && typeof entry !== 'object')
    .map(([key, entry]) => ({ id: uid(), key, value: String(entry), enabled: true }))
}

function bodyText(value: unknown): { raw: string; lang: 'json' | 'xml' | 'text' } {
  const unwrapped = unwrapNestedJson(value)
  if (unwrapped === null || unwrapped === undefined) return { raw: '', lang: 'json' }
  if (typeof unwrapped === 'string') {
    const trimmed = unwrapped.trim()
    return { raw: unwrapped, lang: trimmed.startsWith('<') ? 'xml' : 'text' }
  }
  return { raw: JSON.stringify(unwrapped, null, 2), lang: 'json' }
}

function splitUrl(url: string): { url: string; params: KVRow[] } {
  const separator = url.indexOf('?')
  if (separator < 0) return { url, params: [] }
  const params: KVRow[] = []
  for (const [key, value] of new URLSearchParams(url.slice(separator + 1))) {
    params.push({ id: uid(), key, value, enabled: true })
  }
  return { url: url.slice(0, separator), params }
}

/**
 * Build an editable request from one log event, using the paired call payload
 * when request and response were logged on different rows.
 */
export function requestDraftFromEvent(sessionEvents: LogEvent[], event: LogEvent): RequestDraft {
  const context = operationalContext(event)
  const paired = callPayloadForEvent(sessionEvents, event)
  const missing: string[] = []
  const sources: string[] = []

  const method = toMethod(paired?.method || context.httpMethod)
  if (!method) missing.push('HTTP method (not in the log — defaulted to GET)')
  else sources.push(`method from ${paired?.method ? 'paired call' : 'event'}`)

  const rawUrl = (paired?.url || context.httpUrl || context.httpRoute || '').trim()
  if (!rawUrl) missing.push('URL or route')
  const absolute = /^https?:\/\//i.test(rawUrl)
  if (rawUrl && !absolute) missing.push('host — prefixed with {{baseUrl}} from the active environment')
  const target = !rawUrl ? '{{baseUrl}}' : absolute ? rawUrl : `{{baseUrl}}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
  const split = splitUrl(target)
  if (rawUrl) sources.push(`url from ${context.httpUrl ? 'http.url' : 'http.route'}`)

  const headers = headerRows(paired?.requestHeaders ?? context.requestHeaders)
  if (!headers.length) missing.push('request headers (auth included)')
  else sources.push(`${headers.length} request headers`)

  const body = bodyText(paired?.requestBody ?? context.requestBody)
  const bodyExpected = method !== null && method !== 'GET' && method !== 'HEAD'
  if (!body.raw && bodyExpected) missing.push('request body')
  else if (body.raw) sources.push('request body')

  const label = [method ?? 'GET', context.httpRoute || rawUrl || context.operation || event.service].filter(Boolean).join(' ')
  const request: RequestItem = {
    id: uid(),
    name: label || 'Reproduced from log',
    description: [
      `Reproduced from ${event.sourceName || 'log'}:${event.line}`,
      context.service ? `service ${context.service}${context.serviceVersion ? ` ${context.serviceVersion}` : ''}` : '',
      event.correlationId ? `correlationId ${event.correlationId}` : '',
      event.traceId ? `traceId ${event.traceId}` : '',
      missing.length ? `Missing from the log: ${missing.join('; ')}.` : 'Every part was present in the log.',
    ].filter(Boolean).join('\n'),
    type: 'request',
    method: method ?? 'GET',
    url: split.url,
    params: split.params.length ? split.params : [blankKVRow()],
    headers: headers.length ? headers : [blankKVRow()],
    cookies: [blankKVRow()],
    bodies: [{ id: uid(), name: 'Body 1', type: body.raw ? 'raw' : 'none', raw: body.raw, lang: body.lang, form: [] }],
    activeBodyIdx: 0,
    auth: { type: 'none', token: '', username: '', password: '' },
    timeout: 0,
    followRedirects: true,
  }

  return { request, missing, sources }
}

/** True when the event carries enough HTTP identity to be worth reproducing. */
export function canReproduce(event: LogEvent): boolean {
  const context = operationalContext(event)
  return Boolean(context.httpUrl || context.httpRoute || context.httpMethod || context.requestBody)
}

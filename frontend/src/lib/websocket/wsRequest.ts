/**
 * A WebSocket connection is a collection request with `method: 'WS'`: its URL, params, headers and
 * auth are the request's, its saved messages are the body variants, and `request.ws` holds the
 * rest. This module turns such a request into the sidecar's connect payload, without any I/O.
 */
import { resolvedRequestUrl, urlWithQuery } from '@/lib/requestUrl'
import { blankAuth, blankKVRow, blankRequest, uid, type KVRow, type RequestAuth, type RequestBody, type RequestItem, type WebSocketSettings } from '@/lib/types'

export const DEFAULT_WS_SETTINGS: WebSocketSettings = {
  subprotocols: '',
  autoReconnect: false,
  reconnectDelay: 3,
  payloadMode: 'json',
  onMessageScript: '',
  parallelCopies: 2,
  parallelClients: 2,
}

export const isWebSocketRequest = (request: Pick<RequestItem, 'method'>) => request.method === 'WS'
export const wsSettings = (request: RequestItem): WebSocketSettings => ({ ...DEFAULT_WS_SETTINGS, ...request.ws })

/** Auth types the handshake can carry; the others need a request/response the upgrade does not have. */
export function wsAuthSupport(auth: RequestAuth): 'native' | 'header' | 'unsupported' | 'none' {
  switch (auth.type) {
    case 'none': return 'none'
    case 'bearer':
    case 'basic': return 'native'
    case 'apikey': return 'header'
    case 'oauth2': return auth.token ? 'native' : 'unsupported'
    default: return 'unsupported'
  }
}

export function substVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, name: string) => vars[name.trim()] ?? match)
}

const enabledRows = (rows: KVRow[] | undefined) => (rows ?? []).filter((row) => row.enabled && row.key.trim())

/**
 * The URL with its enabled query params, variables resolved. The URL bar keeps the query in the
 * URL (like a REST request); rows the URL does not carry yet are added.
 */
export function resolveWsUrl(request: RequestItem, vars: Record<string, string>): string {
  const base = substVars(resolvedRequestUrl(request).trim(), vars)
  const params = enabledRows(request.params)
  if (!params.length) return base
  try {
    const url = new URL(base)
    for (const row of params) url.searchParams.set(substVars(row.key, vars), substVars(row.value, vars))
    return url.toString()
  } catch {
    const carries = (key: string) => [key, encodeURIComponent(key)].some((name) => base.includes(`?${name}=`) || base.includes(`&${name}=`))
    const missing = params.filter((row) => !carries(substVars(row.key, vars)))
    if (!missing.length) return base
    const query = missing.map((row) => `${encodeURIComponent(substVars(row.key, vars))}=${encodeURIComponent(substVars(row.value, vars))}`).join('&')
    return `${base}${base.includes('?') ? '&' : '?'}${query}`
  }
}

export interface WsConnectPayload {
  url: string
  headers: Record<string, string>
  subprotocols?: string[]
  auth: { type: 'none' | 'bearer' | 'basic'; token: string; username: string; password: string }
}

/** What POST /ws/connect needs: URL with params, headers, subprotocols and the auth the handshake can carry. */
export function connectPayload(request: RequestItem, vars: Record<string, string>, extraHeaders: Record<string, string> = {}): WsConnectPayload {
  const headers: Record<string, string> = { ...extraHeaders }
  for (const row of enabledRows(request.headers)) headers[substVars(row.key, vars)] = substVars(row.value, vars)
  const auth = request.auth ?? blankAuth()
  const support = wsAuthSupport(auth)
  if (support === 'header') headers[substVars(auth.username || 'X-API-Key', vars)] = substVars(auth.token, vars)
  const nativeType = auth.type === 'basic' ? 'basic' : 'bearer'
  const protocols = wsSettings(request).subprotocols.split(',').map((item) => item.trim()).filter(Boolean)
  return {
    url: resolveWsUrl(request, vars),
    headers,
    subprotocols: protocols.length ? protocols : undefined,
    auth: support === 'native'
      ? { type: nativeType, token: substVars(auth.token, vars), username: substVars(auth.username, vars), password: substVars(auth.password, vars) }
      : { type: 'none', token: '', username: '', password: '' },
  }
}

/** The message as it goes on the wire: variables resolved, JSON formatted when it parses. */
export function outgoingPayload(raw: string, mode: WebSocketSettings['payloadMode'], vars: Record<string, string>): string {
  const resolved = substVars(raw, vars)
  if (mode !== 'json') return mode === 'binary' ? resolved.trim() : resolved
  try { return JSON.stringify(JSON.parse(resolved), null, 2) } catch { return resolved }
}

/** The saved message the composer shows and Ctrl+Enter sends. */
export function activeMessage(request: RequestItem): RequestBody | undefined {
  const bodies = request.bodies ?? []
  if (!bodies.length) return undefined
  return bodies[Math.min(Math.max(request.activeBodyIdx ?? 0, 0), bodies.length - 1)]
}

/** Binary when the connection says so, else the message's own format (JSON or text). */
export function messageMode(request: RequestItem, message: RequestBody | undefined): WebSocketSettings['payloadMode'] {
  if (wsSettings(request).payloadMode === 'binary') return 'binary'
  return message?.type === 'raw' && message.lang === 'json' ? 'json' : 'text'
}

/** A saved message: a body variant holding raw JSON or text. */
export function wsMessage(name: string, raw: string, lang: RequestBody['lang'] = 'json'): RequestBody {
  return { id: uid(), name, type: 'raw', raw, lang, form: [] }
}

export function blankWebSocketRequest(name = 'New WebSocket', url = ''): RequestItem {
  return {
    ...blankRequest('WS', name),
    url,
    bodies: [wsMessage('Message 1', '{\n  "type": "ping"\n}')],
    ws: { ...DEFAULT_WS_SETTINGS },
  }
}

/** ws:// or wss://, for the badge next to the URL. */
export const wsScheme = (url: string) => (url.trim().toLowerCase().startsWith('wss://') ? 'WSS' : 'WS')

// ---- the panel before the WebSocket client moved into the API workspace

const LEGACY_CONFIG_KEY = 'adomnia.websocket'
const LEGACY_TEMPLATES_KEY = 'adomnia.websocket.templates'
const MIGRATED_KEY = 'adomnia.websocket.migratedToWorkspace'

interface LegacyRow { key?: string; value?: string; enabled?: boolean }
interface LegacyConfig {
  url?: string; authType?: 'none' | 'bearer' | 'basic'; token?: string; username?: string; password?: string
  headers?: LegacyRow[]; queryParams?: LegacyRow[]; autoReconnect?: boolean; reconnectDelay?: number; subprotocols?: string
}
interface LegacyTemplate { name?: string; payload?: string; mode?: 'text' | 'json' | 'binary' }

const rows = (legacy: LegacyRow[] | undefined): KVRow[] => {
  const out = (legacy ?? []).filter((row) => row.key).map((row) => ({ id: uid(), key: row.key ?? '', value: row.value ?? '', enabled: row.enabled ?? true }))
  return [...out, blankKVRow()]
}

/** The request the old panel's saved configuration and templates become: nothing the user set is lost. */
export function requestFromLegacy(config: LegacyConfig | null, templates: LegacyTemplate[]): RequestItem | null {
  if (!config?.url) return null
  const params = rows(config.queryParams)
  const request = blankWebSocketRequest('WebSocket', urlWithQuery(config.url, params))
  const messages = templates.filter((template) => template.payload).map((template, index) => wsMessage(template.name || `Message ${index + 1}`, template.payload ?? '', template.mode === 'json' ? 'json' : 'text'))
  return {
    ...request,
    params,
    headers: rows(config.headers),
    auth: { ...blankAuth(), type: config.authType ?? 'none', token: config.token ?? '', username: config.username ?? '', password: config.password ?? '' },
    bodies: messages.length ? messages : request.bodies,
    ws: {
      ...DEFAULT_WS_SETTINGS,
      subprotocols: config.subprotocols ?? '',
      autoReconnect: config.autoReconnect ?? false,
      reconnectDelay: config.reconnectDelay ?? DEFAULT_WS_SETTINGS.reconnectDelay,
    },
  }
}

/** Reads the old panel's storage once; later calls return null. The old keys are left in place. */
export function takeLegacyWebSocketRequest(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): RequestItem | null {
  try {
    if (storage.getItem(MIGRATED_KEY)) return null
    storage.setItem(MIGRATED_KEY, '1')
    const config = JSON.parse(storage.getItem(LEGACY_CONFIG_KEY) ?? 'null') as LegacyConfig | null
    const templates = JSON.parse(storage.getItem(LEGACY_TEMPLATES_KEY) ?? '[]') as LegacyTemplate[]
    return requestFromLegacy(config, Array.isArray(templates) ? templates : [])
  } catch {
    return null
  }
}

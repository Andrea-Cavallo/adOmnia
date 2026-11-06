import { describe, expect, it } from 'vitest'
import { blankAuth, blankKVRow, type KVRow } from '@/lib/types'
import {
  activeMessage, blankWebSocketRequest, connectPayload, messageMode, outgoingPayload, requestFromLegacy,
  resolveWsUrl, takeLegacyWebSocketRequest, wsAuthSupport, wsMessage, wsScheme,
} from './wsRequest'

const row = (key: string, value: string, enabled = true): KVRow => ({ ...blankKVRow(), key, value, enabled })

describe('connectPayload', () => {
  it('resolves variables in URL, headers and auth', () => {
    const request = {
      ...blankWebSocketRequest('Feed', '{{host}}/feed'),
      headers: [row('X-Tenant', '{{tenant}}'), row('X-Off', 'no', false)],
      auth: { ...blankAuth(), type: 'bearer' as const, token: '{{token}}' },
    }
    const payload = connectPayload(request, { host: 'wss://api.local', tenant: 'acme', token: 't0k' })
    expect(payload.url).toBe('wss://api.local/feed')
    expect(payload.headers).toEqual({ 'X-Tenant': 'acme' })
    expect(payload.auth).toEqual({ type: 'bearer', token: 't0k', username: '', password: '' })
    expect(payload.subprotocols).toBeUndefined()
  })

  it('sends an API key as a handshake header and maps OAuth 2.0 tokens to bearer', () => {
    const apiKey = { ...blankWebSocketRequest('k', 'ws://x'), auth: { ...blankAuth(), type: 'apikey' as const, username: 'X-Key', token: 'secret' } }
    expect(connectPayload(apiKey, {}).headers).toEqual({ 'X-Key': 'secret' })
    expect(connectPayload(apiKey, {}).auth.type).toBe('none')
    const oauth = { ...blankWebSocketRequest('o', 'ws://x'), auth: { ...blankAuth(), type: 'oauth2' as const, token: 'abc' } }
    expect(connectPayload(oauth, {}).auth).toMatchObject({ type: 'bearer', token: 'abc' })
  })

  it('drops auth types the handshake cannot carry and keeps subprotocols', () => {
    const request = { ...blankWebSocketRequest('a', 'ws://x'), auth: { ...blankAuth(), type: 'digest' as const, username: 'u' }, ws: { ...blankWebSocketRequest().ws!, subprotocols: 'graphql-ws, mqtt ,' } }
    expect(wsAuthSupport(request.auth)).toBe('unsupported')
    expect(connectPayload(request, {}).auth.type).toBe('none')
    expect(connectPayload(request, {}).subprotocols).toEqual(['graphql-ws', 'mqtt'])
  })
})

describe('resolveWsUrl', () => {
  it('adds enabled params the URL does not carry, without duplicating those it does', () => {
    const request = { ...blankWebSocketRequest('p', 'ws://h/s?room=1'), params: [row('room', '1'), row('token', '{{t}}'), row('off', 'x', false)] }
    expect(resolveWsUrl(request, { t: 'z' })).toBe('ws://h/s?room=1&token=z')
  })

  it('appends params to a URL that does not parse', () => {
    const request = { ...blankWebSocketRequest('p', '{{missing}}/s'), params: [row('a', 'b c')] }
    expect(resolveWsUrl(request, {})).toBe('{{missing}}/s?a=b%20c')
  })
})

describe('messages', () => {
  it('formats JSON payloads and leaves text alone', () => {
    expect(outgoingPayload('{"a":{{n}}}', 'json', { n: '1' })).toBe('{\n  "a": 1\n}')
    expect(outgoingPayload('not json', 'json', {})).toBe('not json')
    expect(outgoingPayload(' AAEC \n', 'binary', {})).toBe('AAEC')
  })

  it('picks the active message and its mode', () => {
    const request = { ...blankWebSocketRequest(), bodies: [wsMessage('a', '{}'), wsMessage('b', 'hi', 'text')], activeBodyIdx: 5 }
    expect(activeMessage(request)?.name).toBe('b')
    expect(messageMode(request, activeMessage(request))).toBe('text')
    expect(messageMode({ ...request, activeBodyIdx: 0 }, request.bodies[0])).toBe('json')
    expect(messageMode({ ...request, ws: { ...request.ws!, payloadMode: 'binary' } }, request.bodies[0])).toBe('binary')
  })

  it('labels secure sockets', () => {
    expect(wsScheme(' WSS://x')).toBe('WSS')
    expect(wsScheme('ws://x')).toBe('WS')
  })
})

describe('legacy WebSocket panel migration', () => {
  it('keeps URL, query, headers, auth, settings and templates', () => {
    const request = requestFromLegacy(
      { url: 'ws://old/feed', authType: 'basic', username: 'u', password: 'p', headers: [{ key: 'X-A', value: '1' }], queryParams: [{ key: 'q', value: '2', enabled: true }], autoReconnect: true, reconnectDelay: 7, subprotocols: 'v1' },
      [{ name: 'Hello', payload: '{"t":1}', mode: 'json' }, { name: 'Empty', payload: '' }, { payload: 'raw', mode: 'text' }],
    )!
    expect(request.method).toBe('WS')
    expect(request.url).toBe('ws://old/feed?q=2')
    expect(request.headers?.filter((item) => item.key)).toMatchObject([{ key: 'X-A', value: '1', enabled: true }])
    expect(request.auth).toMatchObject({ type: 'basic', username: 'u', password: 'p' })
    expect(request.ws).toMatchObject({ autoReconnect: true, reconnectDelay: 7, subprotocols: 'v1' })
    expect(request.bodies.map((body) => [body.name, body.lang])).toEqual([['Hello', 'json'], ['Message 2', 'text']])
  })

  it('migrates once and ignores a panel that never had a URL', () => {
    const store = new Map<string, string>([['adomnia.websocket', JSON.stringify({ url: 'ws://once' })]])
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    expect(takeLegacyWebSocketRequest(storage)?.url).toBe('ws://once')
    expect(takeLegacyWebSocketRequest(storage)).toBeNull()
    expect(store.get('adomnia.websocket')).toBeDefined()
    expect(requestFromLegacy({}, [])).toBeNull()
  })
})

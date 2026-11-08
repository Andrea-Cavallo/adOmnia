import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mockEndpointStore', () => ({}))
vi.mock('@/lib/devcontext-api', () => ({}))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('@/stores/environments', () => ({ useEnvironmentsStore: { getState: vi.fn() } }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: vi.fn() } }))
vi.mock('@/stores/tabs', () => ({ useTabsStore: { getState: vi.fn() } }))

import { grpcTargetAddress, registerDefaultOpeners, websocketUrlFor } from './openers'
import { actionsFor } from './router'

describe('code → protocol openers', () => {
  it('turns a gRPC listen address into a callable target', () => {
    expect(grpcTargetAddress(':50051')).toBe('localhost:50051')
    expect(grpcTargetAddress('0.0.0.0:9000')).toBe('localhost:9000')
    expect(grpcTargetAddress('api.local:443')).toBe('api.local:443')
    expect(grpcTargetAddress(undefined)).toBe('localhost:50051')
  })

  it('builds WebSocket URLs from the literal client URL or the environment baseUrl', () => {
    const server = { kind: 'websocket' as const, id: 'w', label: '/ws', attrs: { role: 'server', path: '/ws/chat' } }
    expect(websocketUrlFor(server, 'https://api.local:8443/')).toBe('wss://api.local:8443/ws/chat')
    expect(websocketUrlFor(server, undefined)).toBe('ws://localhost:8080/ws/chat')
    expect(websocketUrlFor({ ...server, attrs: { role: 'client', url: 'ws://feed:9000/x' } }, 'http://ignored')).toBe('ws://feed:9000/x')
  })

  it('links a WSDL to its JAX-WS implementation and a SOAP route to SOAP Studio', () => {
    const off = registerDefaultOpeners()
    const contract = { kind: 'contract' as const, id: 'contract:orders.wsdl', label: 'orders.wsdl', attrs: { type: 'wsdl', path: 'orders.wsdl', declFile: 'OrderEndpoint.java', declLine: '7' } }
    expect(actionsFor(contract).map((action) => action.intent)).toContain('implementation')
    const route = { kind: 'route' as const, id: 'route:POST /orders', label: 'POST /orders', sessionId: 's1', attrs: { method: 'POST', path: '/orders', contract: 'orders.wsdl' } }
    expect(actionsFor(route).map((action) => action.intent)).toContain('soap')
    expect(actionsFor({ ...route, attrs: { method: 'GET', path: '/x' } }).map((action) => action.intent)).not.toContain('soap')
    off()
  })
})

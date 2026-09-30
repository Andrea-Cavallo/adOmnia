import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mockEndpointStore', () => ({}))
vi.mock('@/lib/devcontext-api', () => ({}))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('@/stores/environments', () => ({ useEnvironmentsStore: { getState: vi.fn() } }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: { getState: vi.fn() } }))
vi.mock('@/stores/tabs', () => ({ useTabsStore: { getState: vi.fn() } }))

import { grpcTargetAddress, websocketUrlFor } from './openers'

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
})

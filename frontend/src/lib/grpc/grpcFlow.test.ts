import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FLOW_SETTINGS, type FlowGraphDefinition } from '@/lib/flowStorage'
import { runApiFlow } from '@/lib/flowRunner'
import { executeRequest } from '@/lib/executeRequest'
import type { GrpcCallBody } from './grpcApi'
import { blankGrpcRequest, grpcMessage } from './grpcRequest'

const calls: GrpcCallBody[] = []
vi.mock('./grpcApi', () => ({
  invokeGrpc: vi.fn(async (body: GrpcCallBody) => {
    calls.push(body)
    if (body.method === 'GetUser') return { status: 'OK', response: { id: 'u-7', active: true }, time_ms: 3 }
    return { status: 'NotFound', error: `no order for ${JSON.stringify(body.payload)}`, time_ms: 2 }
  }),
}))
vi.mock('@/lib/devsession/grpcCapture', () => ({
  beginGrpcCapture: vi.fn(async (_a: string, _s: string, _m: string, _t: boolean, metadata: Record<string, string>) => ({ run: null, metadata, debug: false })),
  endGrpcCapture: vi.fn(async () => undefined),
}))

function call(method: string, message: string) {
  const request = blankGrpcRequest(method, 'localhost:50051')
  return { ...request, bodies: [grpcMessage('m', message)], grpc: { ...request.grpc!, service: 'shop.v1.Shop', method, kind: 'unary' as const } }
}

describe('gRPC in Flows', () => {
  beforeEach(() => { calls.length = 0 })

  it('runs gRPC calls as flow steps: status, extraction into variables, failure branch', async () => {
    const graph: FlowGraphDefinition = {
      settings: DEFAULT_FLOW_SETTINGS,
      nodes: [
        { id: 'user', type: 'request', label: 'Get user', x: 0, y: 0, config: { request: call('GetUser', '{"id":"me"}'), expectedStatus: '2xx', extractions: [{ id: 'x', name: 'userId', source: 'body', path: 'id' }] } },
        { id: 'order', type: 'request', label: 'Get order', x: 0, y: 0, config: { request: call('GetOrder', '{"user":"{{userId}}"}'), expectedStatus: '2xx', stopOnFailure: false } },
      ],
      edges: [{ id: 'e', source: 'user', target: 'order', branch: 'success' }],
    }
    const result = await runApiFlow(graph, { initialVars: {}, execute: (request, vars, options) => executeRequest(request, vars, options) })
    expect(calls.map((body) => body.method)).toEqual(['GetUser', 'GetOrder'])
    expect(result.vars.userId).toBe('u-7')
    expect(calls[1].payload).toEqual({ user: 'u-7' })
    expect(result.runtime.user.status).toBe('success')
    expect(result.runtime.order.status).toBe('failed')
    expect(result.entries[1].httpStatus).toBe(404)
  })
})

import { describe, expect, it } from 'vitest'
import { runApiFlow, validateFlowGraph } from '@/lib/flowRunner'
import { createMockCommerceCollection, createMockCommerceFlow } from '@/lib/mockFlowDemo'
import type { RequestItem, ResponseData } from '@/lib/types'

function response(status: number, body: unknown): ResponseData {
  return {
    status,
    statusText: status === 201 ? 'Created' : 'OK',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    contentType: 'application/json',
    ms: 12,
    size: JSON.stringify(body).length,
  }
}

describe('mock flow demo', () => {
  it('creates a runnable four API flow backed by mock endpoints', async () => {
    const collection = createMockCommerceCollection('http://127.0.0.1:3000')
    const flow = createMockCommerceFlow(collection)

    expect(validateFlowGraph(flow.graph)).toEqual([])
    expect(flow.graph.nodes.filter((node) => node.type === 'request')).toHaveLength(4)

    const seen: string[] = []
    const result = await runApiFlow(flow.graph, {
      initialVars: {},
      execute: async (request: RequestItem) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`)
        if (request.url.endsWith('/demo/auth/login')) return { response: response(200, { access_token: 'demo-local-token' }), vars: {}, mutations: {}, scriptRuns: [] }
        if (request.url.endsWith('/demo/catalog/products')) return { response: response(200, { products: [] }), vars: {}, mutations: {}, scriptRuns: [] }
        if (request.url.endsWith('/demo/orders')) return { response: response(201, { orderId: 'ord_9001' }), vars: {}, mutations: {}, scriptRuns: [] }
        return { response: response(200, { receiptNo: 'rcpt_2026_0001' }), vars: {}, mutations: {}, scriptRuns: [] }
      },
    })

    expect(seen).toEqual([
      'POST /demo/auth/login',
      'GET /demo/catalog/products',
      'POST /demo/orders',
      'GET /demo/orders/ord_9001/receipt',
    ])
    const lastEntry = result.entries[result.entries.length - 1]
    expect(lastEntry?.nodeLabel).toBe('End success')
    expect(lastEntry?.status).toBe('success')
  })
})

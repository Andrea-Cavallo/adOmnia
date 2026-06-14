import { flattenApiCatalog } from '@/lib/apiCatalog'
import { graphFromMermaid } from '@/lib/flowMermaid'
import { DEFAULT_FLOW_SETTINGS, type SavedFlowDefinition } from '@/lib/flowStorage'
import { blankRequest, type Collection, type HttpMethod, type RequestItem, uid } from '@/lib/types'

export const MOCK_FLOW_DEMO_NAME = 'Mock Commerce API flow'

interface MockDemoEndpoint {
  id: string
  path: string
  method: string
  description: string
  responses: Array<{
    id: string
    name: string
    status: number
    headers: Record<string, string>
    body: string
    delayMs: number
    isActive: boolean
  }>
  mode: string
  enabled: boolean
}

function jsonBody(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function mockEndpoint(method: HttpMethod, path: string, description: string, status: number, body: unknown): MockDemoEndpoint {
  return {
    id: uid(),
    path,
    method,
    description,
    responses: [{
      id: uid(),
      name: `${method} ${path} success`,
      status,
      headers: { 'Content-Type': 'application/json' },
      body: jsonBody(body),
      delayMs: 80,
      isActive: true,
    }],
    mode: 'first_active',
    enabled: true,
  }
}

function demoRequest(method: HttpMethod, name: string, url: string, body?: unknown): RequestItem {
  const request = blankRequest(method, name)
  return {
    ...request,
    url,
    headers: [{ id: uid(), key: 'Content-Type', value: 'application/json', enabled: true }],
    bodies: [{
      id: uid(),
      name: 'Body 1',
      type: body === undefined ? 'none' : 'raw',
      raw: body === undefined ? '' : jsonBody(body),
      lang: 'json',
      form: [],
    }],
    activeBodyIdx: 0,
    assertions: [{ id: uid(), enabled: true, target: 'statusCode', operator: 'gte', expected: '200' }],
  }
}

export function createMockCommerceEndpoints(): MockDemoEndpoint[] {
  return [
    mockEndpoint('POST', '/demo/auth/login', 'Issue a local demo access token', 200, {
      access_token: 'demo-local-token',
      expires_in: 3600,
      user: { id: 'usr_1001', name: 'Andrea Demo' },
    }),
    mockEndpoint('GET', '/demo/catalog/products', 'Return a small product catalog', 200, {
      products: [
        { sku: 'coffee-001', name: 'Espresso beans', price: 9.9, stock: 42 },
        { sku: 'mug-002', name: 'adOmnia mug', price: 14.5, stock: 12 },
      ],
    }),
    mockEndpoint('POST', '/demo/orders', 'Create a demo order', 201, {
      orderId: 'ord_9001',
      status: 'created',
      total: 24.4,
      links: { receipt: '/demo/orders/ord_9001/receipt' },
    }),
    mockEndpoint('GET', '/demo/orders/:param/receipt', 'Return the generated order receipt', 200, {
      orderId: 'ord_9001',
      paid: true,
      receiptNo: 'rcpt_2026_0001',
      total: 24.4,
    }),
  ]
}

export function createMockCommerceCollection(mockBaseUrl: string): Collection {
  return {
    id: uid(),
    name: 'Mock Commerce Demo',
    children: [
      demoRequest('POST', 'POST Mock Login', `${mockBaseUrl}/demo/auth/login`, { username: 'andrea', password: 'demo' }),
      demoRequest('GET', 'GET Mock Products', `${mockBaseUrl}/demo/catalog/products`),
      demoRequest('POST', 'POST Mock Order', `${mockBaseUrl}/demo/orders`, {
        customerId: 'usr_1001',
        items: [{ sku: 'coffee-001', quantity: 1 }, { sku: 'mug-002', quantity: 1 }],
      }),
      demoRequest('GET', 'GET Mock Receipt', `${mockBaseUrl}/demo/orders/ord_9001/receipt`),
    ],
  }
}

export const MOCK_COMMERCE_MERMAID = `flowchart TD
  S((Start)) --> A[POST Mock Login]
  A --> B[GET Mock Products]
  B --> C[POST Mock Order]
  C --> D{Order created?}
  D -->|yes| E[GET Mock Receipt]
  D -->|no| X((End failed))
  E --> Z((End success))
`

export function createMockCommerceFlow(collection: Collection): SavedFlowDefinition {
  const graph = graphFromMermaid(MOCK_COMMERCE_MERMAID, flattenApiCatalog([collection]))
  return {
    id: uid(),
    name: MOCK_FLOW_DEMO_NAME,
    graph: {
      ...graph,
      settings: { ...DEFAULT_FLOW_SETTINGS, stopOnMissingBranch: false },
      nodes: graph.nodes.map((node) => (
        node.label === 'Order created?' && node.type === 'condition'
          ? {
              ...node,
              config: {
                ...node.config,
                condition: { source: 'status', path: 'response.status', operator: 'eq', value: '201' },
              },
            }
          : node
      )),
    },
    mermaidSource: MOCK_COMMERCE_MERMAID,
    updatedAt: new Date().toISOString(),
    version: 3,
  }
}

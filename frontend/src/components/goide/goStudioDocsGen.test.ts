import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/markdownDoc'
import { apiDocsMarkdown, architectureMarkdown, openApiFromRoutes, openApiPath, packageDocMarkdown, parseSourceLink, protoMarkdown, sourceLink } from './goStudioDocsGen'

const site = (relativePath: string, line: number) => ({ relativePath, line, column: 1 })
const pkg = {
  importPath: 'example.com/shop', name: 'shop', dir: 'shop', synopsis: 'Package shop sells things.', doc: 'Package shop sells things.\n',
  consts: [{ names: ['Limit'], doc: 'Limit caps orders.', decl: 'const Limit = 3', site: site('shop/shop.go', 3) }], vars: [],
  funcs: [{ name: 'Load', doc: '', decl: 'func Load()', site: site('shop/shop.go', 9) }],
  types: [{ name: 'Store', doc: 'Store keeps orders.', decl: 'type Store struct{}', site: site('shop/shop.go', 5), consts: [], vars: [], funcs: [{ name: 'NewStore', doc: 'NewStore creates a store.', decl: 'func NewStore() *Store', site: site('shop/shop.go', 7) }], methods: [{ name: 'Save', recv: '*Store', doc: '', decl: 'func (s *Store) Save() error', site: site('shop/shop.go', 8) }] }],
  notes: { BUG: ['totals ignore taxes.'] }, problems: [], site: site('shop/shop.go', 1),
} as any

describe('documentation generators', () => {
  it('renders a package like go doc, with links to the source', () => {
    const markdown = packageDocMarkdown(pkg)
    expect(markdown).toContain('# package shop')
    expect(markdown).toContain('`import "example.com/shop"`')
    expect(markdown).toContain('- func (*Store) Save')
    expect(markdown).toContain('```go\nfunc (s *Store) Save() error\n```')
    expect(markdown).toContain('[source](/shop/shop.go#L8)')
    expect(markdown).toContain('## BUGs\n\n- totals ignore taxes.')
    expect(renderMarkdown(markdown)).toContain('href="/shop/shop.go#L8"')
    expect(apiDocsMarkdown([pkg], 'Shop')).toContain('## package shop')
  })

  it('round-trips source links', () => {
    expect(sourceLink(site('a/b.go', 12), 'x')).toBe('[x](/a/b.go#L12)')
    expect(parseSourceLink('/a/b.go#L12')).toEqual({ path: 'a/b.go', line: 12 })
    expect(parseSourceLink('https://x')).toBeNull()
  })

  it('embeds Mermaid diagrams and service tables in the architecture document', () => {
    const report = {
      packages: [{ path: 'example.com/shop/cmd', name: 'main', module: 'example.com/shop', files: 1, site: site('cmd/main.go', 1), external: [], std: 0 }, { path: 'example.com/shop/store', name: 'store', module: 'example.com/shop', files: 1, site: site('store/s.go', 1), external: [], std: 0 }],
      imports: [{ from: 'example.com/shop/cmd', to: 'example.com/shop/store', count: 1 }], packageCalls: [], functions: [], calls: [], modules: [],
      interfaces: [{ name: 'Store', package: 'example.com/shop/store', site: site('store/s.go', 3), methods: [], embeds: [], implementations: [{ type: 'mem', package: 'example.com/shop/store', pointer: true, site: site('store/s.go', 9) }], users: [], userCount: 2, methodUses: [], nearMisses: [], hints: [] }],
      entries: [{ kind: 'http', name: 'GET /orders/{id}', package: 'example.com/shop/cmd', function: 'main', site: site('cmd/main.go', 12) }],
    } as any
    const markdown = architectureMarkdown(report, 'Shop')
    expect(markdown).toContain('```mermaid\nflowchart TD')
    expect(markdown).toContain('n_example_com_shop_cmd --> n_example_com_shop_store')
    expect(markdown).toContain('| GET /orders/{id} | — | [cmd/main.go:12](/cmd/main.go#L12) |')
    expect(markdown).toContain('| [shop/store.Store](/store/s.go#L3) | *mem | 2 |')
    expect(renderMarkdown(markdown)).toContain('data-mermaid="flowchart TD')
  })

  it('builds OpenAPI paths and operations from the routes', () => {
    expect(openApiPath('/users/:id/files/*rest')).toEqual({ path: '/users/{id}/files/{rest}', parameters: ['id', 'rest'] })
    expect(openApiPath('/files/{path...}')).toEqual({ path: '/files/{path}', parameters: ['path'] })
    const spec = openApiFromRoutes([
      { kind: 'http', name: 'GET /orders/{id}', package: 'example.com/shop/api', function: 'getOrder', site: site('api/a.go', 4) },
      { kind: 'http', name: 'POST /orders', package: 'example.com/shop/api', function: 'createOrder', site: site('api/a.go', 9) },
      { kind: 'http', name: '/health', package: 'example.com/shop/api', function: 'main', site: site('api/a.go', 2) },
      { kind: 'grpc', name: 'Greeter', package: 'p', site: site('g.go', 1) },
    ] as any, 'Shop') as any
    expect(Object.keys(spec.paths)).toEqual(['/orders/{id}', '/orders', '/health'])
    expect(spec.paths['/orders/{id}'].get).toMatchObject({ operationId: 'getgetOrder', tags: ['shop/api'], parameters: [{ name: 'id', in: 'path', required: true }] })
    expect(spec.paths['/orders'].post.responses).toEqual({ default: { description: 'Response (not described in the code yet)' } })
    expect(spec.openapi).toBe('3.0.3')
  })

  it('documents proto services, messages and enums', () => {
    const markdown = protoMarkdown([
      { path: 'api/orders.proto', package: 'shop.v1', syntax: 'proto3', doc: 'Orders API.', services: [{ name: 'Orders', doc: 'Manages orders.', line: 5, methods: [{ name: 'Watch', input: 'Req', output: 'Order', serverStreaming: true, line: 6, doc: 'live | updates' }] }], messages: [{ name: 'Order', line: 9, fields: [{ name: 'items', number: 2, type: 'Item', label: 'repeated', doc: '' }] }], enums: [{ name: 'Status', line: 12, values: [{ name: 'PAID', number: 1, doc: 'Paid.' }] }] },
      { path: 'broken.proto', services: [], messages: [], enums: [], error: 'syntax error' },
    ] as any, 'Shop')
    expect(markdown).toContain(String.raw`| Watch | Req | stream Order | live \| updates |`)
    expect(markdown).toContain('| items | 2 | repeated Item |  |')
    expect(markdown).toContain('| PAID | 1 | Paid. |')
    expect(markdown).toContain('> Could not read this file: syntax error')
  })
})

describe('OpenAPI with DTO schemas', () => {
  it('adds request and response bodies and component schemas from the handler', () => {
    const schemas = [
      { name: 'CreateOrder', package: 'p', site: site('a.go', 1), fields: [{ name: 'item', goName: 'Item', type: 'string', required: true }, { name: 'tags', goName: 'Tags', type: 'array', items: 'string' }, { name: 'ship', goName: 'Ship', type: 'object', ref: 'Address' }, { name: 'at', goName: 'At', type: 'string', format: 'date-time', required: true }] },
      { name: 'Address', package: 'p', site: site('a.go', 5), fields: [{ name: 'city', goName: 'City', type: 'string', required: true }] },
    ]
    const spec = openApiFromRoutes([{ kind: 'http', name: 'POST /api/v1/orders', package: 'example.com/api', handler: 'Handlers.Create', handlerSite: site('api/h.go', 20), middleware: ['Logging', 'Auth'], request: { type: 'api.CreateOrder', ref: 'CreateOrder' }, response: { type: 'api.Order', ref: 'Order', array: true }, site: site('api/r.go', 4) }] as any, 'Shop', schemas as any) as any
    const operation = spec.paths['/api/v1/orders'].post
    expect(operation.operationId).toBe('postHandlersCreate')
    expect(operation.description).toBe('Handled by Handlers.Create (api/h.go:20). Middleware: Logging, Auth.')
    expect(operation.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/CreateOrder' })
    expect(operation.responses[200].content['application/json'].schema).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Order' } })
    expect(spec.components.schemas.CreateOrder).toEqual({
      type: 'object',
      properties: { item: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, ship: { $ref: '#/components/schemas/Address' }, at: { type: 'string', format: 'date-time' } },
      required: ['item', 'at'],
    })
  })
})

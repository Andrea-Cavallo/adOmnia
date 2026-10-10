import { describe, expect, it } from 'vitest'
import type { GoIDEArchEntry } from '@/lib/goide-api'
import { callNeighbourhood, entityRefsForEntry, groupEntries, interfaceGraph, kafkaTopics, isWrite, packageGraph, queriesByTable, searchFunctions, shortPackage } from './goStudioArchitecture'

const site = (relativePath: string, line = 1) => ({ relativePath, line, column: 1 })
const pkg = (path: string) => ({ path, name: path.split('/').pop()!, module: 'example.com/shop', files: 2, site: site(`${path}.go`), external: [], std: 1 })
const report = {
  packages: [pkg('example.com/shop/cmd'), pkg('example.com/shop/service'), pkg('example.com/shop/store'), pkg('example.com/shop/util')],
  imports: [{ from: 'example.com/shop/cmd', to: 'example.com/shop/service', count: 1 }, { from: 'example.com/shop/service', to: 'example.com/shop/store', count: 1 }],
  packageCalls: [],
  functions: [
    { id: 'main', name: 'main', package: 'example.com/shop/cmd', site: site('main.go') },
    { id: 'Lookup', name: 'Service.Lookup', package: 'example.com/shop/service', site: site('s.go') },
    { id: 'Get', name: 'Store.Get', package: 'example.com/shop/store', abstract: true, site: site('t.go') },
    { id: 'Log', name: 'Log', package: 'example.com/shop/util', site: site('u.go') },
  ],
  calls: [{ from: 'main', to: 'Lookup', count: 1 }, { from: 'Lookup', to: 'Get', count: 2 }, { from: 'Lookup', to: 'Log', count: 1 }],
  modules: [], interfaces: [], entries: [],
} as any

describe('architecture helpers', () => {
  it('shortens package paths relative to their module', () => {
    expect(shortPackage('example.com/shop/internal/store', 'example.com/shop')).toBe('internal/store')
    expect(shortPackage('github.com/acme/lib/pkg/x')).toBe('pkg/x')
  })

  it('builds the import graph and focuses on a package and its neighbours', () => {
    expect(packageGraph(report, 'imports', null).links).toHaveLength(2)
    const focused = packageGraph(report, 'imports', 'example.com/shop/service')
    expect(focused.nodes.map((node) => node.id).sort()).toEqual(['example.com/shop/cmd', 'example.com/shop/service', 'example.com/shop/store'])
    expect(packageGraph(report, 'imports', null, 2).hidden).toBe(2)
  })

  it('finds functions and their callers and callees', () => {
    expect(searchFunctions(report, 'look').map((fn) => fn.id)).toEqual(['Lookup'])
    const graph = callNeighbourhood(report, 'Lookup')
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['Get', 'Log', 'Lookup', 'main'])
    expect(graph.links).toHaveLength(3)
    expect(graph.nodes.find((node) => node.id === 'Get')?.data.subtitle).toContain('interface')
  })

  it('draws consumers above an interface and implementations below', () => {
    const iface = { name: 'Store', package: 'example.com/shop/store', site: site('t.go'), methods: ['Get(id string) string'], embeds: [], implementations: [{ type: 'mem', package: 'example.com/shop/store', pointer: true, site: site('m.go') }], users: [{ kind: 'field', package: 'example.com/shop/service', site: site('s.go') }], userCount: 1, methodUses: [], nearMisses: [], hints: [] } as any
    const graph = interfaceGraph(iface)
    expect(graph.links).toEqual([{ from: 'consumer:example.com/shop/service', to: 'example.com/shop/store.Store', value: 1 }, { from: 'example.com/shop/store.Store', to: 'impl:example.com/shop/store.mem', value: 1 }])
  })

  it('groups entries and maps services to adOmnia entities', () => {
    const entries = [
      { kind: 'http', name: 'GET /orders/{id}', package: 'p', site: site('main.go', 9) },
      { kind: 'kafka-consumer', name: 'consume', package: 'p', topics: ['orders', 'payments'], site: site('k.go') },
      { kind: 'grpc', name: 'Greeter', package: 'p', site: site('g.go') },
    ] as any
    expect(groupEntries(entries).map((group) => group.kind)).toEqual(['http', 'grpc', 'kafka-consumer'])
    expect(groupEntries(entries, 'payments').map((group) => group.kind)).toEqual(['kafka-consumer'])
    expect(entityRefsForEntry(entries[0], 's1')[0]).toMatchObject({ kind: 'route', attrs: { method: 'GET', path: '/orders/{id}' }, source: { file: 'main.go', line: 9 } })
    expect(entityRefsForEntry(entries[1], 's1').map((ref) => ref.label)).toEqual(['orders', 'payments'])
    expect(entityRefsForEntry(entries[2], 's1')[0]).toMatchObject({ kind: 'grpc', label: 'Greeter' })
    const client = { kind: 'websocket-client', name: 'ws://localhost:9000/feed', package: 'p', site: site('w.go') } as any
    expect(groupEntries([client]).map((group) => group.title)).toEqual(['WebSocket clients'])
    expect(entityRefsForEntry(client, 's1')[0]).toMatchObject({ kind: 'websocket', attrs: { url: 'ws://localhost:9000/feed' } })
    expect(entityRefsForEntry({ ...client, name: 'Follow' }, 's1')).toEqual([])
  })
})

describe('data access', () => {
  const q = (fn: string, tables: string[], extra: Record<string, unknown> = {}) => ({ library: 'database/sql', operation: 'query', method: 'QueryContext', tables, function: fn, package: 'p', site: site('a.go'), ...extra }) as any
  it('groups queries by table with reads, writes and the functions that touch it', () => {
    const tables = queriesByTable([
      q('List', ['orders', 'customers']),
      q('Pay', ['orders'], { operation: 'exec', method: 'ExecContext' }),
      q('Rename', ['order_items'], { operation: 'orm', method: 'Updates', tableGuess: true }),
      q('Count', []),
    ])
    expect(tables.map((item) => [item.table, item.reads, item.writes, item.functions.join(','), item.guess])).toEqual([
      ['orders', 1, 1, 'List,Pay', false],
      ['customers', 1, 0, 'List', false],
      ['order_items', 0, 1, 'Rename', true],
    ])
    expect(queriesByTable([q('List', ['orders'])], 'cust')).toEqual([])
    expect(isWrite(q('x', [], { sql: '  INSERT INTO a VALUES (1)' }))).toBe(true)
  })
})

describe('kafka topics', () => {
  it('inverts entries into topic → producers and consumers with groups and roles', () => {
    const entries = [
      { kind: 'kafka-producer', name: 'Publish', package: 'p', topics: ['orders', 'orders.DLQ'], topicRoles: { 'orders.DLQ': 'dead-letter' }, site: site('a.go') },
      { kind: 'kafka-consumer', name: 'Consume', package: 'p', topics: ['orders'], group: 'billing', site: site('b.go') },
      { kind: 'kafka-consumer', name: 'Audit', package: 'p', topics: ['orders'], group: 'audit', site: site('c.go') },
      { kind: 'http', name: 'GET /x', package: 'p', site: site('d.go') },
    ] as GoIDEArchEntry[]
    const topics = kafkaTopics(entries)
    expect(topics.map((t) => t.topic)).toEqual(['orders', 'orders.DLQ'])
    expect(topics[0].producers.map((e) => e.name)).toEqual(['Publish'])
    expect(topics[0].consumers.map((e) => e.name)).toEqual(['Consume', 'Audit'])
    expect(topics[0].groups).toEqual(['billing', 'audit'])
    expect(topics[1].role).toBe('dead-letter')
    expect(kafkaTopics(entries, 'audit').map((t) => t.topic)).toEqual(['orders'])
  })
})

import { describe, expect, it } from 'vitest'
import { callNeighbourhood, entityRefsForEntry, groupEntries, interfaceGraph, packageGraph, searchFunctions, shortPackage } from './goStudioArchitecture'

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
  })
})

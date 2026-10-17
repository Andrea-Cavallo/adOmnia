import { describe, expect, it } from 'vitest'
import type { GoIDEArchEntry } from '@/lib/code-studio-api'
import { callNeighbourhood, entityRefsForEntry, groupEntries, interfaceGraph, kafkaTopics, isWrite, packageGraph, packageView, DEFAULT_PACKAGE_VIEW, cycleMembers, packageGroup, groupGoroutines, filterGoroutines, matchGoroutineSite, NO_GOROUTINE_FILTER, queriesByTable, searchFunctions, shortPackage } from './codeStudioArchitecture'

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
    const nats = { kind: 'nats-consumer', name: 'Listen', package: 'p', topics: ['orders.created'], site: site('n.go') } as any
    expect(groupEntries([nats]).map((group) => group.title)).toEqual(['NATS subscribers'])
    expect(entityRefsForEntry(nats, 's1')[0]).toMatchObject({ kind: 'topic', id: 'topic:nats:orders.created', attrs: { broker: 'nats' } })
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

describe('packageView', () => {
  const base = 'example.com/shop'
  const names = ['cmd', 'internal/api', 'internal/store', 'internal/cache', 'pkg/util']
  const wide = {
    ...report,
    packages: names.map((name) => ({ ...pkg(`${base}/${name}`), stdImports: ['fmt'], external: name === 'pkg/util' ? ['github.com/x/y'] : [] })),
    imports: [
      ['cmd', 'internal/api'], ['cmd', 'internal/store'], ['internal/api', 'internal/store'], ['internal/store', 'internal/cache'],
      ['internal/api', 'internal/cache'], ['internal/cache', 'internal/store'], ['internal/api', 'pkg/util'],
    ].map(([from, to]) => ({ from: `${base}/${from}`, to: `${base}/${to}`, count: 1 })),
  } as typeof report
  const view = (patch = {}) => packageView(wide, { ...DEFAULT_PACKAGE_VIEW, ...patch })

  it('shows every package and counts the transitive edges it hides', () => {
    const result = view()
    expect(result.shown).toBe(5)
    expect(result.total).toBe(5)
    expect(result.reduced).toBe(2)
    expect(view({ reduce: false }).reduced).toBe(0)
  })

  it('focuses on a package up to the chosen depth instead of cutting at a fixed size', () => {
    const focus = `${base}/pkg/util`
    expect(view({ focus, depth: 1 }).nodes.map((node) => node.id).sort()).toEqual([`${base}/internal/api`, focus].sort())
    expect(view({ focus, depth: 2 }).shown).toBe(5)
    expect(view({ focus: `${base}/cmd`, depth: 1 }).shown).toBe(3)
  })

  it('reports cycles and can show only them', () => {
    expect(cycleMembers(view({ reduce: false }).links)).toEqual(new Set([`${base}/internal/store`, `${base}/internal/cache`]))
    const cycles = view({ cyclesOnly: true })
    expect(cycles.nodes.map((node) => node.id).sort()).toEqual([`${base}/internal/cache`, `${base}/internal/store`])
    expect(cycles.cycles).toBe(2)
  })

  it('collapses packages by top-level folder until the group is expanded', () => {
    expect(packageGroup(`${base}/internal/store`, base)).toBe('internal')
    expect(packageGroup(`${base}/cmd`, base)).toBe('')
    const grouped = view({ group: true })
    expect(grouped.nodes.map((node) => node.id)).toContain('group:internal')
    expect(grouped.nodes.some((node) => node.id === `${base}/internal/api`)).toBe(false)
    expect(view({ group: true, expanded: new Set(['internal']) }).nodes.some((node) => node.id === `${base}/internal/api`)).toBe(true)
  })

  it('adds standard library and external nodes only when asked', () => {
    expect(view().nodes.some((node) => node.data.kind === 'std' || node.data.kind === 'external')).toBe(false)
    expect(view({ std: true }).nodes.filter((node) => node.data.kind === 'std')).toHaveLength(1)
    expect(view({ external: true }).nodes.filter((node) => node.data.kind === 'external')).toHaveLength(1)
  })
})

describe('goroutine grouping and filters', () => {
  const launch = (patch: Record<string, unknown>) => ({ kind: 'go', shape: 'literal', package: 'example.com/shop/api', function: 'Handler', site: site('api/api.go', 10), risks: [], severity: 'none', ...patch }) as any
  const items = [
    launch({ function: 'Handler', risks: ['fire-and-forget-in-handler'], severity: 'medium' }),
    launch({ function: 'Handler', site: site('api/api.go', 12), kind: 'errgroup', inLoop: true, loopKind: 'for', bounded: true }),
    launch({ package: 'example.com/shop/store', function: 'Flush', site: site('store/s.go', 4), inLoop: true, risks: ['unbounded-loop-spawn', 'loop-var-capture'], severity: 'high' }),
    launch({ package: 'example.com/shop/util', function: 'Tick', kind: 'afterfunc', site: site('util/u.go', 2) }),
  ]

  it('groups by package then function, riskiest package first', () => {
    const groups = groupGoroutines(items)
    expect(groups.map((group) => group.package)).toEqual(['example.com/shop/store', 'example.com/shop/api', 'example.com/shop/util'])
    expect(groups[1].functions).toHaveLength(1)
    expect(groups[1].functions[0].items).toHaveLength(2)
    expect(groups[1]).toMatchObject({ count: 2, risky: 1 })
  })

  it('filters by risk, loop, kind and text', () => {
    expect(filterGoroutines(items, { ...NO_GOROUTINE_FILTER, risksOnly: true })).toHaveLength(2)
    expect(filterGoroutines(items, { ...NO_GOROUTINE_FILTER, inLoopOnly: true })).toHaveLength(2)
    expect(filterGoroutines(items, { ...NO_GOROUTINE_FILTER, kinds: new Set(['errgroup', 'afterfunc']) })).toHaveLength(2)
    expect(filterGoroutines(items, { ...NO_GOROUTINE_FILTER, query: 'flush' })).toHaveLength(1)
    expect(filterGoroutines(items, { ...NO_GOROUTINE_FILTER, query: 'loop-var' })).toHaveLength(1)
    expect(groupGoroutines(items, { ...NO_GOROUTINE_FILTER, query: 'nothing here' })).toEqual([])
  })

  it('matches a runtime creation frame to the static launch by file and line', () => {
    expect(matchGoroutineSite(items, 'C:\\proj\\store\\s.go', 4)?.function).toBe('Flush')
    expect(matchGoroutineSite(items, '/work/proj/api/api.go', 12)?.kind).toBe('errgroup')
    expect(matchGoroutineSite(items, '/work/proj/api/api.go', 99)).toBeUndefined()
  })
})

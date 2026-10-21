import type { GoIDEArchEntry, GoIDEArchInterface, GoIDEArchitecture } from '@/lib/code-studio-api'
import type { EntityRef } from '@/lib/entities/types'
import { reduceTransitive, type LayeredInput, type LayeredLink } from './codeStudioLayeredGraph'

/** Nodo dei grafi dell'Architecture Explorer: cosa disegnare e dove aprire il codice. */
export interface ArchNode {
  kind: 'package' | 'group' | 'std' | 'external' | 'function' | 'interface' | 'implementation' | 'consumer' | 'module'
  title: string
  subtitle: string
  tooltip: string
  site?: { relativePath: string; line: number; column: number }
}

export interface ArchGraph {
  nodes: LayeredInput<ArchNode>[]
  links: LayeredLink[]
  hidden: number
}

/** "example.com/shop/internal/store" → "internal/store" (relativo al modulo quando possibile). */
export function shortPackage(path: string, module?: string): string {
  if (module && path.startsWith(`${module}/`)) return path.slice(module.length + 1)
  if (module && path === module) return path.split('/').pop() ?? path
  const parts = path.split('/')
  return parts.slice(-2).join('/')
}

/**
 * Grafo dei package: import o volume di chiamate tra package. Con un focus mostra solo il package
 * e i suoi vicini; altrimenti i `limit` package più collegati.
 */
export function packageGraph(report: GoIDEArchitecture, mode: 'imports' | 'calls', focus: string | null, limit = 40): ArchGraph {
  const edges = mode === 'imports' ? report.imports : report.packageCalls
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + edge.count)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + edge.count)
  }
  let chosen = report.packages
  if (focus) {
    const neighbours = new Set([focus, ...edges.filter((edge) => edge.from === focus || edge.to === focus).flatMap((edge) => [edge.from, edge.to])])
    chosen = chosen.filter((pkg) => neighbours.has(pkg.path))
  }
  const sorted = [...chosen].sort((a, b) => (degree.get(b.path) ?? 0) - (degree.get(a.path) ?? 0) || a.path.localeCompare(b.path))
  const visible = sorted.slice(0, limit)
  const ids = new Set(visible.map((pkg) => pkg.path))
  return {
    nodes: visible.map((pkg) => ({
      id: pkg.path,
      weight: degree.get(pkg.path) ?? 0,
      data: {
        kind: 'package', title: shortPackage(pkg.path, pkg.module), site: pkg.site,
        subtitle: `${pkg.files} file${pkg.files === 1 ? '' : 's'} · ${pkg.external.length} external`,
        tooltip: `${pkg.path}\n${pkg.files} files, ${pkg.std} standard library imports${pkg.external.length ? `\nExternal: ${pkg.external.join(', ')}` : ''}`,
      },
    })),
    links: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => ({ from: edge.from, to: edge.to, value: edge.count })),
    hidden: sorted.length - visible.length,
  }
}

export interface PackageViewOptions {
  mode: 'imports' | 'calls'
  focus: string | null
  /** Distanza dal focus (in archi, in entrambe le direzioni). */
  depth: number
  /** Nasconde a→c quando esiste già a→b→c. */
  reduce: boolean
  std: boolean
  external: boolean
  /** Raccoglie i package della stessa cartella di primo livello; `expanded` ne apre alcune. */
  group: boolean
  expanded: ReadonlySet<string>
  cyclesOnly: boolean
}

export const DEFAULT_PACKAGE_VIEW: PackageViewOptions = { mode: 'imports', focus: null, depth: 1, reduce: true, std: false, external: false, group: false, expanded: new Set(), cyclesOnly: false }

export interface PackageView extends ArchGraph {
  /** Package del progetto nel report e quanti ne restano dopo focus/filtri. */
  total: number
  shown: number
  /** Archi nascosti dalla riduzione transitiva. */
  reduced: number
  /** Package che partecipano a un ciclo di import. */
  cycles: number
}

const MAX_VIEW_NODES = 150

/** Cartella di primo livello di un package ("internal/store" → "internal"); vuota se il package è già al primo livello. */
export function packageGroup(path: string, module?: string): string {
  const short = shortPackage(path, module)
  return short.includes('/') ? short.split('/')[0] : ''
}

/** Componenti fortemente connesse con più di un nodo (Tarjan): i cicli di import. */
export function cycleMembers(links: readonly LayeredLink[]): Set<string> {
  const next = new Map<string, string[]>()
  for (const link of links) if (link.from !== link.to) next.set(link.from, [...(next.get(link.from) ?? []), link.to])
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const members = new Set<string>()
  let counter = 0
  const visit = (id: string) => {
    index.set(id, counter)
    low.set(id, counter++)
    stack.push(id)
    onStack.add(id)
    for (const other of next.get(id) ?? []) {
      if (!index.has(other)) {
        visit(other)
        low.set(id, Math.min(low.get(id)!, low.get(other)!))
      } else if (onStack.has(other)) low.set(id, Math.min(low.get(id)!, index.get(other)!))
    }
    if (low.get(id) !== index.get(id)) return
    const component: string[] = []
    for (let top = stack.pop()!; ; top = stack.pop()!) {
      onStack.delete(top)
      component.push(top)
      if (top === id) break
    }
    if (component.length > 1) component.forEach((member) => members.add(member))
  }
  for (const id of [...next.keys()]) if (!index.has(id)) visit(id)
  return members
}

/**
 * Grafo dei package per l'Architecture Explorer: focus a profondità N invece di un taglio fisso, gruppi per
 * cartella, riduzione transitiva, filtro cicli e nodi per libreria standard / dipendenze esterne.
 */
export function packageView(report: GoIDEArchitecture, options: PackageViewOptions): PackageView {
  const edges = options.mode === 'imports' ? report.imports : report.packageCalls
  const byPath = new Map(report.packages.map((pkg) => [pkg.path, pkg]))
  let visible = new Set(report.packages.map((pkg) => pkg.path))
  if (options.focus && byPath.has(options.focus)) {
    visible = new Set([options.focus])
    for (let level = 0; level < options.depth; level++) {
      const reached = new Set(visible)
      for (const edge of edges) {
        if (!byPath.has(edge.from) || !byPath.has(edge.to)) continue
        if (visible.has(edge.from)) reached.add(edge.to)
        if (visible.has(edge.to)) reached.add(edge.from)
      }
      visible = reached
    }
  }
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + edge.count)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + edge.count)
  }
  const ranked = [...visible].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))
  const capped = new Set(ranked.slice(0, MAX_VIEW_NODES))
  const members = new Map<string, string[]>()
  for (const path of capped) {
    const group = packageGroup(path, byPath.get(path)?.module)
    if (group) members.set(group, [...(members.get(group) ?? []), path])
  }
  const nodeId = (path: string): string => {
    if (!options.group) return path
    const group = packageGroup(path, byPath.get(path)?.module)
    const open = !group || (members.get(group)?.length ?? 0) < 2 || options.expanded.has(group) || path === options.focus
    return open ? path : `group:${group}`
  }
  const merged = new Map<string, LayeredLink>()
  for (const edge of edges) {
    if (!capped.has(edge.from) || !capped.has(edge.to)) continue
    const from = nodeId(edge.from)
    const to = nodeId(edge.to)
    if (from === to) continue
    const key = `${from}\u0000${to}`
    merged.set(key, { from, to, value: (merged.get(key)?.value ?? 0) + edge.count })
  }
  let links = [...merged.values()]
  const cycles = cycleMembers(links)
  if (options.cyclesOnly) links = links.filter((link) => cycles.has(link.from) && cycles.has(link.to))
  const reduction = options.reduce ? reduceTransitive(links) : { links, removed: 0 }
  links = reduction.links
  const nodes: LayeredInput<ArchNode>[] = []
  const placed = new Set<string>()
  const addNode = (node: LayeredInput<ArchNode>) => {
    if (placed.has(node.id)) return
    placed.add(node.id)
    nodes.push(node)
  }
  for (const path of capped) {
    const id = nodeId(path)
    if (options.cyclesOnly && !cycles.has(id)) continue
    if (id !== path) {
      const group = id.slice('group:'.length)
      const inside = members.get(group) ?? []
      addNode({ id, weight: inside.reduce((sum, member) => sum + (degree.get(member) ?? 0), 0), data: { kind: 'group', title: `${group}/`, subtitle: `${inside.length} packages · click to expand`, tooltip: inside.join('\n') } })
      continue
    }
    const pkg = byPath.get(path)!
    addNode({
      id, weight: degree.get(path) ?? 0,
      data: {
        kind: 'package', title: shortPackage(pkg.path, pkg.module), site: pkg.site,
        subtitle: `${pkg.files} file${pkg.files === 1 ? '' : 's'} · ${pkg.external.length} external`,
        tooltip: `${pkg.path}\n${pkg.files} files, ${pkg.std} standard library imports${pkg.external.length ? `\nExternal: ${pkg.external.join(', ')}` : ''}`,
      },
    })
  }
  if (!options.cyclesOnly) {
    const leaves = (kind: 'std' | 'external', pick: (pkg: GoIDEArchitecture['packages'][number]) => readonly string[]) => {
      for (const path of capped) {
        const from = nodeId(path)
        for (const dep of pick(byPath.get(path)!)) {
          const id = `${kind}:${dep}`
          addNode({ id, weight: 0, data: { kind, title: dep.split('/').slice(-2).join('/'), subtitle: kind === 'std' ? 'standard library' : 'external module', tooltip: dep } })
          if (!links.some((link) => link.from === from && link.to === id)) links.push({ from, to: id, value: 1 })
        }
      }
    }
    if (options.std) leaves('std', (pkg) => (pkg as { stdImports?: string[] }).stdImports ?? [])
    if (options.external) leaves('external', (pkg) => pkg.external)
  }
  return {
    nodes, links, hidden: ranked.length - capped.size,
    total: report.packages.length, shown: nodes.filter((node) => node.data.kind === 'package' || node.data.kind === 'group').length,
    reduced: reduction.removed, cycles: new Set([...cycles].filter((id) => !id.startsWith('group:'))).size,
  }
}

/** Funzioni il cui nome contiene la ricerca, prima quelle con il nome che inizia così. */
export function searchFunctions(report: GoIDEArchitecture, query: string, limit = 30): GoIDEArchitecture['functions'] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return report.functions
    .filter((fn) => fn.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)) || a.name.length - b.name.length)
    .slice(0, limit)
}

/** Chiamanti (fino a depth livelli sopra) e chiamati (sotto) di una funzione, per il call graph. */
export function callNeighbourhood(report: GoIDEArchitecture, id: string, depth = 2, limit = 48): ArchGraph {
  const byId = new Map(report.functions.map((fn) => [fn.id, fn]))
  const outgoing = new Map<string, GoIDEArchitecture['calls']>()
  const incoming = new Map<string, GoIDEArchitecture['calls']>()
  for (const call of report.calls) {
    outgoing.set(call.from, [...(outgoing.get(call.from) ?? []), call])
    incoming.set(call.to, [...(incoming.get(call.to) ?? []), call])
  }
  const chosen = new Set([id])
  const links = new Map<string, LayeredLink>()
  let hidden = 0
  const walk = (start: string, edges: Map<string, GoIDEArchitecture['calls']>, next: (call: GoIDEArchitecture['calls'][number]) => string) => {
    let frontier = [start]
    for (let level = 0; level < depth; level++) {
      const following: string[] = []
      for (const current of frontier) {
        for (const call of edges.get(current) ?? []) {
          const other = next(call)
          if (!chosen.has(other) && chosen.size >= limit) {
            hidden++
            continue
          }
          if (!chosen.has(other)) following.push(other)
          chosen.add(other)
          links.set(`${call.from}\u0000${call.to}`, { from: call.from, to: call.to, value: call.count })
        }
      }
      frontier = following
    }
  }
  walk(id, incoming, (call) => call.from)
  walk(id, outgoing, (call) => call.to)
  return {
    nodes: [...chosen].map((key) => {
      const fn = byId.get(key)
      const packagePath = fn?.package ?? ''
      return {
        id: key,
        weight: key === id ? Number.MAX_SAFE_INTEGER : 0,
        data: { kind: 'function', title: fn?.name ?? key, subtitle: `${shortPackage(packagePath)}${fn?.abstract ? ' · interface' : ''}`, tooltip: key, site: fn?.site },
      }
    }),
    links: [...links.values()],
    hidden,
  }
}

/** Interfaccia al centro: sopra i package che la consumano, sotto le implementazioni. */
export function interfaceGraph(item: GoIDEArchInterface): ArchGraph {
  const id = `${item.package}.${item.name}`
  const consumers = new Map<string, number>()
  for (const user of item.users) if (user.package !== item.package || user.kind === 'param' || user.kind === 'field') consumers.set(user.package, (consumers.get(user.package) ?? 0) + 1)
  const nodes: LayeredInput<ArchNode>[] = [{ id, weight: 1, data: { kind: 'interface', title: item.name, subtitle: `${item.methods.length} methods · ${shortPackage(item.package)}`, tooltip: item.methods.join('\n'), site: item.site } }]
  const links: LayeredLink[] = []
  for (const [pkg, count] of consumers) {
    nodes.push({ id: `consumer:${pkg}`, weight: count, data: { kind: 'consumer', title: shortPackage(pkg), subtitle: `${count} use${count === 1 ? '' : 's'}`, tooltip: pkg } })
    links.push({ from: `consumer:${pkg}`, to: id, value: count })
  }
  for (const impl of item.implementations) {
    const key = `impl:${impl.package}.${impl.type}`
    nodes.push({ id: key, weight: 1, data: { kind: 'implementation', title: `${impl.pointer ? '*' : ''}${impl.type}`, subtitle: `${shortPackage(impl.package)}${impl.test ? ' · test' : ''}`, tooltip: `${impl.package}.${impl.type}`, site: impl.site } })
    links.push({ from: id, to: key, value: 1 })
  }
  return { nodes, links, hidden: 0 }
}

/** Moduli del progetto e dipendenze tra loro. */
export function moduleGraph(report: GoIDEArchitecture): ArchGraph {
  const ids = new Set(report.modules.map((module) => module.path))
  return {
    nodes: report.modules.map((module) => ({ id: module.path, weight: module.requires.length, data: { kind: 'module', title: module.path.split('/').slice(-2).join('/'), subtitle: `${module.external.length} external requires`, tooltip: `${module.path}\n${module.external.join('\n')}`, site: module.site } })),
    links: report.modules.flatMap((module) => module.requires.filter((path) => ids.has(path)).map((path) => ({ from: module.path, to: path, value: 1 }))),
    hidden: 0,
  }
}

export const ENTRY_KINDS: Array<{ kind: string; title: string }> = [
  { kind: 'main', title: 'Entry points' },
  { kind: 'http', title: 'HTTP routes' },
  { kind: 'middleware', title: 'HTTP middleware' },
  { kind: 'grpc', title: 'gRPC services' },
  { kind: 'kafka-producer', title: 'Kafka producers' },
  { kind: 'kafka-consumer', title: 'Kafka consumers' },
  { kind: 'nats-producer', title: 'NATS publishers' },
  { kind: 'nats-consumer', title: 'NATS subscribers' },
  { kind: 'amqp-producer', title: 'AMQP publishers' },
  { kind: 'amqp-consumer', title: 'AMQP consumers' },
  { kind: 'websocket-server', title: 'WebSocket servers' },
  { kind: 'websocket-client', title: 'WebSocket clients' },
  { kind: 'repository', title: 'DB repositories' },
  { kind: 'job', title: 'Scheduled jobs' },
  { kind: 'cli', title: 'CLI commands' },
  { kind: 'init', title: 'init functions' },
]

export function groupEntries(entries: readonly GoIDEArchEntry[], query = ''): Array<{ kind: string; title: string; entries: GoIDEArchEntry[] }> {
  const needle = query.trim().toLowerCase()
  return ENTRY_KINDS.map(({ kind, title }) => ({
    kind, title,
    entries: entries.filter((entry) => entry.kind === kind && (!needle || `${entry.name} ${entry.detail ?? ''} ${entry.package} ${(entry.topics ?? []).join(' ')}`.toLowerCase().includes(needle))),
  })).filter((group) => group.entries.length > 0)
}

export interface KafkaTopicUse {
  topic: string
  /** 'retry' | 'dead-letter' when the name follows those conventions. */
  role?: string
  producers: GoIDEArchEntry[]
  consumers: GoIDEArchEntry[]
  groups: string[]
}

/** Topic → funzioni che producono e consumano, con i consumer group: la vista inversa delle entry Kafka. */
export function kafkaTopics(entries: readonly GoIDEArchEntry[], query = ''): KafkaTopicUse[] {
  const needle = query.trim().toLowerCase()
  const byTopic = new Map<string, KafkaTopicUse>()
  for (const entry of entries) {
    if (entry.kind !== 'kafka-producer' && entry.kind !== 'kafka-consumer') continue
    for (const topic of entry.topics ?? []) {
      const use = byTopic.get(topic) ?? { topic, role: entry.topicRoles?.[topic], producers: [], consumers: [], groups: [] }
      if (entry.kind === 'kafka-producer') use.producers.push(entry)
      else {
        use.consumers.push(entry)
        if (entry.group && !use.groups.includes(entry.group)) use.groups.push(entry.group)
      }
      byTopic.set(topic, use)
    }
  }
  return [...byTopic.values()]
    .filter((use) => !needle || `${use.topic} ${[...use.producers, ...use.consumers].map((e) => e.name).join(' ')} ${use.groups.join(' ')}`.toLowerCase().includes(needle))
    .sort((a, b) => a.topic.localeCompare(b.topic))
}

/** Entità adOmnia per aprire il servizio nello studio giusto (API client, gRPC, Broker Studio). */
export function entityRefsForEntry(entry: GoIDEArchEntry, sessionId: string): EntityRef[] {
  const source = entry.site.relativePath ? { file: entry.site.relativePath, line: entry.site.line } : undefined
  const base = { sessionId, source }
  switch (entry.kind) {
    case 'http': {
      const [first, second] = entry.name.split(' ')
      const method = second ? first : 'GET'
      const path = second ?? first
      return [{ ...base, kind: 'route', id: `route:${method} ${path}`, label: `${method} ${path}`, attrs: { method, path } }]
    }
    case 'grpc':
      return [{ ...base, kind: 'grpc', id: `grpc:${entry.name}`, label: entry.name, attrs: { service: entry.name } }]
    case 'kafka-producer':
    case 'kafka-consumer':
      return (entry.topics ?? []).map((topic) => ({ ...base, kind: 'topic', id: `topic:${topic}`, label: topic, attrs: { broker: 'kafka' } }))
    case 'nats-producer':
    case 'nats-consumer':
    case 'amqp-producer':
    case 'amqp-consumer': {
      const broker = entry.kind.split('-')[0]
      return (entry.topics ?? []).map((topic) => ({ ...base, kind: 'topic', id: `topic:${broker}:${topic}`, label: topic, attrs: { broker } }))
    }
    case 'websocket-client':
      return /^wss?:\/\//.test(entry.name) ? [{ ...base, kind: 'websocket', id: `websocket:${entry.name}`, label: entry.name, attrs: { role: 'client', url: entry.name } }] : []
  }
  return []
}

export type ArchQuery = GoIDEArchitecture['queries'][number]

export interface TableAccess {
  table: string
  queries: ArchQuery[]
  reads: number
  writes: number
  functions: string[]
  guess: boolean
}

/** Tabella → funzioni che la leggono o scrivono (le query senza tabella nota restano fuori). */
export function queriesByTable(queries: readonly ArchQuery[], query = ''): TableAccess[] {
  const needle = query.trim().toLowerCase()
  const tables = new Map<string, TableAccess>()
  for (const item of queries) {
    for (const table of item.tables) {
      if (needle && !`${table} ${item.function}`.toLowerCase().includes(needle)) continue
      const entry = tables.get(table) ?? { table, queries: [], reads: 0, writes: 0, functions: [], guess: true }
      entry.queries.push(item)
      if (isWrite(item)) entry.writes++
      else entry.reads++
      if (!entry.functions.includes(item.function)) entry.functions.push(item.function)
      entry.guess = entry.guess && !!item.tableGuess
      tables.set(table, entry)
    }
  }
  return [...tables.values()].sort((a, b) => b.queries.length - a.queries.length || a.table.localeCompare(b.table))
}

const WRITE_SQL = /^\s*(insert|update|delete|merge|upsert|replace|create|alter|drop|truncate)\b/i
const WRITE_ORM = new Set(['Create', 'Save', 'Delete', 'Update', 'Updates', 'UpdateColumn', 'UpdateColumns', 'FirstOrCreate'])

export function isWrite(query: ArchQuery): boolean {
  return query.operation === 'exec' || WRITE_SQL.test(query.sql ?? '') || (query.operation === 'orm' && WRITE_ORM.has(query.method))
}

export type ArchGoroutine = GoIDEArchitecture['goroutines'][number]

export interface GoroutineFilter {
  query: string
  risksOnly: boolean
  inLoopOnly: boolean
  /** Vuoto = tutti i tipi (go, errgroup, waitgroup-go, afterfunc). */
  kinds: ReadonlySet<string>
}

export const NO_GOROUTINE_FILTER: GoroutineFilter = { query: '', risksOnly: false, inLoopOnly: false, kinds: new Set() }

export interface GoroutineFunctionGroup {
  function: string
  items: ArchGoroutine[]
}

export interface GoroutinePackageGroup {
  package: string
  functions: GoroutineFunctionGroup[]
  count: number
  risky: number
}

const SEVERITY_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 }

export function filterGoroutines(items: readonly ArchGoroutine[], filter: GoroutineFilter): ArchGoroutine[] {
  const needle = filter.query.trim().toLowerCase()
  return items.filter((item) =>
    (!filter.risksOnly || item.risks.length > 0) &&
    (!filter.inLoopOnly || !!item.inLoop) &&
    (filter.kinds.size === 0 || filter.kinds.has(item.kind)) &&
    (!needle || `${item.package} ${item.function} ${item.launches ?? ''} ${item.kind} ${item.shape} ${item.risks.join(' ')} ${(item.entries ?? []).join(' ')}`.toLowerCase().includes(needle)))
}

/** Package → funzione che avvia → goroutine; i package con più rischio gravi in cima. */
export function groupGoroutines(items: readonly ArchGoroutine[], filter: GoroutineFilter = NO_GOROUTINE_FILTER): GoroutinePackageGroup[] {
  const byPackage = new Map<string, Map<string, ArchGoroutine[]>>()
  for (const item of filterGoroutines(items, filter)) {
    const functions = byPackage.get(item.package) ?? new Map<string, ArchGoroutine[]>()
    functions.set(item.function, [...(functions.get(item.function) ?? []), item])
    byPackage.set(item.package, functions)
  }
  return [...byPackage.entries()]
    .map(([pkg, functions]) => {
      const groups = [...functions.entries()].map(([name, list]) => ({ function: name, items: list })).sort((a, b) => a.function.localeCompare(b.function))
      const all = groups.flatMap((group) => group.items)
      return { package: pkg, functions: groups, count: all.length, risky: all.filter((item) => item.risks.length > 0).length, worst: Math.max(...all.map((item) => SEVERITY_RANK[item.severity] ?? 0)) }
    })
    .sort((a, b) => b.worst - a.worst || b.risky - a.risky || a.package.localeCompare(b.package))
    .map(({ worst: _worst, ...group }) => group)
}

/** Avvio statico che corrisponde a una goroutine osservata a runtime (stesso file e riga della creazione). */
export function matchGoroutineSite(items: readonly ArchGoroutine[], file: string, line: number): ArchGoroutine | undefined {
  const normal = file.split('\\').join('/')
  return items.find((item) => item.site.line === line && (normal === item.site.relativePath || normal.endsWith(`/${item.site.relativePath}`)))
}

/** Ultimo nome utile di una funzione: `pkg.(*Server).Start` → `Start`, `pkg.run.func1` → `run`. */
export function functionLeaf(name: string): string {
  const cleaned = name.replace(/\.func\d+(?:\.\d+)?$/, '')
  const receiver = cleaned.match(/\)\.([A-Za-z0-9_]+)$/)
  if (receiver) return receiver[1]
  const parts = cleaned.split('.')
  return parts[parts.length - 1] ?? cleaned
}

/**
 * Avvio statico della funzione `name` (runtime Delve o profilo pprof), confrontato
 * per ultimo segmento: è un indizio, due omonimi in package diversi si confondono.
 */
export function matchLaunchedFunction(items: readonly ArchGoroutine[], name: string): ArchGoroutine | undefined {
  const leaf = functionLeaf(name)
  return items.find((item) => item.launches && functionLeaf(item.launches) === leaf)
}

/** Avvio statico che ha lanciato questa goroutine runtime (per nome della funzione di origine). */
export function matchGoroutineLaunch(items: readonly ArchGoroutine[], originName: string | undefined): ArchGoroutine | undefined {
  return originName ? matchLaunchedFunction(items, originName) : undefined
}

import type { GoIDEArchEntry, GoIDEArchInterface, GoIDEArchitecture } from '@/lib/goide-api'
import type { EntityRef } from '@/lib/entities/types'
import type { LayeredInput, LayeredLink } from './goStudioLayeredGraph'

/** Nodo dei grafi dell'Architecture Explorer: cosa disegnare e dove aprire il codice. */
export interface ArchNode {
  kind: 'package' | 'function' | 'interface' | 'implementation' | 'consumer' | 'module'
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

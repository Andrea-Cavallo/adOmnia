import * as GoIDE from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import type { Impact, Node as GraphNode, Ref } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/graph/models'
import type { GraphSummary } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'

export type GraphImpact = Impact
export type GraphRef = Ref
export type { GraphNode }
export type WorkspaceGraphSummary = GraphSummary

/** Semantic Workspace Graph: built from the Architecture Explorer model, cached on disk until Go sources change. */
export const workspaceGraphSummary = (sessionId: string, rebuild = false): Promise<WorkspaceGraphSummary> => GoIDE.WorkspaceGraphSummary(sessionId, rebuild)
export const graphImpactAt = (sessionId: string, relativePath: string, line: number): Promise<GraphImpact> => GoIDE.GraphImpact(sessionId, relativePath, line)
/** Graph nodes that are not code symbols: routes, RPCs, topics, tables, env vars, config keys, services, dependencies, DTOs. */
export const GRAPH_SEARCH_KINDS = ['endpoint', 'rpc', 'topic', 'table', 'envvar', 'config', 'service', 'dependency', 'type', 'websocket']
export const graphSearchReady = (sessionId: string, query: string, limit = 6): Promise<GraphNode[]> => GoIDE.GraphSearchReady(sessionId, query, GRAPH_SEARCH_KINDS, limit).then((nodes) => nodes ?? [])
export const graphImpactOf = (sessionId: string, nodeId: string): Promise<GraphImpact> => GoIDE.GraphImpactOf(sessionId, nodeId)

const MAX_LISTED = 8

function list(title: string, refs: readonly GraphRef[] | null | undefined, describe: (ref: GraphRef) => string = (ref) => ref.node.label): string | null {
  if (!refs?.length) return null
  const shown = refs.slice(0, MAX_LISTED).map((ref) => `- ${describe(ref)}`)
  if (refs.length > MAX_LISTED) shown.push(`- … ${refs.length - MAX_LISTED} more`)
  return `${title}:\n${shown.join('\n')}`
}

const where = (ref: GraphRef) => (ref.node.file ? ` (${ref.node.file}:${ref.node.line})` : '')
const hops = (ref: GraphRef) => (ref.depth > 1 ? ` [${ref.depth} calls away]` : '')

/**
 * The workspace-graph neighbourhood of the code under the cursor, compact enough for every
 * chat (milk, Claude Code, Copilot): who reaches it, what it touches, what could break.
 */
export function impactContext(impact: GraphImpact): string {
  const parts = [
    `Workspace graph for ${impact.target.label}${where({ node: impact.target, depth: 0 } as GraphRef)} — change risk ${impact.risk}: ${(impact.riskReasons ?? []).join('; ')}.`,
    list('Callers (direct and indirect, through interfaces too)', impact.callers, (ref) => ref.node.label + hops(ref) + where(ref)),
    list('Interface contracts it implements', impact.interfaces),
    list('Other modules using it (public contract)', impact.contracts ?? []),
    list('Tests that reach it', impact.tests, (ref) => ref.node.label + where(ref)),
    list('Types that contain it', impact.containers ?? []),
    list('HTTP routes served through it', impact.endpoints),
    list('gRPC services served through it', impact.rpcs),
    list('Topics consumed through it', impact.consumers),
    list('It calls', impact.callees),
    list('It produces to topics', impact.produces),
    list('It queries tables', impact.queries, (ref) => ref.node.label + (ref.via?.[0] ? ` (${ref.via[0]})` : '')),
    list('Entry points reaching it', impact.entries),
    list('Compose services that run it', impact.services ?? []),
    list('It reads env vars / config keys', impact.reads ?? []),
  ]
  return parts.filter(Boolean).join('\n')
}

/** Resolves within ms or gives up: a chat message is never held back by a cold graph build. */
export async function impactContextWithin(sessionId: string, relativePath: string, line: number, ms: number): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  const impact = graphImpactAt(sessionId, relativePath, line).then(impactContext, () => null)
  return Promise.race([impact, timeout])
}

export interface ImpactMapNode {
  node: GraphRef['node']
  role: 'target' | 'upstream' | 'downstream'
  group: string
}

const UPSTREAM: Array<[keyof GraphImpact, string]> = [['services', 'service'], ['entries', 'entry'], ['endpoints', 'route'], ['rpcs', 'rpc'], ['consumers', 'topic'], ['tests', 'test'], ['callers', 'caller'], ['containers', 'type'], ['interfaces', 'interface']]
const DOWNSTREAM: Array<[keyof GraphImpact, string]> = [['callees', 'callee'], ['produces', 'topic'], ['queries', 'table'], ['reads', 'config']]
const MAP_PER_GROUP = 8

/**
 * The impact as a layered picture: what reaches the target above it, what it touches below.
 * Each ref hangs from the node it was reached through (the last label of `via`), or from the target.
 */
export function impactMapGraph(impact: GraphImpact): { items: Array<{ id: string; weight: number; data: ImpactMapNode }>; links: Array<{ from: string; to: string; value: number }> } {
  const items = new Map<string, { id: string; weight: number; data: ImpactMapNode }>()
  const links: Array<{ from: string; to: string; value: number }> = []
  const target = impact.target
  items.set(target.id, { id: target.id, weight: 1000, data: { node: target, role: 'target', group: 'target' } })
  const byLabel = new Map<string, string>([[target.label, target.id]])
  const add = (groups: Array<[keyof GraphImpact, string]>, role: 'upstream' | 'downstream') => {
    const refs = groups.flatMap(([key, group]) => ((impact[key] as GraphRef[] | null | undefined) ?? []).slice(0, MAP_PER_GROUP).map((ref) => ({ ref, group })))
    refs.sort((left, right) => left.ref.depth - right.ref.depth)
    for (const { ref, group } of refs) {
      if (items.has(ref.node.id)) continue
      items.set(ref.node.id, { id: ref.node.id, weight: 100 - ref.depth, data: { node: ref.node, role, group } })
      byLabel.set(ref.node.label, ref.node.id)
    }
    for (const { ref } of refs) {
      const via = ref.via ?? []
      const anchor = (via.length && byLabel.get(via[via.length - 1])) || target.id
      if (anchor === ref.node.id) continue
      links.push(role === 'upstream' ? { from: ref.node.id, to: anchor, value: 1 } : { from: anchor, to: ref.node.id, value: 1 })
    }
  }
  add(UPSTREAM, 'upstream')
  add(DOWNSTREAM, 'downstream')
  return { items: [...items.values()], links }
}

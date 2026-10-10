import * as GoIDE from '../../../bindings/adomnia/goide'
import type { Impact, Ref } from '../../../bindings/adomnia/internal/ide/graph/models'
import type { GraphSummary } from '../../../bindings/adomnia/internal/goide/models'

export type GraphImpact = Impact
export type GraphRef = Ref
export type WorkspaceGraphSummary = GraphSummary

/** Semantic Workspace Graph: built from the Architecture Explorer model, cached on disk until Go sources change. */
export const workspaceGraphSummary = (sessionId: string, rebuild = false): Promise<WorkspaceGraphSummary> => GoIDE.WorkspaceGraphSummary(sessionId, rebuild)
export const graphImpactAt = (sessionId: string, relativePath: string, line: number): Promise<GraphImpact> => GoIDE.GraphImpact(sessionId, relativePath, line)
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
    list('Tests that reach it', impact.tests, (ref) => ref.node.label + where(ref)),
    list('HTTP routes served through it', impact.endpoints),
    list('gRPC services served through it', impact.rpcs),
    list('Topics consumed through it', impact.consumers),
    list('It calls', impact.callees),
    list('It produces to topics', impact.produces),
    list('It queries tables', impact.queries, (ref) => ref.node.label + (ref.via?.[0] ? ` (${ref.via[0]})` : '')),
    list('Entry points reaching it', impact.entries),
  ]
  return parts.filter(Boolean).join('\n')
}

/** Resolves within ms or gives up: a chat message is never held back by a cold graph build. */
export async function impactContextWithin(sessionId: string, relativePath: string, line: number, ms: number): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  const impact = graphImpactAt(sessionId, relativePath, line).then(impactContext, () => null)
  return Promise.race([impact, timeout])
}

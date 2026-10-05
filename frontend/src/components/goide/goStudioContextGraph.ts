import type { GoIDEArchitecture, GoIDEArchSite } from '@/lib/goide-api'
import type { ContextAnalysis } from './goStudioContextAnalysis'
import type { LayeredInput, LayeredLink } from './goStudioLayeredGraph'
import { shortPackage } from './goStudioArchitecture'

/** Nodo del grafo di propagazione del context (file o progetto). */
export interface ContextNode {
  title: string
  subtitle?: string
  tone: 'broken' | 'root' | 'timeout' | 'plain'
  site?: GoIDEArchSite
  line?: number
}

export interface ContextBreak {
  from: string
  to: string
  crossPackage: boolean
  site: GoIDEArchSite
}

export interface ContextGraph {
  nodes: LayeredInput<ContextNode>[]
  links: LayeredLink[]
  breaks: ContextBreak[]
  hidden: number
}

export const MAX_CONTEXT_NODES = 60

/** Grafo del singolo file, dall'analisi testuale del buffer. */
export function fileContextGraph(analysis: ContextAnalysis): ContextGraph {
  const linked = new Set(analysis.edges.flatMap((edge) => [edge.from, edge.to]))
  const nodes = analysis.nodes.filter((node) => linked.has(node.id)).map((node) => ({
    id: node.id,
    weight: analysis.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length,
    data: {
      title: node.label,
      subtitle: node.ctxParams.length ? `ctx: ${node.ctxParams.join(', ')}` : 'no ctx param',
      tone: node.createsRoot && node.ctxParams.length ? 'broken' : node.createsRoot ? 'root' : node.appliesTimeout ? 'timeout' : 'plain',
      line: node.line,
    } satisfies ContextNode,
  }))
  return { nodes, links: aggregate(analysis.edges.map((edge) => [edge.from, edge.to])), breaks: [], hidden: 0 }
}

/**
 * Grafo del progetto dal report tipato (attraversa i package): archi = chiamate che passano un
 * context. Un chiamante che riceve un ctx ma passa Background/TODO spezza la catena.
 */
export function projectContextGraph(report: GoIDEArchitecture, module?: string): ContextGraph {
  const functions = new Map(report.functions.map((fn) => [fn.id, fn]))
  const calls = report.contextCalls ?? []
  const breaks: ContextBreak[] = []
  const tone = new Map<string, ContextNode['tone']>()
  const degree = new Map<string, number>()
  for (const call of calls) {
    degree.set(call.from, (degree.get(call.from) ?? 0) + 1)
    degree.set(call.to, (degree.get(call.to) ?? 0) + 1)
    const caller = functions.get(call.from)
    if (call.origin === 'root' && caller?.context) {
      tone.set(call.from, 'broken')
      breaks.push({ from: caller.name, to: functions.get(call.to)?.name ?? call.to, crossPackage: caller.package !== functions.get(call.to)?.package, site: call.site })
    } else if (call.origin === 'root' && tone.get(call.from) !== 'broken') tone.set(call.from, 'root')
    else if (call.timeout && !tone.has(call.from)) tone.set(call.from, 'timeout')
  }
  const ranked = [...degree.entries()].sort((a, b) => b[1] - a[1])
  const kept = new Set(ranked.slice(0, MAX_CONTEXT_NODES).map(([id]) => id))
  const nodes = ranked.filter(([id]) => kept.has(id)).map(([id, weight]) => {
    const fn = functions.get(id)
    return { id, weight, data: { title: fn?.name ?? id, subtitle: fn ? shortPackage(fn.package, module) : undefined, tone: tone.get(id) ?? 'plain', site: fn?.site } satisfies ContextNode }
  })
  return { nodes, links: aggregate(calls.map((call) => [call.from, call.to])), breaks, hidden: Math.max(0, ranked.length - kept.size) }
}

function aggregate(pairs: Array<[string, string]>): LayeredLink[] {
  const counts = new Map<string, LayeredLink>()
  for (const [from, to] of pairs) {
    const key = `${from}\u0000${to}`
    const link = counts.get(key)
    if (link) link.value++
    else counts.set(key, { from, to, value: 1 })
  }
  return [...counts.values()]
}

import { LAYERED_BOX, layoutLayered, type LayeredLayout } from './goStudioLayeredGraph'
import { isRuntimeFunction, sampleValue, type ProfileFunction, type ProfileNode } from './goStudioProfiles'

interface ProfileEdgeLike {
  caller: ProfileFunction
  callee: ProfileFunction
  value: number[]
}

export const CALL_GRAPH_NODE = LAYERED_BOX

/**
 * Grafo delle chiamate più pesanti, a livelli dall'alto (chiamanti) al basso (chiamati). Mostra le
 * `limit` funzioni con costo cumulativo più alto e gli archi tra loro; i cicli (ricorsione) non
 * spingono i livelli all'infinito (vedi layoutLayered).
 */
export function layoutCallGraph(top: ProfileNode[], edges: ProfileEdgeLike[], sampleIndex: number, options: { limit?: number; hideRuntime?: boolean } = {}): LayeredLayout<ProfileFunction> {
  const limit = options.limit ?? 24
  const chosen = top
    .filter((node) => !options.hideRuntime || !isRuntimeFunction(node.function))
    .map((node) => ({ id: node.function.name, weight: sampleValue(node.cum, sampleIndex), data: node.function }))
    .filter((node) => node.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
  const ids = new Set(chosen.map((node) => node.id))
  const links = edges
    .filter((edge) => ids.has(edge.caller.name) && ids.has(edge.callee.name))
    .map((edge) => ({ from: edge.caller.name, to: edge.callee.name, value: sampleValue(edge.value, sampleIndex) }))
    .filter((edge) => edge.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit * 3)
  return layoutLayered(chosen, links)
}

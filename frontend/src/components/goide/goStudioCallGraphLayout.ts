import { isRuntimeFunction, sampleValue, type ProfileFunction, type ProfileNode } from './goStudioProfiles'

interface ProfileEdgeLike {
  caller: ProfileFunction
  callee: ProfileFunction
  value: number[]
}

export interface CallGraphNode {
  fn: ProfileFunction
  cum: number
  layer: number
  x: number
  y: number
}

export interface CallGraphEdge {
  from: CallGraphNode
  to: CallGraphNode
  value: number
}

export interface CallGraphLayout {
  nodes: CallGraphNode[]
  edges: CallGraphEdge[]
  width: number
  height: number
  maxEdge: number
}

export const CALL_GRAPH_NODE = { width: 188, height: 42, gapX: 24, gapY: 56, padding: 16 } as const

/**
 * Grafo delle chiamate più pesanti, a livelli dall'alto (chiamanti) al basso (chiamati). Mostra le
 * `limit` funzioni con costo cumulativo più alto e gli archi tra loro; i cicli (ricorsione) non
 * spingono i livelli all'infinito perché un nodo non scende oltre il numero di nodi.
 */
export function layoutCallGraph(top: ProfileNode[], edges: ProfileEdgeLike[], sampleIndex: number, options: { limit?: number; hideRuntime?: boolean } = {}): CallGraphLayout {
  const limit = options.limit ?? 24
  const chosen = top
    .filter((node) => !options.hideRuntime || !isRuntimeFunction(node.function))
    .map((node) => ({ fn: node.function, cum: sampleValue(node.cum, sampleIndex) }))
    .filter((node) => node.cum > 0)
    .sort((a, b) => b.cum - a.cum)
    .slice(0, limit)
  const byName = new Map(chosen.map((node) => [node.fn.name, { ...node, layer: 0, x: 0, y: 0 } as CallGraphNode]))
  const links = edges
    .filter((edge) => edge.caller.name !== edge.callee.name && byName.has(edge.caller.name) && byName.has(edge.callee.name))
    .map((edge) => ({ from: byName.get(edge.caller.name)!, to: byName.get(edge.callee.name)!, value: sampleValue(edge.value, sampleIndex) }))
    .filter((edge) => edge.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit * 3)
  // Livello = cammino più lungo dai chiamanti. Gli archi che chiudono un ciclo (ricorsione) si
  // disegnano ma non contano per i livelli: si trovano con una DFS dai nodi più costosi.
  const backEdges = cycleEdges([...byName.values()], links)
  const forward = links.filter((edge) => !backEdges.has(edge))
  for (let pass = 0; pass < byName.size; pass++) {
    let changed = false
    for (const edge of forward) {
      if (edge.to.layer < edge.from.layer + 1) {
        edge.to.layer = edge.from.layer + 1
        changed = true
      }
    }
    if (!changed) break
  }
  const nodes = [...byName.values()]
  const rows = new Map<number, CallGraphNode[]>()
  for (const node of nodes) rows.set(node.layer, [...(rows.get(node.layer) ?? []), node])
  const layers = [...rows.keys()].sort((a, b) => a - b)
  const widest = Math.max(1, ...[...rows.values()].map((row) => row.length))
  const { width: w, height: h, gapX, gapY, padding } = CALL_GRAPH_NODE
  const width = padding * 2 + widest * w + (widest - 1) * gapX
  layers.forEach((layer, rowIndex) => {
    const row = rows.get(layer)!.sort((a, b) => b.cum - a.cum)
    const rowWidth = row.length * w + (row.length - 1) * gapX
    row.forEach((node, index) => {
      node.x = (width - rowWidth) / 2 + index * (w + gapX)
      node.y = padding + rowIndex * (h + gapY)
    })
  })
  const height = padding * 2 + layers.length * h + Math.max(0, layers.length - 1) * gapY
  return { nodes, edges: links, width, height, maxEdge: links[0]?.value ?? 0 }
}

function cycleEdges(nodes: CallGraphNode[], links: CallGraphEdge[]): Set<CallGraphEdge> {
  const outgoing = new Map<CallGraphNode, CallGraphEdge[]>()
  for (const edge of links) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])
  const state = new Map<CallGraphNode, 'open' | 'done'>()
  const back = new Set<CallGraphEdge>()
  const visit = (node: CallGraphNode) => {
    state.set(node, 'open')
    for (const edge of outgoing.get(node) ?? []) {
      const next = state.get(edge.to)
      if (next === 'open') back.add(edge)
      else if (!next) visit(edge.to)
    }
    state.set(node, 'done')
  }
  const incoming = new Set(links.map((edge) => edge.to))
  // Prima le radici (nessun chiamante nel grafo), poi il resto per costo.
  for (const node of [...nodes].sort((a, b) => Number(incoming.has(a)) - Number(incoming.has(b)) || b.cum - a.cum)) {
    if (!state.has(node)) visit(node)
  }
  return back
}

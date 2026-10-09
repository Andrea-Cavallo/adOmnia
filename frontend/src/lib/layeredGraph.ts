/** Grafo a livelli generico (chiamanti sopra, chiamati sotto), usato da profiler e Architecture Explorer. */

export interface LayeredInput<T> {
  id: string
  weight: number
  data: T
}

export interface LayeredLink {
  from: string
  to: string
  value: number
}

export interface LayeredNode<T> extends LayeredInput<T> {
  layer: number
  x: number
  y: number
}

export interface LayeredEdge<T> {
  from: LayeredNode<T>
  to: LayeredNode<T>
  value: number
}

export interface LayeredLayout<T> {
  nodes: LayeredNode<T>[]
  edges: LayeredEdge<T>[]
  width: number
  height: number
  maxEdge: number
}

export interface LayeredBox {
  width: number
  height: number
  gapX: number
  gapY: number
  padding: number
}

export const LAYERED_BOX: LayeredBox = { width: 188, height: 42, gapX: 24, gapY: 56, padding: 16 }

/**
 * Livello = cammino più lungo dalle radici. Gli archi che chiudono un ciclo si disegnano ma non
 * contano per i livelli (si trovano con una DFS dai nodi senza entranti, poi dai più pesanti).
 * Dentro un livello i nodi sono ordinati per peso.
 */
export function layoutLayered<T>(items: readonly LayeredInput<T>[], links: readonly LayeredLink[], box: LayeredBox = LAYERED_BOX): LayeredLayout<T> {
  const byId = new Map(items.map((item) => [item.id, { ...item, layer: 0, x: 0, y: 0 } as LayeredNode<T>]))
  const edges = links
    .filter((link) => link.from !== link.to && byId.has(link.from) && byId.has(link.to))
    .map((link) => ({ from: byId.get(link.from)!, to: byId.get(link.to)!, value: link.value }))
    .sort((a, b) => b.value - a.value)
  const back = cycleEdges([...byId.values()], edges)
  const forward = edges.filter((edge) => !back.has(edge))
  for (let pass = 0; pass < byId.size; pass++) {
    let changed = false
    for (const edge of forward) {
      if (edge.to.layer < edge.from.layer + 1) {
        edge.to.layer = edge.from.layer + 1
        changed = true
      }
    }
    if (!changed) break
  }
  const nodes = [...byId.values()]
  const rows = new Map<number, LayeredNode<T>[]>()
  for (const node of nodes) rows.set(node.layer, [...(rows.get(node.layer) ?? []), node])
  const layers = [...rows.keys()].sort((a, b) => a - b)
  const widest = Math.max(1, ...[...rows.values()].map((row) => row.length))
  const width = box.padding * 2 + widest * box.width + (widest - 1) * box.gapX
  layers.forEach((layer, rowIndex) => {
    const row = rows.get(layer)!.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    const rowWidth = row.length * box.width + (row.length - 1) * box.gapX
    row.forEach((node, index) => {
      node.x = (width - rowWidth) / 2 + index * (box.width + box.gapX)
      node.y = box.padding + rowIndex * (box.height + box.gapY)
    })
  })
  const height = box.padding * 2 + layers.length * box.height + Math.max(0, layers.length - 1) * box.gapY
  return { nodes, edges, width, height, maxEdge: edges[0]?.value ?? 0 }
}

function cycleEdges<T>(nodes: LayeredNode<T>[], links: LayeredEdge<T>[]): Set<LayeredEdge<T>> {
  const outgoing = new Map<LayeredNode<T>, LayeredEdge<T>[]>()
  for (const edge of links) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])
  const state = new Map<LayeredNode<T>, 'open' | 'done'>()
  const back = new Set<LayeredEdge<T>>()
  const visit = (node: LayeredNode<T>) => {
    state.set(node, 'open')
    for (const edge of outgoing.get(node) ?? []) {
      const next = state.get(edge.to)
      if (next === 'open') back.add(edge)
      else if (!next) visit(edge.to)
    }
    state.set(node, 'done')
  }
  const incoming = new Set(links.map((edge) => edge.to))
  for (const node of [...nodes].sort((a, b) => Number(incoming.has(a)) - Number(incoming.has(b)) || b.weight - a.weight)) {
    if (!state.has(node)) visit(node)
  }
  return back
}

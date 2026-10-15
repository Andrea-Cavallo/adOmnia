/** Grafo a livelli generico (chiamanti sopra, chiamati sotto), usato da profiler, Architecture Explorer e Service Map. */

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

export interface LayeredPoint {
  x: number
  y: number
}

export interface LayeredEdge<T> {
  from: LayeredNode<T>
  to: LayeredNode<T>
  value: number
  /** Arco che chiude un ciclo: disegnato risalendo, dal bordo alto del chiamante al basso del chiamato. */
  back?: boolean
  /** Percorso completo da `from` a `to` (porte incluse); i tratti sono sempre fuori dai nodi. */
  path?: LayeredPoint[]
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

/** Larghezza dello slot che un arco lungo occupa in un livello che attraversa. */
const LANE = 14
const SWEEPS = 6
/** Oltre questa soglia le sweep si fermano alla prima: il conteggio incroci è quadratico. */
const CROSSING_BUDGET = 400

interface Slot<T> {
  id: string
  node?: LayeredNode<T>
  layer: number
  x: number
  down: Slot<T>[]
  up: Slot<T>[]
}

interface Chain<T> {
  edge: LayeredEdge<T>
  /** Slot dall'alto in basso: nodo alto, fittizi, nodo basso. */
  slots: Slot<T>[]
}

/**
 * Sugiyama: livelli per cammino più lungo (gli archi di ciclo non contano), nodi fittizi per gli archi
 * che attraversano più livelli, sweep barycenter su/giù per ridurre gli incroci e porte distribuite
 * lungo il bordo del nodo. Ogni arco riceve un `path` che non attraversa nessun nodo.
 */
export function layoutLayered<T>(items: readonly LayeredInput<T>[], links: readonly LayeredLink[], box: LayeredBox = LAYERED_BOX): LayeredLayout<T> {
  const byId = new Map(items.map((item) => [item.id, { ...item, layer: 0, x: 0, y: 0 } as LayeredNode<T>]))
  const edges: LayeredEdge<T>[] = links
    .filter((link) => link.from !== link.to && byId.has(link.from) && byId.has(link.to))
    .map((link) => ({ from: byId.get(link.from)!, to: byId.get(link.to)!, value: link.value }))
    .sort((a, b) => b.value - a.value)
  const back = cycleEdges([...byId.values()], edges)
  for (const edge of back) edge.back = true
  const forward = edges.filter((edge) => !edge.back)
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
  const layerCount = nodes.reduce((max, node) => Math.max(max, node.layer + 1), 0)
  const rows: Slot<T>[][] = Array.from({ length: layerCount }, () => [])
  const slotOf = new Map<LayeredNode<T>, Slot<T>>()
  for (const node of nodes.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))) {
    const slot: Slot<T> = { id: node.id, node, layer: node.layer, x: 0, down: [], up: [] }
    slotOf.set(node, slot)
    rows[node.layer].push(slot)
  }
  const chains = edges.map((edge) => chain(edge, slotOf, rows))
  reduceCrossings(rows)
  const widths = rows.map((row) => rowWidth(row, box))
  const width = box.padding * 2 + Math.max(box.width, ...widths)
  rows.forEach((row, layer) => {
    let x = (width - widths[layer]) / 2
    for (const slot of row) {
      slot.x = x
      x += slotWidth(slot, box) + box.gapX
      if (slot.node) {
        slot.node.x = slot.x
        slot.node.y = rowY(layer, box)
      }
    }
  })
  routePaths(chains, box)
  const height = box.padding * 2 + layerCount * box.height + Math.max(0, layerCount - 1) * box.gapY
  return { nodes, edges, width, height, maxEdge: edges[0]?.value ?? 0 }
}

const rowY = (layer: number, box: LayeredBox): number => box.padding + layer * (box.height + box.gapY)
const slotWidth = <T>(slot: Slot<T>, box: LayeredBox): number => (slot.node ? box.width : LANE)
const rowWidth = <T>(row: Slot<T>[], box: LayeredBox): number => row.reduce((sum, slot) => sum + slotWidth(slot, box), 0) + Math.max(0, row.length - 1) * box.gapX

/** Spezza l'arco in tratti di un livello con slot fittizi; un arco di ciclo è costruito dal basso verso l'alto. */
function chain<T>(edge: LayeredEdge<T>, slotOf: Map<LayeredNode<T>, Slot<T>>, rows: Slot<T>[][]): Chain<T> {
  const top = slotOf.get(edge.back ? edge.to : edge.from)!
  const bottom = slotOf.get(edge.back ? edge.from : edge.to)!
  const slots = [top]
  for (let layer = top.layer + 1; layer < bottom.layer; layer++) {
    const dummy: Slot<T> = { id: `${edge.from.id}->${edge.to.id}@${layer}`, layer, x: 0, down: [], up: [] }
    rows[layer].push(dummy)
    slots.push(dummy)
  }
  slots.push(bottom)
  for (let index = 0; index + 1 < slots.length; index++) {
    slots[index].down.push(slots[index + 1])
    slots[index + 1].up.push(slots[index])
  }
  return { edge, slots }
}

/** Ordina ogni livello per baricentro dei vicini, su e giù, tenendo il risultato con meno incroci. */
function reduceCrossings<T>(rows: Slot<T>[][]): void {
  const edgeCount = rows.reduce((sum, row) => sum + row.reduce((inner, slot) => inner + slot.down.length, 0), 0)
  const sweeps = edgeCount > CROSSING_BUDGET ? 1 : SWEEPS
  let best = rows.map((row) => [...row])
  let bestCrossings = countCrossings(rows)
  for (let sweep = 0; sweep < sweeps && bestCrossings > 0; sweep++) {
    const downward = sweep % 2 === 0
    const order = downward ? rows.map((_, index) => index).slice(1) : rows.map((_, index) => index).slice(0, -1).reverse()
    for (const layer of order) {
      const neighbours = (slot: Slot<T>) => (downward ? slot.up : slot.down)
      const position = new Map<Slot<T>, number>()
      rows[downward ? layer - 1 : layer + 1].forEach((slot, index) => position.set(slot, index))
      const keyed = rows[layer].map((slot, index) => {
        const around = neighbours(slot).map((other) => position.get(other) ?? 0)
        return { slot, key: around.length > 0 ? around.reduce((a, b) => a + b, 0) / around.length : index }
      })
      keyed.sort((a, b) => a.key - b.key)
      rows[layer] = keyed.map((item) => item.slot)
    }
    const crossings = countCrossings(rows)
    if (crossings < bestCrossings) {
      bestCrossings = crossings
      best = rows.map((row) => [...row])
    }
  }
  best.forEach((row, layer) => {
    rows[layer] = row
  })
}

/** Incroci tra archi di livelli adiacenti: due archi (a→b, c→d) si incrociano se l'ordine di partenza e arrivo è opposto. */
function countCrossings<T>(rows: Slot<T>[][]): number {
  let total = 0
  for (let layer = 0; layer + 1 < rows.length; layer++) {
    const lower = new Map<Slot<T>, number>()
    rows[layer + 1].forEach((slot, index) => lower.set(slot, index))
    const arcs: Array<[number, number]> = []
    rows[layer].forEach((slot, index) => {
      for (const next of slot.down) arcs.push([index, lower.get(next) ?? 0])
    })
    for (let a = 0; a < arcs.length; a++) {
      for (let b = a + 1; b < arcs.length; b++) {
        if ((arcs[a][0] - arcs[b][0]) * (arcs[a][1] - arcs[b][1]) < 0) total++
      }
    }
  }
  return total
}

/** Percorso di ogni arco: porta di uscita, attraversamento dritto dei livelli intermedi, porta di ingresso. */
function routePaths<T>(chains: Chain<T>[], box: LayeredBox): void {
  const ports = new Map<string, number>()
  const side = (chainItem: Chain<T>, atTop: boolean) => {
    const slot = atTop ? chainItem.slots[0] : chainItem.slots[chainItem.slots.length - 1]
    const other = atTop ? chainItem.slots[1] : chainItem.slots[chainItem.slots.length - 2]
    return { slot, other }
  }
  const spread = (key: (item: Chain<T>) => { slot: Slot<T>; other: Slot<T> }, atTop: boolean) => {
    const groups = new Map<Slot<T>, Chain<T>[]>()
    for (const item of chains) groups.set(key(item).slot, [...(groups.get(key(item).slot) ?? []), item])
    for (const [slot, group] of groups) {
      group.sort((a, b) => centre(key(a).other, box) - centre(key(b).other, box))
      group.forEach((item, index) => ports.set(`${atTop ? 't' : 'b'}:${item.edge.from.id}->${item.edge.to.id}`, slot.x + (box.width * (index + 1)) / (group.length + 1)))
    }
  }
  spread((item) => side(item, true), true)
  spread((item) => side(item, false), false)
  for (const item of chains) {
    const { edge, slots } = item
    const topNode = slots[0].node!
    const bottomNode = slots[slots.length - 1].node!
    const portKey = `${edge.from.id}->${edge.to.id}`
    const points: LayeredPoint[] = [{ x: ports.get(`t:${portKey}`) ?? topNode.x + box.width / 2, y: topNode.y + box.height }]
    for (const slot of slots.slice(1, -1)) {
      const y = rowY(slot.layer, box)
      points.push({ x: slot.x + LANE / 2, y }, { x: slot.x + LANE / 2, y: y + box.height })
    }
    points.push({ x: ports.get(`b:${portKey}`) ?? bottomNode.x + box.width / 2, y: bottomNode.y })
    edge.path = edge.back ? points.reverse() : points
  }
}

const centre = <T>(slot: Slot<T>, box: LayeredBox): number => slot.x + slotWidth(slot, box) / 2

/** Archi che chiudono un ciclo (DFS dai nodi senza entranti, poi dai più pesanti). */
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

/**
 * Riduzione transitiva: toglie a→c se esiste già a→…→c. Gli archi di ciclo restano (servono a vederli);
 * `removed` conta quanti archi sono stati nascosti.
 */
export function reduceTransitive(links: readonly LayeredLink[]): { links: LayeredLink[]; removed: number } {
  const nodes = new Map<string, LayeredNode<null>>()
  const node = (id: string) => nodes.get(id) ?? (nodes.set(id, { id, weight: 0, data: null, layer: 0, x: 0, y: 0 }), nodes.get(id)!)
  const pairs = links.filter((link) => link.from !== link.to).map((link) => ({ link, edge: { from: node(link.from), to: node(link.to), value: link.value } as LayeredEdge<null> }))
  const cycle = cycleEdges([...nodes.values()], pairs.map((pair) => pair.edge))
  const dag = new Map<string, string[]>()
  for (const { edge } of pairs) if (!cycle.has(edge)) dag.set(edge.from.id, [...(dag.get(edge.from.id) ?? []), edge.to.id])
  const reachable = (start: string, target: string): boolean => {
    const seen = new Set<string>([start])
    const stack = (dag.get(start) ?? []).filter((next) => next !== target)
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current === target) return true
      if (seen.has(current)) continue
      seen.add(current)
      stack.push(...(dag.get(current) ?? []))
    }
    return false
  }
  const kept = pairs.filter(({ edge }) => cycle.has(edge) || !reachable(edge.from.id, edge.to.id)).map((pair) => pair.link)
  return { links: kept, removed: pairs.length - kept.length }
}

import type { SpringBean, SpringIndex, SpringInjection } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'
import { beanForInjection } from './springInsights'

export interface BeanNode {
  id: string
  bean: SpringBean
  /** Colonna del livello: 0 = chi nessuno inietta (controller), poi i servizi, in fondo i repository. */
  level: number
  x: number
  y: number
}

export interface BeanEdge {
  from: string
  to: string
  injection: SpringInjection
}

export interface BeanGraph {
  nodes: BeanNode[]
  edges: BeanEdge[]
  /** Iniezioni senza un bean che le soddisfi: a runtime sono un errore d'avvio (NoSuchBeanDefinition). */
  unresolved: SpringInjection[]
  width: number
  height: number
}

export const BEAN_BOX = { width: 190, height: 44, columnGap: 70, rowGap: 18 } as const

const idOf = (bean: SpringBean) => `${bean.type}|${bean.name}|${bean.member ?? ''}`

/** Il nome corto di un tipo qualificato: `com.acme.OrderService` → `OrderService`. */
export function shortType(type: string): string {
  const generic = type.indexOf('<')
  const base = generic < 0 ? type : type.slice(0, generic)
  return base.slice(base.lastIndexOf('.') + 1)
}

/** I bean che l'iniezione di una classe appartiene: il suo bean di classe, o i bean dichiarati con @Bean nella classe. */
function ownersOf(index: SpringIndex, injection: SpringInjection): SpringBean[] {
  const beans = index.beans ?? []
  const own = beans.filter((bean) => bean.type === injection.class && !bean.member)
  return own.length > 0 ? own : beans.filter((bean) => bean.class === injection.class)
}

/**
 * Grafo dei bean come lo conosce l'indice statico: un arco va dal bean che inietta a quello iniettato. I livelli
 * seguono la profondità massima da chi nessuno inietta (con un tetto, così un ciclo non fa girare il calcolo).
 */
export function buildBeanGraph(index: SpringIndex): BeanGraph {
  const beans = index.beans ?? []
  const edges: BeanEdge[] = []
  const unresolved: SpringInjection[] = []
  const seen = new Set<string>()
  for (const injection of index.injections ?? []) {
    const target = beanForInjection(index, injection)
    if (!target) {
      unresolved.push(injection)
      continue
    }
    for (const owner of ownersOf(index, injection)) {
      const key = `${idOf(owner)}>${idOf(target)}`
      if (idOf(owner) === idOf(target) || seen.has(key)) continue
      seen.add(key)
      edges.push({ from: idOf(owner), to: idOf(target), injection })
    }
  }

  const incoming = new Map<string, string[]>()
  for (const edge of edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from])
  const levels = new Map<string, number>()
  const levelOf = (id: string, trail: Set<string>): number => {
    const known = levels.get(id)
    if (known !== undefined) return known
    if (trail.has(id)) return 0 // ciclo: si interrompe qui
    trail.add(id)
    const level = Math.max(-1, ...(incoming.get(id) ?? []).map((parent) => levelOf(parent, trail))) + 1
    trail.delete(id)
    levels.set(id, level)
    return level
  }
  for (const bean of beans) levelOf(idOf(bean), new Set())

  const columns = new Map<number, SpringBean[]>()
  for (const bean of beans) columns.set(levels.get(idOf(bean)) ?? 0, [...(columns.get(levels.get(idOf(bean)) ?? 0) ?? []), bean])
  const nodes: BeanNode[] = []
  let height = 0
  for (const [level, members] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    members.sort((a, b) => shortType(a.type).localeCompare(shortType(b.type)) || a.name.localeCompare(b.name))
    members.forEach((bean, row) => {
      const y = row * (BEAN_BOX.height + BEAN_BOX.rowGap)
      nodes.push({ id: idOf(bean), bean, level, x: level * (BEAN_BOX.width + BEAN_BOX.columnGap), y })
      height = Math.max(height, y + BEAN_BOX.height)
    })
  }
  const lastLevel = nodes.reduce((max, node) => Math.max(max, node.level), 0)
  return { nodes, edges, unresolved, width: (lastLevel + 1) * BEAN_BOX.width + lastLevel * BEAN_BOX.columnGap, height }
}

/** Curva di Bézier dal lato destro di un nodo al lato sinistro dell'altro (o, in un ciclo, all'indietro). */
export function edgePath(from: BeanNode, to: BeanNode): string {
  const startX = from.x + BEAN_BOX.width
  const startY = from.y + BEAN_BOX.height / 2
  const endX = to.x
  const endY = to.y + BEAN_BOX.height / 2
  const reach = Math.max(40, Math.abs(endX - startX) / 2)
  return `M ${startX} ${startY} C ${startX + reach} ${startY}, ${endX - reach} ${endY}, ${endX} ${endY}`
}

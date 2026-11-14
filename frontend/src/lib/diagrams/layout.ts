/**
 * Auto-layout with ELK (Eclipse Layout Kernel, layered algorithm). ELK is loaded on first use, so it
 * costs nothing until someone presses Auto-layout. Only top-level nodes move; nodes inside a
 * container move with it.
 */
import type { ElkNode } from 'elkjs/lib/elk-api'
import type { DiagramGraph } from './model'
import { nodeSize } from './graphOps'

export type LayoutDirection = 'RIGHT' | 'DOWN'

export interface LayoutOptions {
  direction: LayoutDirection
  /** Space between nodes of a layer and between layers. */
  spacing: number
}

export const DEFAULT_LAYOUT: LayoutOptions = { direction: 'RIGHT', spacing: 60 }

type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> }
let elkInstance: Promise<ElkInstance> | null = null

function elk(): Promise<ElkInstance> {
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then((module) => {
    const Elk = (module as unknown as { default: new () => ElkInstance }).default
    return new Elk()
  })
  return elkInstance
}

/** The ELK input for a graph: top-level nodes with their sizes, and the edges between them. */
export function elkGraph(graph: DiagramGraph, options: LayoutOptions): ElkNode {
  const topLevel = graph.nodes.filter((node) => !node.parentId)
  const ids = new Set(topLevel.map((node) => node.id))
  // An edge into a container's child is laid out as an edge to the container itself.
  const parentOf = new Map(graph.nodes.map((node) => [node.id, node.parentId]))
  const root = (id: string) => {
    let current = id
    const seen = new Set<string>()
    while (parentOf.get(current) && !seen.has(current)) { seen.add(current); current = parentOf.get(current)! }
    return current
  }
  const edges = graph.edges
    .map((edge) => ({ id: edge.id, source: root(edge.source), target: root(edge.target) }))
    .filter((edge) => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target))
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': options.direction,
      'elk.spacing.nodeNode': String(options.spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.spacing * 1.4),
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      // Nodes of a layer keep the order they were declared in: a template reads top to bottom as written.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: topLevel.map((node) => ({ id: node.id, ...nodeSize(node) })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
}

/** Applies ELK's result: new positions for the nodes it placed, everything else unchanged. */
export function applyLayout(graph: DiagramGraph, result: ElkNode): DiagramGraph {
  const placed = new Map((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]))
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (placed.has(node.id) && !node.data.locked ? { ...node, position: placed.get(node.id)! } : node)),
    // Manual bends no longer fit the new places: the connectors route themselves again.
    edges: graph.edges.map((edge) => (edge.data?.waypoints.length ? { ...edge, data: { ...edge.data, waypoints: [] } } : edge)),
  }
}

export async function autoLayout(graph: DiagramGraph, options: LayoutOptions = DEFAULT_LAYOUT): Promise<DiagramGraph> {
  if (graph.nodes.length === 0) return graph
  const engine = await elk()
  return applyLayout(graph, await engine.layout(elkGraph(graph, options)))
}

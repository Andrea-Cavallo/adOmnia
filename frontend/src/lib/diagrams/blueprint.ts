/**
 * Blueprints: diagrams described as data (typed nodes and links, no coordinates) and turned into a
 * laid-out graph. Templates are blueprints; a future generator that reads workspace metadata
 * (Developer Context routes, topics, datasources, OSGi bundles) only has to produce one. Discovery
 * stays outside the editor: this module never reads the workspace.
 */
import { createEdge, createNode } from './graphOps'
import { autoLayout, type LayoutOptions } from './layout'
import type { DiagramEdgeData, DiagramGraph, DiagramNode, EdgeRouting } from './model'
import { DEFAULT_NODE_STYLE, STYLE_PALETTE, shapeOf } from './shapes'

export interface BlueprintNode {
  /** Stable key used by the links; not the node id. */
  key: string
  shape: string
  label: string
  subtitle?: string
  /** A tint of STYLE_PALETTE (`green`, `violet`…), for nodes that carry a meaning. */
  color?: string
  /** Key of the container this node sits in. */
  parent?: string
}

export interface BlueprintLink {
  from: string
  to: string
  label?: string
  /** Animated pulses: data flowing from `from` to `to`. */
  flow?: boolean
  dashed?: boolean
  /** A tint of STYLE_PALETTE for the line. */
  color?: string
}

export interface DiagramBlueprint {
  nodes: BlueprintNode[]
  links: BlueprintLink[]
}

/** Something that can describe part of the workspace as a diagram (implemented outside the editor). */
export interface DiagramSource {
  id: string
  label: string
  describe: () => Promise<DiagramBlueprint>
}

const tint = (id: string | undefined) => STYLE_PALETTE.find((entry) => entry.id === id)

/** Space between the nodes inside a container and between them and its border. */
const CONTAINER_GAP = 40

/** The blueprint as a graph: nodes with their shapes, containers sized and filled in rows, links routed. */
export function graphFromBlueprint(blueprint: DiagramBlueprint, routing: EdgeRouting): DiagramGraph {
  const ids = new Map<string, string>()
  const created = blueprint.nodes.map((spec) => {
    const color = tint(spec.color)
    const style = color ? { style: { ...DEFAULT_NODE_STYLE, ...shapeOf(spec.shape).style, fill: color.fill, stroke: color.stroke } } : {}
    const node = createNode(spec.shape, { x: 0, y: 0 }, { label: spec.label, ...(spec.subtitle === undefined ? {} : { subtitle: spec.subtitle }), ...style })
    ids.set(spec.key, node.id)
    return { spec, node }
  })
  const nodes = created.map(({ spec, node }): DiagramNode => (spec.parent && ids.has(spec.parent) ? { ...node, parentId: ids.get(spec.parent) } : node))
  const sized = fitContainers(nodes)
  const edges = blueprint.links.flatMap((link) => {
    const source = ids.get(link.from)
    const target = ids.get(link.to)
    if (!source || !target) return []
    const data: Partial<DiagramEdgeData> = { label: link.label ?? '', flow: link.flow ?? false, dashed: link.dashed ?? false, color: tint(link.color)?.stroke ?? '' }
    return [createEdge({ source, target, sourceHandle: null, targetHandle: null }, routing, data)]
  })
  // Containers first: React Flow needs a parent before its children.
  const containers = sized.filter((node) => sized.some((child) => child.parentId === node.id))
  return { nodes: [...containers, ...sized.filter((node) => !containers.includes(node))], edges }
}

/** Lays the children of each container out in a row and grows the container around them. */
function fitContainers(nodes: DiagramNode[]): DiagramNode[] {
  const children = new Map<string, DiagramNode[]>()
  for (const node of nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  const placed = new Map<string, DiagramNode>()
  for (const [parentId, members] of children) {
    let x = CONTAINER_GAP
    let tallest = 0
    for (const member of members) {
      placed.set(member.id, { ...member, position: { x, y: CONTAINER_GAP + 12 } })
      x += (member.width ?? 0) + CONTAINER_GAP
      tallest = Math.max(tallest, member.height ?? 0)
    }
    const parent = nodes.find((node) => node.id === parentId)
    if (parent) placed.set(parentId, { ...parent, width: Math.max(parent.width ?? 0, x), height: Math.max(parent.height ?? 0, tallest + CONTAINER_GAP * 2 + 12) })
  }
  return nodes.map((node) => placed.get(node.id) ?? node)
}

export async function diagramFromBlueprint(blueprint: DiagramBlueprint, routing: EdgeRouting, layout?: LayoutOptions): Promise<DiagramGraph> {
  return autoLayout(graphFromBlueprint(blueprint, routing), layout)
}

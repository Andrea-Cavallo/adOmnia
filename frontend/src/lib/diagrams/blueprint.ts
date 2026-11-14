/**
 * Blueprints: diagrams described as data (typed nodes and links, no coordinates) and turned into a
 * laid-out graph. Templates are blueprints; a future generator that reads workspace metadata
 * (Developer Context routes, topics, datasources, OSGi bundles) only has to produce one. Discovery
 * stays outside the editor: this module never reads the workspace.
 */
import { createEdge, createNode } from './graphOps'
import { autoLayout, DEFAULT_LAYOUT, type LayoutOptions } from './layout'
import type { DiagramCodeRef, DiagramEdgeData, DiagramGraph, DiagramNode, EdgeRouting, LinkConfidence } from './model'
import { DEFAULT_NODE_STYLE, STYLE_PALETTE, shapeOf } from './shapes'

export interface BlueprintNode {
  /** Stable key used by the links; not the node id. */
  key: string
  shape: string
  label: string
  subtitle?: string
  /** A tint of STYLE_PALETTE (`green`, `violet`…), for nodes that carry a meaning. */
  color?: string
  /** A picture of the icon library (`tech/apachekafka.svg`) drawn instead of the shape, with the label under it. */
  icon?: string
  /** Key of the container this node sits in. */
  parent?: string
  /** The analysed entity this node stands for (workspace generation only). */
  source?: DiagramCodeRef
  service?: string
  generated?: boolean
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
  /** Set on relations derived from the code, never on links the user drew. */
  confidence?: LinkConfidence
  evidence?: string
  generated?: boolean
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

/** Where the icon library is served from; the paths are the ones of its manifest. */
export const DIAGRAM_ICON_BASE = `${import.meta.env.BASE_URL}diagram-icons/`
const ICON_NODE_SIZE = 64

const TEXT_FIT = { labelChar: 8.2, subtitleChar: 6.8, padding: 56, max: 340 }

/** A generated node is as wide as its name and its file:line, so neither wraps mid-word nor overflows. */
export function widenToText(node: DiagramNode): DiagramNode {
  const text = Math.max(node.data.label.length * TEXT_FIT.labelChar, (node.data.subtitle?.length ?? 0) * TEXT_FIT.subtitleChar)
  const width = Math.min(TEXT_FIT.max, Math.max(node.width ?? 0, Math.ceil(text) + TEXT_FIT.padding))
  return width === node.width ? node : { ...node, width }
}

/** The blueprint as a graph: nodes with their shapes, containers sized and filled in rows, links routed. */
export function graphFromBlueprint(blueprint: DiagramBlueprint, routing: EdgeRouting): DiagramGraph {
  const ids = new Map<string, string>()
  const created = blueprint.nodes.map((spec) => {
    const color = tint(spec.color)
    const style = color ? { style: { ...DEFAULT_NODE_STYLE, ...shapeOf(spec.shape).style, fill: color.fill, stroke: color.stroke } } : {}
    const iconNode = spec.icon
      ? { ...createNode('image', { x: 0, y: 0 }, { image: `${DIAGRAM_ICON_BASE}${spec.icon}`, label: spec.subtitle ? `${spec.label} · ${spec.subtitle}` : spec.label }), width: ICON_NODE_SIZE, height: ICON_NODE_SIZE }
      : null
    const node = iconNode ?? createNode(spec.shape, { x: 0, y: 0 }, {
      label: spec.label,
      ...(spec.subtitle === undefined ? {} : { subtitle: spec.subtitle }),
      ...(spec.source ? { source: spec.source, generated: true } : {}),
      ...(spec.service ? { service: spec.service } : {}),
      ...(spec.generated ? { generated: true } : {}),
      ...style,
    })
    ids.set(spec.key, node.id)
    return { spec, node: spec.generated ? widenToText(node) : node }
  })
  const nodes = created.map(({ spec, node }): DiagramNode => (spec.parent && ids.has(spec.parent) ? { ...node, parentId: ids.get(spec.parent) } : node))
  const sized = fitContainers(nodes)
  const edges = blueprint.links.flatMap((link) => {
    const source = ids.get(link.from)
    const target = ids.get(link.to)
    if (!source || !target) return []
    const data: Partial<DiagramEdgeData> = {
      label: link.label ?? '', flow: link.flow ?? false, dashed: link.dashed ?? false, color: tint(link.color)?.stroke ?? '',
      ...(link.confidence ? { confidence: link.confidence, generated: true } : {}),
      ...(link.evidence ? { evidence: link.evidence } : {}),
    }
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
    const parent = nodes.find((node) => node.id === parentId)
    if (!parent) continue
    // A tall container (a swimlane) grows downwards, a wide one to the right.
    const column = (parent.height ?? 0) > (parent.width ?? 0)
    let offset = 0
    let deepest = 0
    for (const member of members) {
      placed.set(member.id, { ...member, position: column
        ? { x: CONTAINER_GAP, y: CONTAINER_GAP + 12 + offset }
        : { x: CONTAINER_GAP + offset, y: CONTAINER_GAP + 12 } })
      offset += (column ? member.height ?? 0 : member.width ?? 0) + CONTAINER_GAP
      deepest = Math.max(deepest, column ? member.width ?? 0 : member.height ?? 0)
    }
    placed.set(parentId, { ...parent, ...(column
      ? { width: Math.max(parent.width ?? 0, deepest + CONTAINER_GAP * 2), height: CONTAINER_GAP * 2 + 12 + offset }
      : { width: CONTAINER_GAP + offset, height: Math.max(parent.height ?? 0, deepest + CONTAINER_GAP * 2 + 12) }) })
  }
  return nodes.map((node) => placed.get(node.id) ?? node)
}

/**
 * A lane blueprint: the containers stay in the order they are declared and sit side by side, because
 * ELK orders top-level nodes by their edges and a swimlane must read in the order its author wrote.
 * Only the lanes are placed; their children come from `fitContainers`.
 */
export function lanesFromBlueprint(blueprint: DiagramBlueprint, routing: EdgeRouting, gap = 32): DiagramGraph {
  const graph = graphFromBlueprint(blueprint, routing)
  let x = 0
  const laneX = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.parentId) continue
    laneX.set(node.id, x)
    x += (node.width ?? 0) + gap
  }
  return { ...graph, nodes: graph.nodes.map((node) => (node.parentId ? node : { ...node, position: { x: laneX.get(node.id) ?? 0, y: 0 } })) }
}


/** Room a connector label needs between two layers, so it never covers the shapes it joins. */
const LABEL_CHAR = 6
const LABEL_MARGIN = 28
/** ELK puts 1.4 × spacing between layers (layout.ts). */
const LAYER_FACTOR = 1.4

export async function diagramFromBlueprint(blueprint: DiagramBlueprint, routing: EdgeRouting, layout: LayoutOptions = DEFAULT_LAYOUT): Promise<DiagramGraph> {
  const longest = Math.max(0, ...blueprint.links.map((link) => link.label?.length ?? 0))
  const spacing = Math.max(layout.spacing, Math.ceil((longest * LABEL_CHAR + LABEL_MARGIN) / LAYER_FACTOR))
  return autoLayout(graphFromBlueprint(blueprint, routing), { ...layout, spacing })
}

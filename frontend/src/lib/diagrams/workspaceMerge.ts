/**
 * Merging a generated graph into a live Diagram Studio document. Layout, names, notes and manual
 * connectors belong to the user: a refresh replaces the relations derived from the code and updates
 * the source refs, but never moves a node the user placed or renames a shape they labelled.
 */
import { createEdge, createNode, nodeSize } from './graphOps'
import type { BlueprintLink } from './blueprint'
import { blueprintLinkOf, blueprintNodeOf, confidenceOf } from './workspace'
import { STYLE_PALETTE } from './shapes'
import type { WorkspaceEntity, WorkspaceLink } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/diagrams/models'
import type { DiagramCodeRef, DiagramEdge, DiagramGraph, DiagramNode, EdgeRouting } from './model'

const RELATED_GAP = 64
const RELATED_STACK = 92

/** Edge ids are derived from what the relation is about, so a refresh updates instead of duplicating. */
export function stableEdgeId(link: Pick<BlueprintLink, 'from' | 'to' | 'label'>): string {
  return `gen:${link.from}\u0000${link.to}\u0000${link.label ?? ''}`
}

function nodeEntityId(node: DiagramNode): string | undefined {
  return node.data.source?.entityId
}

/**
 * Merges the freshly generated graph into the current one.
 * - generated nodes keep their position, size, label and style; only the source ref and stale flag change
 * - a generated node missing from the new analysis is kept and marked stale, never silently deleted
 * - generated edges are replaced; manual edges and manual nodes are untouched
 */
export function mergeGeneratedGraph(current: DiagramGraph, fresh: DiagramGraph): { graph: DiagramGraph; added: number; stale: number } {
  const freshByEntity = new Map<string, DiagramNode>()
  const freshEntityByNode = new Map<string, string>()
  for (const node of fresh.nodes) {
    const entityId = nodeEntityId(node)
    if (entityId) {
      freshByEntity.set(entityId, node)
      freshEntityByNode.set(node.id, entityId)
    }
  }
  const currentByEntity = new Map<string, DiagramNode>()
  for (const node of current.nodes) {
    const entityId = nodeEntityId(node)
    if (entityId) currentByEntity.set(entityId, node)
  }

  let added = 0
  let stale = 0
  const nodes: DiagramNode[] = current.nodes.map((node) => {
    const entityId = nodeEntityId(node)
    if (!entityId) return node
    const replacement = freshByEntity.get(entityId)
    if (!replacement) {
      stale++
      return { ...node, data: { ...node.data, stale: true } }
    }
    return {
      ...node,
      data: {
        ...node.data,
        source: replacement.data.source,
        service: replacement.data.service,
        generated: true,
        stale: false,
      },
    }
  })
  const nodeIdByEntity = new Map<string, string>()
  for (const node of nodes) {
    const entityId = nodeEntityId(node)
    if (entityId) nodeIdByEntity.set(entityId, node.id)
  }

  for (const freshNode of fresh.nodes) {
    const entityId = nodeEntityId(freshNode)
    if (entityId && currentByEntity.has(entityId)) continue
    nodes.push(freshNode)
    if (entityId) nodeIdByEntity.set(entityId, freshNode.id)
    added++
  }

  const manualEdges = current.edges.filter((edge) => !edge.data?.generated)
  const generatedEdges: DiagramEdge[] = []
  for (const edge of fresh.edges) {
    const source = nodeIdByEntity.get(freshEntityByNode.get(edge.source) ?? edge.source)
    const target = nodeIdByEntity.get(freshEntityByNode.get(edge.target) ?? edge.target)
    if (!source || !target || source === target) continue
    generatedEdges.push({ ...edge, id: edge.id.startsWith('gen:') ? edge.id : `gen:${edge.id}`, source, target })
  }
  return { graph: { nodes, edges: [...manualEdges, ...generatedEdges] }, added, stale }
}

/** Places newly revealed entities around an anchor without disturbing the existing layout. */
export function relatedGraph(
  entities: WorkspaceEntity[],
  links: WorkspaceLink[],
  anchor: DiagramNode | null,
  options: { sessionId: string; workspaceId?: string; fingerprint?: string; routing: EdgeRouting },
): DiagramGraph {
  const nodes: DiagramNode[] = []
  const byEntity = new Map<string, DiagramNode>()
  const origin = anchor ? { x: anchor.position.x + nodeSize(anchor).width + RELATED_GAP, y: anchor.position.y } : { x: 0, y: 0 }
  entities.forEach((entity, index) => {
    if (anchor && entity.id === anchor.data.source?.entityId) {
      byEntity.set(entity.id, anchor)
      return
    }
    const base = revealNode(entity, null, options)
    const node = { ...base, position: { x: origin.x, y: origin.y + index * RELATED_STACK } }
    nodes.push(node)
    byEntity.set(entity.id, node)
  })
  const edges: DiagramEdge[] = []
  for (const link of links) {
    const source = byEntity.get(link.from)
    const target = byEntity.get(link.to)
    if (!source || !target || source.id === target.id) continue
    const spec = blueprintLinkOf(link)
    edges.push(createEdge({ source: source.id, target: target.id, sourceHandle: null, targetHandle: null }, options.routing, {
      label: spec.label ?? '', confidence: confidenceOf(spec.confidence), evidence: spec.evidence, generated: true,
      dashed: spec.dashed ?? false, flow: spec.flow ?? false, color: spec.color ?? '',
    }))
  }
  return { nodes, edges }
}

/** A node for an entity that is not in the diagram yet. */
export function revealNode(entity: WorkspaceEntity, anchor: DiagramNode | null, options: { sessionId: string; workspaceId?: string; fingerprint?: string }): DiagramNode {
  const spec = blueprintNodeOf(entity, options, options.fingerprint)
  const at = anchor ? { x: anchor.position.x + nodeSize(anchor).width + RELATED_GAP, y: anchor.position.y } : { x: 0, y: 0 }
  const base = createNode(spec.shape, at)
  // A shape from the catalog may already carry a style; the service tint is merged over it.
  return {
    ...base,
    data: {
      ...base.data,
      label: spec.label,
      ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
      ...(spec.color ? { style: { ...base.data.style, ...styleOfColor(spec.color) } } : {}),
      source: spec.source,
      ...(spec.service ? { service: spec.service } : {}),
      generated: true,
    },
  }
}

function styleOfColor(color: string): { fill?: string; stroke?: string } {
  const tint = STYLE_PALETTE.find((entry) => entry.id === color)
  return tint ? { fill: tint.fill, stroke: tint.stroke } : {}
}

/** The diagram data for one code ref, so Open in Code Studio can use the freshest position. */
export function sourceOfNode(node: DiagramNode | undefined): DiagramCodeRef | undefined {
  return node?.data.source
}

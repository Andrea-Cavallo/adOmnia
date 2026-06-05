import { blankRequest, uid, type RequestItem, type VisualTest, type TestBlock } from '@/lib/types'
import {
  DEFAULT_FLOW_SETTINGS,
  type FlowNodeDefinition,
  type FlowEdgeDefinition,
  type SavedFlowDefinition,
  type ConditionOperator,
} from '@/lib/flowStorage'

// Assert operators that map cleanly onto flow ConditionOperator.
const ASSERT_TO_CONDITION_OP: Record<string, ConditionOperator> = {
  eq: 'eq',
  neq: 'neq',
  contains: 'contains',
  gt: 'gt',
  lt: 'lt',
  exists: 'exists',
}

function stripJsonPath(path: string): string {
  return path.replace(/^\$\.?/, '')
}

/**
 * Convert a VisualTest's linear block list into a Flow graph definition.
 *
 * - Request blocks become `request` nodes (the resolved RequestItem + extractions).
 * - Assert blocks become `condition` nodes.
 * - SetVar blocks become `extract` nodes (expression source).
 *
 * Nodes are chained Start → … → End(success) with `next` edges, mirroring the
 * legacy step→graph conversion used elsewhere in the flow store.
 */
export function visualTestToFlow(test: VisualTest, allRequests: RequestItem[]): SavedFlowDefinition {
  const nodes: FlowNodeDefinition[] = []
  const edges: FlowEdgeDefinition[] = []

  const startId = uid()
  nodes.push({ id: startId, type: 'start', label: 'Start', x: 80, y: 220, width: 130, height: 74, config: {} })

  let previousId = startId
  let col = 1

  const link = (targetId: string) => {
    edges.push({ id: uid(), source: previousId, target: targetId, branch: 'next', label: '' })
    previousId = targetId
  }

  for (const block of test.blocks) {
    const nodeId = uid()
    const x = 80 + col * 260
    col += 1

    if (block.type === 'request') {
      const found = allRequests.find((r) => r.id === block.collectionItemId)
      const request: RequestItem = found
        ? { ...found }
        : { ...blankRequest('GET', block.label || 'Request') }
      nodes.push({
        id: nodeId,
        type: 'request',
        label: block.label || request.name || 'Request',
        x,
        y: 205,
        width: 220,
        height: 122,
        config: {
          request,
          expectedStatus: '2xx',
          stopOnFailure: true,
          extractions: (block.extractVars ?? [])
            .filter((e) => e.varName && e.jsonPath)
            .map((e) => ({ id: uid(), name: e.varName, source: 'body' as const, path: stripJsonPath(e.jsonPath) })),
        },
      })
      link(nodeId)
    } else if (block.type === 'assert') {
      nodes.push({
        id: nodeId,
        type: 'condition',
        label: `Assert ${block.field || ''}`.trim(),
        x,
        y: 185,
        width: 150,
        height: 150,
        config: {
          condition: {
            source: block.source === 'status' ? 'status' : block.source === 'header' ? 'header' : 'body',
            path: block.source === 'status' ? 'response.status' : block.field,
            operator: ASSERT_TO_CONDITION_OP[block.operator] ?? 'eq',
            value: block.expected,
          },
        },
      })
      link(nodeId)
    } else if (block.type === 'setvar') {
      nodes.push({
        id: nodeId,
        type: 'extract',
        label: `Set ${block.varName || 'var'}`,
        x,
        y: 205,
        width: 210,
        height: 116,
        config: {
          note: `${block.varName} = ${block.expression}`,
          extractions: block.varName
            ? [{ id: uid(), name: block.varName, source: 'expression' as const, path: block.expression }]
            : [],
        },
      })
      link(nodeId)
    }
    // if/loop blocks are not represented in the v1 flow export.
  }

  const endId = uid()
  nodes.push({
    id: endId,
    type: 'end',
    label: 'End success',
    x: 80 + col * 260,
    y: 220,
    width: 146,
    height: 74,
    config: { endState: 'success' },
  })
  edges.push({ id: uid(), source: previousId, target: endId, branch: 'next', label: '' })

  return {
    id: uid(),
    name: `${test.name || 'Visual Test'} (from Visual Test)`,
    graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, settings: DEFAULT_FLOW_SETTINGS },
    updatedAt: new Date().toISOString(),
    version: 3,
  }
}

/** Best-effort count of blocks that survive the flow export (request/assert/setvar). */
export function exportableBlockCount(blocks: TestBlock[]): number {
  return blocks.filter((b) => b.type === 'request' || b.type === 'assert' || b.type === 'setvar').length
}

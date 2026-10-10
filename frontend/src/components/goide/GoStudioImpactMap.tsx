import { useMemo } from 'react'
import { layoutLayered, type LayeredBox } from '@/lib/layeredGraph'
import { impactMapGraph, type GraphImpact, type GraphRef } from '@/lib/goide/workspaceGraph'
import { useGoIDEStore } from '@/stores/goide'

const BOX: LayeredBox = { width: 176, height: 38, gapX: 18, gapY: 46, padding: 14 }

const GROUP_LABEL: Record<string, string> = {
  service: 'compose', entry: 'entry', route: 'route', rpc: 'gRPC', topic: 'topic', test: 'test', caller: 'caller',
  type: 'type', interface: 'contract', callee: 'calls', table: 'table', config: 'env/config', target: 'changed',
}

/** Architecture view of an impact: who reaches the changed code above it, what it touches below. */
export function GoStudioImpactMap({ impact, onFocus }: { impact: GraphImpact; onFocus: (ref: GraphRef) => void }) {
  const layout = useMemo(() => {
    const { items, links } = impactMapGraph(impact)
    return layoutLayered(items, links, BOX)
  }, [impact])
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <svg width={layout.width} height={layout.height} className="block" role="img" aria-label={`Impact map of ${impact.target.label}`}>
        <defs>
          <marker id="impact-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-4)" /></marker>
        </defs>
        {layout.edges.map((edge) => {
          const x1 = edge.from.x + BOX.width / 2
          const y1 = edge.from.y + BOX.height
          const x2 = edge.to.x + BOX.width / 2
          const y2 = edge.to.y
          return <path key={`${edge.from.id}>${edge.to.id}`} d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} fill="none" stroke="var(--color-text-4)" strokeWidth={1.2} opacity={0.7} markerEnd="url(#impact-arrow)" />
        })}
        {layout.nodes.map((placed) => {
          const { node, role, group } = placed.data
          const target = role === 'target'
          return (
            <foreignObject key={placed.id} x={placed.x} y={placed.y} width={BOX.width} height={BOX.height}>
              <button
                type="button"
                title={`${node.label}${node.file ? `\n${node.file}:${node.line}` : ''}\nClick: open · Alt+click: impact of this node`}
                onClick={(event) => {
                  if (event.altKey && !target) return onFocus({ node, depth: 1 })
                  if (node.file) void useGoIDEStore.getState().openLocation(node.file, node.line || 1)
                }}
                className={`flex h-full w-full flex-col justify-center rounded-md border px-2 text-left ${target ? 'border-accent bg-accent/15' : role === 'upstream' ? 'border-border-2 bg-surface-2 hover:border-accent' : 'border-dashed border-border-2 bg-surface-1 hover:border-accent'}`}
              >
                <span className="truncate font-mono text-[11px] text-text-1">{node.label}</span>
                <span className="text-[9.5px] uppercase tracking-wide text-text-4">{GROUP_LABEL[group] ?? group}</span>
              </button>
            </foreignObject>
          )
        })}
      </svg>
    </div>
  )
}

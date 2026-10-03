import { useMemo } from 'react'
import { CALL_GRAPH_NODE, layoutCallGraph } from './goStudioCallGraphLayout'
import { codeOriginColor, formatProfilePercent, formatProfileValue, shortFunctionName, type ProfileFunction, type ProfileNode } from './goStudioProfiles'

interface GoStudioCallGraphProps {
  top: ProfileNode[]
  edges: Array<{ caller: ProfileFunction; callee: ProfileFunction; value: number[] }>
  sampleIndex: number
  total: number
  unit: string
  hideRuntime: boolean
  selected: string | null
  onSelect: (fn: ProfileFunction) => void
  onOpen: (fn: ProfileFunction) => void
}

/** Call graph a nodi delle funzioni più costose: spessore degli archi = costo della chiamata. */
export function GoStudioCallGraph({ top, edges, sampleIndex, total, unit, hideRuntime, selected, onSelect, onOpen }: GoStudioCallGraphProps) {
  const layout = useMemo(() => layoutCallGraph(top, edges, sampleIndex, { hideRuntime }), [top, edges, sampleIndex, hideRuntime])
  const { width: w, height: h } = CALL_GRAPH_NODE
  if (layout.nodes.length === 0) return <p className="p-4 text-[12px] text-text-4">No call data for this sample type.</p>
  const related = new Set(selected ? layout.edges.filter((edge) => edge.from.fn.name === selected || edge.to.fn.name === selected).flatMap((edge) => [edge.from.fn.name, edge.to.fn.name]) : [])

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <p className="px-1 pb-2 text-[11px] text-text-4">The {layout.nodes.length} most expensive functions by cumulative cost. Click to highlight its calls, double-click to open the source.</p>
      <svg role="img" aria-label="Call graph" width={layout.width} height={layout.height} className="block">
        <defs>
          <marker id="gs-callgraph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-4)" />
          </marker>
        </defs>
        {layout.edges.map((edge) => {
          const x1 = edge.from.x + w / 2
          const y1 = edge.from.y + h
          const x2 = edge.to.x + w / 2
          const y2 = edge.to.y
          const up = y2 <= y1
          const bend = up ? 60 : Math.max(24, (y2 - y1) / 2)
          const active = !selected || edge.from.fn.name === selected || edge.to.fn.name === selected
          const thickness = 1 + (layout.maxEdge > 0 ? (edge.value / layout.maxEdge) * 5 : 0)
          return (
            <path key={`${edge.from.fn.name}->${edge.to.fn.name}`} d={`M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`}
              fill="none" stroke={active ? 'var(--color-text-3)' : 'var(--color-border-2, var(--color-border-1))'} strokeOpacity={active ? 0.75 : 0.35} strokeWidth={thickness} markerEnd="url(#gs-callgraph-arrow)">
              <title>{`${shortFunctionName(edge.from.fn)} → ${shortFunctionName(edge.to.fn)}: ${formatProfileValue(edge.value, unit)} (${formatProfilePercent(edge.value, total)})`}</title>
            </path>
          )
        })}
        {layout.nodes.map((node) => {
          const color = codeOriginColor(node.fn)
          const isSelected = node.fn.name === selected
          const dimmed = !!selected && !isSelected && !related.has(node.fn.name)
          return (
            <g key={node.fn.name} transform={`translate(${node.x},${node.y})`} opacity={dimmed ? 0.4 : 1} className="cursor-pointer"
              onClick={() => onSelect(node.fn)} onDoubleClick={() => onOpen(node.fn)}>
              <title>{`${node.fn.name}\n${formatProfileValue(node.cum, unit)} cumulative (${formatProfilePercent(node.cum, total)})`}</title>
              <rect width={w} height={h} rx={8} fill={`color-mix(in srgb, ${color} 16%, var(--gs-island, var(--color-surface-2)))`} stroke={isSelected ? 'var(--color-accent)' : color} strokeWidth={isSelected ? 2 : 1} />
              <rect width={4} height={h - 12} x={6} y={6} rx={2} fill={color} />
              <text x={16} y={17} className="fill-[var(--color-text-1)] font-mono text-[11px]">{truncate(shortFunctionName(node.fn), 24)}</text>
              <text x={16} y={32} className="fill-[var(--color-text-4)] text-[10px] tabular-nums">{formatProfileValue(node.cum, unit)} · {formatProfilePercent(node.cum, total)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

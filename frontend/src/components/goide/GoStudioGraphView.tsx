import { useId } from 'react'
import { LAYERED_BOX, type LayeredBox, type LayeredLayout, type LayeredNode } from './goStudioLayeredGraph'

export interface GraphNodeLook {
  title: string
  subtitle?: string
  tooltip?: string
  color: string
}

interface GoStudioGraphViewProps<T> {
  layout: LayeredLayout<T>
  label: string
  box?: LayeredBox
  selected: string | null
  look: (node: LayeredNode<T>) => GraphNodeLook
  edgeTitle?: (from: LayeredNode<T>, to: LayeredNode<T>, value: number) => string
  onSelect: (node: LayeredNode<T>) => void
  onOpen?: (node: LayeredNode<T>) => void
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Grafo SVG a livelli: archi curvi con spessore proporzionale al peso, selezione che evidenzia
 * i vicini e attenua il resto. Clic seleziona, doppio clic apre il sorgente.
 */
export function GoStudioGraphView<T>({ layout, label, box = LAYERED_BOX, selected, look, edgeTitle, onSelect, onOpen }: GoStudioGraphViewProps<T>) {
  const marker = `gs-graph-arrow-${useId().replace(/:/g, '')}`
  const { width: w, height: h } = box
  const related = new Set(selected ? layout.edges.filter((edge) => edge.from.id === selected || edge.to.id === selected).flatMap((edge) => [edge.from.id, edge.to.id]) : [])
  const characters = Math.max(8, Math.floor((w - 24) / 6.6))
  return (
    <svg role="img" aria-label={label} width={layout.width} height={layout.height} className="block">
      <defs>
        <marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-4)" />
        </marker>
      </defs>
      {layout.edges.map((edge) => {
        const x1 = edge.from.x + w / 2
        const y1 = edge.from.y + h
        const x2 = edge.to.x + w / 2
        const y2 = edge.to.y
        const bend = y2 <= y1 ? 60 : Math.max(24, (y2 - y1) / 2)
        const active = !selected || edge.from.id === selected || edge.to.id === selected
        const thickness = 1 + (layout.maxEdge > 0 ? (edge.value / layout.maxEdge) * 5 : 0)
        return (
          <path key={`${edge.from.id}->${edge.to.id}`} d={`M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`}
            fill="none" stroke={active ? 'var(--color-text-3)' : 'var(--color-border-2, var(--color-border-1))'} strokeOpacity={active ? 0.75 : 0.35} strokeWidth={thickness} markerEnd={`url(#${marker})`}>
            {edgeTitle && <title>{edgeTitle(edge.from, edge.to, edge.value)}</title>}
          </path>
        )
      })}
      {layout.nodes.map((node) => {
        const { title, subtitle, tooltip, color } = look(node)
        const isSelected = node.id === selected
        const dimmed = !!selected && !isSelected && !related.has(node.id)
        return (
          <g key={node.id} transform={`translate(${node.x},${node.y})`} opacity={dimmed ? 0.4 : 1} className="cursor-pointer"
            onClick={() => onSelect(node)} onDoubleClick={() => onOpen?.(node)}>
            <title>{tooltip ?? title}</title>
            <rect width={w} height={h} rx={8} fill={`color-mix(in srgb, ${color} 16%, var(--gs-island, var(--color-surface-2)))`} stroke={isSelected ? 'var(--color-accent)' : color} strokeWidth={isSelected ? 2 : 1} />
            <rect width={4} height={h - 12} x={6} y={6} rx={2} fill={color} />
            <text x={16} y={subtitle ? 17 : h / 2 + 4} className="fill-[var(--color-text-1)] font-mono text-[11px]">{truncate(title, characters)}</text>
            {subtitle && <text x={16} y={32} className="fill-[var(--color-text-4)] text-[10px] tabular-nums">{truncate(subtitle, characters + 4)}</text>}
          </g>
        )
      })}
    </svg>
  )
}

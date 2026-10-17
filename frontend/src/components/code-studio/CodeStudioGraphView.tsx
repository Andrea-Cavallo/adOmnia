import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { LAYERED_BOX, type LayeredBox, type LayeredEdge, type LayeredLayout, type LayeredNode } from './codeStudioLayeredGraph'

export interface GraphNodeLook {
  title: string
  subtitle?: string
  tooltip?: string
  color: string
}

interface CodeStudioGraphViewProps<T> {
  layout: LayeredLayout<T>
  label: string
  box?: LayeredBox
  selected: string | null
  look: (node: LayeredNode<T>) => GraphNodeLook
  edgeTitle?: (from: LayeredNode<T>, to: LayeredNode<T>, value: number) => string
  onSelect: (node: LayeredNode<T>) => void
  onOpen?: (node: LayeredNode<T>) => void
}

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
/** Altezza massima del riquadro: un grafo più alto si esplora con pan/zoom invece di allungare il pannello. */
const MAX_HEIGHT = 640
const ARROW = 7

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Curva morbida con tangenti verticali attraverso i punti del percorso (uscita e ingresso dei nodi sono verticali). */
function pathData(points: Array<{ x: number; y: number }>): string {
  return points.reduce((data, point, index) => {
    if (index === 0) return `M${point.x},${point.y}`
    const prev = points[index - 1]
    const mid = (prev.y + point.y) / 2
    return `${data} C${prev.x},${mid} ${point.x},${mid} ${point.x},${point.y}`
  }, '')
}

function edgePoints<T>(edge: LayeredEdge<T>, box: LayeredBox): Array<{ x: number; y: number }> {
  if (edge.path && edge.path.length > 1) return edge.path
  return [{ x: edge.from.x + box.width / 2, y: edge.from.y + box.height }, { x: edge.to.x + box.width / 2, y: edge.to.y }]
}

/**
 * Grafo SVG a livelli con pan/zoom (rotellina, trascinamento, "adatta"): gli archi seguono il percorso calcolato dal layout,
 * frecce e tratto hanno dimensione fissa a schermo, hover/selezione attenuano il resto. Clic seleziona, doppio clic apre il sorgente.
 */
export function CodeStudioGraphView<T>({ layout, label, box = LAYERED_BOX, selected, look, edgeTitle, onSelect, onOpen }: CodeStudioGraphViewProps<T>) {
  const id = useId().replace(/:/g, '')
  const arrow = `gs-graph-arrow-${id}`
  const arrowBack = `gs-graph-arrow-back-${id}`
  const { width: w, height: h } = box
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; view: ViewBox; scale: number } | null>(null)
  const fit = useMemo<ViewBox>(() => ({ x: 0, y: 0, w: Math.max(1, layout.width), h: Math.max(1, layout.height) }), [layout.width, layout.height])
  const [view, setView] = useState<ViewBox>(fit)
  const [hovered, setHovered] = useState<string | null>(null)
  useEffect(() => setView(fit), [fit])

  const focusId = hovered ?? selected
  const related = useMemo(() => new Set(focusId ? layout.edges.filter((edge) => edge.from.id === focusId || edge.to.id === focusId).flatMap((edge) => [edge.from.id, edge.to.id]) : []), [focusId, layout.edges])
  const characters = Math.max(8, Math.floor((w - 24) / 6.6))

  const scaleOf = (current: ViewBox): number => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect && rect.width > 0 && rect.height > 0 ? Math.min(rect.width / current.w, rect.height / current.h) : 1
  }
  const zoomAt = (factor: number, anchorX?: number, anchorY?: number) => setView((current) => {
    const rect = svgRef.current?.getBoundingClientRect()
    const scale = scaleOf(current)
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (fit.w / current.w) * factor))
    const nextW = fit.w / next
    const nextH = fit.h / next
    const px = anchorX ?? (rect ? rect.width / 2 : 0)
    const py = anchorY ?? (rect ? rect.height / 2 : 0)
    return { x: current.x + px / scale - (px / scale) * (nextW / current.w), y: current.y + py / scale - (py / scale) * (nextH / current.h), w: nextW, h: nextH }
  })

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left, event.clientY - rect.top)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // zoomAt legge solo `fit` e lo stato corrente tramite l'aggiornamento funzionale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit])

  const startDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('[data-graph-node]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, view, scale: scaleOf(view) }
  }
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = drag.current
    if (!start) return
    setView({ ...start.view, x: start.view.x - (event.clientX - start.x) / start.scale, y: start.view.y - (event.clientY - start.y) / start.scale })
  }
  const endDrag = () => {
    drag.current = null
  }

  const height = Math.min(Math.max(layout.height, 160), MAX_HEIGHT)
  const zoomed = Math.abs(view.w - fit.w) > 0.5 || view.x !== 0 || view.y !== 0
  return (
    <div className="relative w-full" style={{ height }}>
      <svg ref={svgRef} role="img" aria-label={label} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMinYMin meet"
        className="block h-full w-full touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={(event) => { if (event.target === event.currentTarget) setView(fit) }}>
        <defs>
          <marker id={arrow} markerUnits="userSpaceOnUse" viewBox="0 0 8 8" refX="7" refY="4" markerWidth={ARROW} markerHeight={ARROW} orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-3)" />
          </marker>
          <marker id={arrowBack} markerUnits="userSpaceOnUse" viewBox="0 0 8 8" refX="7" refY="4" markerWidth={ARROW} markerHeight={ARROW} orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--color-danger)" />
          </marker>
        </defs>
        {layout.edges.map((edge) => {
          const incident = !focusId || edge.from.id === focusId || edge.to.id === focusId
          const ratio = layout.maxEdge > 0 ? edge.value / layout.maxEdge : 0
          const stroke = edge.back ? 'var(--color-danger)' : incident ? 'var(--color-text-3)' : 'var(--color-border-2, var(--color-border-1))'
          return (
            <path key={`${edge.from.id}->${edge.to.id}`} d={pathData(edgePoints(edge, box))} fill="none" stroke={stroke}
              strokeOpacity={incident ? 0.45 + ratio * 0.45 : 0.1} strokeWidth={1 + ratio * 2} strokeDasharray={edge.back ? '5 4' : undefined}
              vectorEffect="non-scaling-stroke" markerEnd={`url(#${edge.back ? arrowBack : arrow})`}>
              {edgeTitle && <title>{edgeTitle(edge.from, edge.to, edge.value)}</title>}
            </path>
          )
        })}
        {layout.nodes.map((node) => {
          const { title, subtitle, tooltip, color } = look(node)
          const isSelected = node.id === selected
          const dimmed = !!focusId && node.id !== focusId && !related.has(node.id)
          return (
            <g key={node.id} data-graph-node transform={`translate(${node.x},${node.y})`} opacity={dimmed ? 0.25 : 1} className="cursor-pointer"
              onPointerEnter={() => setHovered(node.id)} onPointerLeave={() => setHovered(null)}
              onClick={() => onSelect(node)} onDoubleClick={() => onOpen?.(node)}>
              <title>{tooltip ?? title}</title>
              <rect width={w} height={h} rx={8} fill={`color-mix(in srgb, ${color} 16%, var(--gs-island, var(--color-surface-2)))`} stroke={isSelected ? 'var(--color-accent)' : color} strokeWidth={isSelected ? 2 : 1} vectorEffect="non-scaling-stroke" />
              <rect width={4} height={h - 12} x={6} y={6} rx={2} fill={color} />
              <text x={16} y={subtitle ? 17 : h / 2 + 4} className="fill-[var(--color-text-1)] font-mono text-[11px]">{truncate(title, characters)}</text>
              {subtitle && <text x={16} y={32} className="fill-[var(--color-text-4)] text-[10px] tabular-nums">{truncate(subtitle, characters + 4)}</text>}
            </g>
          )
        })}
      </svg>
      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-border-1 bg-surface-2/90 p-0.5 text-text-3 shadow-sm backdrop-blur">
        <button type="button" onClick={() => zoomAt(1.25)} title="Zoom in" aria-label="Zoom in" className="rounded p-1 hover:bg-surface-3 hover:text-text-1"><Plus size={12} aria-hidden="true" /></button>
        <button type="button" onClick={() => zoomAt(1 / 1.25)} title="Zoom out" aria-label="Zoom out" className="rounded p-1 hover:bg-surface-3 hover:text-text-1"><Minus size={12} aria-hidden="true" /></button>
        <button type="button" onClick={() => setView(fit)} disabled={!zoomed} title="Fit to view" aria-label="Fit to view" className="rounded p-1 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"><Maximize2 size={12} aria-hidden="true" /></button>
      </div>
    </div>
  )
}

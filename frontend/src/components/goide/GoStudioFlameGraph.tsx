import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ZoomOut } from 'lucide-react'
import {
  CODE_ORIGINS, codeOrigin, codeOriginColor, formatProfilePercent, formatProfileValue, sampleValue, shortFunctionName,
  type ProfileFlame, type ProfileFunction,
} from './goStudioProfiles'
import { VizLegend, VizTooltip, VizTooltipRow, useVizTooltip } from './GoStudioVizKit'

const ROW_HEIGHT = 22
const ROW_GAP = 2
const FRAME_GAP = 1
const MIN_VISIBLE_PX = 0.6
const LABEL_MIN_PX = 34
const MONO_CHAR_PX = 6.6
const LABEL_PADDING_PX = 7
const MAX_FRAMES = 20000
const MAX_DEPTH = 300

interface FlameFrame {
  key: string
  node: ProfileFlame
  x: number
  width: number
  depth: number
}

interface FlameLayout {
  frames: FlameFrame[]
  maxDepth: number
}

/** Dispone l'albero in coordinate frazionarie [0,1]: i figli riempiono il rettangolo del genitore. */
function layoutFlame(root: ProfileFlame | null, total: number, index: number): FlameLayout {
  const frames: FlameFrame[] = []
  let maxDepth = 0
  if (!root || total <= 0) return { frames, maxDepth }
  const walk = (node: ProfileFlame, x: number, depth: number) => {
    if (frames.length >= MAX_FRAMES || depth > MAX_DEPTH) return
    const value = sampleValue(node.value, index)
    if (value <= 0) return
    const width = value / total
    frames.push({ key: `${depth}:${x.toFixed(6)}:${node.function.name}`, node, x, width, depth })
    maxDepth = Math.max(maxDepth, depth)
    let offset = x
    for (const child of node.children ?? []) {
      if (!child) continue
      const childValue = sampleValue(child.value, index)
      if (childValue <= 0) continue
      walk(child, offset, depth + 1)
      offset += childValue / total
    }
  }
  let offset = 0
  for (const child of root.children ?? []) {
    if (!child) continue
    const childValue = sampleValue(child.value, index)
    if (childValue <= 0) continue
    walk(child, offset, 0)
    offset += childValue / total
  }
  return { frames, maxDepth }
}

/** Etichetta che entra nel rettangolo: nome corto, troncato con "…" quando serve. */
function fitLabel(text: string, widthPx: number): string {
  const chars = Math.floor((widthPx - LABEL_PADDING_PX * 2) / MONO_CHAR_PX)
  if (chars <= 1) return ''
  return text.length <= chars ? text : `${text.slice(0, chars - 1)}…`
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

interface GoStudioFlameGraphProps {
  flame: ProfileFlame | null
  total: number
  sampleIndex: number
  unit: string
  query: string
  selected: string | null
  onSelect: (fn: ProfileFunction) => void
}

/**
 * Flame graph in pixel reali (niente SVG stirato): colore per origine del codice, clic per zoomare
 * sul frame, tooltip con valore e quota, ricerca che spegne i frame che non corrispondono.
 */
export function GoStudioFlameGraph({ flame, total, sampleIndex, unit, query, selected, onSelect }: GoStudioFlameGraphProps) {
  const layout = useMemo(() => layoutFlame(flame, total, sampleIndex), [flame, total, sampleIndex])
  const [icicle, setIcicle] = useState(false)
  const [focus, setFocus] = useState<FlameFrame | null>(null)
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const { tooltip, show, hide } = useVizTooltip()
  useEffect(() => setFocus(null), [layout])

  const needle = query.trim().toLowerCase()
  const focusX = focus?.x ?? 0
  const focusWidth = focus?.width ?? 1
  const focusDepth = focus?.depth ?? 0
  const visible = useMemo(() => layout.frames.filter((frame) => {
    if (!focus) return true
    const inside = frame.x >= focusX - 1e-9 && frame.x + frame.width <= focusX + focusWidth + 1e-9 && frame.depth >= focusDepth
    const ancestor = frame.depth < focusDepth && frame.x <= focusX + 1e-9 && frame.x + frame.width >= focusX + focusWidth - 1e-9
    return inside || ancestor
  }), [layout, focus, focusX, focusWidth, focusDepth])

  if (layout.frames.length === 0) return <p className="p-4 text-[12px] text-text-4">No stack samples for this sample type.</p>

  const height = (layout.maxDepth + 1) * (ROW_HEIGHT + ROW_GAP)
  const toPx = (frame: FlameFrame) => {
    if (frame.depth < focusDepth) return { left: 0, size: width }
    return { left: ((frame.x - focusX) / focusWidth) * width, size: (frame.width / focusWidth) * width }
  }
  const focusValue = focus ? sampleValue(focus.node.value, sampleIndex) : total

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-1 px-3 py-1.5">
        <VizLegend items={CODE_ORIGINS.map((origin) => ({ id: origin.id, label: origin.label, color: origin.color }))} />
        <span className="ml-auto flex items-center gap-1 text-[11.5px] text-text-3">
          {focus && (
            <button type="button" onClick={() => setFocus(null)} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-accent hover:bg-accent/10">
              <ZoomOut size={12} />Reset zoom · {shortFunctionName(focus.node.function)} ({formatProfilePercent(focusValue, total)})
            </button>
          )}
          <button type="button" onClick={() => setIcicle((value) => !value)} aria-pressed={icicle} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surface-3 hover:text-text-1">
            <ArrowLeftRight size={11} className="rotate-90" />{icicle ? 'Icicle' : 'Flame'}
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <div ref={ref} className="w-full">
          {width > 0 && (
            <svg role="img" aria-label="Flame graph" width={width} height={height} className="block" onMouseLeave={hide}>
              {visible.map((frame) => {
                const { left, size } = toPx(frame)
                if (size < MIN_VISIBLE_PX) return null
                const row = icicle ? frame.depth : layout.maxDepth - frame.depth
                const y = row * (ROW_HEIGHT + ROW_GAP)
                const fn = frame.node.function
                const value = sampleValue(frame.node.value, sampleIndex)
                const color = codeOriginColor(fn)
                const dimmed = (needle && !fn.name.toLowerCase().includes(needle)) || frame.depth < focusDepth
                const isSelected = selected === fn.name
                const rectWidth = Math.max(MIN_VISIBLE_PX, size - FRAME_GAP)
                const label = size >= LABEL_MIN_PX ? fitLabel(shortFunctionName(fn), size) : ''
                return (
                  <g
                    key={frame.key}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.38 : 1}
                    onClick={() => { onSelect(fn); if (frame.depth >= focusDepth && frame !== focus) setFocus(frame) }}
                    onMouseMove={(event) => show(event, (
                      <>
                        <div className="mb-1 break-all font-mono text-[11.5px] text-text-1">{fn.name}</div>
                        <VizTooltipRow label={CODE_ORIGINS.find((origin) => origin.id === codeOrigin(fn))?.label ?? ''} value={fn.package || '—'} color={color} />
                        <VizTooltipRow label="Value" value={formatProfileValue(value, unit)} />
                        <VizTooltipRow label="Share of total" value={formatProfilePercent(value, total)} />
                        <div className="mt-1 text-[10.5px] text-text-4">Click to zoom · select to see callers</div>
                      </>
                    ))}
                  >
                    <rect
                      x={left}
                      y={y}
                      width={rectWidth}
                      height={ROW_HEIGHT}
                      rx={4}
                      style={{ fill: `color-mix(in srgb, ${color} ${isSelected ? 58 : 30}%, var(--gs-island))`, stroke: isSelected ? color : 'none', strokeWidth: 1.5 }}
                      className="transition-[fill] duration-100 hover:brightness-110"
                    />
                    <rect x={left} y={y + 5} width={Math.min(3, rectWidth)} height={ROW_HEIGHT - 10} rx={1.5} style={{ fill: color }} />
                    {label && (
                      <text x={left + LABEL_PADDING_PX} y={y + ROW_HEIGHT / 2 + 4} fontSize={11} className="pointer-events-none select-none font-mono" style={{ fill: 'var(--color-text-1)' }}>
                        {label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </div>
      <VizTooltip tooltip={tooltip} />
    </div>
  )
}

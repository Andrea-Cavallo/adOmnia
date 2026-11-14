/**
 * Bodies of the nodes that are not "an outline with text": images, legends, sequence lifelines,
 * combined fragments (loop/alt/opt) and their connection points. ShapeNode picks one of these by geometry.
 */
import { Handle, Position } from '@xyflow/react'
import { FRAGMENT_TAB, LIFELINE_HEAD, SEQ_BAR_HALF, SEQ_FIRST_ROW, SEQ_ROW, lifelineRows } from '@/lib/diagrams/geometry'
import type { DiagramNodeData } from '@/lib/diagrams/model'
import { themeColor } from './ShapeOutline'

export function ImageBody({ src, label }: { src?: string; label: string }) {
  if (!src) return <div className="diagram-image-missing">No image</div>
  return (
    <>
      <img className="diagram-image" src={src} alt={label} draggable={false} />
      {label && <span className="diagram-image-caption">{label}</span>}
    </>
  )
}

export function LegendBody({ data, fontSize }: { data: DiagramNodeData; fontSize: number }) {
  const color = themeColor(data.style.textColor, '--diagram-node-text')
  return (
    <div className="diagram-legend" style={{ color, fontSize }}>
      <div className="diagram-legend-title">{data.label}</div>
      <ul>
        {(data.legend ?? []).map((entry, index) => (
          <li key={index}>
            <svg width="26" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="25" y2="5" stroke={entry.color || 'var(--diagram-edge)'} strokeWidth="3" strokeDasharray={entry.dashed ? '5 3' : undefined} strokeLinecap="round" />
            </svg>
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The dashed timeline under a lifeline's header. */
export function LifelineStem({ width, height, stroke }: { width: number; height: number; stroke: string }) {
  return (
    <svg className="diagram-lifeline-stem" width={width} height={height} aria-hidden="true">
      <line x1={width / 2} y1={LIFELINE_HEAD} x2={width / 2} y2={height - 6} stroke={themeColor(stroke, '--diagram-node-stroke')} strokeWidth="1.3" strokeDasharray="6 5" />
      <path d={`M ${width / 2 - 5} ${height - 10} L ${width / 2} ${height - 2} L ${width / 2 + 5} ${height - 10}`} fill="none" stroke={themeColor(stroke, '--diagram-node-stroke')} strokeWidth="1.3" />
    </svg>
  )
}

/**
 * A connection point every message row, on both sides of the timeline, so a message drawn between two
 * lifelines is horizontal and lands on the activation bar's edge. Ids are `L<row>` and `R<row>`.
 */
export function LifelineHandles({ height, locked }: { height: number; locked: boolean }) {
  const rows = lifelineRows(height)
  return (
    <>
      {Array.from({ length: rows }, (_, row) => {
        const top = SEQ_FIRST_ROW + row * SEQ_ROW
        return [
          <Handle key={`L${row}`} id={`L${row}`} type="source" position={Position.Left} isConnectable={!locked} className="diagram-handle diagram-handle--row diagram-no-export" style={{ top, left: `calc(50% - ${SEQ_BAR_HALF}px)` }} />,
          <Handle key={`R${row}`} id={`R${row}`} type="source" position={Position.Right} isConnectable={!locked} className="diagram-handle diagram-handle--row diagram-no-export" style={{ top, left: `calc(50% + ${SEQ_BAR_HALF}px)` }} />,
        ]
      })}
      <span className="diagram-lifeline-hit" aria-hidden="true" />
    </>
  )
}

/** The operator tab, the guard and the operand separators of a combined fragment. */
export function FragmentBody({ data, width }: { data: DiagramNodeData; width: number }) {
  const color = themeColor(data.style.textColor, '--diagram-node-text')
  const stroke = themeColor(data.style.stroke, '--diagram-node-stroke')
  return (
    <div className="diagram-fragment" style={{ color }}>
      <span className="diagram-fragment-tab" style={{ width: FRAGMENT_TAB.width, height: FRAGMENT_TAB.height }}>{data.label}</span>
      {data.subtitle && <span className="diagram-fragment-guard">{data.subtitle}</span>}
      {(data.dividers ?? []).map((divider, index) => (
        <div key={index} className="diagram-fragment-divider" style={{ top: divider.y, width, borderTopColor: stroke }}>
          {divider.label && <span className="diagram-fragment-guard">{divider.label}</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * Bodies of the nodes that are not "an outline with text": images, legends, sequence lifelines,
 * combined fragments (loop/alt/opt) and their connection points. ShapeNode picks one of these by geometry.
 */
import { useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { FRAGMENT_TAB, LIFELINE_HEAD, SEQ_BAR_HALF, SEQ_FIRST_ROW, SEQ_ROW, lifelineRows } from '@/lib/diagrams/geometry'
import type { DiagramNodeData } from '@/lib/diagrams/model'
import { legendHeight } from '@/lib/diagrams/legend'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
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

/** One line of a legend edited where it is: Enter or a click elsewhere keeps the text, Escape discards it. */
function LegendText({ value, label, onDone }: { value: string; label: string; onDone: (text: string | null) => void }) {
  const done = useRef(false)
  const finish = (text: string | null) => {
    if (done.current) return
    done.current = true
    onDone(text)
  }
  return (
    <input
      className="diagram-legend-input nodrag nopan nowheel"
      defaultValue={value}
      autoFocus
      aria-label={label}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => finish(event.currentTarget.value)}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') finish(null)
        if (event.key === 'Enter') finish(event.currentTarget.value)
      }}
    />
  )
}

/**
 * A legend: the title and every row are written in place with a double-click, and a selected
 * legend offers "Add row", so nobody has to find the inspector to name a color.
 */
export function LegendBody({ id, data, fontSize, selected, editingTitle }: { id: string; data: DiagramNodeData; fontSize: number; selected: boolean; editingTitle: boolean }) {
  const color = themeColor(data.style.textColor, '--diagram-node-text')
  const updateNodes = useDiagramStudio((state) => state.updateNodes)
  const commit = useDiagramStudio((state) => state.commit)
  const editNode = useDiagramUi((state) => state.editNode)
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const rows = data.legend ?? []
  const editable = !data.locked
  const saveRow = (index: number, text: string | null) => {
    setEditingRow(null)
    if (text !== null && text !== rows[index]?.label) updateNodes([id], { legend: rows.map((row, at) => (at === index ? { ...row, label: text } : row)) })
  }
  const saveTitle = (text: string | null) => {
    if (text !== null && text !== data.label) updateNodes([id], { label: text })
    editNode(null)
  }
  const addRow = () => {
    const legend = [...rows, { color: '#4c8fd6', label: '' }]
    // One undo step: the new row and the room it needs.
    commit((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === id ? { ...node, height: Math.max(node.height ?? 0, legendHeight(legend.length)), data: { ...node.data, legend } } : node)),
    }))
    setEditingRow(legend.length - 1)
  }
  return (
    <div className="diagram-legend" style={{ color, fontSize }}>
      <div className="diagram-legend-title">
        {editingTitle ? <LegendText value={data.label} label="Legend title" onDone={saveTitle} /> : data.label}
      </div>
      <ul>
        {rows.map((entry, index) => (
          <li key={index} onDoubleClick={(event) => { if (!editable) return; event.stopPropagation(); setEditingRow(index) }} title={editable ? 'Double-click to write' : undefined}>
            <svg width="26" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="25" y2="5" stroke={entry.color || 'var(--diagram-edge)'} strokeWidth="3" strokeDasharray={entry.dashed ? '5 3' : undefined} strokeLinecap="round" />
            </svg>
            {editingRow === index
              ? <LegendText value={entry.label} label={`Row ${index + 1} text`} onDone={(text) => saveRow(index, text)} />
              : <span className={entry.label ? undefined : 'diagram-legend-placeholder'}>{entry.label || 'Double-click to write'}</span>}
          </li>
        ))}
      </ul>
      {selected && editable && (
        <button type="button" className="diagram-legend-add nodrag nopan diagram-no-export" onClick={addRow} onDoubleClick={(event) => event.stopPropagation()}>+ Add row</button>
      )}
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

/**
 * The shape library: searchable, grouped by category. Drag a shape onto the canvas, or click it to
 * drop it in the middle of the view.
 */
import { memo, useMemo, useState, type DragEvent } from 'react'
import { Search, X } from 'lucide-react'
import { SHAPE_CATEGORIES, searchShapes, type ShapeDefinition } from '@/lib/diagrams/shapes'
import { DEFAULT_NODE_STYLE } from '@/lib/diagrams/shapes'
import { SHAPE_ICONS } from './shapeIcons'
import { ShapeOutline } from './ShapeOutline'

/** The drag payload type the canvas accepts. */
export const SHAPE_DRAG_TYPE = 'application/adomnia-diagram-shape'
const PREVIEW_WIDTH = 46
const PREVIEW_MAX_HEIGHT = 32

const ShapeTile = memo(function ShapeTile({ shape, onAdd }: { shape: ShapeDefinition; onAdd: (id: string) => void }) {
  const scale = Math.min(PREVIEW_WIDTH / shape.width, PREVIEW_MAX_HEIGHT / shape.height)
  const width = Math.max(10, Math.round(shape.width * scale))
  const height = Math.max(10, Math.round(shape.height * scale))
  const Icon = shape.icon ? SHAPE_ICONS[shape.icon] : undefined
  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(SHAPE_DRAG_TYPE, shape.id)
    event.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <button type="button" className="diagram-tile" draggable onDragStart={onDragStart} onClick={() => onAdd(shape.id)} title={`${shape.label} · drag onto the canvas or click to add`}>
      <span className="diagram-tile-preview">
        {shape.geometry === 'text'
          ? <span className="diagram-tile-text">Aa</span>
          : <ShapeOutline geometry={shape.geometry} width={width} height={height} style={{ ...DEFAULT_NODE_STYLE, ...shape.style, strokeWidth: 1.2 }} />}
        {Icon && <Icon size={11} className="diagram-tile-icon" aria-hidden="true" />}
      </span>
      <span className="diagram-tile-label">{shape.label}</span>
    </button>
  )
})

export function ShapeLibrary({ onAdd }: { onAdd: (shapeId: string) => void }) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => searchShapes(query), [query])
  return (
    <aside className="diagram-library" aria-label="Shapes">
      <label className="diagram-search">
        <Search size={12} aria-hidden="true" />
        <span className="sr-only">Search shapes</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shapes…" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={11} /></button>}
      </label>
      <div className="diagram-library-scroll">
        {SHAPE_CATEGORIES.map((category) => {
          const shapes = matches.filter((shape) => shape.category === category.id)
          if (shapes.length === 0) return null
          return (
            <section key={category.id} className="diagram-library-group">
              <h3>{category.label}</h3>
              <div className="diagram-tiles">
                {shapes.map((shape) => <ShapeTile key={shape.id} shape={shape} onAdd={onAdd} />)}
              </div>
            </section>
          )
        })}
        {matches.length === 0 && <p className="diagram-empty-hint">No shape matches “{query}”.</p>}
      </div>
    </aside>
  )
}

/**
 * The shape library: searchable, grouped by category. Drag a shape onto the canvas, or click it to
 * drop it in the middle of the view.
 */
import { lazy, memo, Suspense, useMemo, useState, type DragEvent } from 'react'
import { Search, Shapes as ShapesIcon, Blocks, X } from 'lucide-react'
import { SHAPE_CATEGORIES, searchShapes, type ShapeDefinition } from '@/lib/diagrams/shapes'
import { DEFAULT_NODE_STYLE } from '@/lib/diagrams/shapes'
import { SHAPE_ICONS } from './shapeIcons'
import { ShapeOutline } from './ShapeOutline'

import { SHAPE_DRAG_TYPE } from './dragTypes'

const IconLibrary = lazy(() => import('./IconLibrary').then((module) => ({ default: module.IconLibrary })))
const PREVIEW_WIDTH = 54
const PREVIEW_MAX_HEIGHT = 36

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
          : <ShapeOutline geometry={shape.geometry} width={width} height={height} style={{ ...DEFAULT_NODE_STYLE, ...shape.style, strokeWidth: 1.5, stroke: shape.style?.stroke || 'var(--color-text-3)' }} />}
        {Icon && <Icon size={11} className="diagram-tile-icon" aria-hidden="true" />}
      </span>
      <span className="diagram-tile-label">{shape.label}</span>
    </button>
  )
})

export function ShapeLibrary({ onAdd, onAddIcon }: { onAdd: (shapeId: string) => void; onAddIcon: (src: string, label: string) => void }) {
  const [tab, setTab] = useState<'shapes' | 'icons'>('shapes')
  return (
    <aside className="diagram-library" aria-label="Shapes and icons">
      <div className="diagram-library-heading"><strong>Assets</strong><span>Click or drag to add</span></div>
      <div className="diagram-library-tabs" role="tablist" aria-label="Library">
        <button type="button" role="tab" aria-pressed={tab === 'shapes'} aria-selected={tab === 'shapes'} onClick={() => setTab('shapes')}><ShapesIcon size={14} aria-hidden="true" />Shapes</button>
        <button type="button" role="tab" aria-pressed={tab === 'icons'} aria-selected={tab === 'icons'} onClick={() => setTab('icons')}><Blocks size={14} aria-hidden="true" />Icons</button>
      </div>
      {tab === 'shapes' ? <Shapes onAdd={onAdd} /> : (
        <Suspense fallback={<p className="diagram-empty-hint">Loading icons…</p>}><IconLibrary onAdd={onAddIcon} /></Suspense>
      )}
    </aside>
  )
}

function Shapes({ onAdd }: { onAdd: (shapeId: string) => void }) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => searchShapes(query), [query])
  return (
    <>
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
              <h3>{category.label}<span>{shapes.length}</span></h3>
              <div className="diagram-tiles">
                {shapes.map((shape) => <ShapeTile key={shape.id} shape={shape} onAdd={onAdd} />)}
              </div>
            </section>
          )
        })}
        {matches.length === 0 && <p className="diagram-empty-hint">No shape matches “{query}”.</p>}
      </div>
    </>
  )
}

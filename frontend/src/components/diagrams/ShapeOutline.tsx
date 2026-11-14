import { memo } from 'react'
import { outlineOf } from '@/lib/diagrams/geometry'
import type { NodeStyle, ShapeGeometry } from '@/lib/diagrams/model'

/** Empty style colors follow the active theme through these CSS variables (diagramStudio.css). */
export const themeColor = (value: string, variable: string) => value || `var(${variable})`

const DASH = '6 4'

/** The outline of a shape at a given size: the same drawing on the canvas and in the library. */
export const ShapeOutline = memo(function ShapeOutline({ geometry, width, height, style }: {
  geometry: ShapeGeometry
  width: number
  height: number
  style: Pick<NodeStyle, 'fill' | 'stroke' | 'strokeWidth' | 'dashed'> & { radius?: number }
}) {
  const outline = outlineOf(geometry, width, height, style.strokeWidth, style.radius)
  if (outline.bodies.length === 0 && outline.lines.length === 0) return null
  const stroke = themeColor(style.stroke, '--diagram-node-stroke')
  const dash = style.dashed ? DASH : undefined
  return (
    <svg className="diagram-shape-outline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {outline.bodies.map((path, index) => (
        <path key={`b${index}`} d={path} fill={themeColor(style.fill, '--diagram-node-fill')} stroke={stroke} strokeWidth={style.strokeWidth} strokeDasharray={dash} strokeLinejoin="round" />
      ))}
      {outline.lines.map((path, index) => (
        <path key={`l${index}`} d={path} fill="none" stroke={stroke} strokeWidth={style.strokeWidth} strokeDasharray={dash} />
      ))}
    </svg>
  )
})

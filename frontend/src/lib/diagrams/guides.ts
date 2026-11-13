/**
 * Smart alignment guides: while a node is dragged, its edges and center snap to those of nearby
 * nodes and the canvas draws the line they share. Pure: rectangles in, snapped position and guide
 * lines out.
 */
import type { Rect } from './graphOps'

/** Screen-independent snap distance, in flow units. */
export const GUIDE_THRESHOLD = 6

export interface Guide {
  orientation: 'vertical' | 'horizontal'
  /** x of a vertical line, y of a horizontal one. */
  position: number
  /** Extent of the line along its own axis. */
  from: number
  to: number
}

export interface GuideResult {
  x: number
  y: number
  guides: Guide[]
}

const xLines = (rect: Rect) => [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
const yLines = (rect: Rect) => [rect.y, rect.y + rect.height / 2, rect.y + rect.height]

interface Match { delta: number; line: number; other: Rect }

function closest(moving: number[], others: readonly Rect[], linesOf: (rect: Rect) => number[], threshold: number): Match | null {
  let best: Match | null = null
  for (const other of others) {
    for (const line of linesOf(other)) {
      for (const own of moving) {
        const delta = line - own
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line, other }
      }
    }
  }
  return best
}

/** Snaps the dragged rectangle to the nearest edge or center of the others, axis by axis. */
export function alignmentGuides(dragged: Rect, others: readonly Rect[], threshold = GUIDE_THRESHOLD): GuideResult {
  const vertical = closest(xLines(dragged), others, xLines, threshold)
  const horizontal = closest(yLines(dragged), others, yLines, threshold)
  const x = dragged.x + (vertical?.delta ?? 0)
  const y = dragged.y + (horizontal?.delta ?? 0)
  const guides: Guide[] = []
  if (vertical) {
    const top = Math.min(y, vertical.other.y)
    const bottom = Math.max(y + dragged.height, vertical.other.y + vertical.other.height)
    guides.push({ orientation: 'vertical', position: vertical.line, from: top, to: bottom })
  }
  if (horizontal) {
    const left = Math.min(x, horizontal.other.x)
    const right = Math.max(x + dragged.width, horizontal.other.x + horizontal.other.width)
    guides.push({ orientation: 'horizontal', position: horizontal.line, from: left, to: right })
  }
  return { x, y, guides }
}

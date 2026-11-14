/**
 * A legend built from what the diagram already uses: every palette tint on a shape or a connector
 * becomes one row, named after the palette entry, so "Add legend" describes the drawing instead of
 * asking the author to repeat the colors by hand. Colors from outside the palette keep their hex.
 */
import type { DiagramEdge, DiagramNode, LegendEntry } from './model'
import { STYLE_PALETTE } from './shapes'

const MAX_ROWS = 8

interface Usage { color: string; label: string; dashed: boolean; count: number }

const paletteFor = (value: string) => {
  const color = value.trim().toLowerCase()
  if (!color || color === 'transparent') return undefined
  return STYLE_PALETTE.find((entry) => entry.id !== 'theme' && (entry.fill.toLowerCase() === color || entry.stroke.toLowerCase() === color))
}

/** Distinct colors of the shapes and connectors, most used first, at most eight rows. */
export function legendFromGraph(nodes: readonly DiagramNode[], edges: readonly DiagramEdge[]): LegendEntry[] {
  const usages = new Map<string, Usage>()
  const record = (value: string, dashed: boolean) => {
    const palette = paletteFor(value)
    const display = palette ? palette.stroke : value.trim()
    if (!display) return
    const key = `${display.toLowerCase()}|${dashed}`
    const existing = usages.get(key)
    if (existing) { existing.count += 1; return }
    usages.set(key, { color: display, label: palette ? palette.label : display.toUpperCase(), dashed, count: 1 })
  }
  for (const node of nodes) {
    if (node.data.shape === 'legend') continue
    record(node.data.style.fill, node.data.style.dashed)
  }
  for (const edge of edges) if (edge.data) record(edge.data.color, edge.data.dashed)
  return [...usages.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ROWS)
    .map((usage) => ({ color: usage.color, label: usage.label, ...(usage.dashed ? { dashed: true } : {}) }))
}

/** Height a legend needs to show its rows without scrolling. */
export const legendHeight = (rows: number) => 36 + rows * 22

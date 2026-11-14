import { describe, expect, it } from 'vitest'
import { legendFromGraph, legendHeight } from './legend'
import { createEdge, createNode } from './graphOps'
import { STYLE_PALETTE } from './shapes'

const green = STYLE_PALETTE.find((entry) => entry.id === 'green')!
const blue = STYLE_PALETTE.find((entry) => entry.id === 'blue')!

describe('legend from what the diagram uses', () => {
  it('names palette colors and counts how often each is used', () => {
    const a = createNode('process', { x: 0, y: 0 }, { label: 'a', style: { ...createNode('process', { x: 0, y: 0 }).data.style, fill: green.fill, stroke: green.stroke } })
    const b = createNode('process', { x: 0, y: 0 }, { label: 'b', style: { ...createNode('process', { x: 0, y: 0 }).data.style, fill: green.fill, stroke: green.stroke } })
    const c = createNode('process', { x: 0, y: 0 }, { label: 'c', style: { ...createNode('process', { x: 0, y: 0 }).data.style, fill: blue.fill, stroke: blue.stroke } })
    const rows = legendFromGraph([a, b, c], [])
    expect(rows.map((row) => row.label)).toEqual(['Green', 'Blue'])
    // The swatch is the palette border, which is the color that reads on the canvas.
    expect(rows[0].color).toBe(green.stroke)
  })

  it('describes connectors too, keeps dashed apart and names colors outside the palette by hex', () => {
    const a = createNode('process', { x: 0, y: 0 })
    const b = createNode('process', { x: 100, y: 0 })
    const edges = [
      createEdge({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null }, 'orthogonal', { color: green.stroke, dashed: true }),
      createEdge({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null }, 'orthogonal', { color: '#ff00aa' }),
    ]
    const rows = legendFromGraph([a, b], edges)
    expect(rows).toEqual([
      { color: green.stroke, label: 'Green', dashed: true },
      { color: '#ff00aa', label: '#FF00AA' },
    ])
  })

  it('skips theme shapes, legends themselves and gives a height for the rows', () => {
    const plain = createNode('process', { x: 0, y: 0 })
    const existing = createNode('legend', { x: 0, y: 0 })
    expect(legendFromGraph([plain, existing], [])).toEqual([])
    expect(legendHeight(3)).toBeGreaterThan(legendHeight(1))
  })

  it('caps the rows so the legend stays readable', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => createNode('process', { x: 0, y: 0 }, {
      style: { ...createNode('process', { x: 0, y: 0 }).data.style, fill: `#0000${(index + 16).toString(16)}` },
    }))
    expect(legendFromGraph(nodes, [])).toHaveLength(8)
  })
})

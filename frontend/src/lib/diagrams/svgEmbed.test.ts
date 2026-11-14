import { describe, expect, it } from 'vitest'
import { embedDiagram, embeddedDiagram } from './export'
import { createNode } from './graphOps'
import { emptyDiagram, newPage, syncedPages } from './model'
import { parseDiagram } from './serialization'

function sample() {
  const doc = { ...emptyDiagram('Orders'), nodes: [createNode('service', { x: 0, y: 0 }, { label: 'Order API' })] }
  return { ...doc, pages: [...syncedPages(doc), newPage('Second')] }
}

describe('SVG export', () => {
  it('embeds the editable diagram in an exported SVG', () => {
    const doc = sample()
    const svg = embedDiagram('<svg xmlns="http://www.w3.org/2000/svg" width="10"><g/></svg>', doc)
    const back = parseDiagram(embeddedDiagram(svg)!)
    expect(back.name).toBe('Orders')
    expect(back.pages).toHaveLength(2)
    expect(embeddedDiagram('<svg/>')).toBeNull()
  })
})

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { fromDrawio, parseStyle, shapeForStyle, toDrawio } from './drawio'
import { createEdge, createNode, groupNodes } from './graphOps'
import { emptyDiagram, newPage, syncedPages, withActivePage, type DiagramDocument } from './model'
import { parseDiagram, serializeDiagram } from './serialization'
import { sequenceFromText } from './sequence'

function sample(): DiagramDocument {
  const api = createNode('service', { x: 40, y: 40 }, { label: 'Order API', style: { fill: '#141e2b', stroke: '#4c8fd6', strokeWidth: 2, radius: 0, textColor: '', fontSize: 13, dashed: false } })
  const db = createNode('database', { x: 320, y: 40 }, { label: 'Orders DB' })
  const grouped = groupNodes({ nodes: [api, db], edges: [] }, [api.id, db.id])
  const edge = createEdge({ source: api.id, target: db.id, sourceHandle: 'right-50', targetHandle: 'left-50' }, 'orthogonal', { label: 'insert', dashed: true, arrowEnd: 'open', waypoints: [{ x: 250, y: 120 }] })
  const doc = { ...emptyDiagram('Orders'), ...grouped.graph, edges: [edge] }
  const second = newPage('Sequence', sequenceFromText('A->>B: call\nB-->>A: done'))
  return { ...doc, pages: [...syncedPages(doc), second] }
}

describe('draw.io', () => {
  it('round-trips pages, shapes, containers, colors, handles, arrows and bends', async () => {
    const doc = sample()
    const back = await fromDrawio(toDrawio(doc), 'Orders')
    expect(back.pages.map((page) => page.name)).toEqual(['Page 1', 'Sequence'])
    const api = back.nodes.find((node) => node.data.label === 'Order API')!
    const db = back.nodes.find((node) => node.data.label === 'Orders DB')!
    expect(db.data.shape).toBe('stored-data')
    expect(api.data.style.fill).toBe('#141e2b')
    expect(api.parentId).toBeDefined()
    expect(back.nodes.findIndex((node) => node.id === api.parentId)).toBeLessThan(back.nodes.indexOf(api))
    const [edge] = back.edges
    expect([edge.sourceHandle, edge.targetHandle, edge.data?.label, edge.data?.dashed, edge.data?.arrowEnd]).toEqual(['right-50', 'left-50', 'insert', true, 'open'])
    expect(edge.data?.waypoints).toEqual([{ x: 250, y: 120 }])
    const sequence = back.pages[1]
    expect(sequence.nodes.filter((node) => node.data.shape === 'seq-lifeline')).toHaveLength(2)
    expect(sequence.edges[0].sourceHandle).toBe('R0')
  })

  it('reads compressed pages and maps common draw.io styles', async () => {
    const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Start" style="ellipse;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="80" as="geometry"/></mxCell></root></mxGraphModel>'
    const deflated = await new Response(new Blob([encodeURIComponent(model)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(deflated)))
    const doc = await fromDrawio(`<mxfile><diagram name="P">${base64}</diagram></mxfile>`)
    expect(doc.nodes[0].data).toMatchObject({ shape: 'circle', label: 'Start' })
    expect(shapeForStyle(parseStyle('rhombus;whiteSpace=wrap;'), 80, 60)).toBe('diamond')
    expect(shapeForStyle(parseStyle('shape=cylinder3;'), 80, 60)).toBe('stored-data')
  })
})

describe('pages', () => {
  it('keeps every page through save and reload, and upgrades version 1 files to one page', () => {
    const doc = withActivePage(sample(), sample().pages[0].id)
    const back = parseDiagram(serializeDiagram(doc))
    expect(back.pages).toHaveLength(2)
    const v1 = { format: 'adomnia-diagram', version: 1, id: 'd', name: 'Old', nodes: [createNode('process', { x: 0, y: 0 })], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: {} }
    const upgraded = parseDiagram(JSON.stringify(v1))
    expect(upgraded.pages).toHaveLength(1)
    expect(upgraded.nodes).toHaveLength(1)
  })

})

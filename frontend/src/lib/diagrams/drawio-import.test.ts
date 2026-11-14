// @vitest-environment happy-dom
/**
 * What an actual .drawio file looks like when it lands in adOmnia: draw.io's light palette becomes
 * adOmnia's tints, the second label line becomes the subtitle, a rounded box keeps its radius and a
 * container keeps its children.
 */
import { describe, expect, it } from 'vitest'
import { fromDrawio, importFill, importStroke, toDrawio } from './drawio'
import { createNode } from './graphOps'
import { emptyDiagram } from './model'
import { STYLE_PALETTE } from './shapes'

const cells = (body: string) => `<mxfile><diagram name="Shop"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`
const vertex = (id: string, value: string, style: string, geometry: string, parent = '1') =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry ${geometry} as="geometry"/></mxCell>`
const edge = (id: string, source: string, target: string, style: string) =>
  `<mxCell id="${id}" value="insert" style="${style}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`

describe('draw.io import in adOmnia style', () => {
  it('reads a real draw.io page into adOmnia shapes and tints', async () => {
    const xml = cells([
      vertex('web', 'Web app', 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;', 'x="40" y="40" width="120" height="60"'),
      vertex('svc', 'Order Service&lt;br&gt;&lt;font style=&quot;font-size: 10px&quot;&gt;Go&lt;/font&gt;', 'rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;', 'x="220" y="40" width="160" height="60"'),
      vertex('db', 'Orders', 'shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;', 'x="440" y="40" width="80" height="80"'),
      vertex('box', 'Backend', 'rounded=1;arcSize=3;container=1;collapsible=0;html=1;', 'x="220" y="140" width="300" height="180"'),
      vertex('handler', 'handler', 'rounded=0;whiteSpace=wrap;html=1;', 'x="240" y="180" width="120" height="40"', 'box'),
      edge('e1', 'svc', 'db', 'edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;'),
    ].join(''))
    const doc = await fromDrawio(xml, 'Shop')

    expect(doc.name).toBe('Shop')
    expect(doc.pages.map((page) => page.name)).toEqual(['Shop'])

    const web = doc.nodes.find((node) => node.id === 'web')!
    const svc = doc.nodes.find((node) => node.id === 'svc')!
    const db = doc.nodes.find((node) => node.id === 'db')!
    const handler = doc.nodes.find((node) => node.id === 'handler')!

    // Light draw.io fills and borders become the adOmnia tints with the same meaning.
    expect(web.data.style.fill).toBe(STYLE_PALETTE.find((entry) => entry.id === 'blue')!.fill)
    expect(web.data.style.stroke).toBe(STYLE_PALETTE.find((entry) => entry.id === 'blue')!.stroke)
    expect(web.data.style.radius).toBe(9)
    expect(web.data.shape).toBe('rounded-rectangle')

    // The second, smaller line of the label is the technology: it becomes the subtitle.
    expect(svc.data.label).toBe('Order Service')
    expect(svc.data.subtitle).toBe('Go')
    expect(svc.data.shape).toBe('rectangle')

    // White/grey draw.io defaults follow the theme instead of punching a light hole in the canvas.
    expect(db.data.shape).toBe('stored-data')
    expect(db.data.style.fill).toBe('')
    expect(db.data.style.stroke).toBe(STYLE_PALETTE.find((entry) => entry.id === 'graphite')!.stroke)

    // A container keeps its children, which stay ordered after it.
    expect(handler.parentId).toBe('box')
    expect(doc.nodes.findIndex((node) => node.id === 'box')).toBeLessThan(doc.nodes.indexOf(handler))

    // Handles come from the draw.io constraints, so the connector lands on the sides it used.
    expect(doc.edges[0].sourceHandle).toBe('right-50')
    expect(doc.edges[0].targetHandle).toBe('left-50')
    expect(doc.edges[0].data?.label).toBe('insert')
  })

  it('maps only the draw.io defaults and leaves a custom color alone', () => {
    expect(importFill('#DAE8FC')).toBe(STYLE_PALETTE.find((entry) => entry.id === 'blue')!.fill)
    expect(importFill('#ffffff')).toBe('')
    expect(importFill('none')).toBe('transparent')
    expect(importFill('#123456')).toBe('#123456')
    expect(importFill(undefined)).toBeUndefined()
    expect(importStroke('#000000')).toBe('')
    expect(importStroke('#b85450')).toBe(STYLE_PALETTE.find((entry) => entry.id === 'red')!.stroke)
    expect(importStroke('#fedcba')).toBe('#fedcba')
  })

  it('keeps a corner radius through export and import', async () => {
    const base = createNode('process', { x: 0, y: 0 }, {
      label: 'Handler',
      style: { ...createNode('process', { x: 0, y: 0 }).data.style, fill: '', stroke: '', radius: 12 },
    })
    const doc = { ...emptyDiagram('Radius'), nodes: [base], edges: [] }
    const back = await fromDrawio(toDrawio(doc), 'Radius')
    const node = back.nodes[0]
    expect(toDrawio(doc)).toContain('rounded=1')
    expect(toDrawio(doc)).toContain('arcSize=17')
    expect(node.data.style.radius).toBe(12)
  })
})

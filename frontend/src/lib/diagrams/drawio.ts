/**
 * draw.io (diagrams.net) files, both ways. Export writes one `<diagram>` per page with editable
 * cells: shapes map to the closest draw.io style, colors, text, containers (as parents), connection
 * points (exit/entry constraints), routing, arrowheads and bends are kept. Import reads plain and
 * compressed pages and maps draw.io styles back to the shape library; anything unknown becomes a
 * rectangle with its text, so nothing is silently dropped.
 */
import { createEdge, createNode } from './graphOps'
import { LIFELINE_HEAD, SEQ_BAR_HALF, SEQ_FIRST_ROW, SEQ_ROW, lifelineRows } from './geometry'
import {
  emptyDiagram, newPage, syncedPages,
  type ArrowHead, type DiagramDocument, type DiagramEdge, type DiagramGraph, type DiagramNode, type DiagramPage, type EdgeRouting,
} from './model'
import { orderParentsFirst } from './serialization'
import { STYLE_PALETTE, shapeOf } from './shapes'

// ---------------------------------------------------------------- export

const GEOMETRY_STYLE: Record<string, string> = {
  rectangle: 'rounded=0;', rounded: 'rounded=1;arcSize=12;', pill: 'rounded=1;arcSize=50;', diamond: 'rhombus;',
  parallelogram: 'shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;', ellipse: 'ellipse;', circle: 'ellipse;aspect=fixed;',
  cylinder: 'shape=cylinder3;boundedLbl=1;size=10;', queue: 'shape=cylinder3;boundedLbl=1;size=10;direction=south;', hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;',
  document: 'shape=document;boundedLbl=1;', cloud: 'ellipse;shape=cloud;', 'uml-class': 'rounded=0;align=left;verticalAlign=top;spacingLeft=6;',
  package: 'shape=folder;tabWidth=60;tabHeight=14;tabPosition=left;', component: 'shape=module;jettyWidth=10;jettyHeight=4;',
  container: 'rounded=1;arcSize=3;verticalAlign=top;align=left;spacingLeft=10;container=1;collapsible=0;', note: 'shape=note;size=16;',
  text: 'text;', triangle: 'triangle;direction=north;', star: 'shape=mxgraph.basic.star;', arrow: 'shape=singleArrow;arrowWidth=0.5;arrowSize=0.35;',
  subprocess: 'shape=process;', 'manual-input': 'shape=manualInput;size=15;', delay: 'shape=delay;', 'off-page': 'shape=offPageConnector;',
  actor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;', legend: 'rounded=1;arcSize=4;align=left;verticalAlign=top;spacingLeft=8;',
  lifeline: `shape=umlLifeline;perimeter=lifelinePerimeter;container=1;collapsible=0;size=${LIFELINE_HEAD};`, activation: 'points=[];perimeter=orthogonalPerimeter;',
  fragment: 'shape=umlFrame;width=64;height=22;', image: 'shape=image;imageAspect=1;verticalLabelPosition=bottom;verticalAlign=top;',
}

const ARROW_OUT: Record<ArrowHead, string> = { none: 'none;', arrow: 'block;Fill=1;', open: 'open;Fill=0;', diamond: 'diamond;Fill=1;', circle: 'oval;Fill=0;' }
const ROUTING_OUT: Record<EdgeRouting, string> = { orthogonal: 'edgeStyle=orthogonalEdgeStyle;', bezier: 'curved=1;', straight: '' }

/**
 * draw.io writes a corner radius as `rounded=1` plus `arcSize`, a percentage of the shorter side.
 * `''` when the shape has no radius of its own.
 */
function radiusArc(node: DiagramNode): string {
  const radius = Number(node.data.style.radius) || 0
  if (radius <= 0) return ''
  const width = node.width ?? shapeOf(node.data.shape).width
  const height = node.height ?? shapeOf(node.data.shape).height
  return `arcSize=${Math.round(Math.min(50, (radius / Math.max(1, Math.min(width, height))) * 100))};`
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;')
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
const color = (value: string) => (value && value !== 'transparent' ? value : '')

function nodeValue(node: DiagramNode): string {
  const { data } = node
  const geometry = shapeOf(data.shape).geometry
  if (geometry === 'uml-class') return [`<b>${escapeHtml(data.label)}</b>`, escapeHtml(data.attributes ?? ''), escapeHtml(data.operations ?? '')].join('<hr>')
  if (geometry === 'legend') return [`<b>${escapeHtml(data.label)}</b>`, ...(data.legend ?? []).map((entry) => `<font color="${entry.color}">■</font> ${escapeHtml(entry.label)}`)].join('<br>')
  if (geometry === 'fragment') return `${escapeHtml(data.label)} ${escapeHtml(data.subtitle ?? '')}`.trim()
  return data.subtitle ? `${escapeHtml(data.label)}<br><font style="font-size:10px">${escapeHtml(data.subtitle)}</font>` : escapeHtml(data.label)
}

function nodeStyle(node: DiagramNode, images: ReadonlyMap<string, string>): string {
  const { data } = node
  const geometry = shapeOf(data.shape).geometry
  const style = data.style
  const arc = radiusArc(node)
  const shapeStyle = GEOMETRY_STYLE[geometry] ?? 'rounded=0;'
  const parts = [arc ? `${shapeStyle.replace('rounded=0;', 'rounded=1;')}${arc}` : shapeStyle, 'whiteSpace=wrap;html=1;']
  const fill = geometry === 'fragment' || style.fill === 'transparent' ? 'none' : color(style.fill)
  if (fill) parts.push(`fillColor=${fill};`)
  if (color(style.stroke)) parts.push(`strokeColor=${style.stroke};`)
  if (color(style.textColor)) parts.push(`fontColor=${style.textColor};`)
  parts.push(`fontSize=${style.fontSize};strokeWidth=${style.strokeWidth};`)
  if (style.dashed) parts.push('dashed=1;')
  if (data.rotation) parts.push(`rotation=${data.rotation};`)
  if (geometry === 'image' && data.image) {
    // draw.io writes data URLs without ";base64" because ";" separates style keys.
    parts.push(`image=${(images.get(data.image) ?? data.image).replace(';base64', '')};`)
  }
  return parts.join('')
}

/** Where a handle sits on its node, as draw.io's 0..1 constraint. */
export function handleConstraint(node: DiagramNode, handle: string | null | undefined): { x: number; y: number } | null {
  if (!handle) return null
  const width = node.width ?? shapeOf(node.data.shape).width
  const height = node.height ?? shapeOf(node.data.shape).height
  const row = /^([LR])(\d+)$/.exec(handle)
  if (row) return { x: 0.5 + ((row[1] === 'R' ? 1 : -1) * SEQ_BAR_HALF) / width, y: (SEQ_FIRST_ROW + Number(row[2]) * SEQ_ROW) / height }
  const side = /^(top|right|bottom|left)-(\d+)$/.exec(handle)
  if (!side) return null
  const along = Number(side[2]) / 100
  return { top: { x: along, y: 0 }, bottom: { x: along, y: 1 }, left: { x: 0, y: along }, right: { x: 1, y: along } }[side[1] as 'top']
}

function edgeStyle(edge: DiagramEdge, byId: ReadonlyMap<string, DiagramNode>): string {
  const data = edge.data
  if (!data) return 'html=1;'
  const parts = [ROUTING_OUT[data.routing], 'html=1;rounded=0;']
  const [endName, endFill] = ARROW_OUT[data.arrowEnd].split(';')
  const [startName, startFill] = ARROW_OUT[data.arrowStart].split(';')
  parts.push(`endArrow=${endName};${endFill ? `end${endFill};` : ''}startArrow=${startName};${startFill ? `start${startFill};` : ''}`)
  if (data.dashed) parts.push('dashed=1;')
  if (data.color) parts.push(`strokeColor=${data.color};`)
  parts.push(`strokeWidth=${data.thickness};`)
  const exit = byId.get(edge.source) && handleConstraint(byId.get(edge.source)!, edge.sourceHandle)
  const entry = byId.get(edge.target) && handleConstraint(byId.get(edge.target)!, edge.targetHandle)
  if (exit) parts.push(`exitX=${round(exit.x)};exitY=${round(exit.y)};exitDx=0;exitDy=0;`)
  if (entry) parts.push(`entryX=${round(entry.x)};entryY=${round(entry.y)};entryDx=0;entryDy=0;`)
  return parts.join('')
}

const round = (value: number) => Math.round(value * 1000) / 1000

function pageXml(page: DiagramPage, images: ReadonlyMap<string, string>): string {
  const byId = new Map(page.nodes.map((node) => [node.id, node]))
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
  for (const node of page.nodes) {
    const definition = shapeOf(node.data.shape)
    const width = node.width ?? definition.width
    const height = node.height ?? definition.height
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : '1'
    cells.push(`<mxCell id="${escapeXml(node.id)}" value="${escapeXml(nodeValue(node))}" style="${escapeXml(nodeStyle(node, images))}" vertex="1" parent="${escapeXml(parent)}"><mxGeometry x="${round(node.position.x)}" y="${round(node.position.y)}" width="${round(width)}" height="${round(height)}" as="geometry"/></mxCell>`)
  }
  for (const edge of page.edges) {
    const points = edge.data?.waypoints.length ? `<Array as="points">${edge.data.waypoints.map((point) => `<mxPoint x="${round(point.x)}" y="${round(point.y)}"/>`).join('')}</Array>` : ''
    cells.push(`<mxCell id="${escapeXml(edge.id)}" value="${escapeXml(escapeHtml(edge.data?.label ?? ''))}" style="${escapeXml(edgeStyle(edge, byId))}" edge="1" parent="1" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`)
  }
  return `<diagram id="${escapeXml(page.id)}" name="${escapeXml(page.name)}"><mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root>${cells.join('')}</root></mxGraphModel></diagram>`
}

/**
 * The diagram as a .drawio file. `images` maps an image node's app URL to a data URL, so icons
 * from the library still show in draw.io, which cannot read adOmnia's own files.
 */
export function toDrawio(doc: DiagramDocument, images: ReadonlyMap<string, string> = new Map()): string {
  return `<mxfile host="adOmnia" type="device">${syncedPages(doc).map((page) => pageXml(page, images)).join('')}</mxfile>`
}

// ---------------------------------------------------------------- import

type Style = Map<string, string>

export function parseStyle(style: string): Style {
  const map: Style = new Map()
  for (const part of style.split(';')) {
    if (!part) continue
    const at = part.indexOf('=')
    if (at < 0) map.set(part.trim(), '1')
    else map.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  return map
}

const SHAPE_IN: ReadonlyArray<[string, string]> = [
  ['umlLifeline', 'seq-lifeline'], ['umlFrame', 'seq-opt'], ['umlActor', 'uml-actor'], ['folder', 'uml-package'], ['module', 'uml-component'],
  ['component', 'uml-component'], ['cylinder3', 'stored-data'], ['cylinder', 'stored-data'], ['datastore', 'stored-data'], ['hexagon', 'hexagon'],
  ['document', 'document'], ['cloud', 'cloud'], ['parallelogram', 'io'], ['note', 'note'], ['process', 'subprocess'], ['manualInput', 'manual-input'],
  ['delay', 'delay'], ['offPageConnector', 'off-page'], ['singleArrow', 'block-arrow'], ['mxgraph.basic.star', 'star'], ['triangle', 'triangle'],
  ['image', 'image'], ['swimlane', 'container'],
]

/** The library shape closest to a draw.io style. */
export function shapeForStyle(style: Style, width: number, height: number): string {
  const shape = style.get('shape') ?? ''
  for (const [key, id] of SHAPE_IN) if (shape === key || style.has(key)) return id
  if (style.has('text')) return 'text'
  if (style.has('rhombus')) return 'diamond'
  if (style.has('ellipse')) return Math.abs(width - height) < 2 ? 'circle' : 'ellipse'
  if (style.has('triangle')) return 'triangle'
  if (style.get('container') === '1' || style.has('group')) return 'container'
  if (style.get('rounded') === '1') return Number(style.get('arcSize') ?? 0) >= 40 ? 'terminator' : 'rounded-rectangle'
  if (style.has('orthogonalPerimeter') || style.get('perimeter') === 'orthogonalPerimeter') return 'seq-activation'
  return 'rectangle'
}

/** draw.io labels are often HTML: keep the text and the line breaks. */
export function plainText(value: string): string {
  if (!/[<&]/.test(value)) return value
  const html = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<hr[^>]*>/gi, '\n')
  const text = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent ?? ''
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

const ARROW_IN: Record<string, ArrowHead> = { none: 'none', block: 'arrow', classic: 'arrow', classicThin: 'arrow', blockThin: 'arrow', open: 'open', openThin: 'open', diamond: 'diamond', diamondThin: 'diamond', oval: 'circle', ERmandOne: 'arrow' }

function arrowIn(style: Style, end: 'start' | 'end'): ArrowHead {
  const name = style.get(`${end}Arrow`)
  if (name === undefined) return end === 'end' ? 'arrow' : 'none'
  const head = ARROW_IN[name] ?? 'arrow'
  return head === 'arrow' && style.get(`${end}Fill`) === '0' ? 'open' : head
}

/** The handle of a node nearest to a draw.io constraint, or null for a floating end. */
export function nearestHandle(node: DiagramNode, x: number | undefined, y: number | undefined): string | null {
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return null
  const definition = shapeOf(node.data.shape)
  const width = node.width ?? definition.width
  const height = node.height ?? definition.height
  if (definition.geometry === 'lifeline') {
    const row = Math.max(0, Math.min(lifelineRows(height) - 1, Math.round((y * height - SEQ_FIRST_ROW) / SEQ_ROW)))
    return `${x >= 0.5 ? 'R' : 'L'}${row}`
  }
  const candidates = (['top', 'right', 'bottom', 'left'] as const).flatMap((side) => {
    const length = side === 'top' || side === 'bottom' ? width : height
    return (length >= 120 ? [25, 50, 75] : [50]).map((offset) => `${side}-${offset}`)
  })
  let best: string | null = null
  let distance = Infinity
  for (const id of candidates) {
    const point = handleConstraint(node, id)!
    const gap = Math.hypot((point.x - x) * width, (point.y - y) * height)
    if (gap < distance) { distance = gap; best = id }
  }
  return best
}

const number = (value: string | null | undefined, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * draw.io's own palette is light (white boxes, pastel fills): on adOmnia's dark canvas it becomes
 * the tint that means the same thing, so an imported diagram looks drawn here. A custom color is
 * left exactly as it is.
 */
const DRAWIO_FILLS: ReadonlyMap<string, string> = new Map([
  ['#ffffff', 'theme'], ['#f5f5f5', 'theme'], ['#dae8fc', 'blue'], ['#d5e8d4', 'green'],
  ['#ffe6cc', 'amber'], ['#fff2cc', 'amber'], ['#f8cecc', 'red'], ['#e1d5e7', 'violet'],
])
const DRAWIO_STROKES: ReadonlyMap<string, string> = new Map([
  ['#000000', 'theme'], ['#ffffff', 'theme'], ['#666666', 'graphite'], ['#6c8ebf', 'blue'], ['#82b366', 'green'],
  ['#d79b00', 'amber'], ['#d6b656', 'amber'], ['#b85450', 'red'], ['#9673a6', 'violet'],
])
const paletteTint = (id: string) => STYLE_PALETTE.find((entry) => entry.id === id)

/** A draw.io fill as an adOmnia fill: a palette tint, the theme's own surface, or the original color. */
export function importFill(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (value === 'none') return 'transparent'
  const id = DRAWIO_FILLS.get(value.toLowerCase())
  if (!id) return value
  return id === 'theme' ? '' : paletteTint(id)?.fill ?? value
}

/** A draw.io border as an adOmnia border; black becomes the theme's own stroke so it stays visible. */
export function importStroke(value: string | null | undefined): string | undefined {
  if (!value || value === 'none') return undefined
  const id = DRAWIO_STROKES.get(value.toLowerCase())
  if (!id) return value
  return id === 'theme' ? '' : paletteTint(id)?.stroke ?? value
}

/** draw.io labels often carry the technology on a second, smaller line: that becomes the subtitle. */
function splitLabel(value: string): { label: string; subtitle?: string } {
  const text = plainText(value)
  if (!/<br\s*\/?>\s*<font/i.test(value)) return { label: text }
  const [first, ...rest] = text.split('\n')
  const subtitle = rest.join(' ').replace(/\s+/g, ' ').trim()
  return subtitle ? { label: first.trim(), subtitle } : { label: text }
}

function readCells(model: Element): DiagramGraph {
  const cells = [...model.getElementsByTagName('mxCell')]
  const byCell = new Map(cells.map((cell) => [cell.getAttribute('id') ?? '', cell]))
  const isLayer = (id: string | null) => !id || byCell.get(id)?.getAttribute('parent') === '0' || id === '0'
  const nodes: DiagramNode[] = []
  const edgeLabels = new Map<string, string>()
  for (const cell of cells) {
    if (cell.getAttribute('vertex') !== '1') continue
    const parent = cell.getAttribute('parent')
    const rawLabel = cell.getAttribute('value') ?? ''
    const label = plainText(rawLabel)
    if (parent && byCell.get(parent)?.getAttribute('edge') === '1') { edgeLabels.set(parent, label); continue }
    const geometry = cell.getElementsByTagName('mxGeometry')[0]
    const width = number(geometry?.getAttribute('width'), 120)
    const height = number(geometry?.getAttribute('height'), 60)
    const style = parseStyle(cell.getAttribute('style') ?? '')
    const shape = shapeForStyle(style, width, height)
    const base = createNode(shape, { x: number(geometry?.getAttribute('x')), y: number(geometry?.getAttribute('y')) })
    const fill = importFill(style.get('fillColor'))
    const stroke = importStroke(style.get('strokeColor'))
    const image = style.get('image')
    const text = splitLabel(rawLabel)
    nodes.push({
      ...base,
      id: cell.getAttribute('id') ?? base.id,
      width,
      height,
      ...(isLayer(parent) ? {} : { parentId: parent! }),
      data: {
        ...base.data,
        label: text.label,
        subtitle: text.subtitle,
        rotation: number(style.get('rotation')),
        ...(image ? { image: image.startsWith('data:') && !image.includes(';base64') ? image.replace(',', ';base64,') : image } : {}),
        style: {
          ...base.data.style,
          ...(fill !== undefined ? { fill } : {}),
          ...(stroke !== undefined ? { stroke } : {}),
          ...(style.get('fontColor') && style.get('fontColor') !== 'none' ? { textColor: style.get('fontColor') === '#000000' ? '' : style.get('fontColor')! } : {}),
          fontSize: number(style.get('fontSize'), base.data.style.fontSize),
          strokeWidth: style.get('strokeColor') === 'none' ? 0 : number(style.get('strokeWidth'), base.data.style.strokeWidth),
          radius: style.get('rounded') === '1' ? Math.round((number(style.get('arcSize'), 15) / 100) * Math.min(width, height)) : 0,
          dashed: style.get('dashed') === '1',
        },
      },
    })
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges: DiagramEdge[] = []
  for (const cell of cells) {
    if (cell.getAttribute('edge') !== '1') continue
    const sourceNode = byId.get(cell.getAttribute('source') ?? '')
    const targetNode = byId.get(cell.getAttribute('target') ?? '')
    if (!sourceNode || !targetNode) continue // a dangling line has nothing to attach to
    const style = parseStyle(cell.getAttribute('style') ?? '')
    const routing: EdgeRouting = style.get('edgeStyle')?.includes('orthogonal') || style.get('edgeStyle') === 'elbowEdgeStyle' ? 'orthogonal' : style.get('curved') === '1' ? 'bezier' : 'straight'
    const points = [...(cell.getElementsByTagName('mxPoint'))].filter((point) => point.parentElement?.getAttribute('as') === 'points')
    const edge = createEdge({
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: nearestHandle(sourceNode, style.has('exitX') ? number(style.get('exitX')) : undefined, style.has('exitY') ? number(style.get('exitY')) : undefined),
      targetHandle: nearestHandle(targetNode, style.has('entryX') ? number(style.get('entryX')) : undefined, style.has('entryY') ? number(style.get('entryY')) : undefined),
    }, routing, {
      label: plainText(cell.getAttribute('value') ?? '') || edgeLabels.get(cell.getAttribute('id') ?? '') || '',
      color: importStroke(style.get('strokeColor')) ?? '',
      thickness: number(style.get('strokeWidth'), 1.5),
      dashed: style.get('dashed') === '1',
      arrowEnd: arrowIn(style, 'end'),
      arrowStart: arrowIn(style, 'start'),
      waypoints: points.map((point) => ({ x: number(point.getAttribute('x')), y: number(point.getAttribute('y')) })),
    })
    edges.push({ ...edge, id: cell.getAttribute('id') ?? edge.id })
  }
  return { nodes: orderParentsFirst(nodes), edges }
}

/** A compressed page: Base64 of raw-deflated, URI-encoded XML. */
async function inflatePage(text: string): Promise<string> {
  const bytes = Uint8Array.from(atob(text.trim()), (char) => char.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return decodeURIComponent(await new Response(stream).text())
}

export class DrawioFormatError extends Error {}

/** Every page of a .drawio/.xml file (or of a draw.io SVG's embedded file) as a diagram. */
export async function fromDrawio(xml: string, name = 'Imported diagram'): Promise<DiagramDocument> {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  if (parsed.getElementsByTagName('parsererror').length) throw new DrawioFormatError('The file is not valid XML.')
  const root = parsed.documentElement
  const models: Array<{ name: string; model: Element }> = []
  if (root.tagName === 'mxGraphModel') models.push({ name: 'Page 1', model: root })
  for (const diagram of [...root.getElementsByTagName('diagram')]) {
    const inner = diagram.getElementsByTagName('mxGraphModel')[0]
    const pageName = diagram.getAttribute('name') || `Page ${models.length + 1}`
    if (inner) { models.push({ name: pageName, model: inner }); continue }
    const text = diagram.textContent?.trim()
    if (!text) continue
    const inflated = new DOMParser().parseFromString(await inflatePage(text), 'application/xml').documentElement
    if (inflated.tagName === 'mxGraphModel') models.push({ name: pageName, model: inflated })
  }
  if (models.length === 0) throw new DrawioFormatError('No draw.io page found (mxfile / mxGraphModel).')
  const pages = models.map(({ name: pageName, model }) => newPage(pageName, readCells(model)))
  const doc = emptyDiagram(name)
  return { ...doc, pages, activePageId: pages[0].id, nodes: pages[0].nodes, edges: pages[0].edges, viewport: pages[0].viewport }
}

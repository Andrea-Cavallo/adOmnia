/**
 * What a file dropped on, or imported into, Diagram Studio becomes: an adOmnia diagram (JSON, an SVG
 * exported by adOmnia), a draw.io diagram (.drawio/.xml, or a draw.io SVG with its file inside),
 * a blueprint written by the MCP server or by Markdown generation, or a picture placed as an image.
 */
import { diagramFromBlueprint, type DiagramBlueprint } from './blueprint'
import { fromDrawio } from './drawio'
import { embeddedDiagram } from './export'
import { emptyDiagram, newPage, type DiagramDocument, type EdgeRouting } from './model'
import { DiagramFormatError, parseDiagram } from './serialization'
import { sequenceFromText } from './sequence'

export type ImportedFile = { kind: 'diagram'; doc: DiagramDocument } | { kind: 'image'; src: string; name: string }

export const BLUEPRINT_FORMAT = 'adomnia-diagram-blueprint'
/** Pictures larger than this would bloat the saved diagram; they are refused with a clear message. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/

export const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/\.(adomnia-diagram|drawio)$/, '') || 'Imported diagram'

export interface BlueprintFile extends DiagramBlueprint {
  format: typeof BLUEPRINT_FORMAT
  name?: string
  /** Mermaid-style sequence diagram text, drawn as a second page (or the only one when there are no nodes). */
  sequence?: string
}

/** A blueprint (generated, not drawn) as a laid-out diagram. */
export async function diagramFromBlueprintFile(file: BlueprintFile, routing: EdgeRouting = 'orthogonal'): Promise<DiagramDocument> {
  const doc = emptyDiagram(file.name?.trim() || 'Generated diagram')
  const pages = []
  if (file.nodes?.length) pages.push(newPage('Overview', await diagramFromBlueprint({ nodes: file.nodes, links: file.links ?? [] }, routing)))
  if (file.sequence?.trim()) pages.push(newPage('Sequence', sequenceFromText(file.sequence)))
  if (pages.length === 0) throw new DiagramFormatError('Nothing to draw: no components, steps or sequence were found.')
  return { ...doc, pages, activePageId: pages[0].id, nodes: pages[0].nodes, edges: pages[0].edges }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

export async function readImageFile(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new DiagramFormatError(`“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB: images up to 4 MB can be placed in a diagram.`)
  return readAsDataUrl(file)
}

/** Reads a text file's content as a diagram, if it is one; null when it is not a known diagram format. */
export async function diagramFromText(text: string, fileName: string): Promise<DiagramDocument | null> {
  const name = baseName(fileName)
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{')) {
    let raw: unknown
    try { raw = JSON.parse(text) } catch { throw new DiagramFormatError('The file is not valid JSON.') }
    if (raw && typeof raw === 'object' && (raw as { format?: unknown }).format === BLUEPRINT_FORMAT) return diagramFromBlueprintFile(raw as BlueprintFile)
    return parseDiagram(text)
  }
  if (trimmed.startsWith('<')) {
    const embedded = embeddedDiagram(text)
    if (embedded) return parseDiagram(embedded)
    if (/<(mxfile|mxGraphModel)\b/.test(text)) return fromDrawio(text, name)
    // A draw.io SVG keeps its file, escaped, in the root's content attribute.
    const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
    const content = svg.getAttribute('content')
    if (content && /<(mxfile|mxGraphModel)\b/.test(content)) return fromDrawio(content, name)
  }
  return null
}

/** Any supported file, as a diagram to open or an image to place. */
export async function importDiagramFile(file: File): Promise<ImportedFile> {
  const lower = file.name.toLowerCase()
  const textual = /\.(json|drawio|xml|svg)$/.test(lower) || file.type === 'image/svg+xml' || file.type.includes('json') || file.type.includes('xml')
  if (textual) {
    const doc = await diagramFromText(await file.text(), file.name)
    if (doc) return { kind: 'diagram', doc }
  }
  if (IMAGE_TYPES.test(file.type) || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(lower)) return { kind: 'image', src: await readImageFile(file), name: baseName(file.name) }
  throw new DiagramFormatError(`“${file.name}” is not a diagram (adOmnia JSON, draw.io, SVG) or an image.`)
}

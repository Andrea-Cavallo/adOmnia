/**
 * Export of a whole diagram (not just the visible part) to PNG, SVG or JSON, saved through the
 * desktop's native Save dialog. The picture is taken from React Flow's viewport element with the
 * transform that fits every node, as React Flow documents for image export.
 */
import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react'
import { SaveBinaryFileBase64 } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/app'
import type { DiagramDocument } from './model'
import { serializeDiagram } from './serialization'

export type ExportFormat = 'png' | 'svg' | 'json'

/** Border around the diagram in an exported picture, in pixels. */
const EXPORT_PADDING = 48
/** PNG pixel density: sharp on high-DPI screens and in documents. */
const PNG_PIXEL_RATIO = 2
const MAX_EXPORT_SIDE = 8000

/**
 * The theme variables the drawing uses. The picture is taken from a copy of the viewport, outside
 * the studio element that defines them, and the copy keeps no custom properties: their resolved
 * values travel inside it as a <style> element for the duration of the export.
 */
export const EXPORT_VARIABLES = [
  '--diagram-canvas', '--diagram-node-fill', '--diagram-node-stroke', '--diagram-node-text', '--diagram-edge', '--diagram-flow', '--diagram-select',
  '--color-surface-0', '--color-surface-1', '--color-surface-2', '--color-surface-3', '--color-surface-4',
  '--color-border-1', '--color-border-2', '--color-border-3', '--color-text-1', '--color-text-2', '--color-text-3', '--color-text-4',
  '--color-accent', '--color-success', '--font-mono', '--font-sans',
] as const

/** A stylesheet defining the variables on the React Flow viewport. */
export function themeStylesheet(variables: Record<string, string>): string {
  const declarations = Object.entries(variables).map(([name, value]) => `${name}: ${value};`).join(' ')
  return `.react-flow__viewport { ${declarations} }`
}

/** The resolved values of EXPORT_VARIABLES on an element; empty ones are left out. */
export function themeVariables(element: Element): Record<string, string> {
  const style = getComputedStyle(element)
  return Object.fromEntries(EXPORT_VARIABLES.map((name) => [name, style.getPropertyValue(name).trim()]).filter(([, value]) => value !== ''))
}

/** A file name from a diagram name: letters, digits, dashes; never empty. */
export function exportFileName(name: string, format: ExportFormat): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram'
  return `${base}.${format === 'json' ? 'adomnia-diagram.json' : format}`
}

/** The frame and transform that put every node in the picture, with a border. */
export function exportFrame(nodes: Node[]): { width: number; height: number; transform: string } {
  const bounds = getNodesBounds(nodes)
  const width = Math.min(MAX_EXPORT_SIDE, Math.ceil(bounds.width + EXPORT_PADDING * 2))
  const height = Math.min(MAX_EXPORT_SIDE, Math.ceil(bounds.height + EXPORT_PADDING * 2))
  const viewport = getViewportForBounds(bounds, width, height, 0.1, 2, EXPORT_PADDING / Math.max(width, height))
  return { width, height, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }
}

export function base64OfText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

/** The Base64 payload of a data URL, whether it is Base64 already or percent-encoded text (SVG). */
export function base64OfDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Not a data URL')
  const header = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  return header.endsWith(';base64') ? payload : base64OfText(decodeURIComponent(payload))
}

/** Renders the viewport element to a data URL; html-to-image is loaded only when exporting. */
async function renderImage(viewport: HTMLElement, nodes: Node[], format: 'png' | 'svg', background: string): Promise<string> {
  const { toPng, toSvg } = await import('html-to-image')
  const frame = exportFrame(nodes)
  const options = {
    backgroundColor: background,
    width: frame.width,
    height: frame.height,
    pixelRatio: PNG_PIXEL_RATIO,
    style: { width: `${frame.width}px`, height: `${frame.height}px`, transform: frame.transform },
    // Editing chrome (handles, resizers, toolbars) is not part of the picture.
    filter: (element: HTMLElement) => !element.classList?.contains('diagram-no-export'),
  }
  const theme = document.createElement('style')
  theme.textContent = themeStylesheet(themeVariables(viewport))
  viewport.prepend(theme)
  try {
    return await (format === 'png' ? toPng(viewport, options) : toSvg(viewport, options))
  } finally {
    theme.remove()
  }
}

/**
 * Exports the diagram; returns the saved path, or '' when the user cancelled the dialog.
 * Throws with a readable message when there is nothing to export or rendering fails.
 */
export async function exportDiagram(doc: DiagramDocument, format: ExportFormat, viewport: HTMLElement | null, background: string): Promise<string> {
  const name = exportFileName(doc.name, format)
  if (format === 'json') return SaveBinaryFileBase64(name, base64OfText(serializeDiagram(doc)))
  if (doc.nodes.length === 0) throw new Error('The diagram is empty: add a shape before exporting a picture.')
  if (!viewport) throw new Error('The canvas is not ready yet.')
  const dataUrl = await renderImage(viewport, doc.nodes, format, background)
  return SaveBinaryFileBase64(name, base64OfDataUrl(dataUrl))
}

// PDF annotation model + coordinate helpers.
//
// All annotation geometry is stored in PDF *points* with a top-left origin
// (y grows downward), matching the on-screen editor. At export time
// (`pdfExport.ts`) these are converted to pdf-lib's bottom-left origin.

export type PdfToolId =
  | 'select'
  | 'text'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'ink'
  | 'signature'

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'

export interface BaseAnnotation {
  id: string
  page: number // 1-based
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text'
  x: number
  y: number
  w: number
  h: number
  text: string
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight'
  x: number
  y: number
  w: number
  h: number
  color: string
  opacity: number
}

export interface ShapeAnnotation extends BaseAnnotation {
  type: ShapeKind
  x: number
  y: number
  w: number // may be negative for line/arrow
  h: number // may be negative for line/arrow
  color: string
  strokeWidth: number
}

export interface InkAnnotation extends BaseAnnotation {
  type: 'ink'
  // Flat list of points [x0, y0, x1, y1, ...] in page points (top-left origin).
  paths: number[]
  color: string
  width: number
}

export interface SignatureAnnotation extends BaseAnnotation {
  type: 'signature'
  x: number
  y: number
  w: number
  h: number
  imageDataUrl: string // PNG data URL
}

export type PdfAnnotation =
  | TextAnnotation
  | HighlightAnnotation
  | ShapeAnnotation
  | InkAnnotation
  | SignatureAnnotation

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

let counter = 0
export function annotationId(): string {
  counter += 1
  return `pdfa_${Date.now().toString(36)}_${counter.toString(36)}`
}

// ── Coordinate conversion ─────────────────────────────────────────────────────

/** Convert a length/position in PDF points to on-screen pixels at the given zoom. */
export function pointToScreen(point: number, zoom: number): number {
  return point * zoom
}

/** Convert an on-screen pixel measurement back to PDF points. */
export function screenToPoint(pixels: number, zoom: number): number {
  return zoom === 0 ? 0 : pixels / zoom
}

/** Normalize a rect so width/height are positive (origin moves to top-left). */
export function normalizeRect(rect: Rect): Rect {
  const x = rect.w < 0 ? rect.x + rect.w : rect.x
  const y = rect.h < 0 ? rect.y + rect.h : rect.y
  return { x, y, w: Math.abs(rect.w), h: Math.abs(rect.h) }
}

// ── Factories ─────────────────────────────────────────────────────────────────

export const DEFAULT_ANNOTATION_COLOR = '#e11d48'
export const DEFAULT_HIGHLIGHT_COLOR = '#facc15'

export function createTextAnnotation(page: number, x: number, y: number): TextAnnotation {
  return {
    id: annotationId(),
    page,
    type: 'text',
    x,
    y,
    w: 160,
    h: 24,
    text: 'Text',
    fontSize: 14,
    color: '#111111',
    align: 'left',
  }
}

export function createShapeAnnotation(type: ShapeKind, page: number, rect: Rect): ShapeAnnotation {
  const geo = type === 'line' || type === 'arrow' ? rect : normalizeRect(rect)
  return {
    id: annotationId(),
    page,
    type,
    x: geo.x,
    y: geo.y,
    w: geo.w,
    h: geo.h,
    color: DEFAULT_ANNOTATION_COLOR,
    strokeWidth: 2,
  }
}

export function createHighlightAnnotation(page: number, rect: Rect): HighlightAnnotation {
  const geo = normalizeRect(rect)
  return {
    id: annotationId(),
    page,
    type: 'highlight',
    x: geo.x,
    y: geo.y,
    w: geo.w,
    h: geo.h,
    color: DEFAULT_HIGHLIGHT_COLOR,
    opacity: 0.4,
  }
}

export function createInkAnnotation(page: number, paths: number[]): InkAnnotation {
  return {
    id: annotationId(),
    page,
    type: 'ink',
    paths,
    color: DEFAULT_ANNOTATION_COLOR,
    width: 2,
  }
}

export function createSignatureAnnotation(
  page: number,
  x: number,
  y: number,
  imageDataUrl: string,
  w = 180,
  h = 70,
): SignatureAnnotation {
  return { id: annotationId(), page, type: 'signature', x, y, w, h, imageDataUrl }
}

/** Parse a #rrggbb string into a {r,g,b} triple in the 0..1 range for pdf-lib. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6)
  const num = parseInt(full, 16)
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 }
  return {
    r: ((num >> 16) & 0xff) / 255,
    g: ((num >> 8) & 0xff) / 255,
    b: (num & 0xff) / 255,
  }
}

// pdf.js loading + page rendering + form-widget extraction.
//
// pdf.js is heavy and ESM-only; it is imported here so the bundle only pulls
// it in when the PDF Editor panel is opened (the panel itself is lazy-loaded).

import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
// Vite resolves this URL to a hashed asset and serves the worker file.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker

export interface LoadedPdf {
  doc: PDFDocumentProxy
  pageCount: number
}

export interface RenderedPage {
  canvas: HTMLCanvasElement
  /** Page size in PDF points (origin top-left for the editor overlay). */
  widthPt: number
  heightPt: number
}

export type FormWidgetType = 'text' | 'checkbox' | 'radio' | 'choice' | 'unsupported'

export interface FormWidget {
  name: string
  type: FormWidgetType
  /** Rect in PDF points, top-left origin: x, y, w, h. */
  x: number
  y: number
  w: number
  h: number
  defaultValue: string | boolean
  options?: string[]
  exportValue?: string // for radio/checkbox "on" value
}

/** Load a PDF from raw bytes. Throws a clean error for invalid/encrypted files. */
export async function loadPdfDocument(bytes: Uint8Array): Promise<LoadedPdf> {
  try {
    // pdf.js transfers (and may detach) the buffer; hand it a private copy.
    const data = bytes.slice()
    const doc = await pdfjs.getDocument({ data }).promise
    return { doc, pageCount: doc.numPages }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (/password/i.test(message)) {
      throw new Error('This PDF is password-protected and cannot be opened (unsupported in v1).')
    }
    throw new Error(`Could not open PDF: ${message}`)
  }
}

/** Render one page (1-based) into a fresh canvas at the given zoom scale. */
export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<RenderedPage> {
  const page: PDFPageProxy = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const baseViewport = page.getViewport({ scale: 1 })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * ratio)
  canvas.height = Math.floor(viewport.height * ratio)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`
  context.scale(ratio, ratio)
  await page.render({ canvasContext: context, viewport }).promise
  return { canvas, widthPt: baseViewport.width, heightPt: baseViewport.height }
}

interface RawWidgetAnnotation {
  subtype?: string
  fieldType?: string
  fieldName?: string
  fieldValue?: unknown
  rect?: number[]
  checkBox?: boolean
  radioButton?: boolean
  options?: Array<{ exportValue?: string; displayValue?: string }>
  exportValue?: string
  buttonValue?: string
}

/**
 * Read interactive AcroForm widgets for a page, converted to top-left points.
 * Returns an empty array when the page has no form fields.
 */
export async function readFormWidgets(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<FormWidget[]> {
  const page = await doc.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const pageHeight = baseViewport.height
  const annotations = (await page.getAnnotations()) as RawWidgetAnnotation[]
  const widgets: FormWidget[] = []

  for (const raw of annotations) {
    if (raw.subtype !== 'Widget' || !raw.fieldName || !raw.rect) continue
    const [x1, y1, x2, y2] = raw.rect
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const top = pageHeight - Math.max(y1, y2)
    const w = right - left
    const h = Math.abs(y2 - y1)

    let type: FormWidgetType = 'unsupported'
    let defaultValue: string | boolean = ''
    let options: string[] | undefined
    let exportValue: string | undefined

    if (raw.fieldType === 'Tx') {
      type = 'text'
      defaultValue = typeof raw.fieldValue === 'string' ? raw.fieldValue : ''
    } else if (raw.fieldType === 'Btn') {
      if (raw.radioButton) {
        type = 'radio'
        exportValue = raw.buttonValue ?? raw.exportValue ?? 'On'
        defaultValue = raw.fieldValue === exportValue
      } else {
        type = 'checkbox'
        exportValue = raw.exportValue ?? 'On'
        defaultValue = Boolean(raw.fieldValue) && raw.fieldValue !== 'Off'
      }
    } else if (raw.fieldType === 'Ch') {
      type = 'choice'
      options = (raw.options ?? [])
        .map((o) => o.exportValue ?? o.displayValue ?? '')
        .filter(Boolean)
      defaultValue = typeof raw.fieldValue === 'string' ? raw.fieldValue : ''
    }

    if (type === 'unsupported') continue
    widgets.push({ name: raw.fieldName, type, x: left, y: top, w, h, defaultValue, options, exportValue })
  }
  return widgets
}

// Flatten the editor's annotation layer + form values into a new PDF via pdf-lib.

import {
  PDFDocument, StandardFonts, rgb,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList,
} from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import {
  hexToRgb01,
  type PdfAnnotation,
  type ShapeAnnotation,
  type InkAnnotation,
} from './annotationModel'

// StandardFonts.Helvetica is WinAnsi-encoded. In the browser we render Unicode
// annotation text to a PNG fallback so visual export keeps non-WinAnsi glyphs.
function toWinAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\x00-\xFF]/g, '?')
}

function hasNonWinAnsi(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\xFF]/.test(text)
}

/** Convert top-left editor Y to pdf-lib bottom-left Y for a box of height `h`. */
function flipY(pageHeight: number, y: number, h: number): number {
  return pageHeight - y - h
}

function drawShape(page: PDFPage, pageHeight: number, a: ShapeAnnotation): void {
  const { r, g, b } = hexToRgb01(a.color)
  const color = rgb(r, g, b)
  if (a.type === 'line' || a.type === 'arrow') {
    const start = { x: a.x, y: pageHeight - a.y }
    const end = { x: a.x + a.w, y: pageHeight - (a.y + a.h) }
    page.drawLine({ start, end, thickness: a.strokeWidth, color })
    if (a.type === 'arrow') {
      const angle = Math.atan2(end.y - start.y, end.x - start.x)
      const headLen = 10 + a.strokeWidth * 2
      for (const offset of [Math.PI - 0.4, Math.PI + 0.4]) {
        page.drawLine({
          start: end,
          end: {
            x: end.x + headLen * Math.cos(angle + offset),
            y: end.y + headLen * Math.sin(angle + offset),
          },
          thickness: a.strokeWidth,
          color,
        })
      }
    }
    return
  }
  const y = flipY(pageHeight, a.y, a.h)
  if (a.type === 'ellipse') {
    page.drawEllipse({
      x: a.x + a.w / 2,
      y: y + a.h / 2,
      xScale: Math.max(1, a.w / 2),
      yScale: Math.max(1, a.h / 2),
      borderColor: color,
      borderWidth: a.strokeWidth,
    })
  } else {
    page.drawRectangle({
      x: a.x,
      y,
      width: a.w,
      height: a.h,
      borderColor: color,
      borderWidth: a.strokeWidth,
    })
  }
}

function drawInk(page: PDFPage, pageHeight: number, a: InkAnnotation): void {
  const { r, g, b } = hexToRgb01(a.color)
  const color = rgb(r, g, b)
  for (let i = 0; i + 3 < a.paths.length; i += 2) {
    page.drawLine({
      start: { x: a.paths[i], y: pageHeight - a.paths[i + 1] },
      end: { x: a.paths[i + 2], y: pageHeight - a.paths[i + 3] },
      thickness: a.width,
      color,
    })
  }
}

async function drawSignature(
  pdf: PDFDocument,
  page: PDFPage,
  pageHeight: number,
  imageDataUrl: string,
  box: { x: number; y: number; w: number; h: number },
): Promise<void> {
  const commaIdx = imageDataUrl.indexOf(',')
  const b64 = commaIdx >= 0 ? imageDataUrl.slice(commaIdx + 1) : imageDataUrl
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  const png = await pdf.embedPng(bytes)
  page.drawImage(png, { x: box.x, y: flipY(pageHeight, box.y, box.h), width: box.w, height: box.h })
}

async function drawUnicodeTextImage(
  pdf: PDFDocument,
  page: PDFPage,
  pageHeight: number,
  a: Extract<PdfAnnotation, { type: 'text' }>,
): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(a.w * scale))
  canvas.height = Math.max(1, Math.ceil(a.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, a.w, a.h)
  ctx.fillStyle = a.color
  ctx.font = `${a.fontSize}px Helvetica, Arial, sans-serif`
  ctx.textAlign = a.align
  ctx.textBaseline = 'top'

  const x = a.align === 'center' ? a.w / 2 : a.align === 'right' ? a.w : 0
  a.text.split('\n').forEach((line, i) => {
    ctx.fillText(line, x, i * a.fontSize * 1.2)
  })

  const dataUrl = canvas.toDataURL('image/png')
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  const png = await pdf.embedPng(bytes)
  page.drawImage(png, { x: a.x, y: flipY(pageHeight, a.y, a.h), width: a.w, height: a.h })
  return true
}

function fillForm(pdf: PDFDocument, formValues: Record<string, string | boolean>): void {
  let form
  try {
    form = pdf.getForm()
  } catch {
    return
  }
  const byName = new Map(form.getFields().map((f) => [f.getName(), f]))
  for (const [name, value] of Object.entries(formValues)) {
    const field = byName.get(name)
    if (!field) continue
    try {
      if (field instanceof PDFTextField) {
        field.setText(String(value))
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check()
        else field.uncheck()
      } else if (
        field instanceof PDFRadioGroup ||
        field instanceof PDFDropdown ||
        field instanceof PDFOptionList
      ) {
        if (typeof value === 'string' && value) field.select(value)
      }
    } catch {
      // Skip fields that cannot be set; never fail the whole export for one field.
    }
  }
  try {
    form.flatten()
  } catch {
    // Some malformed forms cannot be flattened; the values are still set.
  }
}

/**
 * Produce a new flattened PDF (Uint8Array) from the original bytes, the editor
 * annotation layer, and the captured form values.
 */
export async function exportPdf(
  originalBytes: Uint8Array,
  annotations: PdfAnnotation[],
  formValues: Record<string, string | boolean>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalBytes)
  const helvetica: PDFFont = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()

  // Forms first so annotations render on top of flattened widgets.
  fillForm(pdf, formValues)

  for (const a of annotations) {
    const page = pages[a.page - 1]
    if (!page) continue
    const pageHeight = page.getHeight()

    if (a.type === 'text') {
      const { r, g, b } = hexToRgb01(a.color)
      if (hasNonWinAnsi(a.text) && await drawUnicodeTextImage(pdf, page, pageHeight, a)) {
        continue
      }
      const lines = toWinAnsi(a.text).split('\n')
      lines.forEach((line, i) => {
        page.drawText(line, {
          x: a.x,
          y: pageHeight - a.y - a.fontSize - i * a.fontSize * 1.2,
          size: a.fontSize,
          font: helvetica,
          color: rgb(r, g, b),
        })
      })
    } else if (a.type === 'highlight') {
      const { r, g, b } = hexToRgb01(a.color)
      page.drawRectangle({
        x: a.x,
        y: flipY(pageHeight, a.y, a.h),
        width: a.w,
        height: a.h,
        color: rgb(r, g, b),
        opacity: a.opacity,
      })
    } else if (a.type === 'ink') {
      drawInk(page, pageHeight, a)
    } else if (a.type === 'signature') {
      await drawSignature(pdf, page, pageHeight, a.imageDataUrl, a)
    } else {
      drawShape(page, pageHeight, a)
    }
  }

  return pdf.save()
}

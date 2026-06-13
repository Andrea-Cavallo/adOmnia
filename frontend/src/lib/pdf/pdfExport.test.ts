import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { exportPdf } from './pdfExport'
import { createTextAnnotation, createShapeAnnotation } from './annotationModel'

async function blankPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([300, 300])
  return pdf.save()
}

describe('exportPdf', () => {
  it('produces a valid PDF when applying text and shape annotations', async () => {
    const original = await blankPdf()
    const text = { ...createTextAnnotation(1, 20, 20), text: 'Hello World' }
    const rect = createShapeAnnotation('rect', 1, { x: 40, y: 40, w: 80, h: 30 })

    const out = await exportPdf(original, [text, rect], {})
    const header = new TextDecoder().decode(out.subarray(0, 5))

    expect(header).toBe('%PDF-')
    expect(out.length).toBeGreaterThan(original.length)

    // The output must re-parse as a real one-page PDF.
    const reparsed = await PDFDocument.load(out)
    expect(reparsed.getPageCount()).toBe(1)
  })

  it('drops non-WinAnsi characters instead of throwing', async () => {
    const original = await blankPdf()
    const text = { ...createTextAnnotation(1, 10, 10), text: 'emoji 😀 and é' }
    await expect(exportPdf(original, [text], {})).resolves.toBeInstanceOf(Uint8Array)
  })

  it('ignores annotations on out-of-range pages', async () => {
    const original = await blankPdf()
    const text = createTextAnnotation(99, 10, 10)
    const out = await exportPdf(original, [text], {})
    expect(new TextDecoder().decode(out.subarray(0, 5))).toBe('%PDF-')
  })
})

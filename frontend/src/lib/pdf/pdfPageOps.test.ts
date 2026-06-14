import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { deletePdfPage, mergePdfBytes, movePdfPage, rotatePdfPage, splitPdfPage } from './pdfPageOps'

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < count; i += 1) pdf.addPage([300 + i, 400 + i])
  return pdf.save()
}

describe('pdfPageOps', () => {
  it('rotates a page', async () => {
    const out = await rotatePdfPage(await pdfWithPages(1), 1, 90)
    const pdf = await PDFDocument.load(out)
    expect(pdf.getPage(0).getRotation().angle).toBe(90)
  })

  it('deletes a page', async () => {
    const out = await deletePdfPage(await pdfWithPages(3), 2)
    const pdf = await PDFDocument.load(out)
    expect(pdf.getPageCount()).toBe(2)
  })

  it('moves a page', async () => {
    const out = await movePdfPage(await pdfWithPages(3), 1, 3)
    const pdf = await PDFDocument.load(out)
    expect(pdf.getPageCount()).toBe(3)
    expect(pdf.getPage(2).getWidth()).toBe(300)
  })

  it('merges PDFs', async () => {
    const out = await mergePdfBytes(await pdfWithPages(2), await pdfWithPages(3))
    const pdf = await PDFDocument.load(out)
    expect(pdf.getPageCount()).toBe(5)
  })

  it('splits one page to a standalone PDF', async () => {
    const out = await splitPdfPage(await pdfWithPages(3), 2)
    const pdf = await PDFDocument.load(out)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getWidth()).toBe(301)
  })
})

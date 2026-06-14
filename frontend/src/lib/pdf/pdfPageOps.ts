import { PDFDocument, degrees } from 'pdf-lib'

export async function rotatePdfPage(bytes: Uint8Array, pageNumber: number, angle: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes)
  const page = pdf.getPage(pageNumber - 1)
  const current = page.getRotation().angle
  page.setRotation(degrees((current + angle + 360) % 360))
  return pdf.save()
}

export async function deletePdfPage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes)
  if (pdf.getPageCount() <= 1) throw new Error('Cannot delete the only page.')
  pdf.removePage(pageNumber - 1)
  return pdf.save()
}

export async function movePdfPage(bytes: Uint8Array, fromPage: number, toPage: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes)
  const count = src.getPageCount()
  if (fromPage < 1 || fromPage > count || toPage < 1 || toPage > count) {
    throw new Error('Page number out of range.')
  }
  const order = Array.from({ length: count }, (_, i) => i)
  const [moved] = order.splice(fromPage - 1, 1)
  order.splice(toPage - 1, 0, moved)

  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, order)
  copied.forEach((page) => out.addPage(page))
  return out.save()
}

export async function mergePdfBytes(baseBytes: Uint8Array, extraBytes: Uint8Array): Promise<Uint8Array> {
  const base = await PDFDocument.load(baseBytes)
  const extra = await PDFDocument.load(extraBytes)
  const copied = await base.copyPages(extra, extra.getPageIndices())
  copied.forEach((page) => base.addPage(page))
  return base.save()
}

export async function splitPdfPage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes)
  const out = await PDFDocument.create()
  const [page] = await out.copyPages(src, [pageNumber - 1])
  out.addPage(page)
  return out.save()
}

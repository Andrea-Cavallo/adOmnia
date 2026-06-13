import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderPdfPage, readFormWidgets, type FormWidget } from '@/lib/pdf/pdfDocument'
import { pointToScreen, type PdfAnnotation, type PdfToolId } from '@/lib/pdf/annotationModel'
import { AnnotationLayer } from './AnnotationLayer'
import { FormFieldLayer } from './FormFieldLayer'

interface PdfPageViewProps {
  doc: PDFDocumentProxy
  page: number
  zoom: number
  tool: PdfToolId
  color: string
  signatureImage: string | null
  annotations: PdfAnnotation[]
  selectedId: string | null
  formValues: Record<string, string | boolean>
  onSelect: (id: string | null) => void
  onCreate: (a: PdfAnnotation) => void
  onUpdate: (a: PdfAnnotation) => void
  onFormChange: (name: string, value: string | boolean) => void
  onToolHandled: () => void
  onNeedSignature: () => void
}

interface PageDims {
  widthPt: number
  heightPt: number
}

export function PdfPageView(props: PdfPageViewProps) {
  const { doc, page, zoom } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasHolderRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<PageDims | null>(null)
  const [visible, setVisible] = useState(false)
  const [widgets, setWidgets] = useState<FormWidget[]>([])
  const [error, setError] = useState<string | null>(null)

  // Fetch intrinsic page size once so we can size the placeholder before render.
  useEffect(() => {
    let cancelled = false
    doc.getPage(page).then((p) => {
      if (cancelled) return
      const vp = p.getViewport({ scale: 1 })
      setDims({ widthPt: vp.width, heightPt: vp.height })
    })
    return () => { cancelled = true }
  }, [doc, page])

  // Lazy: only render the canvas when the page scrolls near the viewport.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setVisible(true) }),
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Render (and re-render on zoom) the canvas; read form widgets once.
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    renderPdfPage(doc, page, zoom)
      .then(({ canvas }) => {
        if (cancelled) return
        const holder = canvasHolderRef.current
        if (holder) {
          holder.replaceChildren(canvas)
          canvas.style.display = 'block'
        }
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Render failed') })
    return () => { cancelled = true }
  }, [doc, page, zoom, visible])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    readFormWidgets(doc, page).then((w) => { if (!cancelled) setWidgets(w) }).catch(() => {})
    return () => { cancelled = true }
  }, [doc, page, visible])

  const widthPx = dims ? pointToScreen(dims.widthPt, zoom) : 612 * zoom
  const heightPx = dims ? pointToScreen(dims.heightPt, zoom) : 792 * zoom

  return (
    <div className="relative mx-auto shadow-lg" style={{ width: widthPx, height: heightPx }} data-page={page}>
      <div className="absolute left-0 top-[-18px] text-[10px] font-medium text-text-4">Page {page}</div>
      <div ref={wrapRef} className="relative h-full w-full bg-white">
        <div ref={canvasHolderRef} className="absolute inset-0" />
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-surface-0 text-[11px] text-error">{error}</div>
        )}
        {/* AnnotationLayer first (underneath); FormFieldLayer on top so its inputs
            stay clickable in select mode while its container passes clicks through. */}
        {dims && (
          <AnnotationLayer
            page={page}
            widthPt={dims.widthPt}
            heightPt={dims.heightPt}
            zoom={zoom}
            tool={props.tool}
            color={props.color}
            annotations={props.annotations}
            selectedId={props.selectedId}
            signatureImage={props.signatureImage}
            onSelect={props.onSelect}
            onCreate={props.onCreate}
            onUpdate={props.onUpdate}
            onToolHandled={props.onToolHandled}
            onNeedSignature={props.onNeedSignature}
          />
        )}
        {dims && (
          <FormFieldLayer
            widgets={widgets}
            zoom={zoom}
            tool={props.tool}
            formValues={props.formValues}
            onChange={props.onFormChange}
          />
        )}
      </div>
    </div>
  )
}

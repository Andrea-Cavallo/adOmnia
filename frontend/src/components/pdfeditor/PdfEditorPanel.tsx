import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { FileUp, AlertCircle } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { SaveBinaryFileBase64 } from '@/wailsjs/go/main/App'
import { extractPageText, loadPdfDocument, searchPdfText, type PdfTextMatch } from '@/lib/pdf/pdfDocument'
import { exportPdf } from '@/lib/pdf/pdfExport'
import {
  listProjects, saveProject, loadProject, deleteProject, bytesToBase64,
  type PdfProjectSummary,
} from '@/lib/pdf/pdfProjects'
import { deletePdfPage, mergePdfBytes, movePdfPage, rotatePdfPage, splitPdfPage } from '@/lib/pdf/pdfPageOps'
import { signPdfDocument, verifyPdfSignature } from '@/lib/pdf/pdfSigning'
import { annotationId, type PdfAnnotation, type PdfToolId } from '@/lib/pdf/annotationModel'
import { PdfToolbar } from './PdfToolbar'
import { PdfPageView } from './PdfPageView'
import { PdfProjectList } from './PdfProjectList'
import { SignatureModal } from './SignatureModal'
import { DigitalSignatureModal, type DigitalSignatureForm } from './DigitalSignatureModal'

const DEFAULT_ZOOM = 1.2
const MIN_ZOOM = 0.4
const MAX_ZOOM = 3

interface Toast {
  text: string
  ok: boolean
}

export function PdfEditorPanel() {
  const consumeFileImport = useAppStore((s) => s.consumeFileImport)
  const pendingFileImport = useAppStore((s) => s.pendingFileImport)

  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [name, setName] = useState('Untitled.pdf')
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({})
  const [tool, setTool] = useState<PdfToolId>('select')
  const [color, setColor] = useState('#e11d48')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatches, setSearchMatches] = useState<PdfTextMatch[]>([])
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [showSignature, setShowSignature] = useState(false)
  const [showDigitalSignature, setShowDigitalSignature] = useState(false)
  const [projects, setProjects] = useState<PdfProjectSummary[]>([])
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const mergeInputRef = useRef<HTMLInputElement>(null)

  const flash = useCallback((text: string, ok: boolean) => {
    setToast({ text, ok })
    window.setTimeout(() => setToast(null), 3000)
  }, [])

  const refreshProjects = useCallback(() => {
    listProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  useEffect(() => { refreshProjects() }, [refreshProjects])

  const openBytes = useCallback(
    async (raw: Uint8Array, fileName: string, opts?: {
      id?: string
      annotations?: PdfAnnotation[]
      formValues?: Record<string, string | boolean>
    }) => {
      setLoadError(null)
      try {
        const loaded = await loadPdfDocument(raw)
        setBytes(raw)
        setDoc(loaded.doc)
        setPageCount(loaded.pageCount)
        setName(fileName)
        setProjectId(opts?.id ?? annotationId())
        setAnnotations(opts?.annotations ?? [])
        setFormValues(opts?.formValues ?? {})
        setSelectedId(null)
        setCurrentPage(1)
        setSearchQuery('')
        setSearchMatches([])
        setTool('select')
        setZoom(DEFAULT_ZOOM)
      } catch (e: unknown) {
        setLoadError(e instanceof Error ? e.message : 'Could not open PDF')
      }
    },
    [],
  )

  // Consume a PDF queued from drag-drop or "Open in PDF Editor" from a response.
  useEffect(() => {
    const routed = consumeFileImport('pdf')
    if (routed && routed.kind === 'pdf') {
      void openBytes(routed.bytes, routed.name)
    }
  }, [consumeFileImport, openBytes, pendingFileImport])

  // ── File open via hidden input ──────────────────────────────────────────────
  const handleOpenFile = () => fileInputRef.current?.click()
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const buf = new Uint8Array(await file.arrayBuffer())
    void openBytes(buf, file.name)
  }

  const reopenEditedBytes = useCallback(async (
    nextBytes: Uint8Array,
    nextAnnotations = annotations,
    nextFormValues = formValues,
    nextName = name,
  ) => {
    await openBytes(nextBytes, nextName, {
      id: projectId ?? annotationId(),
      annotations: nextAnnotations,
      formValues: nextFormValues,
    })
  }, [annotations, formValues, name, openBytes, projectId])

  // ── Annotation CRUD ─────────────────────────────────────────────────────────
  const createAnnotation = useCallback((a: PdfAnnotation) => {
    setAnnotations((prev) => [...prev, a])
  }, [])

  const updateAnnotation = useCallback((a: PdfAnnotation) => {
    setAnnotations((prev) => prev.map((x) => (x.id === a.id ? a : x)))
  }, [])

  const deleteSelected = useCallback(() => {
    setSelectedId((id) => {
      if (id) setAnnotations((prev) => prev.filter((x) => x.id !== id))
      return null
    })
  }, [])

  const handleToolHandled = useCallback(() => {
    setTool((t) => (t === 'text' || t === 'signature' ? 'select' : t))
  }, [])

  const handleFormChange = useCallback((fieldName: string, value: string | boolean) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }))
  }, [])

  // Delete / Backspace removes the selected annotation (unless editing text).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, deleteSelected])

  // ── Zoom ────────────────────────────────────────────────────────────────────
  const handleZoom = useCallback((dir: 'in' | 'out' | 'reset') => {
    setZoom((z) => {
      if (dir === 'reset') return DEFAULT_ZOOM
      const next = dir === 'in' ? z + 0.2 : z - 0.2
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 10) / 10))
    })
  }, [])

  useEffect(() => {
    if (!doc || !searchQuery.trim()) {
      setSearchMatches([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchPdfText(doc, searchQuery)
        .then((matches) => {
          if (cancelled) return
          setSearchMatches(matches)
          if (matches[0]) setCurrentPage(matches[0].page)
        })
        .catch(() => { if (!cancelled) setSearchMatches([]) })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [doc, searchQuery])

  // ── Persistence ─────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!bytes || !projectId) return
    setSaving(true)
    try {
      await saveProject({
        id: projectId,
        name,
        pageCount,
        annotations,
        formValues,
        updatedAt: Date.now(),
        pdfBytes: bytes,
      })
      refreshProjects()
      flash('Project saved.', true)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Save failed', false)
    } finally {
      setSaving(false)
    }
  }, [bytes, projectId, name, pageCount, annotations, formValues, refreshProjects, flash])

  const handleOpenProject = useCallback(async (id: string) => {
    try {
      const project = await loadProject(id)
      if (!project) { flash('Project not found.', false); return }
      await openBytes(project.pdfBytes, project.name, {
        id: project.id,
        annotations: project.annotations,
        formValues: project.formValues,
      })
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Could not open project', false)
    }
  }, [openBytes, flash])

  const handleDeleteProject = useCallback(async (id: string) => {
    await deleteProject(id).catch(() => {})
    if (id === projectId) {
      setBytes(null); setDoc(null); setPageCount(0); setProjectId(null); setAnnotations([])
    }
    refreshProjects()
  }, [projectId, refreshProjects])

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!bytes) return
    setExporting(true)
    try {
      const out = await exportPdf(bytes, annotations, formValues)
      const saved = await SaveBinaryFileBase64(name.replace(/\.pdf$/i, '') + '-edited.pdf', bytesToBase64(out))
      flash(saved ? `Exported flattened PDF to ${saved}` : 'Export cancelled.', Boolean(saved))
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Export failed', false)
    } finally {
      setExporting(false)
    }
  }, [bytes, annotations, formValues, name, flash])

  const clampPage = useCallback((page: number) => {
    if (!Number.isFinite(page)) return
    setCurrentPage(Math.min(Math.max(1, Math.round(page)), Math.max(1, pageCount)))
  }, [pageCount])

  const handleRotatePage = useCallback(async () => {
    if (!bytes) return
    try {
      await reopenEditedBytes(await rotatePdfPage(bytes, currentPage, 90))
      flash(`Rotated page ${currentPage}.`, true)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Rotate failed', false)
    }
  }, [bytes, currentPage, flash, reopenEditedBytes])

  const handleDeletePage = useCallback(async () => {
    if (!bytes || pageCount <= 1) return
    try {
      const nextAnnotations = annotations
        .filter((a) => a.page !== currentPage)
        .map((a) => (a.page > currentPage ? { ...a, page: a.page - 1 } as PdfAnnotation : a))
      await reopenEditedBytes(await deletePdfPage(bytes, currentPage), nextAnnotations)
      setCurrentPage(Math.min(currentPage, pageCount - 1))
      flash(`Deleted page ${currentPage}.`, true)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Delete page failed', false)
    }
  }, [annotations, bytes, currentPage, flash, pageCount, reopenEditedBytes])

  const handleMovePage = useCallback(async () => {
    if (!bytes || pageCount <= 1) return
    const raw = window.prompt(`Move page ${currentPage} to position`, String(currentPage))
    if (!raw) return
    const toPage = Math.min(Math.max(1, Number(raw)), pageCount)
    if (!Number.isFinite(toPage) || toPage === currentPage) return
    try {
      const remap = (page: number) => {
        if (page === currentPage) return toPage
        if (currentPage < toPage && page > currentPage && page <= toPage) return page - 1
        if (currentPage > toPage && page >= toPage && page < currentPage) return page + 1
        return page
      }
      const nextAnnotations = annotations.map((a) => ({ ...a, page: remap(a.page) } as PdfAnnotation))
      await reopenEditedBytes(await movePdfPage(bytes, currentPage, toPage), nextAnnotations)
      setCurrentPage(toPage)
      flash(`Moved page ${currentPage} to ${toPage}.`, true)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Move page failed', false)
    }
  }, [annotations, bytes, currentPage, flash, pageCount, reopenEditedBytes])

  const handleSplitPage = useCallback(async () => {
    if (!bytes) return
    try {
      const out = await splitPdfPage(bytes, currentPage)
      const saved = await SaveBinaryFileBase64(name.replace(/\.pdf$/i, '') + `-page-${currentPage}.pdf`, bytesToBase64(out))
      flash(saved ? `Saved page ${currentPage} to ${saved}` : 'Split cancelled.', Boolean(saved))
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Split failed', false)
    }
  }, [bytes, currentPage, flash, name])

  const handleMergeFile = () => mergeInputRef.current?.click()

  const handleMergeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !bytes) return
    try {
      const extra = new Uint8Array(await file.arrayBuffer())
      await reopenEditedBytes(await mergePdfBytes(bytes, extra), annotations, formValues, name)
      flash(`Appended ${file.name}.`, true)
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Merge failed', false)
    }
  }

  const handleCopyPageText = useCallback(async () => {
    if (!doc) return
    try {
      const text = await extractPageText(doc, currentPage)
      await navigator.clipboard.writeText(text)
      flash(text ? `Copied text from page ${currentPage}.` : `Page ${currentPage} has no selectable text.`, Boolean(text))
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Copy text failed', false)
    }
  }, [currentPage, doc, flash])

  const handleDigitalSign = useCallback(async (form: DigitalSignatureForm) => {
    if (!bytes || !doc) return
    setExporting(true)
    try {
      const page = await doc.getPage(currentPage)
      const height = page.getViewport({ scale: 1 }).height
      const box = { x: 48, y: Math.max(24, height - 120), w: 220, h: 72 }
      const signed = await signPdfDocument(bytes, {
        ...form,
        page: currentPage,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      })
      setShowDigitalSignature(false)
      await openBytes(signed.bytes, name.replace(/\.pdf$/i, '') + '-signed.pdf')
      flash('PDF signed cryptographically.', true)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'PDF signing failed', false)
    } finally {
      setExporting(false)
    }
  }, [bytes, currentPage, doc, flash, name, openBytes])

  const handleVerifySignature = useCallback(async () => {
    if (!bytes) return
    try {
      const result = await verifyPdfSignature(bytes)
      const signers = result.Signers ?? []
      if (result.Error) {
        flash(result.Error, false)
      } else if (signers.length === 0) {
        flash('No digital signatures found.', false)
      } else {
        const valid = signers.filter((s) => s.valid_signature).length
        const trusted = signers.filter((s) => s.trusted_issuer).length
        flash(`${valid}/${signers.length} valid signatures, ${trusted}/${signers.length} trusted issuers.`, valid === signers.length)
      }
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Signature verification failed', false)
    }
  }, [bytes, flash])

  const handleApplySignature = (dataUrl: string) => {
    setSignatureImage(dataUrl)
    setShowSignature(false)
    setTool('signature')
    flash('Signature ready — click on the page to place it.', true)
  }

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1)

  return (
    <div className="flex h-full min-h-0 flex-1">
      <PdfProjectList
        projects={projects}
        activeId={projectId}
        onOpen={handleOpenProject}
        onDelete={handleDeleteProject}
        onNew={handleOpenFile}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <PdfToolbar
          hasDoc={!!doc}
          tool={tool}
          color={color}
          zoom={zoom}
          pageCount={pageCount}
          currentPage={currentPage}
          searchQuery={searchQuery}
          searchCount={searchMatches.length}
          selectedId={selectedId}
          saving={saving}
          exporting={exporting}
          onToolChange={(t) => { setTool(t); if (t === 'signature' && !signatureImage) setShowSignature(true) }}
          onColorChange={setColor}
          onZoom={handleZoom}
          onCurrentPageChange={clampPage}
          onSearchChange={setSearchQuery}
          onRotatePage={handleRotatePage}
          onDeletePage={handleDeletePage}
          onMovePage={handleMovePage}
          onSplitPage={handleSplitPage}
          onMergeFile={handleMergeFile}
          onCopyPageText={handleCopyPageText}
          onSignPdf={() => setShowDigitalSignature(true)}
          onVerifySignature={handleVerifySignature}
          onOpenFile={handleOpenFile}
          onSave={handleSave}
          onExport={handleExport}
          onDeleteSelected={deleteSelected}
        />

        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileChange} />
        <input ref={mergeInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleMergeFileChange} />

        <div className="relative min-h-0 flex-1 overflow-auto bg-surface-0 p-6">
          {loadError && (
            <div className="mx-auto mb-4 flex max-w-md items-center gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
              <AlertCircle size={15} /> {loadError}
            </div>
          )}

          {!doc ? (
            <div className="grid h-full place-items-center">
              <button
                onClick={handleOpenFile}
                className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-2 px-10 py-12 text-text-3 transition-colors hover:border-accent hover:text-text-1"
              >
                <FileUp size={32} />
                <span className="text-sm font-medium">Open a PDF to edit</span>
                <span className="text-[11px] text-text-4">or drag a .pdf file anywhere in adOmnia</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-8 pt-3">
              {pages.map((p) => (
                <PdfPageView
                  key={`${projectId}_${p}`}
                  doc={doc}
                  page={p}
                  zoom={zoom}
                  tool={tool}
                  color={color}
                  signatureImage={signatureImage}
                  annotations={annotations.filter((a) => a.page === p)}
                  selectedId={selectedId}
                  formValues={formValues}
                  active={currentPage === p}
                  onSelect={setSelectedId}
                  onActivate={setCurrentPage}
                  onCreate={createAnnotation}
                  onUpdate={updateAnnotation}
                  onFormChange={handleFormChange}
                  onToolHandled={handleToolHandled}
                  onNeedSignature={() => setShowSignature(true)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showSignature && (
        <SignatureModal onClose={() => setShowSignature(false)} onApply={handleApplySignature} />
      )}

      {showDigitalSignature && (
        <DigitalSignatureModal
          defaultName={name.replace(/\.pdf$/i, '')}
          onClose={() => setShowDigitalSignature(false)}
          onSign={(form) => void handleDigitalSign(form)}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[200] rounded-lg border px-3 py-2 text-[12px] shadow-lg ${
            toast.ok ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

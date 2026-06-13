import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { FileUp, AlertCircle } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { loadPdfDocument } from '@/lib/pdf/pdfDocument'
import { exportPdf } from '@/lib/pdf/pdfExport'
import {
  listProjects, saveProject, loadProject, deleteProject,
  type PdfProjectSummary,
} from '@/lib/pdf/pdfProjects'
import { annotationId, type PdfAnnotation, type PdfToolId } from '@/lib/pdf/annotationModel'
import { PdfToolbar } from './PdfToolbar'
import { PdfPageView } from './PdfPageView'
import { PdfProjectList } from './PdfProjectList'
import { SignatureModal } from './SignatureModal'

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
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [showSignature, setShowSignature] = useState(false)
  const [projects, setProjects] = useState<PdfProjectSummary[]>([])
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

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
      const blob = new Blob([out as unknown as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name.replace(/\.pdf$/i, '') + '-edited.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      flash('Exported flattened PDF.', true)
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Export failed', false)
    } finally {
      setExporting(false)
    }
  }, [bytes, annotations, formValues, name, flash])

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
          selectedId={selectedId}
          saving={saving}
          exporting={exporting}
          onToolChange={(t) => { setTool(t); if (t === 'signature' && !signatureImage) setShowSignature(true) }}
          onColorChange={setColor}
          onZoom={handleZoom}
          onOpenFile={handleOpenFile}
          onSave={handleSave}
          onExport={handleExport}
          onDeleteSelected={deleteSelected}
        />

        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileChange} />

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
                  onSelect={setSelectedId}
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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  BriefcaseBusiness,
  Clipboard,
  Download,
  FileCode,
  FilePlus2,
  GraduationCap,
  Maximize2,
  Minimize2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { downloadText, readFileSmart } from '@/lib/fileUtils'
import {
  LATEX_TEMPLATES,
  latexToPlainText,
  parseResumePreview,
  type LatexResumeEntry,
  type LatexTemplate,
} from '@/lib/latex/latexTemplates'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'adomnia.latex.studio.v1'

const DEFAULT_COLUMN_WIDTHS = {
  presets: 260,
  source: 560,
}

function clampWidth(width: number, min: number, maxRatio: number): number {
  return Math.max(min, Math.min(width, Math.round(window.innerWidth * maxRatio)))
}

function ResizeHandle({
  label,
  onMouseDown,
}: {
  label: string
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      className="group relative z-10 w-[5px] shrink-0 cursor-ew-resize bg-surface-0 transition-colors hover:bg-accent/20"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-1 transition-colors group-hover:bg-accent/60" />
    </div>
  )
}

interface SavedLatexState {
  templateId: string
  source: string
}

function loadInitialState(): SavedLatexState {
  const fallback = LATEX_TEMPLATES[0]
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { templateId: fallback.id, source: fallback.source }
    const parsed = JSON.parse(raw) as Partial<SavedLatexState>
    return {
      templateId: typeof parsed.templateId === 'string' ? parsed.templateId : fallback.id,
      source: typeof parsed.source === 'string' && parsed.source.trim() ? parsed.source : fallback.source,
    }
  } catch {
    return { templateId: fallback.id, source: fallback.source }
  }
}

function slugName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'adomnia-latex'
}

function entryId(entry: LatexResumeEntry, index: number): string {
  return `${entry.title}_${entry.organization}_${index}`
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text)
}

function ResumeEntryBlock({ icon: Icon, title, entries }: {
  icon: typeof BriefcaseBusiness
  title: string
  entries: LatexResumeEntry[]
}) {
  if (entries.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 border-b border-[#d9e1e8] pb-1">
        <Icon size={13} className="text-[#008c8c]" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#0f172a]">{title}</h3>
      </div>
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <article key={entryId(entry, index)} className="space-y-1">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-[13px] font-bold text-[#0f172a]">{entry.title}</h4>
                <p className="text-[11px] font-semibold text-[#008c8c]">{entry.organization}</p>
              </div>
              <div className="shrink-0 text-right text-[10px] leading-4 text-[#64748b]">
                <div>{entry.date}</div>
                <div>{entry.location}</div>
              </div>
            </div>
            <ul className="ml-4 list-disc space-y-0.5 text-[11px] leading-5 text-[#334155]">
              {entry.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  )
}

function LatexPreviewFrame({ children, zoom, onWheel }: {
  children: React.ReactNode
  zoom: number
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5" onWheel={onWheel}>
      <div
        className="mx-auto origin-top"
        style={{
          width: 700 * zoom,
          minHeight: 980 * zoom,
        }}
      >
        <div
          className="origin-top-left"
          style={{
            width: 700,
            transform: `scale(${zoom})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function ResumePreview({ source }: { source: string }) {
  const preview = useMemo(() => parseResumePreview(source), [source])
  return (
    <div className="min-h-[980px] w-[700px] bg-white p-9 text-[#0f172a] shadow-xl">
      <header className="border-b-2 border-[#00a3a3] pb-4">
        <h1 className="text-[34px] font-black leading-none tracking-normal text-[#0f172a]">{preview.name}</h1>
        <p className="mt-1 text-[16px] font-semibold text-[#008c8c]">{preview.role}</p>
        <p className="mt-3 text-[10px] text-[#475569]">
          {[preview.location, preview.email, preview.phone, preview.website].filter(Boolean).join(' | ')}
        </p>
      </header>

      <main className="mt-5 space-y-5">
        <section className="text-[12px] leading-5 text-[#334155]">{preview.summary}</section>

        {preview.skills.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 border-b border-[#d9e1e8] pb-1">
              <FileCode size={13} className="text-[#008c8c]" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#0f172a]">Skills</h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {preview.skills.map((skill) => (
                <span key={skill} className="rounded border border-[#cbd5e1] bg-[#f8fafc] px-2 py-1 text-[10px] font-semibold text-[#334155]">{skill}</span>
              ))}
            </div>
          </section>
        )}

        <ResumeEntryBlock icon={BriefcaseBusiness} title="Experience" entries={preview.experience} />
        <ResumeEntryBlock icon={BookOpen} title="Projects" entries={preview.projects} />
        <ResumeEntryBlock icon={GraduationCap} title="Education" entries={preview.education} />
      </main>
    </div>
  )
}

function PlainPreview({ source }: { source: string }) {
  const plain = useMemo(() => latexToPlainText(source), [source])
  return (
    <div className="min-h-[980px] w-[700px] bg-white p-9 text-[#0f172a] shadow-xl">
      <pre className="whitespace-pre-wrap font-sans text-[12px] leading-6 text-[#334155]">{plain || 'Empty LaTeX document.'}</pre>
    </div>
  )
}

export function LatexStudioPanel() {
  const initial = useMemo(() => loadInitialState(), [])
  const consumeFileImport = useAppStore((state) => state.consumeFileImport)
  const pendingFileImport = useAppStore((state) => state.pendingFileImport)
  const [source, setSource] = useState(initial.source)
  const [templateId, setTemplateId] = useState(initial.templateId)
  const [status, setStatus] = useState('Ready')
  const [previewZoom, setPreviewZoom] = useState(0.9)
  const [fullscreen, setFullscreen] = useState(false)
  const [columnWidths, setColumnWidths] = useState(() => ({
    presets: DEFAULT_COLUMN_WIDTHS.presets,
    source: DEFAULT_COLUMN_WIDTHS.source,
  }))
  const fileRef = useRef<HTMLInputElement>(null)
  const columnResizeRef = useRef<{ key: 'presets' | 'source'; startX: number; startWidth: number } | null>(null)

  const activeTemplate = useMemo(
    () => LATEX_TEMPLATES.find((template) => template.id === templateId) ?? LATEX_TEMPLATES[0],
    [templateId],
  )

  const saveState = (nextTemplateId = templateId, nextSource = source) => {
    safeSetItem(STORAGE_KEY, JSON.stringify({ templateId: nextTemplateId, source: nextSource }))
  }

  const applyTemplate = (template: LatexTemplate) => {
    setTemplateId(template.id)
    setSource(template.source)
    saveState(template.id, template.source)
    setStatus(`${template.name} loaded`)
  }

  const updateSource = (value: string) => {
    setSource(value)
    saveState(templateId, value)
  }

  const setClampedZoom = (value: number) => {
    setPreviewZoom(Math.max(0.45, Math.min(2.4, Number(value.toFixed(3)))))
  }

  const zoomBy = (factor: number) => setPreviewZoom((value) => Math.max(0.45, Math.min(2.4, Number((value * factor).toFixed(3)))))

  const handlePreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.001)
    setClampedZoom(previewZoom * factor)
  }

  const startColumnResize = (key: 'presets' | 'source') => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    columnResizeRef.current = { key, startX: event.clientX, startWidth: columnWidths[key] }

    const handleMove = (moveEvent: MouseEvent) => {
      const drag = columnResizeRef.current
      if (!drag) return
      const min = drag.key === 'presets' ? 190 : 320
      const maxRatio = drag.key === 'presets' ? 0.34 : 0.72
      setColumnWidths((current) => ({
        ...current,
        [drag.key]: clampWidth(drag.startWidth + moveEvent.clientX - drag.startX, min, maxRatio),
      }))
    }

    const handleUp = () => {
      columnResizeRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  const importTex = async (file: File) => {
    const { text } = await readFileSmart(file)
    setTemplateId('blank-article')
    setSource(text)
    saveState('blank-article', text)
    setStatus(`${file.name} imported`)
  }

  useEffect(() => {
    const routed = consumeFileImport('latex')
    if (routed?.kind !== 'latex') return
    setTemplateId('blank-article')
    setSource(routed.text)
    saveState('blank-article', routed.text)
    setStatus(`${routed.name} imported`)
  }, [consumeFileImport, pendingFileImport])

  const exportName = activeTemplate.filename || `${slugName(activeTemplate.name)}.tex`
  const previewContent = activeTemplate.kind === 'resume' ? <ResumePreview source={source} /> : <PlainPreview source={source} />
  const renderPreviewPane = () => (
    <LatexPreviewFrame zoom={previewZoom} onWheel={handlePreviewWheel}>
      {previewContent}
    </LatexPreviewFrame>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0 text-text-1">
      <div className="flex min-h-[52px] items-center gap-3 border-b border-border-1 bg-surface-1 px-4">
        <div className="flex items-center gap-2">
          <FileCode size={16} className="text-accent" />
          <div>
            <h2 className="text-sm font-semibold text-text-1">LaTeX Studio</h2>
            <p className="text-[11px] text-text-4">{activeTemplate.description}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => copyText(source)}
            className="grid h-8 w-8 place-items-center rounded border border-border-2 text-text-3 hover:bg-surface-2 hover:text-text-1"
            title="Copy LaTeX source"
          >
            <Clipboard size={14} />
          </button>
          <button
            type="button"
            onClick={() => downloadText(exportName, source, 'application/x-tex;charset=utf-8')}
            className="inline-flex h-8 items-center gap-2 rounded bg-accent px-3 text-[11px] font-bold text-white hover:bg-accent-hover"
            title="Download .tex"
          >
            <Download size={13} />
            Export .tex
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="grid h-8 w-8 place-items-center rounded border border-border-2 text-text-3 hover:bg-surface-2 hover:text-text-1"
            title="Fullscreen preview"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid h-8 w-8 place-items-center rounded border border-border-2 text-text-3 hover:bg-surface-2 hover:text-text-1"
            title="Import .tex"
          >
            <Upload size={14} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".tex,text/x-tex,application/x-tex,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importTex(file)
              event.currentTarget.value = ''
            }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="min-h-0 shrink-0 overflow-auto border-r border-border-1 bg-surface-1 p-3" style={{ width: columnWidths.presets }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">Presets</span>
            <FilePlus2 size={13} className="text-text-4" />
          </div>
          <div className="space-y-2">
            {LATEX_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template)}
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-left transition-colors',
                  template.id === templateId
                    ? 'border-accent/50 bg-accent/10'
                    : 'border-border-1 bg-surface-0 hover:border-border-2 hover:bg-surface-2',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-text-1">{template.name}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase text-text-4">{template.kind}</span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-text-4">{template.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-md border border-border-1 bg-surface-0 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">Compiler</div>
            <p className="mt-2 text-[11px] leading-4 text-text-3">Local engine: not configured</p>
          </div>
        </aside>

        <ResizeHandle label="Resize LaTeX presets" onMouseDown={startColumnResize('presets')} />

        <section className="flex min-h-0 shrink-0 flex-col border-r border-border-1 bg-surface-0" style={{ width: columnWidths.source }}>
          <div className="flex h-9 items-center justify-between border-b border-border-1 px-3">
            <span className="text-[11px] font-semibold text-text-2">Source</span>
            <span className="text-[10px] text-text-4">{source.length.toLocaleString()} chars</span>
          </div>
          <textarea
            value={source}
            onChange={(event) => updateSource(event.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-surface-0 p-3 font-mono text-[12px] leading-5 text-text-1 outline-none placeholder:text-text-4"
          />
          <div className="h-8 border-t border-border-1 px-3 py-2 text-[10px] text-text-4">{status}</div>
        </section>

        <ResizeHandle label="Resize LaTeX source and preview" onMouseDown={startColumnResize('source')} />

        <section className="flex min-w-[320px] min-h-0 flex-1 flex-col bg-surface-2">
          <div className="flex h-9 items-center justify-between border-b border-border-1 bg-surface-1 px-3">
            <span className="text-[11px] font-semibold text-text-2">Preview</span>
            <div className="flex items-center gap-1">
              <button onClick={() => zoomBy(1 / 1.15)} title="Zoom out" className="grid h-6 w-6 place-items-center rounded border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomOut size={12} /></button>
              <button onClick={() => setClampedZoom(0.9)} title="Reset zoom" className="h-6 min-w-12 rounded border border-border-2 bg-surface-2 px-1 text-[10px] text-text-2 hover:text-text-1">{Math.round(previewZoom * 100)}%</button>
              <button onClick={() => zoomBy(1.15)} title="Zoom in" className="grid h-6 w-6 place-items-center rounded border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomIn size={12} /></button>
              <button onClick={() => setFullscreen(true)} title="Fullscreen preview" className="grid h-6 w-6 place-items-center rounded bg-accent/10 text-accent hover:bg-accent/20"><Maximize2 size={12} /></button>
            </div>
          </div>
          {renderPreviewPane()}
        </section>
      </div>
      {fullscreen && (
        <div className="fixed inset-0 z-[220] flex flex-col bg-surface-0">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
            <FileCode size={15} className="text-accent" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">{activeTemplate.name}</div>
            <button onClick={() => zoomBy(1 / 1.15)} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomOut size={14} /></button>
            <button onClick={() => setClampedZoom(0.9)} className="h-7 min-w-14 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-2 hover:text-text-1">{Math.round(previewZoom * 100)}%</button>
            <button onClick={() => zoomBy(1.15)} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomIn size={14} /></button>
            <button onClick={() => setFullscreen(false)} title="Exit fullscreen" className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
              <Minimize2 size={14} />
            </button>
          </div>
          {renderPreviewPane()}
        </div>
      )}
    </div>
  )
}

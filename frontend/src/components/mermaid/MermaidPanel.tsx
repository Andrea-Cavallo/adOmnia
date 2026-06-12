import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import {
  Copy,
  Download,
  Expand,
  FileCode,
  FilePlus2,
  Folder,
  FolderPlus,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { cn } from '@/lib/utils'

interface MermaidDoc {
  id: string
  name: string
  folder: string
  source: string
  createdAt: string
  updatedAt: string
}

interface MermaidState {
  version: 1
  folders: string[]
  documents: MermaidDoc[]
}

const STORAGE_KEY = 'adomnia.mermaid.documents'

const SAMPLE_SOURCE = `flowchart TD
  A[Import API spec] --> B{Contract valid?}
  B -->|yes| C[Generate collection]
  B -->|no| D[Fix schema]
  D --> B
  C --> E[Run tests locally]
`

function nowIso(): string {
  return new Date().toISOString()
}

function docId(): string {
  return `mmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function defaultState(): MermaidState {
  const timestamp = nowIso()
  return {
    version: 1,
    folders: ['Workspace Diagrams'],
    documents: [{
      id: docId(),
      name: 'API import flow.mmd',
      folder: 'Workspace Diagrams',
      source: SAMPLE_SOURCE,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
  }
}

function loadState(): MermaidState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<MermaidState>
    const documents = Array.isArray(parsed.documents)
      ? parsed.documents.filter((doc): doc is MermaidDoc => Boolean(doc?.id && doc.name && typeof doc.source === 'string'))
      : []
    const folders = Array.from(new Set([
      ...(Array.isArray(parsed.folders) ? parsed.folders.filter((folder): folder is string => typeof folder === 'string' && folder.trim().length > 0) : []),
      ...documents.map((doc) => doc.folder || 'Diagrams'),
    ])).sort((a, b) => a.localeCompare(b))
    if (documents.length === 0) return defaultState()
    return { version: 1, folders: folders.length ? folders : ['Diagrams'], documents }
  } catch {
    return defaultState()
  }
}

function saveState(state: MermaidState) {
  safeSetItem(STORAGE_KEY, JSON.stringify(state))
}

function slugName(name: string, fallback = 'diagram'): string {
  const clean = name.replace(/\.(mmd|mermaid|txt)$/i, '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return clean || fallback
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadPng(filename: string, svg: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not render SVG as PNG'))
    })
    image.src = url
    await loaded
    const canvas = document.createElement('canvas')
    const scale = 2
    canvas.width = Math.max(1, image.width * scale)
    canvas.height = Math.max(1, image.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.fillStyle = '#0f1117'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = png
    a.download = filename
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function MermaidPreview({
  source,
  zoom,
  onRendered,
  className,
}: {
  source: string
  zoom: number
  onRendered: (svg: string) => void
  className?: string
}) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const renderId = useRef(`adomnia-mermaid-${docId()}`)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const trimmed = source.trim()
      if (!trimmed) {
        setSvg('')
        setError('Diagram source is empty.')
        onRendered('')
        return
      }
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          flowchart: { curve: 'basis', htmlLabels: true },
          sequence: { mirrorActors: false },
        })
        const result = await mermaid.render(`${renderId.current}-${Date.now()}`, trimmed)
        if (cancelled) return
        setSvg(result.svg)
        setError('')
        onRendered(result.svg)
      } catch (err) {
        if (cancelled) return
        setSvg('')
        onRendered('')
        setError(err instanceof Error ? err.message : 'Could not render Mermaid diagram.')
      }
    }
    void render()
    return () => { cancelled = true }
  }, [onRendered, source])

  return (
    <div className={cn('relative min-h-0 flex-1 overflow-auto bg-surface-0', className)}>
      {error ? (
        <div className="m-4 rounded-md border border-error/30 bg-error/10 p-3 font-mono text-[11px] leading-5 text-error">
          {error}
        </div>
      ) : (
        <div className="grid min-h-full min-w-full place-items-center p-10">
          <div
            className="mermaid-render origin-center text-text-1 transition-transform"
            style={{ transform: `scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  )
}

export function MermaidPanel() {
  const consumeFileImport = useAppStore((s) => s.consumeFileImport)
  const [state, setState] = useState<MermaidState>(() => loadState())
  const [activeId, setActiveId] = useState(() => loadState().documents[0]?.id ?? '')
  const [selectedFolder, setSelectedFolder] = useState(() => loadState().documents[0]?.folder ?? 'Workspace Diagrams')
  const [query, setQuery] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split')
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [lastSvg, setLastSvg] = useState('')
  const [status, setStatus] = useState('Ready')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeDoc = useMemo(
    () => state.documents.find((doc) => doc.id === activeId) ?? state.documents[0] ?? null,
    [activeId, state.documents],
  )

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    if (activeDoc && activeDoc.id !== activeId) setActiveId(activeDoc.id)
  }, [activeDoc, activeId])

  const importText = useCallback((name: string, source: string) => {
    const folder = selectedFolder || state.folders[0] || 'Imported'
    const timestamp = nowIso()
    const doc: MermaidDoc = {
      id: docId(),
      name: /\.(mmd|mermaid|txt)$/i.test(name) ? name : `${name}.mmd`,
      folder,
      source,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    setState((prev) => ({
      version: 1,
      folders: Array.from(new Set([...prev.folders, folder])).sort((a, b) => a.localeCompare(b)),
      documents: [doc, ...prev.documents],
    }))
    setActiveId(doc.id)
    setSelectedFolder(folder)
    setStatus(`Imported ${doc.name}`)
  }, [selectedFolder, state.folders])

  useEffect(() => {
    const routed = consumeFileImport('mermaid')
    if (routed?.kind === 'mermaid') importText(routed.name, routed.text)
  }, [consumeFileImport, importText])

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.documents
      .filter((doc) => doc.folder === selectedFolder)
      .filter((doc) => !q || doc.name.toLowerCase().includes(q) || doc.source.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [query, selectedFolder, state.documents])

  const updateActiveSource = (source: string) => {
    if (!activeDoc) return
    const updatedAt = nowIso()
    setState((prev) => ({
      ...prev,
      documents: prev.documents.map((doc) => doc.id === activeDoc.id ? { ...doc, source, updatedAt } : doc),
    }))
  }

  const createDiagram = () => {
    const folder = selectedFolder || state.folders[0] || 'Diagrams'
    const timestamp = nowIso()
    const doc: MermaidDoc = {
      id: docId(),
      name: 'Untitled diagram.mmd',
      folder,
      source: 'flowchart LR\n  A[Start] --> B[Next step]\n',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    setState((prev) => ({ ...prev, documents: [doc, ...prev.documents] }))
    setActiveId(doc.id)
    setStatus('Created diagram')
  }

  const createFolder = () => {
    const folder = newFolderName.trim()
    if (!folder) return
    setState((prev) => ({ ...prev, folders: Array.from(new Set([...prev.folders, folder])).sort((a, b) => a.localeCompare(b)) }))
    setSelectedFolder(folder)
    setNewFolderName('')
    setStatus(`Created folder ${folder}`)
  }

  const deleteActive = () => {
    if (!activeDoc || !window.confirm(`Delete ${activeDoc.name}?`)) return
    setState((prev) => {
      const documents = prev.documents.filter((doc) => doc.id !== activeDoc.id)
      return documents.length ? { ...prev, documents } : defaultState()
    })
    setStatus(`Deleted ${activeDoc.name}`)
  }

  const renameActive = (name: string) => {
    if (!activeDoc) return
    setState((prev) => ({
      ...prev,
      documents: prev.documents.map((doc) => doc.id === activeDoc.id ? { ...doc, name, updatedAt: nowIso() } : doc),
    }))
  }

  const handleFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      importText(file.name, await file.text())
    }
  }

  const copySource = async () => {
    if (!activeDoc) return
    await navigator.clipboard.writeText(activeDoc.source)
    setStatus('Source copied')
  }

  const zoomBy = (delta: number) => setZoom((z) => Math.max(0.25, Math.min(3, Number((z + delta).toFixed(2)))))
  const resetZoom = () => setZoom(1)

  const exportSource = () => {
    if (!activeDoc) return
    downloadText(`${slugName(activeDoc.name)}.mmd`, activeDoc.source, 'text/plain')
  }

  const exportSvg = () => {
    if (!activeDoc || !lastSvg) return
    downloadText(`${slugName(activeDoc.name)}.svg`, lastSvg, 'image/svg+xml')
  }

  const exportPng = () => {
    if (!activeDoc || !lastSvg) return
    void downloadPng(`${slugName(activeDoc.name)}.png`, lastSvg)
  }

  const preview = (
    <MermaidPreview
      source={activeDoc?.source ?? ''}
      zoom={zoom}
      onRendered={setLastSvg}
      className="rounded-none"
    />
  )

  return (
    <div className="flex min-h-0 flex-1 bg-surface-0">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mmd,.mermaid,.txt"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void handleFiles(event.target.files)
          event.currentTarget.value = ''
        }}
      />

      <aside className="flex w-72 shrink-0 flex-col border-r border-border-1 bg-surface-1">
        <div className="border-b border-border-1 p-3">
          <div className="flex items-center gap-2">
            <button onClick={createDiagram} title="New diagram" className="grid h-7 w-7 place-items-center rounded-md bg-accent text-white hover:bg-accent-hover">
              <FilePlus2 size={14} />
            </button>
            <button onClick={() => fileInputRef.current?.click()} title="Import Mermaid files" className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1">
              <Upload size={14} />
            </button>
            <div className="relative min-w-0 flex-1">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search diagrams"
                className="h-7 w-full rounded-md border border-border-2 bg-surface-2 pl-7 pr-2 text-xs text-text-1 outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') createFolder() }}
              placeholder="New folder"
              className="h-7 min-w-0 flex-1 rounded-md border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent"
            />
            <button onClick={createFolder} title="Create folder" className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1">
              <FolderPlus size={14} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {state.folders.map((folder) => {
            const docs = state.documents.filter((doc) => doc.folder === folder)
            const active = selectedFolder === folder
            return (
              <div key={folder} className="mb-1">
                <button
                  onClick={() => setSelectedFolder(folder)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                    active ? 'bg-accent/10 text-text-1' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
                  )}
                >
                  <Folder size={13} className="text-accent" />
                  <span className="min-w-0 flex-1 truncate">{folder}</span>
                  <span className="text-[10px] text-text-4">{docs.length}</span>
                </button>
                {active && (
                  <div className="mt-1 space-y-0.5 pl-3">
                    {filteredDocs.length === 0 ? (
                      <div className="px-2 py-3 text-[11px] text-text-4">No diagrams in this folder.</div>
                    ) : filteredDocs.map((doc) => (
                      <button
                        key={doc.id}
                        onClick={() => setActiveId(doc.id)}
                        className={cn(
                          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                          activeDoc?.id === doc.id ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
                        )}
                      >
                        <FileCode size={13} />
                        <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
          <input
            value={activeDoc?.name ?? ''}
            disabled={!activeDoc}
            onChange={(event) => renameActive(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-text-1 outline-none hover:border-border-2 hover:bg-surface-2 focus:border-accent focus:bg-surface-2 disabled:opacity-50"
          />
          <div className="flex rounded-md border border-border-2 bg-surface-2 p-0.5">
            {(['split', 'edit', 'preview'] as const).map((nextMode) => (
              <button
                key={nextMode}
                onClick={() => setMode(nextMode)}
                className={cn('h-6 rounded px-2 text-[11px] capitalize', mode === nextMode ? 'bg-surface-4 text-text-1' : 'text-text-3 hover:text-text-1')}
              >
                {nextMode}
              </button>
            ))}
          </div>
          <button onClick={copySource} title="Copy source" className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
            <Copy size={14} />
          </button>
          <button onClick={exportSource} title="Export .mmd" className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
            <Download size={14} />
          </button>
          <button onClick={deleteActive} title="Delete diagram" className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-error/10 hover:text-error">
            <Trash2 size={14} />
          </button>
        </div>

        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-0 px-3">
          <button onClick={() => zoomBy(-0.1)} title="Zoom out" className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1">
            <ZoomOut size={14} />
          </button>
          <button onClick={resetZoom} title="Reset zoom" className="h-7 min-w-14 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-2 hover:text-text-1">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => zoomBy(0.1)} title="Zoom in" className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setZoom(0.75)} title="Fit overview" className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1">
            <RefreshCw size={13} />
          </button>
          <div className="h-5 w-px bg-border-1" />
          <button onClick={exportSvg} disabled={!lastSvg} className="h-7 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-3 hover:text-text-1 disabled:opacity-40">
            SVG
          </button>
          <button onClick={exportPng} disabled={!lastSvg} className="h-7 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-3 hover:text-text-1 disabled:opacity-40">
            PNG
          </button>
          <div className="min-w-0 flex-1 truncate text-[11px] text-text-4">{status}</div>
          <button onClick={() => setFullscreen(true)} title="Fullscreen preview" className="grid h-7 w-7 place-items-center rounded-md bg-accent/10 text-accent hover:bg-accent/20">
            <Maximize2 size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {mode === 'edit' ? (
            <textarea
              value={activeDoc?.source ?? ''}
              onChange={(event) => updateActiveSource(event.target.value)}
              spellCheck={false}
              className="h-full w-full resize-none bg-surface-0 p-4 font-mono text-[12px] leading-5 text-text-1 outline-none"
            />
          ) : mode === 'preview' ? (
            preview
          ) : (
            <div className="grid h-full min-h-0 grid-cols-[minmax(320px,42%)_1fr]">
              <textarea
                value={activeDoc?.source ?? ''}
                onChange={(event) => updateActiveSource(event.target.value)}
                spellCheck={false}
                className="h-full resize-none border-r border-border-1 bg-surface-0 p-4 font-mono text-[12px] leading-5 text-text-1 outline-none"
              />
              {preview}
            </div>
          )}
        </div>
      </section>

      {fullscreen && (
        <div className="fixed inset-0 z-[220] flex flex-col bg-surface-0">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
            <Expand size={15} className="text-accent" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">{activeDoc?.name ?? 'Mermaid preview'}</div>
            <button onClick={() => zoomBy(-0.1)} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomOut size={14} /></button>
            <button onClick={resetZoom} className="h-7 min-w-14 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-2 hover:text-text-1">{Math.round(zoom * 100)}%</button>
            <button onClick={() => zoomBy(0.1)} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomIn size={14} /></button>
            <button onClick={() => setFullscreen(false)} title="Exit fullscreen" className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
              <Minimize2 size={14} />
            </button>
          </div>
          {preview}
        </div>
      )}
    </div>
  )
}

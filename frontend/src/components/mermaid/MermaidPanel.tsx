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
  GitBranch,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { flattenApiCatalog } from '@/lib/apiCatalog'
import { graphFromMermaid } from '@/lib/flowMermaid'
import { loadFlowDefinitions, saveFlowDefinitions, type SavedFlowDefinition } from '@/lib/flowStorage'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { uid } from '@/lib/types'
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

interface NodeStylePreset {
  label: string
  fill: string
  stroke: string
  color: string
}

const STORAGE_KEY = 'adomnia.mermaid.documents'

const DEFAULT_MERMAID_SOURCE_WIDTH = 520

function clampMermaidWidth(width: number): number {
  return Math.max(320, Math.min(width, Math.round(window.innerWidth * 0.72)))
}

function MermaidResizeHandle({
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

const NODE_STYLE_PRESETS: NodeStylePreset[] = [
  { label: 'White', fill: '#ffffff', stroke: '#334155', color: '#111827' },
  { label: 'Blue', fill: '#dbeafe', stroke: '#2563eb', color: '#0f172a' },
  { label: 'Green', fill: '#dcfce7', stroke: '#16a34a', color: '#052e16' },
  { label: 'Amber', fill: '#fef3c7', stroke: '#d97706', color: '#422006' },
  { label: 'Rose', fill: '#ffe4e6', stroke: '#e11d48', color: '#4c0519' },
  { label: 'Violet', fill: '#ede9fe', stroke: '#7c3aed', color: '#2e1065' },
  { label: 'Slate', fill: '#e2e8f0', stroke: '#475569', color: '#0f172a' },
  { label: 'Critical', fill: '#fee2e2', stroke: '#dc2626', color: '#450a0a' },
]

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

function flowNameFromDiagram(name: string) {
  return slugName(name, 'Mermaid API flow').replace(/[-_]+/g, ' ')
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

function readSvgSize(svgNode: SVGSVGElement | null, fallback = { width: 960, height: 640 }) {
  if (!svgNode) return fallback

  const viewBox = svgNode.getAttribute('viewBox')?.trim().split(/\s+/).map(Number)
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: Math.ceil(viewBox[2]), height: Math.ceil(viewBox[3]) }
  }

  const width = Number.parseFloat(svgNode.getAttribute('width') || '')
  const height = Number.parseFloat(svgNode.getAttribute('height') || '')
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width: Math.ceil(width), height: Math.ceil(height) }
  }

  return fallback
}

function prepareMermaidSvg(rawSvg: string) {
  const doc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml')
  const svgNode = doc.querySelector('svg')
  if (!svgNode) return { svg: rawSvg, size: { width: 960, height: 640 } }

  const size = readSvgSize(svgNode as SVGSVGElement)
  svgNode.setAttribute('width', String(size.width))
  svgNode.setAttribute('height', String(size.height))
  svgNode.setAttribute('style', 'max-width:none;width:auto;height:auto;background:#ffffff;')
  svgNode.style.maxWidth = 'none'
  svgNode.style.background = '#ffffff'
  return { svg: new XMLSerializer().serializeToString(svgNode), size }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function styleDirective(nodeId: string, style: NodeStylePreset) {
  return `style ${nodeId} fill:${style.fill},stroke:${style.stroke},color:${style.color}`
}

function upsertNodeStyle(source: string, nodeId: string, style: NodeStylePreset) {
  const lines = source.split(/\r?\n/)
  const nextDirective = styleDirective(nodeId, style)
  const existing = new RegExp(`^\\s*style\\s+${escapeRegExp(nodeId)}\\s+`)
  let replaced = false
  const nextLines = lines.map((line) => {
    if (!existing.test(line)) return line
    replaced = true
    const indent = line.match(/^\s*/)?.[0] ?? ''
    return `${indent}${nextDirective}`
  })
  if (!replaced) {
    let insertAt = nextLines.length
    for (let index = nextLines.length - 1; index >= 0; index -= 1) {
      if (nextLines[index].trim().length > 0) {
        insertAt = index + 1
        break
      }
    }
    nextLines.splice(insertAt, 0, nextDirective)
  }
  return nextLines.join('\n')
}

function replaceNodeLabel(source: string, nodeId: string, label: string) {
  const escapedId = escapeRegExp(nodeId)
  const escapedLabel = label.replace(/"/g, '\\"')
  const nodePattern = new RegExp(`(^|[\\s;])(${escapedId})(\\s*)(\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\})`)
  const lines = source.split(/\r?\n/)
  let replaced = false
  const nextLines = lines.map((line) => {
    if (replaced || /^\s*(style|class|classDef|linkStyle)\b/.test(line)) return line
    if (!nodePattern.test(line)) return line
    replaced = true
    return line.replace(nodePattern, (_match, prefix, id, gap, shape) => {
      const open = String(shape)[0]
      const close = String(shape).slice(-1)
      return `${prefix}${id}${gap}${open}"${escapedLabel}"${close}`
    })
  })
  return replaced ? nextLines.join('\n') : source
}

function findSvgNodeElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('.node') as HTMLElement | null
}

function nodeIdFromSvgElement(element: HTMLElement | null): string | null {
  const rawId = element?.id || element?.getAttribute('data-id') || ''
  if (!rawId) return null
  const mermaidNode = rawId.match(/(?:^|-)(?:flowchart|graph|stateDiagram|classDiagram)-(.+?)(?:-\d+)?$/)?.[1]
  const withoutPrefix = mermaidNode || rawId.replace(/^(flowchart|graph|stateDiagram|classDiagram)-/, '')
  return withoutPrefix.replace(/-\d+$/, '').replace(/^node-/, '') || null
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
  onZoomChange,
  onStyleNode,
  onRenameNode,
  onRendered,
  className,
}: {
  source: string
  zoom: number
  onZoomChange: (zoom: number) => void
  onStyleNode: (nodeId: string, style: NodeStylePreset) => void
  onRenameNode: (nodeId: string) => void
  onRendered: (svg: string) => void
  className?: string
}) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [styleMenu, setStyleMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [naturalSize, setNaturalSize] = useState({ width: 960, height: 640 })
  const [isPanning, setIsPanning] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const renderRef = useRef<HTMLDivElement>(null)
  const panRef = useRef({ pointerId: 0, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 })
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
          theme: 'base',
          securityLevel: 'loose',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          themeVariables: {
            background: '#ffffff',
            mainBkg: '#ffffff',
            primaryColor: '#ffffff',
            primaryTextColor: '#111827',
            primaryBorderColor: '#334155',
            lineColor: '#334155',
            secondaryColor: '#f8fafc',
            tertiaryColor: '#eef2ff',
            clusterBkg: '#f8fafc',
            clusterBorder: '#cbd5e1',
            edgeLabelBackground: '#ffffff',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            darkMode: false,
          },
          flowchart: { curve: 'basis', htmlLabels: true },
          sequence: { mirrorActors: false },
        })
        const result = await mermaid.render(`${renderId.current}-${Date.now()}`, trimmed)
        if (cancelled) return
        const prepared = prepareMermaidSvg(result.svg)
        setSvg(prepared.svg)
        setStyleMenu(null)
        setNaturalSize(prepared.size)
        setError('')
        onRendered(prepared.svg)
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

  useEffect(() => {
    const target = renderRef.current
    if (!target) return

    const svgNode = target.querySelector('svg') as SVGSVGElement | null
    setNaturalSize((current) => readSvgSize(svgNode, current))
  }, [svg])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (error || !svg) return
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()

    const viewport = viewportRef.current
    if (!viewport) return

    const rect = viewport.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const contentX = (viewport.scrollLeft + pointerX) / zoom
    const contentY = (viewport.scrollTop + pointerY) / zoom
    const factor = Math.exp(-event.deltaY * 0.001)
    const nextZoom = Math.max(0.1, Math.min(10, Number((zoom * factor).toFixed(3))))

    if (nextZoom === zoom) return
    onZoomChange(nextZoom)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = (contentX * nextZoom) - pointerX
      viewport.scrollTop = (contentY * nextZoom) - pointerY
    })
  }, [error, onZoomChange, svg, zoom])

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const node = findSvgNodeElement(event.target)
    const nodeId = nodeIdFromSvgElement(node)
    if (!nodeId) return
    event.preventDefault()
    event.stopPropagation()
    setStyleMenu({ nodeId, x: event.clientX, y: event.clientY })
  }, [])

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const node = findSvgNodeElement(event.target)
    const nodeId = nodeIdFromSvgElement(node)
    if (!nodeId) return
    event.preventDefault()
    event.stopPropagation()
    onRenameNode(nodeId)
  }, [onRenameNode])

  const startPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || error || !svg) return
    const viewport = viewportRef.current
    if (!viewport) return
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    viewport.setPointerCapture(event.pointerId)
    setStyleMenu(null)
    setIsPanning(true)
  }, [error, svg])

  const movePan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning) return
    const viewport = viewportRef.current
    if (!viewport || event.pointerId !== panRef.current.pointerId) return
    viewport.scrollLeft = panRef.current.scrollLeft - (event.clientX - panRef.current.startX)
    viewport.scrollTop = panRef.current.scrollTop - (event.clientY - panRef.current.startY)
  }, [isPanning])

  const stopPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId)
    }
    setIsPanning(false)
  }, [])

  return (
    <div
      ref={viewportRef}
      onWheel={handleWheel}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'relative min-h-0 flex-1 overflow-auto bg-white overscroll-contain',
        svg && !error ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : '',
        className,
      )}
    >
      {error ? (
        <div className="m-4 rounded-md border border-error/30 bg-error/10 p-3 font-mono text-[11px] leading-5 text-error">
          {error}
        </div>
      ) : (
        <div
          className="grid min-h-full min-w-full place-items-center p-10"
          style={{
            width: Math.ceil(naturalSize.width * zoom) + 80,
            height: Math.ceil(naturalSize.height * zoom) + 80,
          }}
        >
          <div style={{ width: naturalSize.width * zoom, height: naturalSize.height * zoom }}>
            <div
              ref={renderRef}
              className="mermaid-render origin-top-left select-none text-slate-950"
              style={{
                transform: `scale(${zoom})`,
                width: naturalSize.width,
                height: naturalSize.height,
                color: '#111827',
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
      {styleMenu && (
        <div
          className="fixed z-[260] w-52 rounded-md border border-border-1 bg-surface-1 p-2 shadow-xl"
          style={{ left: styleMenu.x, top: styleMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-text-1">{styleMenu.nodeId}</span>
            <button
              className="rounded px-1.5 py-0.5 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1"
              onClick={() => setStyleMenu(null)}
            >
              close
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {NODE_STYLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                title={preset.label}
                className="h-8 rounded border border-border-2 transition-transform hover:scale-105"
                style={{ backgroundColor: preset.fill, borderColor: preset.stroke, color: preset.color }}
                onClick={() => {
                  onStyleNode(styleMenu.nodeId, preset)
                  setStyleMenu(null)
                }}
              >
                Aa
              </button>
            ))}
          </div>
          <button
            className="mt-2 h-7 w-full rounded-md border border-border-2 bg-surface-2 text-[11px] text-text-2 hover:text-text-1"
            onClick={() => {
              onRenameNode(styleMenu.nodeId)
              setStyleMenu(null)
            }}
          >
            Rename label
          </button>
        </div>
      )}
    </div>
  )
}

export function MermaidPanel() {
  const consumeFileImport = useAppStore((s) => s.consumeFileImport)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const collections = useCollectionsStore((s) => s.collections)
  const [state, setState] = useState<MermaidState>(() => loadState())
  const [activeId, setActiveId] = useState(() => loadState().documents[0]?.id ?? '')
  const [selectedFolder, setSelectedFolder] = useState(() => loadState().documents[0]?.folder ?? 'Workspace Diagrams')
  const [query, setQuery] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split')
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [sourceWidth, setSourceWidth] = useState(DEFAULT_MERMAID_SOURCE_WIDTH)
  const [lastSvg, setLastSvg] = useState('')
  const [status, setStatus] = useState('Ready')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const splitResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const activeDoc = useMemo(
    () => state.documents.find((doc) => doc.id === activeId) ?? state.documents[0] ?? null,
    [activeId, state.documents],
  )
  const apiCatalog = useMemo(() => flattenApiCatalog(collections), [collections])
  const flowPreview = useMemo(() => {
    if (!activeDoc?.source.trim()) return { graph: null, requestCount: 0, mappedCount: 0 }
    const graph = graphFromMermaid(activeDoc.source, apiCatalog)
    const requestNodes = graph.nodes.filter((node) => node.type === 'request')
    const mappedCount = requestNodes.filter((node) => Boolean(node.config.request?.url.trim())).length
    return { graph, requestCount: requestNodes.length, mappedCount }
  }, [activeDoc?.source, apiCatalog])

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

  const setClampedZoom = (nextZoom: number) => setZoom(Math.max(0.1, Math.min(10, Number(nextZoom.toFixed(3)))))
  const zoomBy = (factor: number) => setZoom((z) => Math.max(0.1, Math.min(10, Number((z * factor).toFixed(3)))))
  const resetZoom = () => setZoom(1)

  const startSplitResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    splitResizeRef.current = { startX: event.clientX, startWidth: sourceWidth }

    const handleMove = (moveEvent: MouseEvent) => {
      const drag = splitResizeRef.current
      if (!drag) return
      setSourceWidth(clampMermaidWidth(drag.startWidth + moveEvent.clientX - drag.startX))
    }

    const handleUp = () => {
      splitResizeRef.current = null
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

  const styleNode = useCallback((nodeId: string, style: NodeStylePreset) => {
    if (!activeDoc) return
    updateActiveSource(upsertNodeStyle(activeDoc.source, nodeId, style))
    setStatus(`Styled node ${nodeId}`)
  }, [activeDoc])

  const renameNode = useCallback((nodeId: string) => {
    if (!activeDoc) return
    const label = window.prompt(`Rename Mermaid node ${nodeId}`, nodeId)
    if (label == null) return
    const nextLabel = label.trim()
    if (!nextLabel) return
    const nextSource = replaceNodeLabel(activeDoc.source, nodeId, nextLabel)
    if (nextSource === activeDoc.source) {
      setStatus(`Could not find an inline label for node ${nodeId}`)
      return
    }
    updateActiveSource(nextSource)
    setStatus(`Renamed node ${nodeId}`)
  }, [activeDoc])

  const sendToApiFlows = useCallback(async () => {
    if (!activeDoc || !flowPreview.graph) return
    const id = uid()
    const saved: SavedFlowDefinition = {
      id,
      name: flowNameFromDiagram(activeDoc.name),
      graph: flowPreview.graph,
      mermaidSource: activeDoc.source,
      updatedAt: new Date().toISOString(),
      version: 3,
    }
    const flows = await loadFlowDefinitions()
    await saveFlowDefinitions([saved, ...flows.filter((flow) => flow.id !== id)])
    setStatus(`Sent to API Flows: ${saved.name}`)
    setActiveRail('flows')
  }, [activeDoc, flowPreview.graph, setActiveRail])

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
      onZoomChange={setClampedZoom}
      onStyleNode={styleNode}
      onRenameNode={renameNode}
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
          <button
            onClick={() => void sendToApiFlows()}
            disabled={!activeDoc || !flowPreview.graph || flowPreview.requestCount === 0}
            title="Send this Mermaid diagram to API Flows"
            className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <GitBranch size={13} />
            API Flows
          </button>
          <div className="hidden h-7 items-center gap-1.5 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-3 md:flex">
            <Play size={12} className={flowPreview.requestCount > 0 && flowPreview.mappedCount === flowPreview.requestCount ? 'text-success' : 'text-warning'} />
            <span>{flowPreview.mappedCount}/{flowPreview.requestCount} API mapped</span>
          </div>
          <div className="h-5 w-px bg-border-1" />
          <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out" className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1">
            <ZoomOut size={14} />
          </button>
          <button onClick={resetZoom} title="Reset zoom" className="h-7 min-w-14 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-2 hover:text-text-1">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => zoomBy(1.25)} title="Zoom in" className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1">
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
            <div className="flex h-full min-h-0 overflow-hidden">
              <textarea
                value={activeDoc?.source ?? ''}
                onChange={(event) => updateActiveSource(event.target.value)}
                spellCheck={false}
                className="h-full shrink-0 resize-none border-r border-border-1 bg-surface-0 p-4 font-mono text-[12px] leading-5 text-text-1 outline-none"
                style={{ width: sourceWidth }}
              />
              <MermaidResizeHandle label="Resize Mermaid source and preview" onMouseDown={startSplitResize} />
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
            <button onClick={() => zoomBy(1 / 1.25)} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomOut size={14} /></button>
            <button onClick={resetZoom} className="h-7 min-w-14 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-2 hover:text-text-1">{Math.round(zoom * 100)}%</button>
            <button onClick={() => zoomBy(1.25)} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-3 hover:text-text-1"><ZoomIn size={14} /></button>
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

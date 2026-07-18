import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Code2, Copy, FileText, Maximize2, Minimize2, Search, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiDocModel } from '@/lib/apidocs/parseSpec'
import { OperationCard } from './OperationCard'

interface ApiDocsViewerProps {
  model: ApiDocModel
  rawSpec: string
  onRawSpecChange: (rawSpec: string) => void
}

type ViewerMode = 'split' | 'editor' | 'preview'

export function ApiDocsViewer({ model, rawSpec, onRawSpecChange }: ApiDocsViewerProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<ViewerMode>('split')
  const [editorPercent, setEditorPercent] = useState(49)
  const [copied, setCopied] = useState(false)

  const tags = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return model.tags
    return model.tags
      .map((tag) => ({
        ...tag,
        operations: tag.operations.filter(
          (op) =>
            op.path.toLowerCase().includes(q) ||
            op.method.toLowerCase().includes(q) ||
            (op.summary ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((tag) => tag.operations.length > 0)
  }, [model.tags, query])

  const copySpec = async () => {
    await navigator.clipboard.writeText(rawSpec)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const nudgeSplit = (delta: number) => {
    setMode('split')
    setEditorPercent((value) => Math.min(70, Math.max(30, value + delta)))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-0">
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-[#0c2a38] bg-[#143a4a] px-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#85ea2d] text-[11px] font-black text-[#17313d]">{'{ }'}</div>
          <span className="text-[14px] font-semibold">Swagger Editor</span>
        </div>
        <button className="text-[12px] font-semibold hover:text-[#85ea2d]">File</button>
        <button className="text-[12px] font-semibold hover:text-[#85ea2d]">Edit</button>
        <button className="text-[12px] font-semibold hover:text-[#85ea2d]">About</button>
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton active={mode === 'editor'} onClick={() => setMode('editor')} title="Show editor only">
            <Code2 size={13} /> Editor
          </ToolbarButton>
          <ToolbarButton active={mode === 'split'} onClick={() => setMode('split')} title="Show editor and preview">
            <FileText size={13} /> Editor + Preview
          </ToolbarButton>
          <ToolbarButton active={mode === 'preview'} onClick={() => setMode('preview')} title="Maximize preview">
            {mode === 'preview' ? <Minimize2 size={13} /> : <Maximize2 size={13} />} Preview
          </ToolbarButton>
          <button
            onClick={() => nudgeSplit(-8)}
            className="flex h-7 w-7 items-center justify-center rounded border border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
            title="Move divider left"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => nudgeSplit(8)}
            className="flex h-7 w-7 items-center justify-center rounded border border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
            title="Move divider right"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => void copySpec()}
            className="ml-1 flex h-7 items-center gap-1 rounded border border-[#2aa6df] px-2 text-[11px] font-semibold text-white hover:bg-[#2aa6df]/20"
            title="Copy loaded YAML or JSON document"
          >
            <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1"
        style={mode === 'split' ? { gridTemplateColumns: `${editorPercent}% 6px minmax(0, 1fr)` } : undefined}
      >
        {(mode === 'split' || mode === 'editor') && (
          <SpecEditorPane rawSpec={rawSpec} onRawSpecChange={onRawSpecChange} />
        )}
        {mode === 'split' && <Divider />}
        {(mode === 'split' || mode === 'preview') && (
          <ReferencePane
            model={model}
            tags={tags}
            query={query}
            setQuery={setQuery}
          />
        )}
      </div>
    </div>
  )
}

function ReferencePane({
  model,
  tags,
  query,
  setQuery,
}: {
  model: ApiDocModel
  tags: ApiDocModel['tags']
  query: string
  setQuery: (value: string) => void
}) {
  return (
    <div className="min-w-0 overflow-y-auto bg-surface-0">
      <header className="border-b border-border-1 bg-surface-0 px-8 py-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-semibold leading-tight text-text-1">{model.title} {model.version && model.version}</h1>
            {model.description && (
              <p className="mt-4 max-w-3xl whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{model.description}</p>
            )}
          </div>
          <span className="shrink-0 rounded border border-border-2 bg-surface-1 px-2 py-1 text-[11px] text-text-3">{model.operationCount} operations</span>
        </div>
        {model.servers.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 text-[18px] font-medium text-text-1">
              <Server size={16} className="text-text-4" /> Servers
            </div>
            <div className="flex flex-wrap gap-2">
              {model.servers.map((server) => (
                <span key={server} className="rounded border border-border-2 bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-2">{server}</span>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="sticky top-0 z-10 border-b border-border-1 bg-surface-0/95 px-8 py-2 backdrop-blur">
        <div className="flex h-8 max-w-xl items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-2">
          <Search size={13} className="text-text-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter operations by path, method, or summary..."
            className="h-full flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-4"
          />
        </div>
      </div>

      <div className="space-y-8 px-8 py-6">
        {tags.map((tag) => (
          <section key={tag.name} id={`apidoc-tag-${tag.name}`} className="scroll-mt-16">
            <div className="mb-3">
              <h2 className="text-[20px] font-medium text-text-1">{tag.name}</h2>
              {tag.description && <p className="mt-1 text-[12px] text-text-3">{tag.description}</p>}
            </div>
            <div className="space-y-2">
              {tag.operations.map((op) => (
                <OperationCard key={`${op.method}_${op.path}`} operation={op} registry={model.schemaRegistry} />
              ))}
            </div>
          </section>
        ))}
        {tags.length === 0 && (
          <p className="py-10 text-center text-[12px] text-text-4">No operations match "{query}".</p>
        )}
      </div>
    </div>
  )
}

function SpecEditorPane({ rawSpec, onRawSpecChange }: { rawSpec: string; onRawSpecChange: (rawSpec: string) => void }) {
  const lineRef = useRef<HTMLDivElement>(null)
  const lineCount = rawSpec ? rawSpec.split(/\r?\n/).length : 1
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-[#1f232b]">
      <div className="flex h-7 shrink-0 items-center justify-end gap-2 border-b border-[#111820] bg-[#f7f7f7] px-3 text-[#1b2733]">
        <span className="rounded border border-[#d7dde3] px-1.5 py-0.5 text-[10px] font-semibold">YAML / JSON</span>
        <span className="text-[10px]">{lineCount} lines</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[54px_minmax(0,1fr)] overflow-hidden">
        <div
          ref={lineRef}
          className="select-none overflow-hidden border-r border-[#303640] bg-[#252a33] px-2 py-2 text-right font-mono text-[12px] leading-[21px] text-[#7c8797]"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <textarea
          value={rawSpec}
          onChange={(event) => onRawSpecChange(event.target.value)}
          onScroll={(event) => {
            if (lineRef.current) lineRef.current.scrollTop = event.currentTarget.scrollTop
          }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none overflow-auto border-0 bg-[#1f232b] p-2 font-mono text-[12px] leading-[21px] text-[#f3f7ff] outline-none selection:bg-[#2aa6df]/40"
        />
      </div>
    </section>
  )
}

function Divider() {
  return (
    <div className="hidden cursor-col-resize border-x border-[#d1d7de] bg-[#e8edf2] xl:block" title="Use the toolbar arrows to move this divider" />
  )
}

function ToolbarButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-semibold',
        active ? 'border-[#2aa6df] bg-[#2aa6df]/20 text-white' : 'border-white/20 text-white/80 hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
    </button>
  )
}

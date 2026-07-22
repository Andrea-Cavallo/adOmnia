import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Code2, Columns2, ExternalLink, FileText, Loader2, Search, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { openExternal } from '@/lib/openExternal'
import type { ApiDocModel, ApiDocOperation } from '@/lib/apidocs/parseSpec'
import type { SpecLanguage, SpecParseError } from '@/lib/apidocs/editorSupport'
import { OperationCard } from './OperationCard'
import { InlineMarkdown, MiniMarkdown } from './MiniMarkdown'

function oasBadge(oasVersion: string): string | null {
  if (!oasVersion) return null
  if (oasVersion.startsWith('2')) return 'Swagger 2.0'
  const parts = oasVersion.split('.')
  return `OAS ${parts[0]}.${parts[1] ?? '0'}`
}

const SpecEditor = lazy(() => import('./SpecEditor').then((m) => ({ default: m.SpecEditor })))

interface ApiDocsViewerProps {
  model: ApiDocModel | null
  rawSpec: string
  language: SpecLanguage
  error: SpecParseError | null
  onRawSpecChange: (rawSpec: string) => void
  onTryOperation?: (operation: ApiDocOperation) => void
}

type ViewerMode = 'split' | 'editor' | 'preview'

export function ApiDocsViewer({ model, rawSpec, language, error, onRawSpecChange, onTryOperation }: ApiDocsViewerProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<ViewerMode>('split')
  const [editorPercent, setEditorPercent] = useState(50)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const containerRef = useRef<HTMLDivElement>(null)

  const tags = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!model) return []
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
  }, [model, query])

  const startResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (moveEvent: MouseEvent) => {
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100
      setEditorPercent(Math.min(75, Math.max(25, pct)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const markers = error?.line ? [{ line: error.line, column: error.column, message: error.message }] : []

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-0">
      <div
        ref={containerRef}
        className="grid min-h-0 flex-1"
        style={mode === 'split' ? { gridTemplateColumns: `${editorPercent}% auto minmax(0, 1fr)` } : undefined}
      >
        {(mode === 'split' || mode === 'editor') && (
          <section className="flex min-h-0 min-w-0 flex-col border-r border-border-1 bg-surface-0">
            <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
              <Code2 size={12} className="text-accent" />
              <span className="rounded border border-border-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-3">{language}</span>
              <div className="ml-auto flex items-center gap-1">
                <LayoutButton active={mode === 'editor'} onClick={() => setMode('editor')} title="Editor only"><Code2 size={12} /></LayoutButton>
                <LayoutButton active={mode === 'split'} onClick={() => setMode('split')} title="Editor + preview"><Columns2 size={12} /></LayoutButton>
                <LayoutButton active={false} onClick={() => setMode('preview')} title="Preview only"><FileText size={12} /></LayoutButton>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={<EditorLoading />}>
                <SpecEditor
                  value={rawSpec}
                  language={language}
                  markers={markers}
                  onChange={onRawSpecChange}
                  onCursor={(line, column) => setCursor({ line, column })}
                />
              </Suspense>
            </div>
          </section>
        )}

        {mode === 'split' && <ResizeHandle label="Resize editor and preview" onMouseDown={startResize} withLine={false} />}

        {(mode === 'split' || mode === 'preview') && (
          <ReferencePane
            model={model}
            tags={tags}
            query={query}
            setQuery={setQuery}
            onTryOperation={onTryOperation}
            mode={mode}
            setMode={setMode}
          />
        )}
      </div>

      <StatusBar language={language} cursor={cursor} model={model} error={error} />
    </div>
  )
}

function StatusBar({
  language,
  cursor,
  model,
  error,
}: {
  language: SpecLanguage
  cursor: { line: number; column: number }
  model: ApiDocModel | null
  error: SpecParseError | null
}) {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border-1 bg-surface-1 px-3 text-[10px] text-text-4">
      <span className="font-mono">Ln {cursor.line}, Col {cursor.column}</span>
      <span className="uppercase">{language}</span>
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        {error ? (
          <span className="flex min-w-0 items-center gap-1 text-error" title={error.message}>
            <AlertCircle size={11} className="shrink-0" />
            <span className="truncate">{error.line ? `Line ${error.line}: ` : ''}{error.message}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 size={11} /> Valid · {model?.operationCount ?? 0} operations
          </span>
        )}
      </div>
    </div>
  )
}

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-0 text-text-4">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}

function ReferencePane({
  model,
  tags,
  query,
  setQuery,
  onTryOperation,
  mode,
  setMode,
}: {
  model: ApiDocModel | null
  tags: ApiDocModel['tags']
  query: string
  setQuery: (value: string) => void
  onTryOperation?: (operation: ApiDocOperation) => void
  mode: ViewerMode
  setMode: (mode: ViewerMode) => void
}) {
  if (!model) {
    return (
      <div className="flex min-w-0 items-center justify-center bg-surface-0 p-8 text-center text-[12px] text-text-4">
        Start typing a valid OpenAPI document to see the live documentation here.
      </div>
    )
  }
  return (
    <div className="min-w-0 overflow-y-auto bg-surface-0">
      <header className="border-b border-border-1 bg-surface-1/60 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold leading-tight text-text-1">{model.title}</h1>
              {model.version && <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent">v{model.version}</span>}
              {oasBadge(model.oasVersion) && (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">{oasBadge(model.oasVersion)}</span>
              )}
            </div>
            {model.description && (
              <MiniMarkdown text={model.description} className="mt-2 max-w-3xl text-[12px] leading-relaxed text-text-3" />
            )}
          </div>
          {mode === 'preview' && (
            <button
              onClick={() => setMode('split')}
              className="shrink-0 rounded border border-border-2 px-2 py-1 text-[10px] text-text-3 hover:text-text-1"
            >
              Show editor
            </button>
          )}
        </div>
        {model.servers.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-4">
              <Server size={12} /> Servers
            </div>
            <div className="flex flex-wrap gap-1.5">
              {model.servers.map((server) => (
                <span key={server} className="rounded border border-border-2 bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-2">{server}</span>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="sticky top-0 z-10 border-b border-border-1 bg-surface-0/95 px-6 py-2 backdrop-blur">
        <div className="flex h-8 max-w-xl items-center gap-2 rounded border border-border-2 bg-surface-1 px-2 focus-within:border-accent">
          <Search size={13} className="text-text-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter operations by path, method, or summary..."
            className="h-full flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-4"
          />
        </div>
      </div>

      <div className="space-y-6 px-6 py-5">
        {tags.map((tag, tagIndex) => (
          <section key={tag.name} id={`apidoc-tag-${tag.name}`} className="scroll-mt-16">
            <div className="mb-2 flex items-end justify-between gap-3 border-b border-border-1 pb-1.5">
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-text-1">{tag.name}</h2>
                {(tag.summary || tag.description) && (
                  <div className="mt-0.5 text-[11px] text-text-4">
                    <InlineMarkdown text={tag.summary || tag.description || ''} />
                  </div>
                )}
              </div>
              {tag.externalDocs && (
                <button
                  onClick={() => openExternal(tag.externalDocs!.url)}
                  title={tag.externalDocs.description || tag.externalDocs.url}
                  className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-accent hover:underline"
                >
                  {tag.externalDocs.description || 'Find out more'} <ExternalLink size={11} />
                </button>
              )}
            </div>
            <div className="space-y-2">
              {tag.operations.map((op, operationIndex) => (
                <OperationCard
                  key={`${op.method}_${op.path}`}
                  operation={op}
                  registry={model.schemaRegistry}
                  defaultOpen={tagIndex === 0 && operationIndex === 0}
                  onTryOperation={onTryOperation}
                />
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

function LayoutButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-5 w-6 items-center justify-center rounded border text-[10px]',
        active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border-2 text-text-4 hover:text-text-2',
      )}
    >
      {children}
    </button>
  )
}

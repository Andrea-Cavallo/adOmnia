import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDownAZ,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  Eraser,
  FileUp,
  GitBranch,
  GitCompare,
  ListTree,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
  WrapText,
  X,
} from 'lucide-react'
import { JsonEditor } from '@/components/ui/JsonEditor'
import { JsonGraph, JsonGraphDiagram } from '@/components/ui/JsonGraph'
import { diagnoseJson } from '@/lib/jsonDiagnostics'
import { findTextMatches } from '@/lib/textSearch'
import {
  EMPTY_JSON_VIEWER_SESSION,
  buildExpandedJsonPaths,
  diffJsonViewerContent,
  formatJsonViewerContent,
  minifyJsonViewerContent,
  sortJsonViewerContent,
  summarizeJsonViewerContent,
  type JsonDiffRow,
  type JsonViewerMode,
  type JsonViewerSession,
  type JsonViewerSummary,
} from '@/lib/jsonViewer'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'adomnia.jsonViewer.session'
const HIGHLIGHT_LIMIT_BYTES = 1024 * 1024
const STRUCTURED_LIMIT_BYTES = 3 * 1024 * 1024
const EXPAND_ALL_PATH_LIMIT = 20000

type PaneId = 'left' | 'right'

function loadSession(): JsonViewerSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_JSON_VIEWER_SESSION
    const parsed = JSON.parse(raw) as Partial<JsonViewerSession>
    return {
      ...EMPTY_JSON_VIEWER_SESSION,
      ...parsed,
      mode: parsed.mode === 'raw' || parsed.mode === 'tree' || parsed.mode === 'graph' || parsed.mode === 'diff' ? parsed.mode : 'raw',
      activePane: parsed.activePane === 'right' ? 'right' : 'left',
      compareEnabled: Boolean(parsed.compareEnabled),
      expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths : ['$'],
    }
  } catch {
    return EMPTY_JSON_VIEWER_SESSION
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function actionTitle(mode: JsonViewerMode): string {
  if (mode === 'raw') return 'Raw'
  if (mode === 'graph') return 'Graph'
  if (mode === 'diff') return 'Diff'
  return 'Tree'
}

function paneLabel(pane: PaneId): string {
  return pane === 'left' ? 'Left JSON' : 'Right JSON'
}

function StatusLine({
  summary,
  diagnostics,
  error,
  emptyText,
}: {
  summary: JsonViewerSummary
  diagnostics: ReturnType<typeof diagnoseJson>
  error: string
  emptyText: string
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-0 px-3 text-[10px]">
      {diagnostics.length > 0 ? (
        <>
          <AlertCircle size={12} className="text-error" />
          <span className="font-mono text-error">
            Line {diagnostics[0].line}, column {diagnostics[0].column}: {diagnostics[0].message}
          </span>
        </>
      ) : summary.rootType !== 'empty' ? (
        <>
          <CheckCircle2 size={12} className="text-success" />
          <span className="font-medium text-success">Valid JSON</span>
        </>
      ) : (
        <span className="text-text-4">{emptyText}</span>
      )}
      {error && <span className="font-mono text-error">{error}</span>}
      <span className="ml-auto font-mono text-text-4">
        {formatBytes(summary.sizeBytes)} - {summary.lineCount} lines - {summary.nodeCount} nodes
      </span>
    </div>
  )
}

function DiffTable({ rows }: { rows: JsonDiffRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-success">
        No differences between the two JSON documents.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto rounded border border-border-1 bg-surface-0 text-xs">
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(180px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border-1 bg-surface-1 font-mono text-[10px] uppercase tracking-wider text-text-4">
        <div className="px-3 py-2">Path</div>
        <div className="border-l border-border-1 px-3 py-2">Left</div>
        <div className="border-l border-border-1 px-3 py-2">Right</div>
      </div>
      {rows.map((row) => (
        <div
          key={`${row.status}:${row.path}`}
          className={cn(
            'grid grid-cols-[minmax(180px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border-1/70 font-mono last:border-b-0',
            row.status === 'added' && 'bg-success/6',
            row.status === 'removed' && 'bg-error/6',
            row.status === 'changed' && 'bg-warning/6',
          )}
        >
          <div className="min-w-0 px-3 py-2 text-text-2">
            <span className={cn(
              'mr-2 rounded px-1.5 py-0.5 text-[9px] uppercase',
              row.status === 'added' && 'bg-success/15 text-success',
              row.status === 'removed' && 'bg-error/15 text-error',
              row.status === 'changed' && 'bg-warning/15 text-warning',
            )}>
              {row.status}
            </span>
            <span className="break-all">{row.path}</span>
          </div>
          <div className="min-w-0 border-l border-border-1 px-3 py-2 text-text-2 break-all">{row.left || ' '}</div>
          <div className="min-w-0 border-l border-border-1 px-3 py-2 text-text-2 break-all">{row.right || ' '}</div>
        </div>
      ))}
    </div>
  )
}

export function JsonViewerPanel() {
  const leftFileInputRef = useRef<HTMLInputElement>(null)
  const rightFileInputRef = useRef<HTMLInputElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const [session, setSession] = useState<JsonViewerSession>(loadSession)
  const [errorFlash, setErrorFlash] = useState('')
  const [copied, setCopied] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0)
  const [dragging, setDragging] = useState(false)

  const activeContent = session.activePane === 'left' ? session.content : session.rightContent
  const leftDiagnostics = useMemo(() => diagnoseJson(session.content), [session.content])
  const rightDiagnostics = useMemo(() => diagnoseJson(session.rightContent), [session.rightContent])
  const leftSummary = useMemo(() => summarizeJsonViewerContent(session.content), [session.content])
  const rightSummary = useMemo(() => summarizeJsonViewerContent(session.rightContent), [session.rightContent])
  const matches = useMemo(
    () => findTextMatches(activeContent, session.searchQuery, { matchCase: false, wholeWord: false }),
    [activeContent, session.searchQuery],
  )
  const activeMatchIndex = matches.length ? ((matchIndex % matches.length) + matches.length) % matches.length : 0
  const leftDiff = useMemo(() => diffJsonViewerContent(session.content, session.rightContent), [session.content, session.rightContent])
  const expandedPaths = useMemo(() => new Set(session.expandedPaths.length ? session.expandedPaths : ['$']), [session.expandedPaths])

  useEffect(() => {
    const safeSession = {
      ...session,
      expandedPaths: session.expandedPaths.slice(0, EXPAND_ALL_PATH_LIMIT),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeSession))
  }, [session])

  useEffect(() => {
    if (matchIndex < matches.length || matches.length === 0) return
    setMatchIndex(0)
  }, [matchIndex, matches.length])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && session.isFullscreen) {
        event.preventDefault()
        setSession((current) => ({ ...current, isFullscreen: false }))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [session.isFullscreen])

  const updateSession = (patch: Partial<JsonViewerSession>) => {
    setErrorFlash('')
    setSession((current) => ({ ...current, ...patch }))
  }

  const setPaneContent = (pane: PaneId, next: string) => {
    updateSession(pane === 'left' ? { content: next, activePane: 'left' } : { rightContent: next, activePane: 'right' })
  }

  const runJsonAction = (action: 'format' | 'minify' | 'sort') => {
    try {
      const next = action === 'format'
        ? formatJsonViewerContent(activeContent)
        : action === 'minify'
          ? minifyJsonViewerContent(activeContent)
          : sortJsonViewerContent(activeContent)
      updateSession({
        ...(session.activePane === 'left' ? { content: next } : { rightContent: next }),
        mode: 'raw',
      })
    } catch (error) {
      setErrorFlash(error instanceof Error ? error.message : 'Invalid JSON')
    }
  }

  const copyJson = async () => {
    await navigator.clipboard.writeText(activeContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const readFile = async (pane: PaneId, file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    updateSession({
      ...(pane === 'left' ? { content: text } : { rightContent: text }),
      activePane: pane,
      mode: 'raw',
      searchQuery: '',
      expandedPaths: ['$'],
    })
    setMatchIndex(0)
  }

  const getStructuredState = (pane: PaneId) => {
    const content = pane === 'left' ? session.content : session.rightContent
    const summary = pane === 'left' ? leftSummary : rightSummary
    const tooLargeForHighlight = summary.sizeBytes > HIGHLIGHT_LIMIT_BYTES
    const tooLargeForStructured = summary.sizeBytes > STRUCTURED_LIMIT_BYTES || summary.nodeCount > EXPAND_ALL_PATH_LIMIT
    const canUseStructuredViews = summary.valid && summary.rootType !== 'empty' && !tooLargeForStructured
    let parsedValue: unknown = null
    if (canUseStructuredViews) {
      try { parsedValue = JSON.parse(content) } catch { parsedValue = null }
    }
    return { content, summary, tooLargeForHighlight, canUseStructuredViews, parsedValue }
  }

  const expandAll = () => {
    const { parsedValue } = getStructuredState(session.activePane)
    if (!parsedValue) return
    updateSession({ expandedPaths: buildExpandedJsonPaths(parsedValue, EXPAND_ALL_PATH_LIMIT) })
  }

  const collapseAll = () => {
    updateSession({ expandedPaths: ['$'] })
  }

  const renderPane = (pane: PaneId) => {
    const { content, summary, tooLargeForHighlight, canUseStructuredViews } = getStructuredState(pane)
    const diagnostics = pane === 'left' ? leftDiagnostics : rightDiagnostics
    const isActive = session.activePane === pane
    const paneMatchesActiveSearch = isActive ? session.searchQuery : ''
    const emptyPlaceholder = pane === 'left'
      ? '{\n  "service": "adOmnia",\n  "localFirst": true\n}'
      : '{\n  "service": "adOmnia",\n  "variant": "compare"\n}'

    return (
      <section
        data-a11y-click-exempt="pane-activation-follows-focus"
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden border-border-1',
          pane === 'right' && 'border-l',
          isActive && 'ring-1 ring-inset ring-accent/40',
        )}
        onFocusCapture={() => updateSession({ activePane: pane })}
        onClick={() => updateSession({ activePane: pane })}
      >
        {session.compareEnabled && (
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
            <span className={cn('text-[10px] font-semibold uppercase tracking-wider', isActive ? 'text-accent' : 'text-text-3')}>
              {paneLabel(pane)}
            </span>
            <button
              onClick={() => (pane === 'left' ? leftFileInputRef : rightFileInputRef).current?.click()}
              className="ml-auto grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"
              title={`Load ${paneLabel(pane)}`}
            >
              <FileUp size={12} />
            </button>
          </div>
        )}

        <StatusLine
          summary={summary}
          diagnostics={diagnostics}
          error={isActive ? errorFlash : ''}
          emptyText={pane === 'left' ? 'Paste, drop, or load a JSON file' : 'Paste, drop, or load a second JSON file'}
        />

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {!content.trim() ? (
            <div className="flex h-full items-center justify-center p-4">
              <textarea
                value={content}
                onChange={(event) => setPaneContent(pane, event.target.value)}
                placeholder={emptyPlaceholder}
                spellCheck={false}
                className="h-full min-h-[320px] w-full resize-none rounded-lg border border-dashed border-border-2 bg-surface-1 p-4 font-mono text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
            </div>
          ) : session.mode === 'raw' || !canUseStructuredViews ? (
            <div className="h-full p-3">
              {!canUseStructuredViews && summary.valid && (
                <div className="mb-2 rounded border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                  Structured tree and graph are disabled for this payload size; raw editing remains available.
                </div>
              )}
              {tooLargeForHighlight ? (
                <textarea
                  value={content}
                  onChange={(event) => setPaneContent(pane, event.target.value)}
                  spellCheck={false}
                  className="h-full w-full resize-none rounded border border-border-2 bg-surface-2 p-3 font-mono text-xs text-text-1 outline-none focus:border-accent"
                />
              ) : (
                <JsonEditor
                  value={content}
                  onChange={(next) => setPaneContent(pane, next)}
                  placeholder={'{\n  "key": "value"\n}'}
                  error={diagnostics.length ? 'Invalid JSON' : undefined}
                  className="h-full"
                  minHeight="100%"
                  searchTerm={paneMatchesActiveSearch}
                  activeSearchIndex={activeMatchIndex}
                />
              )}
            </div>
          ) : session.mode === 'graph' ? (
            <div className="h-full p-3">
              <JsonGraphDiagram json={content} className="h-full" />
            </div>
          ) : (
            <div className="h-full p-3">
              <JsonGraph
                json={content}
                className="h-full"
                expandedPaths={expandedPaths}
                onExpandedPathsChange={(next) => updateSession({ expandedPaths: Array.from(next) })}
              />
            </div>
          )}
        </div>
      </section>
    )
  }

  const shellClass = cn(
    'flex min-h-0 flex-1 flex-col bg-surface-0',
    session.isFullscreen && 'fixed inset-3 z-50 overflow-hidden rounded-xl border border-border-2 shadow-2xl',
  )

  return (
    <>
      {session.isFullscreen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={() => updateSession({ isFullscreen: false })} />
      )}
      <div
        className={shellClass}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void readFile(session.activePane, event.dataTransfer.files[0])
        }}
      >
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-1 px-3 py-2">
          <div className="mr-2 flex min-w-0 items-center gap-2">
            <ListTree size={14} className="text-accent" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2">JSON Studio</span>
          </div>

          <div className="flex items-center overflow-hidden rounded-md border border-border-2 bg-surface-0">
            {(['raw', 'tree', 'graph', 'diff'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => updateSession({ mode, compareEnabled: mode === 'diff' ? true : session.compareEnabled })}
                disabled={mode === 'diff' && !session.compareEnabled && !session.rightContent.trim()}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 border-r border-border-2 px-2.5 text-[10.5px] font-medium last:border-r-0 disabled:opacity-35',
                  session.mode === mode ? 'bg-accent text-white' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
                )}
              >
                {mode === 'graph' ? <GitBranch size={11} /> : mode === 'raw' ? <WrapText size={11} /> : mode === 'diff' ? <GitCompare size={11} /> : <ListTree size={11} />}
                {actionTitle(mode)}
              </button>
            ))}
          </div>

          <button
            onClick={() => updateSession({ compareEnabled: !session.compareEnabled, mode: !session.compareEnabled ? 'raw' : session.mode })}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded px-2 text-[10.5px] hover:bg-surface-2',
              session.compareEnabled ? 'text-accent' : 'text-text-3 hover:text-text-1',
            )}
            title="Show two JSON documents side by side"
          >
            <Columns2 size={12} /> 2 panes
          </button>
          <button onClick={() => runJsonAction('format')} className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1" title={`Format ${paneLabel(session.activePane)}`}>
            <Sparkles size={12} /> Format
          </button>
          <button onClick={() => runJsonAction('minify')} className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1" title={`Minify ${paneLabel(session.activePane)}`}>
            <WrapText size={12} /> Minify
          </button>
          <button onClick={() => runJsonAction('sort')} className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1" title={`Sort keys in ${paneLabel(session.activePane)}`}>
            <ArrowDownAZ size={12} /> Sort A-Z
          </button>
          <button onClick={expandAll} disabled={session.mode === 'diff'} className="h-7 rounded px-2 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-35" title="Expand all tree nodes">
            Expand all
          </button>
          <button onClick={collapseAll} disabled={session.mode === 'diff'} className="h-7 rounded px-2 text-[10.5px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-35" title="Collapse tree nodes">
            Collapse
          </button>

          <div className="ml-auto flex h-7 min-w-[220px] max-w-sm flex-1 items-center overflow-hidden rounded-md border border-border-2 bg-surface-0">
            <Search size={12} className="ml-2 shrink-0 text-text-4" />
            <input
              ref={findInputRef}
              value={session.searchQuery}
              onChange={(event) => { updateSession({ searchQuery: event.target.value }); setMatchIndex(0) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setMatchIndex((index) => index + (event.shiftKey ? -1 : 1))
                }
                if (event.key === 'Escape') updateSession({ searchQuery: '' })
              }}
              placeholder={`Search ${paneLabel(session.activePane)}`}
              className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4"
            />
            <span className="min-w-16 px-1 text-center font-mono text-[10px] text-text-4">
              {session.searchQuery ? `${matches.length ? activeMatchIndex + 1 : 0}/${matches.length}` : '0/0'}
            </span>
            <button onClick={() => setMatchIndex((index) => index - 1)} disabled={!matches.length} className="grid h-full w-6 place-items-center text-text-4 hover:text-text-1 disabled:opacity-35" title="Previous match">
              <ChevronUp size={12} />
            </button>
            <button onClick={() => setMatchIndex((index) => index + 1)} disabled={!matches.length} className="grid h-full w-6 place-items-center text-text-4 hover:text-text-1 disabled:opacity-35" title="Next match">
              <ChevronDown size={12} />
            </button>
            <button onClick={() => updateSession({ searchQuery: '' })} className="grid h-full w-7 place-items-center text-text-4 hover:text-text-1" title="Clear search">
              <X size={12} />
            </button>
          </div>

          <input ref={leftFileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => { void readFile('left', event.target.files?.[0]); event.currentTarget.value = '' }} />
          <input ref={rightFileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => { void readFile('right', event.target.files?.[0]); event.currentTarget.value = '' }} />
          <button onClick={() => (session.activePane === 'left' ? leftFileInputRef : rightFileInputRef).current?.click()} className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1" title={`Load ${paneLabel(session.activePane)}`}>
            <FileUp size={13} />
          </button>
          <button onClick={copyJson} disabled={!activeContent} className={cn('grid h-7 w-7 place-items-center rounded hover:bg-surface-2 disabled:opacity-35', copied ? 'text-success' : 'text-text-3 hover:text-text-1')} title={copied ? 'Copied' : `Copy ${paneLabel(session.activePane)}`}>
            {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
          </button>
          <button onClick={() => { setPaneContent(session.activePane, ''); setMatchIndex(0) }} disabled={!activeContent} className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-error/10 hover:text-error disabled:opacity-35" title={`Clear ${paneLabel(session.activePane)}`}>
            <Eraser size={13} />
          </button>
          <button
            onClick={() => updateSession({ isFullscreen: !session.isFullscreen })}
            className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1"
            title={session.isFullscreen ? 'Exit full screen (Esc)' : 'Open full screen'}
          >
            {session.isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>

        <div className={cn('relative min-h-0 flex-1 overflow-hidden', dragging && 'ring-2 ring-inset ring-accent')}>
          {session.mode === 'diff' ? (
            <div className="flex h-full min-h-0 flex-col p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] text-text-4">
                <GitCompare size={12} className="text-accent" />
                {leftDiff.error ? <span className="text-error">{leftDiff.error}</span> : <span>{leftDiff.rows.length} differences</span>}
              </div>
              {leftDiff.error ? (
                <div className="flex flex-1 items-center justify-center rounded border border-error/30 bg-error/8 text-xs text-error">{leftDiff.error}</div>
              ) : (
                <DiffTable rows={leftDiff.rows} />
              )}
            </div>
          ) : (
            <div className={cn('flex h-full min-h-0', session.compareEnabled ? 'flex-row' : 'flex-col')}>
              {renderPane('left')}
              {session.compareEnabled && renderPane('right')}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

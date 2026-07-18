import { type JSX, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  enableDebugger,
  disableDebugger,
  setBreakpoint,
  setBreakpointByScriptID,
  removeBreakpoint,
  getBreakpoints,
  getSourceFiles,
  getSourceFileContent,
  reloadPageNoCache,
  resume,
  stepOver,
  stepInto,
  stepOut,
  getPausedState,
  type BreakpointInfo,
  type PausedState,
  type CallFrame,
  type SourceFileInfo,
} from '@/lib/browser-debug-api'
import {
  Bug,
  Play,
  SkipForward,
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  X,
  Power,
  Pause,
  RefreshCw,
  FileCode2,
  CircleDot,
  Search,
  ChevronRight,
} from 'lucide-react'

export type { BreakpointInfo, CallFrame, PausedState, SourceFileInfo }

function sourceLabel(source: SourceFileInfo) {
  if (!source.url) return source.scriptId ? `inline script ${source.scriptId}` : source.id
  try {
    const url = new URL(source.url)
    return url.pathname.split('/').filter(Boolean).pop() || url.hostname
  } catch {
    return source.url.split('/').filter(Boolean).pop() || source.url
  }
}

function sourceSubtitle(source: SourceFileInfo) {
  if (!source.url) return source.scriptId ? `scriptId ${source.scriptId}` : source.type
  try {
    const url = new URL(source.url)
    return `${source.type || 'Source'} - ${url.hostname}${url.pathname}`
  } catch {
    return `${source.type || 'Source'} - ${source.url}`
  }
}

function breakpointLineKey(kind: 'script' | 'url', id: string, lineNumber: number) {
  return `${kind}:${id}:${lineNumber}`
}

function sourceLineKeys(source: SourceFileInfo, lineNumber: number) {
  const keys: string[] = []
  if (source.scriptId) keys.push(breakpointLineKey('script', source.scriptId, lineNumber))
  if (source.url) keys.push(breakpointLineKey('url', source.url, lineNumber))
  return keys
}

function sourceTone(source: SourceFileInfo) {
  const type = source.type.toLowerCase()
  if (type === 'document') return 'text-info border-info/25 bg-info/10'
  if (type === 'script') return 'text-accent border-accent/25 bg-accent/10'
  if (type === 'stylesheet') return 'text-success border-success/25 bg-success/10'
  if (type === 'image' || type === 'font' || type === 'media') return 'text-text-4 border-border-1 bg-surface-1'
  return 'text-warning border-warning/25 bg-warning/10'
}

const JS_KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'of',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])

function tokenClass(token: string) {
  if (token.startsWith('//') || token.startsWith('/*')) return 'text-text-4 italic'
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) return 'text-success'
  if (/^\d/.test(token)) return 'text-warning'
  if (JS_LITERALS.has(token)) return 'text-info'
  if (JS_KEYWORDS.has(token)) return 'text-accent font-medium'
  if (/^[{}()[\].,;:+\-*/%=&|!?<>~^]+$/.test(token)) return 'text-text-3'
  return 'text-text-2'
}

function renderHighlightedJS(line: string) {
  const tokenPattern =
    /(\/\/.*|\/\*.*?\*\/|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b(?:true|false|null|undefined|NaN|Infinity)\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,;:+\-*/%=&|!?<>~^]+)/gi
  const parts: Array<string | JSX.Element> = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index))
    const token = match[0]
    parts.push(
      <span key={`${index}-${match.index}`} className={tokenClass(token)}>
        {token}
      </span>
    )
    cursor = match.index + token.length
    index += 1
  }

  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts.length ? parts : line
}

function renderHighlightedHTML(line: string) {
  const tokenPattern =
    /(<!--.*?-->|<\/?[A-Za-z][\w:-]*|\/?>|[A-Za-z_:][\w:.-]*(?=\=)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g
  const parts: Array<string | JSX.Element> = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index))
    const token = match[0]
    const className = token.startsWith('<!--')
      ? 'text-text-4 italic'
      : token.startsWith('<')
        ? 'text-accent'
        : token === '>' || token === '/>'
          ? 'text-text-3'
          : token.startsWith('"') || token.startsWith("'")
            ? 'text-success'
            : 'text-info'
    parts.push(<span key={`${index}-${match.index}`} className={className}>{token}</span>)
    cursor = match.index + token.length
    index += 1
  }

  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts.length ? parts : line
}

function renderHighlightedCSS(line: string) {
  const tokenPattern = /(\/\*.*?\*\/|#[\w-]+|\.[\w-]+|--[\w-]+|[A-Za-z-]+(?=\s*:)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms)?\b|[{}:;,()>+~*])/g
  const parts: Array<string | JSX.Element> = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index))
    const token = match[0]
    const className = token.startsWith('/*')
      ? 'text-text-4 italic'
      : token.startsWith('"') || token.startsWith("'")
        ? 'text-success'
        : /^\d/.test(token)
          ? 'text-warning'
          : token.startsWith('.') || token.startsWith('#')
            ? 'text-accent'
            : /^[{}:;,()>+~*]$/.test(token)
              ? 'text-text-3'
              : 'text-info'
    parts.push(<span key={`${index}-${match.index}`} className={className}>{token}</span>)
    cursor = match.index + token.length
    index += 1
  }

  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts.length ? parts : line
}

function renderHighlightedSource(line: string, source: SourceFileInfo | null) {
  const type = source?.type.toLowerCase() ?? ''
  const mime = source?.mimeType.toLowerCase() ?? ''
  if (type === 'document' || mime.includes('html') || mime.includes('xml')) return renderHighlightedHTML(line)
  if (type === 'stylesheet' || mime.includes('css')) return renderHighlightedCSS(line)
  if (type === 'script' || mime.includes('javascript') || mime.includes('json')) return renderHighlightedJS(line)
  return line
}

export function DebuggerPanel() {
  const [enabled, setEnabled] = useState(false)
  const [breakpoints, setBreakpoints] = useState<BreakpointInfo[]>([])
  const [pausedState, setPausedState] = useState<PausedState | null>(null)
  const [sources, setSources] = useState<SourceFileInfo[]>([])
  const [selectedSource, setSelectedSource] = useState<SourceFileInfo | null>(null)
  const [sourceContent, setSourceContent] = useState('')
  const [scriptFilter, setScriptFilter] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)

  const [bpUrl, setBpUrl] = useState('')
  const [bpLine, setBpLine] = useState('')
  const [bpCondition, setBpCondition] = useState('')
  const [error, setError] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeLineRef = useRef<HTMLDivElement | null>(null)

  const refreshBreakpoints = useCallback(async () => {
    try {
      setBreakpoints(await getBreakpoints())
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to refresh breakpoints')
    }
  }, [])

  const refreshSources = useCallback(async () => {
    try {
      const nextSources = await getSourceFiles()
      setSources(nextSources)
      setSelectedSource((current) => {
        if (current && nextSources.some((source) => source.id === current.id)) {
          return current
        }
        return nextSources[0] ?? null
      })
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to refresh sources')
    }
  }, [])

  const hardReloadSources = useCallback(async () => {
    setSourceLoading(true)
    setSourceContent('')
    setSelectedSource(null)
    setSources([])
    setBreakpoints([])
    setPausedState(null)

    try {
      await reloadPageNoCache()
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reload page')
      setSourceLoading(false)
      return
    }
    window.setTimeout(() => {
      void refreshSources()
      void refreshBreakpoints()
      setSourceLoading(false)
    }, 450)
  }, [refreshBreakpoints, refreshSources])

  const loadSourceContent = useCallback(async (source: SourceFileInfo | null) => {
    if (!source) {
      setSourceContent('')
      return
    }
    setSourceLoading(true)
    try {
      const content = await getSourceFileContent(source.id)
      setSourceContent(content)
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load source content')
    } finally {
      setSourceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setPausedState(null)
      return
    }

    const poll = async () => {
      try {
        const state = await getPausedState()
        setPausedState(state)
        setError('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to read debugger pause state')
      }
    }
    poll()
    pollRef.current = setInterval(poll, 500)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void refreshBreakpoints()
    void refreshSources()
  }, [enabled, refreshBreakpoints, refreshSources])

  useEffect(() => {
    void loadSourceContent(selectedSource)
  }, [selectedSource, loadSourceContent])

  useEffect(() => {
    if (!pausedState?.paused) return
    const match = sources.find((source) =>
      (pausedState.scriptId && source.scriptId === pausedState.scriptId) ||
      (pausedState.scriptUrl && source.url === pausedState.scriptUrl)
    )
    if (match) {
      setSelectedSource(match)
    } else {
      void refreshSources()
    }
  }, [pausedState, refreshSources, sources])

  useEffect(() => {
    if (!pausedState?.paused || !activeLineRef.current) return
    activeLineRef.current.scrollIntoView({ block: 'center' })
  }, [pausedState?.paused, pausedState?.scriptId, pausedState?.lineNumber, selectedSource?.id, sourceContent])

  const handleToggleDebugger = useCallback(async () => {
    if (enabled) {
      try {
        await disableDebugger()
        setError('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to disable debugger')
      }
      setEnabled(false)
      setBreakpoints([])
      setSources([])
      setSelectedSource(null)
      setSourceContent('')
    } else {
      try {
        await enableDebugger()
        setEnabled(true)
        setError('')
        setTimeout(() => {
          void refreshSources()
          void refreshBreakpoints()
        }, 250)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to enable debugger')
      }
    }
  }, [enabled, refreshBreakpoints, refreshSources])

  const handleAddBreakpoint = useCallback(async () => {
    const displayLine = parseInt(bpLine, 10)
    if (!bpUrl || Number.isNaN(displayLine) || displayLine < 1) return

    try {
      await setBreakpoint(bpUrl, displayLine - 1, bpCondition)
      setBpUrl('')
      setBpLine('')
      setBpCondition('')
      await refreshBreakpoints()
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add breakpoint')
    }
  }, [bpUrl, bpLine, bpCondition, refreshBreakpoints])

  const handleRemoveBreakpoint = useCallback(
    async (id: string) => {
      try {
        await removeBreakpoint(id)
        await refreshBreakpoints()
        setError('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to remove breakpoint')
      }
    },
    [refreshBreakpoints]
  )

  const handleResume = useCallback(async () => {
    try {
      await resume()
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resume debugger')
    }
  }, [])

  const handleStepOver = useCallback(async () => {
    try {
      await stepOver()
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to step over')
    }
  }, [])

  const handleStepInto = useCallback(async () => {
    try {
      await stepInto()
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to step into')
    }
  }, [])

  const handleStepOut = useCallback(async () => {
    try {
      await stepOut()
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to step out')
    }
  }, [])

  const handleToggleLineBreakpoint = useCallback(
    async (lineIndex: number) => {
      if (!selectedSource?.canSetBreakpoint) return
      const existing = breakpoints.find(
        (bp) =>
          bp.lineNumber === lineIndex &&
          ((selectedSource.scriptId && bp.scriptId === selectedSource.scriptId) ||
            (selectedSource.url && bp.scriptUrl === selectedSource.url))
      )
      try {
        if (existing) {
          await removeBreakpoint(existing.id)
        } else if (selectedSource.scriptId) {
          await setBreakpointByScriptID(selectedSource.scriptId, lineIndex, 0, '')
        } else if (selectedSource.url) {
          await setBreakpoint(selectedSource.url, lineIndex, '')
        } else {
          return
        }
        await refreshBreakpoints()
        setError('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to toggle breakpoint')
      }
    },
    [breakpoints, refreshBreakpoints, selectedSource]
  )

  const filteredSources = useMemo(() => {
    const query = scriptFilter.trim().toLowerCase()
    if (!query) return sources
    return sources.filter((source) => {
      const label = sourceLabel(source).toLowerCase()
      const subtitle = sourceSubtitle(source).toLowerCase()
      return label.includes(query) || subtitle.includes(query)
    })
  }, [scriptFilter, sources])

  const breakpointsByLine = useMemo(() => {
    const index = new Map<string, BreakpointInfo>()
    for (const bp of breakpoints) {
      if (bp.scriptId) index.set(breakpointLineKey('script', bp.scriptId, bp.lineNumber), bp)
      if (bp.scriptUrl) index.set(breakpointLineKey('url', bp.scriptUrl, bp.lineNumber), bp)
    }
    return index
  }, [breakpoints])

  const sourceLines = sourceContent ? sourceContent.split('\n') : []
  const canSetSourceBreakpoints = Boolean(enabled && selectedSource?.canSetBreakpoint && (selectedSource.scriptId || selectedSource.url))

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      <div className="flex items-center h-9 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Bug size={12} className="text-text-3" />

        <button
          onClick={handleToggleDebugger}
          className={cn(
            'h-6 px-2 rounded text-[10px] font-medium flex items-center gap-1 transition-colors',
            enabled
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-surface-2 border border-border-1 text-text-2 hover:text-text-1'
          )}
        >
          <Power size={10} />
          {enabled ? 'Disable' : 'Enable'}
        </button>

        <div className="w-px h-5 bg-border-1" />

        <button
          onClick={handleResume}
          disabled={!enabled || !pausedState?.paused}
          title="Resume"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Play size={12} />
        </button>
        <button
          onClick={handleStepOver}
          disabled={!enabled || !pausedState?.paused}
          title="Step Over"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <SkipForward size={12} />
        </button>
        <button
          onClick={handleStepInto}
          disabled={!enabled || !pausedState?.paused}
          title="Step Into"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowDownToLine size={12} />
        </button>
        <button
          onClick={handleStepOut}
          disabled={!enabled || !pausedState?.paused}
          title="Step Out"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowUpFromLine size={12} />
        </button>

        <div className="w-px h-5 bg-border-1" />

        <button
          onClick={() => {
            void hardReloadSources()
          }}
          disabled={!enabled}
          title="Reload without cache"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} />
        </button>

        {pausedState?.paused && (
          <div className="ml-auto flex items-center gap-2 rounded border border-yellow-500/30 bg-yellow-500/5 px-2 h-6 text-[10px] text-yellow-300 font-mono">
            <Pause size={11} />
            {pausedState.reason || 'paused'} at {pausedState.scriptUrl || pausedState.scriptId || 'anonymous'}:
            {pausedState.lineNumber + 1}
          </div>
        )}
      </div>

      <div className="relative flex flex-1 min-h-0">
        {error && (
          <div className="absolute right-4 top-12 z-10 max-w-md rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error shadow-lg">
            {error}
          </div>
        )}
        <aside className="w-[280px] flex-shrink-0 border-r border-border-1 bg-surface-0 flex flex-col min-h-0">
          <div className="h-8 px-2 border-b border-border-1 flex items-center gap-2">
            <FileCode2 size={12} className="text-text-3" />
            <span className="text-[10px] uppercase tracking-wide font-medium text-text-3">
              Sources
            </span>
            <span className="ml-auto text-[10px] text-text-4">{sources.length}</span>
          </div>
          <div className="p-2 border-b border-border-1">
            <div className="relative">
              <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                value={scriptFilter}
                onChange={(e) => setScriptFilter(e.target.value)}
                placeholder="Filter sources..."
                className="h-6 w-full pl-6 pr-2 rounded bg-surface-1 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!enabled && (
              <div className="px-3 py-4 text-xs text-text-3">
                Enable the debugger to load page sources.
              </div>
            )}
            {enabled && filteredSources.length === 0 && (
              <div className="px-3 py-4 text-xs text-text-3">
                No source files captured yet. Refresh after the page loads.
              </div>
            )}
            {filteredSources.map((source) => (
              <button
                key={source.id}
                onClick={() => setSelectedSource(source)}
                className={cn(
                  'w-full px-2 py-1.5 text-left border-b border-border-1/60 hover:bg-surface-2 transition-colors',
                  selectedSource?.id === source.id && 'bg-accent/10'
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn('rounded border px-1 text-[8px] uppercase tracking-wide', sourceTone(source))}>
                    {source.type || 'src'}
                  </span>
                  <span className="text-[11px] text-text-1 font-mono truncate">
                    {sourceLabel(source)}
                  </span>
                </div>
                <div className="text-[9px] text-text-4 font-mono truncate">
                  {sourceSubtitle(source)}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col bg-surface-1">
          <div className="h-8 px-3 border-b border-border-1 bg-surface-0 flex items-center gap-2">
            <span className="text-[10px] text-text-3 uppercase tracking-wide font-medium">
              Source
            </span>
            {selectedSource && (
              <span className="text-[10px] text-text-2 font-mono truncate">
                {selectedSource.url || `inline script ${selectedSource.scriptId}`}
              </span>
            )}
            {selectedSource && !selectedSource.canSetBreakpoint && (
              <span className="ml-auto text-[10px] text-yellow-300">
                Read-only resource
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-surface-0 font-mono text-[10px] leading-4">
            {sourceLoading && (
              <div className="flex items-center justify-center h-full text-xs text-text-3">
                Loading source...
              </div>
            )}
            {!sourceLoading && !selectedSource && (
              <div className="flex items-center justify-center h-full text-xs text-text-3">
                Select a source file to inspect its content
              </div>
            )}
            {!sourceLoading && selectedSource && sourceLines.length === 0 && (
              <div className="flex items-center justify-center h-full text-xs text-text-3">
                Source is empty or unavailable
              </div>
            )}
            {!sourceLoading &&
              sourceLines.map((line, index) => {
                const bp = selectedSource
                  ? sourceLineKeys(selectedSource, index)
                    .map((key) => breakpointsByLine.get(key))
                    .find(Boolean)
                  : undefined
                const isPausedLine =
                  pausedState?.paused &&
                  selectedSource &&
                  ((pausedState.scriptId && selectedSource.scriptId === pausedState.scriptId) ||
                    (pausedState.scriptUrl && selectedSource.url === pausedState.scriptUrl)) &&
                  pausedState.lineNumber === index

                return (
                  <div
                    key={index}
                    ref={isPausedLine ? activeLineRef : undefined}
                    className={cn(
                      'group flex min-w-max border-l-2 border-transparent',
                      isPausedLine
                        ? 'border-warning bg-warning/20 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-warning)_35%,transparent)]'
                        : 'hover:bg-surface-2/60'
                    )}
                  >
                    <button
                      onClick={() => handleToggleLineBreakpoint(index)}
                      disabled={!canSetSourceBreakpoints}
                      title={
                        canSetSourceBreakpoints
                          ? bp
                            ? 'Remove breakpoint'
                            : 'Set breakpoint'
                          : 'Select a breakpoint-capable source'
                      }
                      className={cn(
                        'w-7 flex-shrink-0 border-r border-border-1 bg-surface-1 flex items-center justify-center disabled:cursor-not-allowed',
                        isPausedLine && 'bg-warning/15'
                      )}
                    >
                      {isPausedLine ? (
                        <ChevronRight size={12} className="text-warning" />
                      ) : bp ? (
                        <CircleDot size={9} className="text-red-400" />
                      ) : (
                        <span className="h-2 w-2 rounded-full opacity-0 group-hover:opacity-40 bg-text-3" />
                      )}
                    </button>
                    <span
                      className={cn(
                        'w-12 flex-shrink-0 select-none border-r border-border-1 pr-2 text-right text-text-4 bg-surface-1',
                        isPausedLine && 'bg-warning/15 text-warning font-medium'
                      )}
                    >
                      {index + 1}
                    </span>
                    <code
                      className={cn(
                        'whitespace-pre px-3 text-text-2',
                        isPausedLine && 'text-text-1'
                      )}
                    >
                      {renderHighlightedSource(line, selectedSource)}
                    </code>
                  </div>
                )
              })}
          </div>
        </main>

        <aside className="w-[300px] flex-shrink-0 border-l border-border-1 bg-surface-1 overflow-y-auto">
          <div className="px-2 py-1.5 border-b border-border-1 bg-surface-0">
            <span className="text-[10px] text-text-3 uppercase tracking-wide font-medium">
              Breakpoints
            </span>
          </div>

          {breakpoints.length === 0 && (
            <div className="px-3 py-3 text-xs text-text-3">No breakpoints set</div>
          )}

          <div className="p-2 space-y-1">
            {breakpoints.map((bp) => (
              <div
                key={bp.id}
                className="flex items-center gap-2 text-[10px] font-mono bg-surface-0 rounded px-2 py-1 border border-border-1"
              >
                <span className="text-text-1 truncate flex-1">
                  {bp.scriptUrl || bp.scriptId || bp.id}:{bp.lineNumber + 1}
                </span>
                {bp.condition && (
                  <span className="text-yellow-400 text-[9px] truncate max-w-[90px]">
                    if: {bp.condition}
                  </span>
                )}
                <button
                  onClick={() => handleRemoveBreakpoint(bp.id)}
                  title="Remove breakpoint"
                  className="h-4 w-4 rounded flex items-center justify-center text-text-3 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>

          {enabled && (
            <div className="p-2 border-t border-border-1 space-y-1.5">
              <div className="text-[10px] text-text-3 uppercase tracking-wide font-medium">
                Manual breakpoint
              </div>
              <input
                type="text"
                value={bpUrl}
                onChange={(e) => setBpUrl(e.target.value)}
                placeholder="Script URL"
                className="w-full h-6 px-2 rounded bg-surface-0 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={bpLine}
                  onChange={(e) => setBpLine(e.target.value)}
                  placeholder="Line"
                  className="w-16 h-6 px-2 rounded bg-surface-0 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
                />
                <input
                  type="text"
                  value={bpCondition}
                  onChange={(e) => setBpCondition(e.target.value)}
                  placeholder="Condition"
                  className="flex-1 h-6 px-2 rounded bg-surface-0 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
                />
                <button
                  onClick={handleAddBreakpoint}
                  className="h-6 px-2 rounded bg-accent/10 border border-accent/30 text-[10px] text-accent font-medium flex items-center gap-1 hover:bg-accent/20 transition-colors"
                >
                  <Plus size={10} />
                  Add
                </button>
              </div>
            </div>
          )}

          {pausedState?.paused && pausedState.callFrames.length > 0 && (
            <div className="border-t border-border-1">
              <div className="px-2 py-1.5 border-b border-border-1 bg-surface-0">
                <span className="text-[10px] text-text-3 uppercase tracking-wide font-medium">
                  Call Stack
                </span>
              </div>
              <div className="p-2 space-y-0.5">
                {pausedState.callFrames.map((frame) => (
                  <div
                    key={frame.id}
                    className="flex flex-col gap-0.5 text-[10px] font-mono text-text-2 py-1 border-b border-border-1/50 last:border-b-0"
                  >
                    <span className="text-accent truncate">
                      {frame.functionName || '(anonymous)'}
                    </span>
                    <span className="text-text-3 truncate">
                      {frame.url || frame.scriptId || 'anonymous'}:{frame.lineNumber + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  listLogFiles,
  readLogFile,
  type LogFileInfo,
} from '@/lib/devlogs-api'
import type { BackendDevLogEntry } from '@/stores/devLogs'
import { useServerPort, getSidecarToken, serverUrl } from '@/lib/useServerPort'
import {
  FileText,
  RefreshCw,
  Download,
  Search,
  Filter,
  ChevronDown,
  Activity,
  Clock,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  FileDigit,
  X,
  FolderOpen,
  Radio,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'LOG'

interface FilterState {
  level: 'all' | LogLevel
  source: 'all' | 'frontend' | 'backend'
  search: string
  correlationId: string
}

interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId: string
  name: string
  service: string
  startMs: number
  durationMs: number
  status: string
  correlationId: string
  http?: { method?: string; url?: string; status?: string }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<LogLevel, { icon: typeof AlertCircle; className: string; label: string }> = {
  ERROR: { icon: AlertCircle, className: 'text-red-400 bg-red-500/10', label: 'ERR' },
  WARN: { icon: AlertTriangle, className: 'text-yellow-400 bg-yellow-500/10', label: 'WRN' },
  INFO: { icon: Info, className: 'text-blue-400 bg-blue-500/10', label: 'INF' },
  DEBUG: { icon: Bug, className: 'text-purple-400 bg-purple-500/10', label: 'DBG' },
  LOG: { icon: FileText, className: 'text-text-2 bg-surface-2', label: 'LOG' },
}

const LEVEL_TABS: { id: 'all' | LogLevel; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ERROR', label: 'ERR' },
  { id: 'WARN', label: 'WRN' },
  { id: 'INFO', label: 'INF' },
  { id: 'DEBUG', label: 'DBG' },
  { id: 'LOG', label: 'LOG' },
]

function formatTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function hasCorrelationId(entry: BackendDevLogEntry, id: string): boolean {
  if (!id) return true
  const searchIn = JSON.stringify([entry.msg, entry.func, entry.data])
  return searchIn.toLowerCase().includes(id.toLowerCase())
}

function pickString(data: Record<string, unknown> | undefined, keys: string[]) {
  if (!data) return ''
  for (const key of keys) {
    const value = data[key]
    if (value !== undefined && value !== null && value !== '') return String(value)
  }
  return ''
}

function pickNumber(data: Record<string, unknown> | undefined, keys: string[]) {
  const raw = pickString(data, keys)
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function extractTraceSpans(entries: BackendDevLogEntry[]): TraceSpan[] {
  const spans = entries.flatMap((entry) => {
    const data = entry.data ?? {}
    const traceId = pickString(data, ['trace_id', 'traceId', 'trace.id', 'otel.trace_id'])
    const spanId = pickString(data, ['span_id', 'spanId', 'span.id', 'otel.span_id'])
    if (!traceId || !spanId) return []
    const start = Date.parse(pickString(data, ['start_time', 'startTime', 'timestamp']) || entry.ts)
    const durationMs = pickNumber(data, ['duration_ms', 'durationMs', 'elapsed_ms', 'time_ms'])
    return [{
      traceId,
      spanId,
      parentSpanId: pickString(data, ['parent_span_id', 'parentSpanId', 'parent.span_id']),
      name: pickString(data, ['span_name', 'spanName', 'name', 'http.route']) || entry.func || entry.msg,
      service: pickString(data, ['service.name', 'service', 'source']) || entry.source || 'app',
      startMs: Number.isFinite(start) ? start : Date.parse(entry.ts),
      durationMs,
      status: pickString(data, ['status.code', 'status', 'http.status_code']) || entry.level,
      correlationId: pickString(data, ['correlation_id', 'correlationId', 'request_id', 'requestId', 'x-request-id']),
      http: {
        method: pickString(data, ['http.method', 'method']),
        url: pickString(data, ['http.url', 'url', 'request_url']),
        status: pickString(data, ['http.status_code', 'status_code']),
      },
    }]
  })
  return spans.sort((a, b) => a.startMs - b.startMs)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ObservabilityPanel() {
  const port = useServerPort()
  const [files, setFiles] = useState<LogFileInfo[]>([])
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [entries, setEntries] = useState<BackendDevLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const entriesRef = useRef<BackendDevLogEntry[]>([])
  const [filters, setFilters] = useState<FilterState>({
    level: 'all',
    source: 'all',
    search: '',
    correlationId: '',
  })

  // Keep entriesRef in sync
  entriesRef.current = entries

  // Streaming effect
  useEffect(() => {
    if (!port || !live) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      return
    }

    let cancelled = false
    let es: EventSource | null = null

    getSidecarToken().then((token) => {
      if (cancelled) return
      const url = serverUrl(port, `/devlogs/stream?token=${encodeURIComponent(token)}`)
      es = new EventSource(url)
      eventSourceRef.current = es

      es.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data) as BackendDevLogEntry
          if (entry.i && entry.ts) {
            setEntries((prev) => {
              // Avoid duplicates by checking counter
              if (prev.some((e) => e.i === entry.i)) return prev
              const next = [...prev, entry]
              // Keep size bounded (max 5000 entries in UI)
              if (next.length > 5000) return next.slice(next.length - 5000)
              return next
            })
          }
        } catch { /* ignore malformed lines */ }
      }

      es.onerror = () => {
        // EventSource auto-reconnects; if it fails permanently, close
        if (es && es.readyState === EventSource.CLOSED) {
          es.close()
          eventSourceRef.current = null
          if (!cancelled) setLive(false)
        }
      }
    })

    return () => {
      cancelled = true
      if (es) {
        es.close()
        eventSourceRef.current = null
      }
    }
  }, [port, live])

  // Load file list on mount
  const loadFiles = useCallback(async () => {
    const fileList = await listLogFiles()
    setFiles(fileList)
    // Auto-select most recent file
    if (fileList.length > 0 && !selectedFile) {
      const latest = fileList.reduce((a, b) => (a.name > b.name ? a : b))
      setSelectedFile(latest.name)
    }
  }, [selectedFile])

  useEffect(() => {
    loadFiles()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load entries when file is selected
  useEffect(() => {
    if (!selectedFile) return
    const load = async () => {
      setLoading(true)
      const data = await readLogFile(selectedFile)
      setEntries(data)
      setLoading(false)
    }
    load()
  }, [selectedFile])

  // Apply filters
  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (filters.level !== 'all' && entry.level !== filters.level) return false
      if (filters.source !== 'all' && entry.source !== filters.source) return false
      if (filters.correlationId && !hasCorrelationId(entry, filters.correlationId)) return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const haystack = [entry.msg, entry.func ?? '', JSON.stringify(entry.data ?? {})].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [entries, filters])

  // Count by level
  const counts = useMemo(() => {
    const c: Record<string, number> = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, LOG: 0 }
    entries.forEach((e) => {
      const lvl = e.level as LogLevel
      if (c[lvl] !== undefined) c[lvl]++
    })
    return c
  }, [entries])

  const traceSpans = useMemo(() => extractTraceSpans(filtered), [filtered])
  const traceGroups = useMemo(() => {
    const groups = new Map<string, TraceSpan[]>()
    for (const span of traceSpans) {
      const list = groups.get(span.traceId) ?? []
      list.push(span)
      groups.set(span.traceId, list)
    }
    return Array.from(groups.entries()).map(([traceId, spans]) => ({ traceId, spans }))
  }, [traceSpans])
  const correlatedRequests = useMemo(() => traceSpans.filter((span) => span.http?.url || span.correlationId).slice(0, 20), [traceSpans])

  // Export filtered logs
  const handleExport = useCallback(() => {
    const lines = filtered.map((e) => JSON.stringify(e)).join('\n')
    const blob = new Blob([lines + '\n'], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `observability-export-${selectedFile || 'logs'}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered, selectedFile])

  const clearFilter = (key: keyof FilterState) => {
    setFilters((p) => ({ ...p, [key]: key === 'level' || key === 'source' ? 'all' : '' }))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center h-10 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Activity size={14} className="text-accent flex-shrink-0" />
        <span className="text-[10px] font-semibold text-text-1 uppercase tracking-wider flex-shrink-0">
          Observability
        </span>

        {/* File selector */}
        <div className="relative flex-shrink-0">
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            className="h-7 px-2 pr-6 rounded bg-surface-1 border border-border-1 text-[10px] text-text-1 font-mono appearance-none cursor-pointer focus:outline-none focus:border-accent"
          >
            <option value="" disabled>Select log file...</option>
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({formatFileSize(f.size)})
              </option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
        </div>

        <button
          onClick={loadFiles}
          title="Refresh file list"
          className="h-7 w-7 rounded flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors flex-shrink-0"
        >
          <RefreshCw size={12} />
        </button>

        <button
          onClick={() => setLive((v) => !v)}
          title={live ? 'Stop live streaming' : 'Start live streaming'}
          className={cn(
            'h-7 w-7 rounded flex items-center justify-center transition-colors flex-shrink-0',
            live
              ? 'text-accent bg-accent/10'
              : 'text-text-3 hover:text-text-1 hover:bg-surface-2'
          )}
        >
          <Radio size={12} />
        </button>

        {/* Stats */}
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <span className="text-[10px] text-text-3">
            {loading ? 'Loading...' : `${entries.length} entries`}
            {filtered.length !== entries.length && ` (${filtered.length} filtered)`}
          </span>
        </div>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          title="Export filtered logs as JSONL"
          className="h-7 px-2 rounded bg-surface-2 border border-border-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1 flex-shrink-0"
        >
          <Download size={10} />
          Export
        </button>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center h-8 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Filter size={10} className="text-text-3 flex-shrink-0" />

        {/* Level tabs */}
        {LEVEL_TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilters((p) => ({ ...p, level: id }))}
            className={cn(
              'h-5 px-1.5 rounded text-[9px] font-medium transition-colors',
              filters.level === id
                ? 'bg-accent/20 text-accent'
                : 'text-text-3 hover:text-text-2 hover:bg-surface-2',
            )}
          >
            {label}
          </button>
        ))}

        <div className="w-px h-4 bg-border-1" />

        {/* Source tabs */}
        {([
          { id: 'all', label: 'All' },
          { id: 'frontend', label: 'FE' },
          { id: 'backend', label: 'BE' },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilters((p) => ({ ...p, source: id }))}
            className={cn(
              'h-5 px-1.5 rounded text-[9px] font-medium transition-colors',
              filters.source === id
                ? 'bg-accent/20 text-accent'
                : 'text-text-3 hover:text-text-2 hover:bg-surface-2',
            )}
          >
            {label}
          </button>
        ))}

        <div className="w-px h-4 bg-border-1" />

        {/* Correlation ID search */}
        <div className="relative">
          <FolderOpen size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={filters.correlationId}
            onChange={(e) => setFilters((p) => ({ ...p, correlationId: e.target.value }))}
            placeholder="Correlation ID..."
            className="h-5 w-36 pl-5 pr-5 rounded bg-surface-1 border border-border-1 text-[9px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
          />
          {filters.correlationId && (
            <button
              onClick={() => clearFilter('correlationId')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1"
            >
              <X size={8} />
            </button>
          )}
        </div>

        {/* Free-text search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            placeholder="Search logs..."
            className="h-5 w-full pl-5 pr-5 rounded bg-surface-1 border border-border-1 text-[9px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
          />
          {filters.search && (
            <button
              onClick={() => clearFilter('search')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1"
            >
              <X size={8} />
            </button>
          )}
        </div>

        {/* Level counts */}
        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {(['ERROR', 'WARN', 'INFO', 'DEBUG', 'LOG'] as LogLevel[]).map((level) => (
            <span
              key={level}
              className={cn(
                'text-[8px] font-mono px-1 py-px rounded',
                LEVEL_CONFIG[level].className,
              )}
            >
              {LEVEL_CONFIG[level].label}:{counts[level]}
            </span>
          ))}
        </div>
      </div>

      {/* ── Log entries table ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {traceGroups.length > 0 && (
          <div className="border-b border-border-1 bg-surface-0 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Activity size={12} className="text-accent" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-2">OpenTelemetry traces</span>
              <span className="text-[10px] text-text-4">{traceGroups.length} trace(s), {traceSpans.length} span(s)</span>
            </div>
            <div className="flex max-h-52 flex-col gap-2 overflow-y-auto">
              {traceGroups.slice(0, 8).map(({ traceId, spans }) => {
                const minStart = Math.min(...spans.map((span) => span.startMs))
                const maxEnd = Math.max(...spans.map((span) => span.startMs + Math.max(span.durationMs, 1)))
                const total = Math.max(maxEnd - minStart, 1)
                return (
                  <div key={traceId} className="rounded border border-border-1 bg-surface-1 p-2">
                    <div className="mb-1 flex items-center gap-2">
                      <button
                        onClick={() => setFilters((p) => ({ ...p, correlationId: spans.find((span) => span.correlationId)?.correlationId || traceId }))}
                        className="font-mono text-[10px] text-accent hover:underline"
                      >
                        {traceId}
                      </button>
                      <span className="text-[10px] text-text-4">{spans.length} spans · {Math.round(total)}ms</span>
                    </div>
                    {spans.map((span) => {
                      const left = ((span.startMs - minStart) / total) * 100
                      const width = Math.max((Math.max(span.durationMs, 1) / total) * 100, 1)
                      return (
                        <div key={span.spanId} className="grid grid-cols-[170px_1fr_56px] items-center gap-2 py-0.5">
                          <span className="truncate font-mono text-[9px] text-text-3" title={span.name}>{span.name}</span>
                          <div className="relative h-3 rounded bg-surface-2">
                            <div className={cn('absolute top-0 h-3 rounded', span.status.toUpperCase().includes('ERROR') ? 'bg-error' : 'bg-accent')} style={{ left: `${left}%`, width: `${width}%` }} />
                          </div>
                          <span className="text-right font-mono text-[9px] text-text-4">{Math.round(span.durationMs)}ms</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            {correlatedRequests.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {correlatedRequests.map((span) => (
                  <button
                    key={`${span.traceId}-${span.spanId}`}
                    onClick={() => setFilters((p) => ({ ...p, correlationId: span.correlationId || span.traceId }))}
                    className="rounded border border-border-2 bg-surface-2 px-2 py-0.5 font-mono text-[9px] text-text-3 hover:text-accent"
                    title={span.http?.url}
                  >
                    {span.http?.method || 'HTTP'} {span.http?.status || ''} {span.correlationId || span.traceId.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-full text-text-3 text-xs">
            Loading logs...
          </div>
        )}

        {!loading && entries.length === 0 && selectedFile && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-3">
            <FileDigit size={24} className="opacity-20" />
            <span className="text-xs">No log entries found in this file</span>
          </div>
        )}

        {!loading && entries.length === 0 && !selectedFile && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-3">
            <Activity size={24} className="opacity-20" />
            <span className="text-xs">Select a log file to view entries</span>
            <span className="text-[10px] opacity-50">
              Log files are stored as JSONL in the application data folder
            </span>
          </div>
        )}

        {filtered.length === 0 && entries.length > 0 && (
          <div className="flex items-center justify-center h-full text-text-3 text-xs">
            No entries match the current filters
          </div>
        )}

        {filtered.length > 0 && (
          <table className="w-full text-[10px] font-mono">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border-1 bg-surface-0 text-text-3 uppercase tracking-wide">
                <th className="text-left px-2 py-1.5 font-medium w-16">Time</th>
                <th className="text-left px-2 py-1.5 font-medium w-12">Level</th>
                <th className="text-left px-2 py-1.5 font-medium w-12">Src</th>
                <th className="text-left px-2 py-1.5 font-medium w-32">Function</th>
                <th className="text-left px-2 py-1.5 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, idx) => {
                const lvl = (entry.level as LogLevel) || 'LOG'
                const config = LEVEL_CONFIG[lvl] ?? LEVEL_CONFIG.LOG
                const Icon = config.icon
                return (
                  <tr
                    key={`${entry.i}-${idx}`}
                    className={cn(
                      'border-b border-border-1/50 hover:bg-surface-2/50 transition-colors',
                      lvl === 'ERROR' && 'bg-red-500/[0.03]',
                      lvl === 'WARN' && 'bg-yellow-500/[0.02]',
                    )}
                  >
                    <td className="px-2 py-1 text-text-3 whitespace-nowrap">
                      {formatTime(entry.ts)}
                    </td>
                    <td className="px-2 py-1">
                      <span className={cn('inline-flex items-center gap-1 px-1 rounded text-[8px]', config.className)}>
                        <Icon size={8} />
                        {config.label}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <span className={cn(
                        'text-[8px] px-1 rounded',
                        entry.source === 'frontend'
                          ? 'text-emerald-400 bg-emerald-500/10'
                          : 'text-text-3 bg-surface-2',
                      )}>
                        {entry.source === 'frontend' ? 'FE' : 'BE'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-text-2 max-w-[180px] truncate">
                      {entry.func}
                    </td>
                    <td className="px-2 py-1 text-text-1 break-words">
                      {entry.msg}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center h-6 px-3 gap-3 border-t border-border-1 bg-surface-0 flex-shrink-0">
        <Clock size={10} className="text-text-3" />
        <span className="text-[9px] text-text-3">
          {selectedFile
            ? `${files.find((f) => f.name === selectedFile)?.modTime ?? '—'} · ${formatFileSize(files.find((f) => f.name === selectedFile)?.size ?? 0)}`
            : 'No file selected'}
        </span>
        <div className="flex-1" />
        <span className="text-[9px] text-text-3">
          Showing {filtered.length} of {entries.length} entries
        </span>
      </div>
    </div>
  )
}

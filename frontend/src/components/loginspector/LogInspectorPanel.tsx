import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  ClipboardPaste,
  Columns3,
  Copy,
  Download,
  Eraser,
  EyeOff,
  Filter,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Search,
  ShieldOff,
  SlidersHorizontal,
  WrapText,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadText } from '@/lib/fileUtils'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import {
  ACCEPTED_EXTENSIONS,
  DEFAULT_MAX_EVENTS,
  EMPTY_FILTERS,
  EXPORT_EXTENSIONS,
  LOG_SAMPLES,
  buildHistogram,
  analyzeLog,
  compileQuery,
  correlateEvents,
  countByLevel,
  discoverFields,
  exportEvents,
  filterEvents,
  fromText,
  hasActiveFilters,
  loadFromFile,
  maskEvents,
  parseLogTextInBackground,
  rememberSchema,
  rememberedPaths,
  sortChronologically,
  EMPTY_DISCOVERY,
  type CorrelationKey,
  type CorrelationResult,
  type ExportFormat,
  type FieldDiscovery,
  type LogEvent,
  type LogFilterState,
  type LogSourceResult,
  type ParseSummary,
  type AnalyzedRequest,
  OperationGate,
  type ImportOperation,
  type StoredSchema,
} from '@/lib/loginspector'
import { DEFAULT_COLUMNS, EventList, LIST_COLUMNS, type Density, type ListColumnId } from './EventList'
import { EventDetail } from './EventDetail'
import { FilterSidebar, type SavedQuery } from './FilterSidebar'
import { RelatedEvents } from './RelatedEvents'
import { Histogram } from './Histogram'
import { EmptyState } from './EmptyState'
import { AnalysisOverview } from './AnalysisOverview'

const PREFS_KEY = 'adomnia.loginspector'
const MAX_EVENT_CHOICES = [50_000, 100_000, DEFAULT_MAX_EVENTS, 500_000]

interface Prefs {
  density: Density
  wrap: boolean
  columns: ListColumnId[]
  maxEvents: number
  savedQueries: SavedQuery[]
  maskFields: string[]
  hiddenFields: string[]
  filterWidth: number
  detailWidth: number
}

const DEFAULT_PREFS: Prefs = {
  density: 'compact',
  wrap: false,
  columns: DEFAULT_COLUMNS,
  maxEvents: DEFAULT_MAX_EVENTS,
  savedQueries: [],
  maskFields: [],
  hiddenFields: [],
  filterWidth: 244,
  detailWidth: 440,
}

function loadPrefs(): Prefs {
  try {
    const stored = localStorage.getItem(PREFS_KEY)
    if (!stored) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...(JSON.parse(stored) as Partial<Prefs>) }
  } catch {
    return DEFAULT_PREFS
  }
}

export function LogInspectorPanel() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [source, setSource] = useState<LogSourceResult | null>(null)
  const [events, setEvents] = useState<LogEvent[]>([])
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [discovery, setDiscovery] = useState<FieldDiscovery>(EMPTY_DISCOVERY)
  const [schema, setSchema] = useState<StoredSchema | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<LogFilterState>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [related, setRelated] = useState<CorrelationResult | null>(null)
  const [showFilters, setShowFilters] = useState(true)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [masked, setMasked] = useState(false)
  const [streamPreview, setStreamPreview] = useState(true)
  const [showAnalysis, setShowAnalysis] = useState(true)
  const [menu, setMenu] = useState<'columns' | 'export' | 'mask' | null>(null)
  const [newMaskField, setNewMaskField] = useState('')
  const [newHiddenField, setNewHiddenField] = useState('')
  const [dragging, setDragging] = useState(false)
  const [panelWidth, setPanelWidth] = useState(0)

  const panelRef = useRef<HTMLDivElement>(null)
  const operationGateRef = useRef(new OperationGate())
  const responsiveInitializedRef = useRef(false)
  const streamRef = useRef(true)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  streamRef.current = streamPreview

  useEffect(() => () => operationGateRef.current.cancel(), [])

  useEffect(() => {
    const node = panelRef.current
    if (!node) return
    const measure = () => {
      const width = node.clientWidth
      setPanelWidth(width)
      if (!responsiveInitializedRef.current && width > 0) {
        responsiveInitializedRef.current = true
        if (width < 640) setShowFilters(false)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [])

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* quota or private mode — preferences are a convenience, not state */
      }
      return next
    })
  }, [])

  // ─── Ingest ────────────────────────────────────────────────────────────────

  const ingest = useCallback(async (result: LogSourceResult, existingOperation?: ImportOperation) => {
    const gate = operationGateRef.current
    const operation = existingOperation ?? gate.start()
    if (!gate.isActive(operation)) return
    if (!result.text.trim()) {
      setError('That input is empty.')
      gate.finish(operation)
      return
    }
    setError('')
    setSource(result)
    setEvents([])
    setSummary(null)
    setDiscovery(EMPTY_DISCOVERY)
    setSchema(null)
    setSelectedId(null)
    setRelated(null)
    setProgress({ done: 0, total: 0 })

    try {
      const parsed = await parseLogTextInBackground(
        result.text,
        { maxEvents: prefs.maxEvents },
        {
          onProgress: (done, total, partial) => {
            if (!gate.isActive(operation)) return
            setProgress({ done, total })
            const now = performance.now()
            if (streamRef.current && (done === total || now - operation.lastPreviewAt >= 100)) {
              operation.lastPreviewAt = now
              setEvents(partial.slice())
            }
          },
          shouldAbort: () => gate.shouldAbort(operation),
        },
      )
      if (!gate.isCurrent(operation)) return
      setEvents(parsed.events.slice())
      setSummary(parsed.summary)
      // Learn the shape of this log so its own keys become searchable.
      const found = discoverFields(parsed.events)
      setDiscovery(found)
      setSchema(rememberSchema(found, result.name))
      if (parsed.aborted) setError('Import cancelled — showing the events parsed so far.')
    } catch (cause) {
      if (!gate.isCurrent(operation)) return
      // A multi-hundred-MB paste can exhaust the renderer heap; say so instead
      // of leaving a blank screen.
      const message = cause instanceof RangeError || (cause instanceof Error && /memory|allocation/i.test(cause.message))
        ? 'Out of memory while parsing. Lower the event limit or split the file.'
        : cause instanceof Error ? cause.message : 'Import failed'
      setError(message)
      setEvents([])
    } finally {
      if (gate.isCurrent(operation)) {
        setProgress(null)
        gate.finish(operation)
      }
    }
  }, [prefs.maxEvents])

  const pasteAndAnalyze = useCallback(async () => {
    const gate = operationGateRef.current
    const operation = gate.start()
    try {
      const text = await navigator.clipboard.readText()
      if (!gate.isActive(operation)) return
      if (!text.trim()) {
        setError('The clipboard is empty.')
        gate.finish(operation)
        return
      }
      await ingest(fromText(text, 'Clipboard', 'paste'), operation)
    } catch {
      if (gate.isActive(operation)) {
        setError('Clipboard access was denied. Paste into the editor box instead.')
        gate.finish(operation)
      }
    }
  }, [ingest])

  const openFile = useCallback(async (file: File) => {
    const gate = operationGateRef.current
    const operation = gate.start()
    try {
      const result = await loadFromFile(file)
      if (gate.isActive(operation)) await ingest(result, operation)
    } catch (cause) {
      if (gate.isActive(operation)) {
        setError(cause instanceof Error ? cause.message : 'Could not read that file')
        gate.finish(operation)
      }
    }
  }, [ingest])

  const clearAll = useCallback(() => {
    operationGateRef.current.cancel()
    setSource(null)
    setEvents([])
    setSummary(null)
    setDiscovery(EMPTY_DISCOVERY)
    setSchema(null)
    setSelectedId(null)
    setRelated(null)
    setFilters(EMPTY_FILTERS)
    setError('')
    setProgress(null)
  }, [])

  // ─── Derived data ──────────────────────────────────────────────────────────

  const working = useMemo(
    () => (masked ? maskEvents(events, prefs.maskFields) : events),
    [events, masked, prefs.maskFields],
  )
  const ordered = useMemo(() => sortChronologically(working, sortDir), [working, sortDir])
  const deferredFilters = useDeferredValue(filters)
  const filtered = useMemo(() => filterEvents(ordered, deferredFilters), [ordered, deferredFilters])
  const compiled = useMemo(() => compileQuery(filters.query), [filters.query])
  const levelCounts = useMemo(() => countByLevel(working), [working])
  // Keys this shape carried in earlier imports but not in this one — still
  // worth offering, because that is often exactly the field that went missing.
  const rememberedOnly = useMemo(() => {
    if (!discovery.signature.length) return []
    const present = new Set(discovery.fields.map((field) => field.path))
    return rememberedPaths(discovery.signature).filter((path) => !present.has(path))
  }, [discovery])
  const histogram = useMemo(() => buildHistogram(filtered, 72), [filtered])
  // Request-level analysis is intentionally delayed until import completes;
  // progressive list rendering must stay cheap on 100k+ line files.
  const analysis = useMemo(() => analyzeLog(summary ? events : []), [events, summary])
  const selected = useMemo(
    () => (selectedId === null ? null : working.find((event) => event.id === selectedId) ?? null),
    [working, selectedId],
  )

  const exportNow = useCallback((format: ExportFormat) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadText(`log-inspector-${stamp}.${EXPORT_EXTENSIONS[format]}`, exportEvents(filtered, format))
    setMenu(null)
  }, [filtered])

  // ─── Shortcuts ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      const target = keyEvent.target as HTMLElement | null
      const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))

      if (keyEvent.key === 'Escape') {
        if (related) setRelated(null)
        else if (selectedId !== null) setSelectedId(null)
        else if (menu) setMenu(null)
        return
      }
      if (!keyEvent.ctrlKey && !keyEvent.metaKey) return

      const key = keyEvent.key.toLowerCase()
      if (key === 'f') {
        keyEvent.preventDefault()
        if (keyEvent.shiftKey) setShowFilters((value) => !value)
        else searchRef.current?.focus()
      } else if (key === 'l' && !typing) {
        keyEvent.preventDefault()
        clearAll()
      } else if (key === 'e' && events.length > 0) {
        keyEvent.preventDefault()
        setMenu((current) => (current === 'export' ? null : 'export'))
      } else if (key === 'v' && !typing) {
        keyEvent.preventDefault()
        void pasteAndAnalyze()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [clearAll, events.length, menu, pasteAndAnalyze, related, selectedId])

  // ─── Resizing ──────────────────────────────────────────────────────────────

  const startResize = (which: 'filters' | 'detail') => (mouseEvent: React.MouseEvent) => {
    mouseEvent.preventDefault()
    const startX = mouseEvent.clientX
    const startWidth = which === 'filters' ? prefs.filterWidth : prefs.detailWidth
    const onMove = (moveEvent: MouseEvent) => {
      const delta = which === 'filters' ? moveEvent.clientX - startX : startX - moveEvent.clientX
      const next = Math.min(760, Math.max(190, startWidth + delta))
      update(which === 'filters' ? { filterWidth: next } : { detailWidth: next })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const busy = progress !== null
  const showEmpty = !source && !busy && events.length === 0
  const narrow = panelWidth > 0 && panelWidth < 640
  const focusedDetail = narrow && Boolean(selected || related)

  const onDrop = (dropEvent: React.DragEvent) => {
    setDragging(false)
    // The empty-state drop zone handles its own drop and marks the event; without
    // this guard the same file would be ingested (and parsed) twice.
    if (dropEvent.defaultPrevented) return
    dropEvent.preventDefault()
    const file = dropEvent.dataTransfer.files?.[0]
    if (file) void openFile(file)
  }

  return (
    <div
      ref={panelRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0"
      onDragEnter={(dragEvent) => { dragEvent.preventDefault(); setDragging(true) }}
      onDragOver={(dragEvent) => dragEvent.preventDefault()}
      onDragLeave={(dragEvent) => { if (dragEvent.currentTarget === dragEvent.target) setDragging(false) }}
      onDrop={onDrop}
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(changeEvent) => {
          const file = changeEvent.target.files?.[0]
          if (file) void openFile(file)
          changeEvent.target.value = ''
        }}
      />

      {/* ── Toolbar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-1 px-3 py-2">
        <ToolButton onClick={() => void pasteAndAnalyze()} icon={<ClipboardPaste size={12} />} label="Paste" title="Paste and analyze (Ctrl+V)" />
        <ToolButton onClick={() => fileRef.current?.click()} icon={<FolderOpen size={12} />} label="Open" title="Open a log file" />
        <ToolButton onClick={clearAll} icon={<Eraser size={12} />} label="Clear" title="Clear everything (Ctrl+L)" disabled={showEmpty} />

        <span className="mx-1 h-5 w-px bg-border-2" />

        <div className="relative min-w-[200px] flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            ref={searchRef}
            value={filters.query}
            onChange={(changeEvent) => setFilters((current) => ({ ...current, query: changeEvent.target.value }))}
            placeholder="Search — level:warn|error  merchantId:M-4471  pod:pay-*  /regex/  -noisy"
            title={[
              'Text search, or field clauses combined with AND:',
              '  level:error            known field',
              '  merchantId:M-4471      any key in the payload',
              '  http.status:502        nested key',
              '  level:warn|error       alternatives',
              '  pod:pay-*              wildcard',
              '  /timed ?out/           regular expression',
              '  traceId:*              field is present',
              '  -service:noisy-cron    exclude',
            ].join('\n')}
            className="h-7 w-full rounded border border-border-2 bg-surface-0 pl-7 pr-7 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
          />
          {filters.query && (
            <button
              onClick={() => setFilters((current) => ({ ...current, query: '' }))}
              title="Clear the query"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-1"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <IconToggle active={showFilters} onClick={() => setShowFilters((value) => !value)} title="Filters (Ctrl+Shift+F)"><Filter size={12} /></IconToggle>
        <IconToggle active={showAnalysis} onClick={() => setShowAnalysis((value) => !value)} title="Request analysis">
          <Activity size={12} />
        </IconToggle>
        <IconToggle
          active={sortDir === 'desc'}
          onClick={() => setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'))}
          title={sortDir === 'asc' ? 'Oldest first — click for newest first' : 'Newest first — click for oldest first'}
        >
          {sortDir === 'asc' ? <ArrowUpWideNarrow size={12} /> : <ArrowDownWideNarrow size={12} />}
        </IconToggle>
        <IconToggle
          active={prefs.density === 'comfortable'}
          onClick={() => update({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' })}
          title={`Density: ${prefs.density}`}
        >
          <span className="font-mono text-[10px]">{prefs.density === 'compact' ? 'Aa' : 'AA'}</span>
        </IconToggle>
        <IconToggle active={prefs.wrap} onClick={() => update({ wrap: !prefs.wrap })} title="Word wrap"><WrapText size={12} /></IconToggle>
        <IconToggle active={masked} onClick={() => setMasked((value) => !value)} title="Clear sensitive fields (tokens, cookies, passwords)">
          {masked ? <ShieldOff size={12} /> : <EyeOff size={12} />}
        </IconToggle>
        <div className="relative">
          <IconToggle
            active={menu === 'mask'}
            onClick={() => setMenu((current) => (current === 'mask' ? null : 'mask'))}
            title="Configure sensitive fields"
          >
            <SlidersHorizontal size={12} />
          </IconToggle>
          {menu === 'mask' && (
            <Popover onClose={() => setMenu(null)} wide>
              <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">Additional sensitive fields</p>
              <form
                className="flex gap-1 px-1 pb-1"
                onSubmit={(submitEvent) => {
                  submitEvent.preventDefault()
                  const field = newMaskField.trim().toLowerCase()
                  if (field && !prefs.maskFields.includes(field)) update({ maskFields: [...prefs.maskFields, field] })
                  setNewMaskField('')
                }}
              >
                <input
                  value={newMaskField}
                  onChange={(changeEvent) => setNewMaskField(changeEvent.target.value)}
                  placeholder="e.g. customer_email"
                  className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent"
                />
                <button className="h-7 rounded border border-accent/40 px-2 text-[10px] text-accent-light hover:bg-accent/15">Add</button>
              </form>
              {prefs.maskFields.length > 0 ? (
                <div className="flex max-h-36 flex-wrap gap-1 overflow-auto px-1 py-1">
                  {prefs.maskFields.map((field) => (
                    <button
                      key={field}
                      onClick={() => update({ maskFields: prefs.maskFields.filter((item) => item !== field) })}
                      title={`Remove ${field}`}
                      className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-1 font-mono text-[9px] text-text-2 hover:text-error"
                    >
                      {field}<X size={9} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-1 text-[10px] text-text-4">Built-in detection already covers tokens, passwords, cookies, sessions and authorization headers.</p>
              )}
            </Popover>
          )}
        </div>
        <IconToggle active={!streamPreview} onClick={() => setStreamPreview((value) => !value)} title={streamPreview ? 'Pause progressive rendering' : 'Resume progressive rendering'}>
          {streamPreview ? <Pause size={12} /> : <Play size={12} />}
        </IconToggle>

        <div className="relative">
          <IconToggle active={menu === 'columns'} onClick={() => setMenu((current) => (current === 'columns' ? null : 'columns'))} title="Choose columns">
            <Columns3 size={12} />
          </IconToggle>
          {menu === 'columns' && (
            <Popover onClose={() => setMenu(null)} wide>
              {LIST_COLUMNS.map((column) => (
                <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] text-text-2 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={prefs.columns.includes(column.id)}
                    onChange={() => update({
                      columns: prefs.columns.includes(column.id)
                        ? prefs.columns.filter((id) => id !== column.id)
                        : LIST_COLUMNS.map((item) => item.id).filter((id) => id === column.id || prefs.columns.includes(id)),
                    })}
                  />
                  {column.label}
                </label>
              ))}
              <div className="mt-1 border-t border-border-2 px-1 pt-2">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">Hide noisy JSON fields</p>
                <form
                  className="flex gap-1"
                  onSubmit={(submitEvent) => {
                    submitEvent.preventDefault()
                    const field = newHiddenField.trim().toLowerCase()
                    if (field && !prefs.hiddenFields.includes(field)) update({ hiddenFields: [...prefs.hiddenFields, field] })
                    setNewHiddenField('')
                  }}
                >
                  <input
                    value={newHiddenField}
                    onChange={(changeEvent) => setNewHiddenField(changeEvent.target.value)}
                    placeholder="e.g. labels"
                    className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent"
                  />
                  <button className="h-7 rounded border border-accent/40 px-2 text-[10px] text-accent-light hover:bg-accent/15">Hide</button>
                </form>
                {prefs.hiddenFields.length > 0 && (
                  <div className="flex max-h-24 flex-wrap gap-1 overflow-auto py-1.5">
                    {prefs.hiddenFields.map((field) => (
                      <button
                        key={field}
                        onClick={() => update({ hiddenFields: prefs.hiddenFields.filter((item) => item !== field) })}
                        title={`Show ${field} again`}
                        className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-1 font-mono text-[9px] text-text-2 hover:text-error"
                      >
                        {field}<X size={9} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Popover>
          )}
        </div>

        <div className="relative">
          <ToolButton
            onClick={() => setMenu((current) => (current === 'export' ? null : 'export'))}
            icon={<Download size={12} />}
            label="Export"
            title="Export the filtered events (Ctrl+E)"
            disabled={filtered.length === 0}
          />
          {menu === 'export' && (
            <Popover onClose={() => setMenu(null)}>
              {(['json', 'jsonl', 'text'] as ExportFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => exportNow(format)}
                  className="w-full rounded px-2 py-1 text-left text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1"
                >
                  {format.toUpperCase()} — {filtered.length} events
                </button>
              ))}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(exportEvents(filtered, 'text')).catch(() => {})
                  setMenu(null)
                }}
                className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-border-2 px-2 py-1 text-left text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1"
              >
                <Copy size={11} /> Copy to clipboard
              </button>
            </Popover>
          )}
        </div>

        <select
          value={prefs.maxEvents}
          onChange={(changeEvent) => update({ maxEvents: Number(changeEvent.target.value) })}
          title="Maximum events retained per import"
          className="h-7 rounded border border-border-2 bg-surface-0 px-1 font-mono text-[10px] text-text-2 outline-none focus:border-accent"
        >
          {MAX_EVENT_CHOICES.map((limit) => (
            <option key={limit} value={limit}>{(limit / 1000).toFixed(0)}k max</option>
          ))}
        </select>
      </div>

      {/* ── Progress ── */}
      {busy && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border-1 bg-surface-1 px-3 py-1.5">
          <Loader2 size={12} className="animate-spin text-accent-light" />
          <span className="font-mono text-[10px] text-text-3">
            Parsing {progress!.done.toLocaleString()} / {progress!.total.toLocaleString()} lines
          </span>
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded bg-surface-2">
            <div
              className="h-full bg-accent transition-[width] duration-100"
              style={{ width: `${progress!.total > 0 ? Math.round((progress!.done / progress!.total) * 100) : 0}%` }}
            />
          </div>
          <button
            onClick={() => { operationGateRef.current.requestAbort() }}
            className="h-6 rounded border border-error/40 px-2 text-[10px] text-error hover:bg-error/10"
          >
            Cancel
          </button>
        </div>
      )}

      {error && !showEmpty && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-warning/70 hover:text-warning"><X size={12} /></button>
        </div>
      )}

      {showEmpty ? (
        <EmptyState
          error={error}
          onSampleId={(id) => {
            const sample = LOG_SAMPLES.find((item) => item.id === id)
            if (sample) void ingest(fromText(sample.text, sample.label, 'sample'))
          }}
          onFile={(file) => void openFile(file)}
          onAnalyzeText={(text) => void ingest(fromText(text, 'Editor', 'editor'))}
        />
      ) : (
        <>
          {showAnalysis && (
            <AnalysisOverview
              analysis={analysis}
              onClose={() => setShowAnalysis(false)}
              onFilterRequest={(request: AnalyzedRequest) => {
                const query = request.correlationId
                  ? `correlationId:${request.correlationId}`
                  : `requestId:${request.requestId}`
                setFilters((current) => ({ ...current, query }))
              }}
            />
          )}
          {histogram.length > 0 && (
            <Histogram
              buckets={histogram}
              onSelectRange={(from, to) => setFilters((current) => ({ ...current, from, to }))}
            />
          )}

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {showFilters && !focusedDetail && (
              <>
                <aside
                  style={{ width: narrow ? Math.min(prefs.filterWidth, Math.max(190, panelWidth - 24)) : prefs.filterWidth }}
                  className={cn(
                    'flex min-h-0 shrink-0 border-r border-border-1 bg-surface-0',
                    narrow && 'absolute inset-y-0 left-0 z-20 shadow-[12px_0_32px_rgba(0,0,0,.45)]',
                  )}
                >
                  <FilterSidebar
                    filters={filters}
                    onChange={setFilters}
                    discovery={discovery}
                    rememberedOnly={rememberedOnly}
                    schema={schema}
                    events={working}
                    levelCounts={levelCounts}
                    savedQueries={prefs.savedQueries}
                    onSaveQuery={(name) => update({
                      savedQueries: [...prefs.savedQueries, { id: `q-${Date.now()}`, name, query: filters.query }],
                    })}
                    onDeleteQuery={(id) => update({ savedQueries: prefs.savedQueries.filter((query) => query.id !== id) })}
                    onReset={() => setFilters(EMPTY_FILTERS)}
                  />
                </aside>
                {!narrow && <ResizeHandle label="Resize filters" withLine={false} onMouseDown={startResize('filters')} />}
              </>
            )}

            {!focusedDetail && <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <EventList
                events={filtered}
                selectedId={selectedId}
                onSelect={(event) => { setSelectedId(event.id); setRelated(null) }}
                density={prefs.density}
                wrap={prefs.wrap}
                columns={prefs.columns}
                highlights={compiled.highlights}
                scrollToId={related ? null : selectedId}
              />
            </div>}

            {(selected || related) && (
              <>
                {!focusedDetail && <ResizeHandle label="Resize details" withLine={false} onMouseDown={startResize('detail')} />}
                <aside
                  style={{ width: focusedDetail ? '100%' : prefs.detailWidth, maxWidth: focusedDetail ? undefined : '58%' }}
                  className="flex min-h-0 shrink-0 flex-col border-l border-border-1"
                >
                  {related ? (
                    <RelatedEvents
                      result={related}
                      onClose={() => setRelated(null)}
                      onApplyAsFilter={() => {
                        setFilters((current) => ({ ...current, query: `${related.key}:${related.value}` }))
                        setRelated(null)
                      }}
                      onSelect={(event) => { setRelated(null); setSelectedId(event.id) }}
                    />
                  ) : selected ? (
                    <EventDetail
                      event={selected}
                      onClose={() => setSelectedId(null)}
                      onFilterBy={(field, value) => setFilters((current) => ({
                        ...current,
                        query: current.query ? `${current.query} ${field}:${value}` : `${field}:${value}`,
                      }))}
                      onShowRelated={(key: CorrelationKey, value: string) => setRelated(correlateEvents(working, key, value))}
                      hiddenFields={prefs.hiddenFields}
                    />
                  ) : null}
                </aside>
              </>
            )}
          </div>

          {/* ── Summary bar ── */}
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border-1 bg-surface-1 px-3 py-1.5 font-mono text-[10px] text-text-3">
            <span className="text-text-2">{filtered.length.toLocaleString()} shown</span>
            <span>/ {events.length.toLocaleString()} events</span>
            {summary && (
              <>
                <span>{summary.valid.toLocaleString()} valid</span>
                {summary.invalid > 0 && <span className="text-warning">{summary.invalid.toLocaleString()} unparsed</span>}
                {summary.errorCount > 0 && <span className="text-error">{summary.errorCount.toLocaleString()} errors</span>}
                {summary.warningCount > 0 && <span className="text-warning/80">{summary.warningCount.toLocaleString()} warnings</span>}
                <span className="text-text-4">{summary.totalLines.toLocaleString()} lines · {summary.format} · {summary.durationMs}ms</span>
                {summary.truncated && <span className="text-warning">truncated at {prefs.maxEvents.toLocaleString()}</span>}
              </>
            )}
            {source && <span className="truncate text-text-4">{source.name}</span>}
            {hasActiveFilters(filters) && (
              <button onClick={() => setFilters(EMPTY_FILTERS)} className="ml-auto text-accent-light hover:text-accent">
                Reset filters
              </button>
            )}
          </div>
        </>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-surface-0/80 backdrop-blur-[1px]">
          <p className="rounded-lg border border-dashed border-accent px-6 py-4 text-sm text-accent-light">Drop the log file to analyze it</p>
        </div>
      )}
    </div>
  )
}

function ToolButton({ onClick, icon, label, title, disabled }: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  title: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-2 text-[11px] text-text-2 transition-colors hover:border-accent/40 hover:text-text-1 disabled:opacity-35"
    >
      {icon}
      {label}
    </button>
  )
}

function IconToggle({ active, onClick, title, children }: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'grid h-7 w-7 place-items-center rounded border transition-colors',
        active ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-3 hover:border-accent/40 hover:text-text-1',
      )}
    >
      {children}
    </button>
  )
}

function Popover({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={cn(
        'absolute right-0 top-8 z-40 min-w-[176px] rounded-md border border-border-2 bg-surface-1 p-1 shadow-[0_12px_40px_rgba(0,0,0,.45)]',
        wide && 'w-72',
      )}>
        {children}
      </div>
    </>
  )
}

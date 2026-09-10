import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { downloadText } from '@/lib/fileUtils'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import {
  ACCEPTED_EXTENSIONS,
  EMPTY_FILTERS,
  EXPORT_EXTENSIONS,
  LOG_SAMPLES,
  analyzeLog,
  buildHistogram,
  compileQuery,
  consumeLogInspectorQuery,
  correlateEvents,
  countByLevel,
  deduplicateAcquisitionEvents,
  AUTOSAVE_INVESTIGATION_ID,
  deleteInvestigation,
  exportInvestigationMetadata,
  exportEvents,
  filterEvents,
  fromText,
  maskEvents,
  loadInvestigation,
  onLogInspectorQuery,
  rememberedPaths,
  saveInvestigation,
  sortChronologically,
  type AnalyzedRequest,
  type CorrelationKey,
  type CorrelationResult,
  type ExportFormat,
  type LogFilterState,
  type InvestigationMetadata,
} from '@/lib/loginspector'
import { availableListColumns, EventList, LIST_COLUMNS } from './EventList'
import { EventDetail } from './EventDetail'
import { FilterSidebar } from './FilterSidebar'
import { RelatedEvents } from './RelatedEvents'
import { Histogram } from './Histogram'
import { EmptyState } from './EmptyState'
import { AnalysisOverview, requestComparisonKey } from './AnalysisOverview'
import { RequestDiffPanel } from './RequestDiffPanel'
import { EvidencePreviewPanel } from './EvidencePreviewPanel'
import { ChainProposalPanel } from './ChainProposalPanel'
import { LiveSourcePanel } from './LiveSourcePanel'
import { LargeFilePanel } from './LargeFilePanel'
import { useLiveSources } from './useLiveSources'
import { LogInspectorToolbar, type ToolbarMenu } from './LogInspectorToolbar'
import { ErrorBar, ImportProgressBar, SummaryBar } from './StatusBars'
import { usePrefs } from './prefs'
import { useLogImport } from './useLogImport'

/** Below this width the filter column collapses and details take over. */
const NARROW_WIDTH = 640

export function LogInspectorPanel() {
  const [prefs, updatePrefs] = usePrefs()
  const [filters, setFilters] = useState<LogFilterState>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [related, setRelated] = useState<CorrelationResult | null>(null)
  const [showFilters, setShowFilters] = useState(true)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [masked, setMasked] = useState(false)
  const [deduplicated, setDeduplicated] = useState(false)
  const [streamPreview, setStreamPreview] = useState(true)
  const [showAnalysis, setShowAnalysis] = useState(true)
  const [comparisonKeys, setComparisonKeys] = useState<string[]>([])
  const [chainKey, setChainKey] = useState<string | null>(null)
  const [showLive, setShowLive] = useState(false)
  const [showLargeFile, setShowLargeFile] = useState(false)
  const [bookmarks, setBookmarks] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionSavedAt, setSessionSavedAt] = useState<number | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)
  const [menu, setMenu] = useState<ToolbarMenu>(null)
  const [dragging, setDragging] = useState(false)
  const [panelWidth, setPanelWidth] = useState(0)

  const panelRef = useRef<HTMLDivElement>(null)
  const responsiveInitializedRef = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const appliedPresetRef = useRef('')
  const restoreStartedRef = useRef(false)

  const clearSelection = useCallback(() => {
    setSelectedId(null)
    setRelated(null)
    setComparisonKeys([])
  }, [])

  const {
    source, sources, events, summary, discovery, schema, progress, error,
    setError, ingest, openFiles, renameSource, toggleSource, removeSource, replaceSource, restoreSources,
    pasteAndAnalyze, appendLiveLines, clearImport, requestAbort,
  } = useLogImport({ maxEvents: prefs.maxEvents, streamPreview, onReset: clearSelection })

  const live = useLiveSources(useCallback(
    (sourceId, label, lines) => appendLiveLines(sourceId, label, lines),
    [appendLiveLines],
  ))

  const sessionMetadata = useCallback((savedAt = Date.now()): InvestigationMetadata => ({
    version: 1,
    id: AUTOSAVE_INVESTIGATION_ID,
    name: sources.map((item) => item.displayName).join(', ') || 'Log investigation',
    savedAt,
    sources: sources.map(({ text: _text, ...metadata }) => metadata),
    ui: { filters, selectedId, bookmarks, notes, showFilters, sortDir, masked, deduplicated },
  }), [bookmarks, deduplicated, filters, masked, notes, selectedId, showFilters, sortDir, sources])

  useEffect(() => {
    if (restoreStartedRef.current) return
    restoreStartedRef.current = true
    void loadInvestigation().then(async (restored) => {
      if (!restored) return
      const restoredSources = restored.sources.map((metadata) => ({ ...metadata, text: restored.sourceContents[metadata.id] ?? '' }))
      await restoreSources(restoredSources)
      setFilters(restored.ui.filters)
      setSelectedId(restored.ui.selectedId)
      setBookmarks(restored.ui.bookmarks)
      setNotes(restored.ui.notes)
      setShowFilters(restored.ui.showFilters)
      setSortDir(restored.ui.sortDir)
      setMasked(restored.ui.masked)
      setDeduplicated(restored.ui.deduplicated)
      setSessionSavedAt(restored.savedAt)
      if (restored.missingSourceIds.length) setError(`${restored.missingSourceIds.length} saved source contents are missing; reload those files.`)
    }).catch(() => setError('The saved investigation could not be restored.')).finally(() => setSessionReady(true))
  }, [restoreSources, setError])

  useEffect(() => {
    if (!sessionReady || !sources.length || progress) return
    const timer = window.setTimeout(() => {
      const savedAt = Date.now()
      void saveInvestigation(sessionMetadata(savedAt), Object.fromEntries(sources.map((item) => [item.id, item.text])))
        .then(() => setSessionSavedAt(savedAt))
        .catch(() => setError('The investigation could not be saved locally.'))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [progress, sessionMetadata, sessionReady, setError, sources])

  useEffect(() => {
    const node = panelRef.current
    if (!node) return
    const measure = () => {
      const width = node.clientWidth
      setPanelWidth(width)
      if (!responsiveInitializedRef.current && width > 0) {
        responsiveInitializedRef.current = true
        if (width < NARROW_WIDTH) setShowFilters(false)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [])

  // Another panel (Browser Debug, proxy traffic) can hand a correlation id to
  // this panel before it is even mounted, so a parked query is read on mount.
  useEffect(() => {
    const apply = (query: string) => {
      setFilters((current) => ({ ...current, query }))
      clearSelection()
    }
    const parked = consumeLogInspectorQuery()
    if (parked) apply(parked)
    return onLogInspectorQuery(apply)
  }, [clearSelection])

  const clearAll = useCallback(() => {
    clearImport()
    setFilters(EMPTY_FILTERS)
    setBookmarks([])
    setNotes('')
    setSessionSavedAt(null)
    void deleteInvestigation().catch(() => {})
  }, [clearImport])

  // ─── Derived data ──────────────────────────────────────────────────────────

  const deduplication = useMemo(() => deduplicateAcquisitionEvents(events), [events])
  const baseEvents = deduplicated ? deduplication.events : events
  const working = useMemo(
    () => (masked ? maskEvents(baseEvents, prefs.maskFields) : baseEvents),
    [baseEvents, masked, prefs.maskFields],
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
  const analysis = useMemo(() => analyzeLog(summary ? baseEvents : []), [baseEvents, summary])
  const availableColumns = useMemo(
    () => availableListColumns(baseEvents, LIST_COLUMNS.map((column) => column.id)),
    [baseEvents],
  )
  const selected = useMemo(
    () => (selectedId === null ? null : working.find((event) => event.id === selectedId) ?? null),
    [working, selectedId],
  )
  const evidenceEvents = useMemo(() => {
    if (!selected) return filtered
    const identity: [CorrelationKey, string] | null = selected.correlationId
      ? ['correlationId', selected.correlationId]
      : selected.traceId ? ['traceId', selected.traceId]
        : selected.requestId ? ['requestId', selected.requestId] : null
    return identity ? working.filter((event) => event[identity[0]] === identity[1]) : [selected]
  }, [filtered, selected, working])
  const chainRequest = useMemo(
    () => (chainKey === null ? null : analysis.requests.find((request) => requestComparisonKey(request) === chainKey) ?? null),
    [analysis.requests, chainKey],
  )
  const comparisonRequests = useMemo(
    () => comparisonKeys.map((key) => analysis.requests.find((request) => requestComparisonKey(request) === key)).filter((request): request is AnalyzedRequest => Boolean(request)),
    [analysis.requests, comparisonKeys],
  )

  useEffect(() => {
    const format = summary?.format || ''
    if (!format || appliedPresetRef.current === format) return
    appliedPresetRef.current = format
    const preset = prefs.columnPresets[format]
    if (preset) updatePrefs({ columns: preset.columns, columnWidths: preset.widths })
  }, [prefs.columnPresets, summary?.format, updatePrefs])

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
      updatePrefs(which === 'filters' ? { filterWidth: next } : { detailWidth: next })
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
  const showEmpty = sources.length === 0 && !busy && events.length === 0
  const narrow = panelWidth > 0 && panelWidth < NARROW_WIDTH
  const focusedDetail = narrow && Boolean(selected || related)

  const onDrop = (dropEvent: React.DragEvent) => {
    setDragging(false)
    // The empty-state drop zone handles its own drop and marks the event; without
    // this guard the same file would be ingested (and parsed) twice.
    if (dropEvent.defaultPrevented) return
    dropEvent.preventDefault()
    const files = Array.from(dropEvent.dataTransfer.files ?? [])
    if (files.length) void openFiles(files)
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
        multiple
        className="hidden"
        onChange={(changeEvent) => {
          const files = Array.from(changeEvent.target.files ?? [])
          if (files.length) void openFiles(files)
          changeEvent.target.value = ''
        }}
      />

      <LogInspectorToolbar
        filters={filters}
        onFiltersChange={setFilters}
        searchRef={searchRef}
        prefs={prefs}
        updatePrefs={updatePrefs}
        availableColumns={availableColumns}
        discoveredPaths={discovery.fields.map((field) => field.path)}
        queryError={compiled.error}
        sourceFormat={summary?.format || ''}
        notes={notes}
        onNotesChange={setNotes}
        bookmarkCount={bookmarks.length}
        selectedBookmarked={selectedId !== null && bookmarks.includes(selectedId)}
        hasSelectedEvent={selectedId !== null}
        onToggleBookmark={() => {
          if (selectedId === null) return
          setBookmarks((current) => current.includes(selectedId) ? current.filter((id) => id !== selectedId) : [...current, selectedId])
        }}
        sessionSavedAt={sessionSavedAt}
        onSaveSession={() => {
          const savedAt = Date.now()
          void saveInvestigation(sessionMetadata(savedAt), Object.fromEntries(sources.map((item) => [item.id, item.text]))).then(() => setSessionSavedAt(savedAt))
        }}
        onExportSession={() => downloadText('log-investigation.adomnia-log.json', exportInvestigationMetadata(sessionMetadata()), 'application/json')}
        filtered={filtered}
        sources={sources}
        duplicateCount={deduplication.duplicateCount}
        deduplicated={deduplicated}
        onToggleDeduplication={() => setDeduplicated((value) => !value)}
        menu={menu}
        onMenuChange={setMenu}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((value) => !value)}
        showAnalysis={showAnalysis}
        onToggleAnalysis={() => setShowAnalysis((value) => !value)}
        sortDir={sortDir}
        onToggleSort={() => setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'))}
        masked={masked}
        onToggleMask={() => setMasked((value) => !value)}
        streamPreview={streamPreview}
        onToggleStream={() => setStreamPreview((value) => !value)}
        onPaste={() => void pasteAndAnalyze()}
        onPickFiles={() => fileRef.current?.click()}
        onToggleLive={() => setShowLive((value) => !value)}
        liveActive={showLive}
        liveRunning={live.sources.filter((item) => item.running).length}
        onToggleLargeFile={() => setShowLargeFile((value) => !value)}
        largeFileActive={showLargeFile}
        onRenameSource={renameSource}
        onToggleSource={toggleSource}
        onRemoveSource={removeSource}
        onReplaceSource={(id, file) => void replaceSource(id, file)}
        onClear={clearAll}
        clearDisabled={showEmpty}
        onExport={exportNow}
        onPreviewEvidence={() => setShowEvidence(true)}
      />

      {progress && <ImportProgressBar progress={progress} onCancel={requestAbort} />}
      {error && !showEmpty && <ErrorBar message={error} onDismiss={() => setError('')} />}

      {showEmpty ? (
        <EmptyState
          error={error}
          onSampleId={(id) => {
            const sample = LOG_SAMPLES.find((item) => item.id === id)
            if (sample) void ingest(fromText(sample.text, sample.label, 'sample'))
          }}
          onFile={(file) => void openFiles([file])}
          onFiles={(files) => void openFiles(files)}
          onAnalyzeText={(text) => void ingest(fromText(text, 'Editor', 'editor'))}
        />
      ) : (
        <>
          {showAnalysis && (
            <AnalysisOverview
              analysis={analysis}
              onClose={() => setShowAnalysis(false)}
              onSelectEventId={(id) => setSelectedId(id)}
              comparisonKeys={comparisonKeys}
              onBuildChain={(request: AnalyzedRequest) => setChainKey(requestComparisonKey(request))}
              onToggleComparison={(request) => setComparisonKeys((current) => {
                const key = requestComparisonKey(request)
                if (current.includes(key)) return current.filter((item) => item !== key)
                return [...current.slice(-1), key]
              })}
              onFilterRequest={(request: AnalyzedRequest) => {
                const value = request.correlationId || request.traceId || request.requestId
                const query = `${request.correlationKey}:${value}`
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
                    onSaveQuery={(name) => updatePrefs({
                      savedQueries: [...prefs.savedQueries, { id: `q-${Date.now()}`, name, query: filters.query }],
                    })}
                    onDeleteQuery={(id) => updatePrefs({ savedQueries: prefs.savedQueries.filter((query) => query.id !== id) })}
                    onReset={() => setFilters(EMPTY_FILTERS)}
                  />
                </aside>
                {!narrow && <ResizeHandle label="Resize filters" withLine={false} onMouseDown={startResize('filters')} />}
              </>
            )}

            {!focusedDetail && (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <EventList
                  events={filtered}
                  selectedId={selectedId}
                  onSelect={(event) => { setSelectedId(event.id); setRelated(null) }}
                  density={prefs.density}
                  wrap={prefs.wrap}
                  columns={prefs.columns}
                  columnWidths={prefs.columnWidths}
                  onColumnWidthChange={(id, width) => updatePrefs({ columnWidths: { ...prefs.columnWidths, [id]: width } })}
                  highlights={compiled.highlights}
                  scrollToId={related ? null : selectedId}
                />
              </div>
            )}

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
                      sessionEvents={working}
                      onClose={() => setSelectedId(null)}
                      onFilterBy={(field, value) => setFilters((current) => ({
                        ...current,
                        query: current.query ? `${current.query} ${field}:${value}` : `${field}:${value}`,
                      }))}
                      onShowRelated={(key: CorrelationKey, value: string) => setRelated(correlateEvents(working, key, value))}
                      onSelectEvent={(event) => setSelectedId(event.id)}
                      hiddenFields={prefs.hiddenFields}
                      prefs={prefs}
                      updatePrefs={updatePrefs}
                    />
                  ) : null}
                </aside>
              </>
            )}
          </div>

          <SummaryBar
            shown={filtered.length}
            total={baseEvents.length}
            summary={summary}
            source={source}
            maxEvents={prefs.maxEvents}
            filters={filters}
            onResetFilters={() => setFilters(EMPTY_FILTERS)}
          />
        </>
      )}

      {showLive && <LiveSourcePanel live={live} onClose={() => setShowLive(false)} />}

      {showLargeFile && (
        <LargeFilePanel
          onClose={() => setShowLargeFile(false)}
          onImportPage={(name, text) => {
            void openFiles([new File([text], name, { type: 'text/plain' })])
            setShowLargeFile(false)
          }}
        />
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-surface-0/80 backdrop-blur-[1px]">
          <p className="rounded-lg border border-dashed border-accent px-6 py-4 text-sm text-accent-light">Drop the log file to analyze it</p>
        </div>
      )}
      {chainRequest && (
        <ChainProposalPanel
          events={working}
          request={chainRequest}
          onClose={() => setChainKey(null)}
          onSelectEventId={(id) => { setChainKey(null); setSelectedId(id) }}
        />
      )}
      {comparisonRequests.length === 2 && (
        <RequestDiffPanel
          events={working}
          left={comparisonRequests[0]}
          right={comparisonRequests[1]}
          onClose={() => setComparisonKeys([])}
        />
      )}
      {showEvidence && (
        <EvidencePreviewPanel
          events={evidenceEvents}
          filters={filters}
          notes={notes}
          maskFields={prefs.maskFields}
          hiddenFields={prefs.hiddenFields}
          onClose={() => setShowEvidence(false)}
        />
      )}
    </div>
  )
}

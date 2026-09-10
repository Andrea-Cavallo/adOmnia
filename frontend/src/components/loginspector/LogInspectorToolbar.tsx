import { useState } from 'react'
import {
  Activity,
  Bookmark,
  BookOpen,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpWideNarrow,
  ClipboardPaste,
  Columns3,
  Database,
  Copy,
  Download,
  Eraser,
  EyeOff,
  Filter,
  Files,
  FolderOpen,
  Pause,
  Play,
  Radio,
  Search,
  Save,
  ShieldOff,
  SlidersHorizontal,
  WrapText,
  X,
} from 'lucide-react'
import { exportEvents, type ExportFormat, type LogEvent, type LogFilterState } from '@/lib/loginspector'
import { LIST_COLUMNS, type ListColumnId } from './EventList'
import { MAX_EVENT_CHOICES, type Prefs, type UpdatePrefs } from './prefs'
import { SourceManager } from './SourceManager'
import type { LogSessionSource } from './useLogImport'
import { AddFieldForm, FieldChip, IconToggle, Popover, ToolButton } from './toolbarControls'

export type ToolbarMenu = 'columns' | 'export' | 'mask' | 'sources' | 'session' | null

const SEARCH_HELP = [
  'Text search, or field clauses combined with AND:',
  '  level:error            known field',
  '  merchantId:M-4471      any key in the payload',
  '  http.status:502        nested key',
  '  level:warn|error       alternatives',
  '  pod:pay-*              wildcard',
  '  /timed ?out/           regular expression',
  '  traceId:*              field is present',
  '  -service:noisy-cron    exclude',
].join('\n')

interface LogInspectorToolbarProps {
  filters: LogFilterState
  onFiltersChange: (update: (current: LogFilterState) => LogFilterState) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  prefs: Prefs
  updatePrefs: UpdatePrefs
  availableColumns: ListColumnId[]
  discoveredPaths: string[]
  queryError: string
  sourceFormat: string
  notes: string
  onNotesChange: (value: string) => void
  bookmarkCount: number
  selectedBookmarked: boolean
  hasSelectedEvent: boolean
  onToggleBookmark: () => void
  sessionSavedAt: number | null
  onSaveSession: () => void
  onExportSession: () => void
  filtered: LogEvent[]
  sources: LogSessionSource[]
  duplicateCount: number
  deduplicated: boolean
  onToggleDeduplication: () => void
  menu: ToolbarMenu
  onMenuChange: (menu: ToolbarMenu) => void
  showFilters: boolean
  onToggleFilters: () => void
  showAnalysis: boolean
  onToggleAnalysis: () => void
  sortDir: 'asc' | 'desc'
  onToggleSort: () => void
  masked: boolean
  onToggleMask: () => void
  streamPreview: boolean
  onToggleStream: () => void
  onPaste: () => void
  onPickFiles: () => void
  onToggleLive: () => void
  onToggleLargeFile: () => void
  largeFileActive: boolean
  liveActive: boolean
  liveRunning: number
  onRenameSource: (id: string, name: string) => void
  onToggleSource: (id: string) => void
  onRemoveSource: (id: string) => void
  onReplaceSource: (id: string, file: File) => void
  onClear: () => void
  clearDisabled: boolean
  onExport: (format: ExportFormat) => void
  onPreviewEvidence: () => void
}

export function LogInspectorToolbar({
  filters,
  onFiltersChange,
  searchRef,
  prefs,
  updatePrefs,
  availableColumns,
  discoveredPaths,
  queryError,
  sourceFormat,
  notes,
  onNotesChange,
  bookmarkCount,
  selectedBookmarked,
  hasSelectedEvent,
  onToggleBookmark,
  sessionSavedAt,
  onSaveSession,
  onExportSession,
  filtered,
  sources,
  duplicateCount,
  deduplicated,
  onToggleDeduplication,
  menu,
  onMenuChange,
  showFilters,
  onToggleFilters,
  showAnalysis,
  onToggleAnalysis,
  sortDir,
  onToggleSort,
  masked,
  onToggleMask,
  streamPreview,
  onToggleStream,
  onPaste,
  onPickFiles,
  onToggleLive,
  onToggleLargeFile,
  largeFileActive,
  liveActive,
  liveRunning,
  onRenameSource,
  onToggleSource,
  onRemoveSource,
  onReplaceSource,
  onClear,
  clearDisabled,
  onExport,
  onPreviewEvidence,
}: LogInspectorToolbarProps) {
  const [newMaskField, setNewMaskField] = useState('')
  const [newHiddenField, setNewHiddenField] = useState('')

  const toggleMenu = (next: Exclude<ToolbarMenu, null>) => onMenuChange(menu === next ? null : next)

  const addMaskField = () => {
    const field = newMaskField.trim().toLowerCase()
    if (field && !prefs.maskFields.includes(field)) updatePrefs({ maskFields: [...prefs.maskFields, field] })
    setNewMaskField('')
  }

  const addHiddenField = () => {
    const field = newHiddenField.trim().toLowerCase()
    if (field && !prefs.hiddenFields.includes(field)) updatePrefs({ hiddenFields: [...prefs.hiddenFields, field] })
    setNewHiddenField('')
  }

  const toggleColumn = (id: ListColumnId) => {
    updatePrefs({
      columns: prefs.columns.includes(id)
        ? prefs.columns.filter((current) => current !== id)
        : [...prefs.columns, id],
    })
  }

  const moveColumn = (id: ListColumnId, delta: number) => {
    const index = prefs.columns.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= prefs.columns.length) return
    const columns = [...prefs.columns]
    ;[columns[index], columns[target]] = [columns[target], columns[index]]
    updatePrefs({ columns })
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-1 px-3 py-2">
      <ToolButton onClick={onPaste} icon={<ClipboardPaste size={12} />} label="Paste" title="Paste and analyze (Ctrl+V)" />
      <ToolButton onClick={onPickFiles} icon={<FolderOpen size={12} />} label="Open" title="Open one or more log files" />
      <ToolButton
        onClick={onToggleLive}
        icon={<Radio size={12} className={liveRunning > 0 ? 'text-success' : undefined} />}
        label={liveRunning > 0 ? `Live ${liveRunning}` : 'Live'}
        title="Tail a local file or stream kubectl / oc / docker logs"
        active={liveActive}
      />
      <ToolButton
        onClick={onToggleLargeFile}
        icon={<Database size={12} />}
        label="Large file"
        title="Index a file too large for memory and browse it page by page"
        active={largeFileActive}
      />
      {sources.length > 0 && (
        <div className="relative">
          <ToolButton
            onClick={() => toggleMenu('sources')}
            icon={<Files size={12} />}
            label={`${sources.filter((item) => item.enabled).length}/${sources.length}`}
            title="Manage investigation sources"
          />
          {menu === 'sources' && (
            <Popover onClose={() => onMenuChange(null)} extraWide>
              <SourceManager
                sources={sources}
                onAdd={() => { onMenuChange(null); onPickFiles() }}
                onRename={onRenameSource}
                onToggle={onToggleSource}
                onRemove={onRemoveSource}
                onReplace={onReplaceSource}
              />
            </Popover>
          )}
        </div>
      )}
      {sources.length > 0 && (
        <div className="relative">
          <IconToggle active={menu === 'session'} onClick={() => toggleMenu('session')} title="Investigation session, notes and bookmarks">
            <BookOpen size={12} />
          </IconToggle>
          {menu === 'session' && (
            <Popover onClose={() => onMenuChange(null)} wide>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">Persistent investigation</p>
              <p className="px-2 pb-2 text-[9px] text-text-4">Autosaved locally{sessionSavedAt ? ` · ${new Date(sessionSavedAt).toLocaleTimeString()}` : ''}</p>
              <textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Investigation notes…"
                className="mx-1 h-24 w-[calc(100%-8px)] resize-none rounded border border-border-2 bg-surface-0 p-2 text-[10px] text-text-1 outline-none focus:border-accent"
              />
              <button onClick={onToggleBookmark} disabled={!hasSelectedEvent} className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-[10px] text-text-2 hover:bg-surface-2 disabled:opacity-35">
                <Bookmark size={11} className={selectedBookmarked ? 'fill-accent text-accent' : ''} />
                {selectedBookmarked ? 'Remove selected bookmark' : 'Bookmark selected event'} · {bookmarkCount}
              </button>
              <button onClick={onSaveSession} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[10px] text-text-2 hover:bg-surface-2"><Save size={11} /> Save now</button>
              <button onClick={onExportSession} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[10px] text-text-2 hover:bg-surface-2"><Download size={11} /> Export session metadata</button>
            </Popover>
          )}
        </div>
      )}
      {duplicateCount > 0 && (
        <IconToggle
          active={deduplicated}
          onClick={onToggleDeduplication}
          title={`${duplicateCount.toLocaleString()} repeated acquisition copies found — ${deduplicated ? 'show all' : 'fold copies'}`}
        >
          <Copy size={12} />
        </IconToggle>
      )}
      <ToolButton onClick={onClear} icon={<Eraser size={12} />} label="Clear" title="Clear everything (Ctrl+L)" disabled={clearDisabled} />

      <span className="mx-1 h-5 w-px bg-border-2" />

      <div className="relative min-w-[200px] flex-1">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
        <input
          ref={searchRef}
          value={filters.query}
          list="log-inspector-query-fields"
          aria-invalid={Boolean(queryError)}
          onChange={(changeEvent) => onFiltersChange((current) => ({ ...current, query: changeEvent.target.value }))}
          placeholder="Search — level:warn|error  merchantId:M-4471  pod:pay-*  /regex/  -noisy"
          aria-label="Search events"
          title={SEARCH_HELP}
          className={`h-7 w-full rounded border bg-surface-0 pl-7 pr-7 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent ${queryError ? 'border-error' : 'border-border-2'}`}
        />
        <datalist id="log-inspector-query-fields">
          {discoveredPaths.map((path) => <option key={path} value={path} />)}
        </datalist>
        {filters.query && (
          <button
            onClick={() => onFiltersChange((current) => ({ ...current, query: '' }))}
            title="Clear the query"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-1"
          >
            <X size={12} />
          </button>
        )}
        {queryError && <span className="absolute left-0 top-8 z-20 rounded border border-error/40 bg-surface-1 px-2 py-1 text-[9px] text-error shadow-lg">{queryError}</span>}
      </div>

      <IconToggle active={showFilters} onClick={onToggleFilters} title="Filters (Ctrl+Shift+F)"><Filter size={12} /></IconToggle>
      <IconToggle active={showAnalysis} onClick={onToggleAnalysis} title="Request analysis"><Activity size={12} /></IconToggle>
      <IconToggle
        active={sortDir === 'desc'}
        onClick={onToggleSort}
        title={sortDir === 'asc' ? 'Oldest first — click for newest first' : 'Newest first — click for oldest first'}
      >
        {sortDir === 'asc' ? <ArrowUpWideNarrow size={12} /> : <ArrowDownWideNarrow size={12} />}
      </IconToggle>
      <IconToggle
        active={prefs.density === 'comfortable'}
        onClick={() => updatePrefs({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' })}
        title={`Density: ${prefs.density}`}
      >
        <span className="font-mono text-[10px]">{prefs.density === 'compact' ? 'Aa' : 'AA'}</span>
      </IconToggle>
      <IconToggle active={prefs.wrap} onClick={() => updatePrefs({ wrap: !prefs.wrap })} title="Word wrap"><WrapText size={12} /></IconToggle>
      <IconToggle active={masked} onClick={onToggleMask} title="Clear sensitive fields (tokens, cookies, passwords)">
        {masked ? <ShieldOff size={12} /> : <EyeOff size={12} />}
      </IconToggle>

      <div className="relative">
        <IconToggle active={menu === 'mask'} onClick={() => toggleMenu('mask')} title="Configure sensitive fields">
          <SlidersHorizontal size={12} />
        </IconToggle>
        {menu === 'mask' && (
          <Popover onClose={() => onMenuChange(null)} wide>
            {prefs.columns.length > 0 && (
              <div className="mb-1 border-b border-border-2 pb-1">
                <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">Pinned order</p>
                {prefs.columns.map((id, index) => (
                  <div key={id} className="flex items-center gap-1 px-2 py-0.5 font-mono text-[9px] text-text-2">
                    <span className="min-w-0 flex-1 truncate">{id.startsWith('field:') ? id.slice(6) : LIST_COLUMNS.find((column) => column.id === id)?.label || id}</span>
                    <button disabled={index === 0} onClick={() => moveColumn(id, -1)} title="Move left" className="disabled:opacity-25"><ArrowLeft size={10} /></button>
                    <button disabled={index === prefs.columns.length - 1} onClick={() => moveColumn(id, 1)} title="Move right" className="disabled:opacity-25"><ArrowRight size={10} /></button>
                  </div>
                ))}
                <button
                  onClick={() => updatePrefs({ columnPresets: { ...prefs.columnPresets, [sourceFormat || 'mixed']: { columns: prefs.columns, widths: prefs.columnWidths } } })}
                  className="mx-2 mt-1 flex h-6 items-center gap-1 rounded border border-accent/35 px-2 text-[9px] text-accent-light hover:bg-accent/10"
                >
                  <Save size={9} /> Save preset for {sourceFormat || 'mixed'}
                </button>
              </div>
            )}
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">Additional sensitive fields</p>
            <div className="px-1 pb-1">
              <AddFieldForm
                value={newMaskField}
                onChange={setNewMaskField}
                onSubmit={addMaskField}
                placeholder="e.g. customer_email"
                action="Add"
              />
            </div>
            {prefs.maskFields.length > 0 ? (
              <div className="flex max-h-36 flex-wrap gap-1 overflow-auto px-1 py-1">
                {prefs.maskFields.map((field) => (
                  <FieldChip
                    key={field}
                    field={field}
                    title={`Remove ${field}`}
                    onRemove={() => updatePrefs({ maskFields: prefs.maskFields.filter((item) => item !== field) })}
                  />
                ))}
              </div>
            ) : (
              <p className="px-2 py-1 text-[10px] text-text-4">
                Built-in detection already covers tokens, passwords, cookies, sessions and authorization headers.
              </p>
            )}
          </Popover>
        )}
      </div>

      <IconToggle
        active={!streamPreview}
        onClick={onToggleStream}
        title={streamPreview ? 'Pause progressive rendering' : 'Resume progressive rendering'}
      >
        {streamPreview ? <Pause size={12} /> : <Play size={12} />}
      </IconToggle>

      <div className="relative">
        <IconToggle active={menu === 'columns'} onClick={() => toggleMenu('columns')} title="Choose columns">
          <Columns3 size={12} />
        </IconToggle>
        {menu === 'columns' && (
          <Popover onClose={() => onMenuChange(null)} wide>
            {LIST_COLUMNS.filter((column) => availableColumns.includes(column.id)).map((column) => (
              <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] text-text-2 hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={prefs.columns.includes(column.id)}
                  onChange={() => toggleColumn(column.id)}
                />
                {column.label}
              </label>
            ))}
            {discoveredPaths.length > 0 && (
              <div className="mt-1 border-t border-border-2 pt-1">
                <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">Fields in this log</p>
                <div className="max-h-40 overflow-auto">
                  {discoveredPaths.slice(0, 80).map((path) => {
                    const id = `field:${path}` as ListColumnId
                    return (
                      <label key={path} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 font-mono text-[10px] text-text-2 hover:bg-surface-2">
                        <input type="checkbox" checked={prefs.columns.includes(id)} onChange={() => toggleColumn(id)} />
                        <span className="truncate" title={path}>{path}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="mt-1 border-t border-border-2 px-1 pt-2">
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">Hide noisy JSON fields</p>
              <AddFieldForm
                value={newHiddenField}
                onChange={setNewHiddenField}
                onSubmit={addHiddenField}
                placeholder="e.g. labels"
                action="Hide"
              />
              {prefs.hiddenFields.length > 0 && (
                <div className="flex max-h-24 flex-wrap gap-1 overflow-auto py-1.5">
                  {prefs.hiddenFields.map((field) => (
                    <FieldChip
                      key={field}
                      field={field}
                      title={`Show ${field} again`}
                      onRemove={() => updatePrefs({ hiddenFields: prefs.hiddenFields.filter((item) => item !== field) })}
                    />
                  ))}
                </div>
              )}
            </div>
          </Popover>
        )}
      </div>

      <div className="relative">
        <ToolButton
          onClick={() => toggleMenu('export')}
          icon={<Download size={12} />}
          label="Export"
          title="Export the filtered events (Ctrl+E)"
          disabled={filtered.length === 0}
        />
        {menu === 'export' && (
          <Popover onClose={() => onMenuChange(null)}>
            {(['json', 'jsonl', 'text'] as ExportFormat[]).map((format) => (
              <button
                key={format}
                onClick={() => onExport(format)}
                className="w-full rounded px-2 py-1 text-left text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1"
              >
                {format.toUpperCase()} — {filtered.length} events
              </button>
            ))}
            <button
              onClick={() => {
                navigator.clipboard.writeText(exportEvents(filtered, 'text')).catch(() => {})
                onMenuChange(null)
              }}
              className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-border-2 px-2 py-1 text-left text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1"
            >
              <Copy size={11} /> Copy to clipboard
            </button>
            <button
              onClick={() => { onMenuChange(null); onPreviewEvidence() }}
              className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-border-2 px-2 py-1 text-left text-[11px] text-success hover:bg-surface-2"
            >
              <ShieldOff size={11} /> Preview redacted evidence package
            </button>
          </Popover>
        )}
      </div>

      <select
        value={prefs.maxEvents}
        onChange={(changeEvent) => updatePrefs({ maxEvents: Number(changeEvent.target.value) })}
        title="Maximum events retained per import"
        aria-label="Maximum events retained per import"
        className="h-7 rounded border border-border-2 bg-surface-0 px-1 font-mono text-[10px] text-text-2 outline-none focus:border-accent"
      >
        {MAX_EVENT_CHOICES.map((limit) => (
          <option key={limit} value={limit}>{(limit / 1000).toFixed(0)}k max</option>
        ))}
      </select>
    </div>
  )
}

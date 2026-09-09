import { Loader2, X } from 'lucide-react'
import { hasActiveFilters, type LogFilterState, type LogSourceResult, type ParseSummary } from '@/lib/loginspector'
import type { ImportProgress } from './useLogImport'

/** Parse progress with a cancel button, shown only while an import runs. */
export function ImportProgressBar({ progress, onCancel }: { progress: ImportProgress; onCancel: () => void }) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border-1 bg-surface-1 px-3 py-1.5">
      <Loader2 size={12} className="animate-spin text-accent-light" aria-hidden="true" />
      <span className="font-mono text-[10px] text-text-3">
        Parsing {progress.done.toLocaleString()} / {progress.total.toLocaleString()} lines
      </span>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 min-w-0 flex-1 overflow-hidden rounded bg-surface-2"
      >
        <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${percent}%` }} />
      </div>
      <button
        onClick={onCancel}
        className="h-6 rounded border border-error/40 px-2 text-[10px] text-error hover:bg-error/10"
      >
        Cancel
      </button>
    </div>
  )
}

export function ErrorBar({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
      <span className="min-w-0 flex-1">{message}</span>
      <button onClick={onDismiss} title="Dismiss" className="text-warning/70 hover:text-warning"><X size={12} /></button>
    </div>
  )
}

interface SummaryBarProps {
  shown: number
  total: number
  summary: ParseSummary | null
  source: LogSourceResult | null
  maxEvents: number
  filters: LogFilterState
  onResetFilters: () => void
}

/** What the import produced, and what the filters left of it. */
export function SummaryBar({ shown, total, summary, source, maxEvents, filters, onResetFilters }: SummaryBarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border-1 bg-surface-1 px-3 py-1.5 font-mono text-[10px] text-text-3">
      <span className="text-text-2">{shown.toLocaleString()} shown</span>
      <span>/ {total.toLocaleString()} events</span>
      {summary && (
        <>
          <span>{summary.valid.toLocaleString()} valid</span>
          {summary.invalid > 0 && <span className="text-warning">{summary.invalid.toLocaleString()} unparsed</span>}
          {summary.errorCount > 0 && <span className="text-error">{summary.errorCount.toLocaleString()} errors</span>}
          {summary.warningCount > 0 && <span className="text-warning/80">{summary.warningCount.toLocaleString()} warnings</span>}
          <span className="text-text-4">{summary.totalLines.toLocaleString()} lines · {summary.format} · {summary.durationMs}ms</span>
          {summary.truncated && <span className="text-warning">truncated at {maxEvents.toLocaleString()}</span>}
        </>
      )}
      {source && <span className="truncate text-text-4">{source.name}</span>}
      {hasActiveFilters(filters) && (
        <button onClick={onResetFilters} className="ml-auto text-accent-light hover:text-accent">
          Reset filters
        </button>
      )}
    </div>
  )
}

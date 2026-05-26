import { useMemo, useState } from 'react'
import { ArrowRight, Check, Clock3, Copy, History, Search, Trash2 } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import type { RequestHistoryEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'success' | 'error'

function formatTime(recordedAt: string | null): string {
  return recordedAt ? new Date(recordedAt).toLocaleString() : 'Saved before request tracking'
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function statusTone(entry: RequestHistoryEntry): string {
  if (entry.response.error || entry.response.status >= 400) return 'text-error bg-error/10 border-error/20'
  if (entry.response.status >= 200 && entry.response.status < 300) return 'text-success bg-success/10 border-success/20'
  return 'text-text-2 bg-surface-3 border-border-2'
}

function matchesStatus(entry: RequestHistoryEntry, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  const failed = Boolean(entry.response.error) || entry.response.status >= 400
  return filter === 'error' ? failed : !failed
}

function searchableText(entry: RequestHistoryEntry): string {
  return [
    entry.request?.name,
    entry.request?.method,
    entry.request?.url,
    entry.response.status,
    entry.response.statusText,
    entry.response.contentType,
    entry.response.body,
    entry.response.error?.message,
  ].join(' ').toLowerCase()
}

export function RequestHistoryPanel() {
  const entries = useTabsStore((s) => s.responseHistory)
  const openHistoryEntry = useTabsStore((s) => s.openHistoryEntry)
  const removeHistoryEntry = useTabsStore((s) => s.removeHistoryEntry)
  const clearResponseHistory = useTabsStore((s) => s.clearResponseHistory)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const filteredEntries = useMemo(() => {
    const term = query.trim().toLowerCase()
    return entries.filter((entry) =>
      matchesStatus(entry, statusFilter) && (!term || searchableText(entry).includes(term)))
  }, [entries, query, statusFilter])
  const selected = filteredEntries.find((entry) => entry.id === selectedId) ?? filteredEntries[0] ?? null

  const reopen = (entry: RequestHistoryEntry) => {
    if (!entry.request) return
    openHistoryEntry(entry.id)
    setActiveRail('collections')
  }

  const copyBody = async (entry: RequestHistoryEntry) => {
    await navigator.clipboard.writeText(entry.response.body)
    setCopiedId(entry.id)
    window.setTimeout(() => setCopiedId((id) => id === entry.id ? null : id), 1500)
  }

  const clearAll = () => {
    if (window.confirm('Clear every saved response from Request History?')) {
      clearResponseHistory()
      setSelectedId(null)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface-0">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border-1 bg-surface-1">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-1">
            <History size={15} className="text-accent" />
            Saved Request History
          </h2>
          <p className="mt-1 text-[11px] text-text-3">
            Search local request snapshots and reopen a captured response without sending it again.
          </p>
        </div>
        <button
          onClick={clearAll}
          disabled={entries.length === 0}
          className="h-8 flex items-center gap-1.5 px-3 rounded-md border border-border-2 text-[11px] text-text-3 hover:text-error hover:border-error/30 disabled:opacity-35 disabled:pointer-events-none transition-colors"
        >
          <Trash2 size={12} />
          Clear history
        </button>
      </div>

      <div className="flex items-center gap-3 px-5 py-3 border-b border-border-1">
        <label className="relative flex-1 max-w-lg">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search URL, request name, method, status or response text"
            className="h-9 w-full rounded-lg border border-border-2 bg-surface-1 pl-9 pr-3 text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent/60"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="h-9 rounded-lg border border-border-2 bg-surface-1 px-3 text-xs text-text-2 outline-none focus:border-accent/60"
        >
          <option value="all">All statuses</option>
          <option value="success">Successful</option>
          <option value="error">Errors</option>
        </select>
        <span className="font-mono text-[11px] text-text-4">
          {filteredEntries.length} / {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 grid place-items-center">
          <div className="max-w-sm text-center">
            <Clock3 size={30} className="mx-auto mb-3 text-text-4" />
            <p className="text-sm font-medium text-text-2">No saved requests yet</p>
            <p className="mt-1 text-xs leading-relaxed text-text-4">
              Send an API request and its response will appear here when response history is enabled.
            </p>
          </div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="flex-1 grid place-items-center text-xs text-text-4">
          No saved requests match this search.
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(310px,410px)_1fr]">
          <div className="overflow-y-auto border-r border-border-1">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'group flex items-stretch border-b border-border-1 transition-colors',
                  selected?.id === entry.id ? 'bg-accent/8' : 'hover:bg-surface-1',
                )}
              >
                <button
                  onClick={() => setSelectedId(entry.id)}
                  className="min-w-0 flex-1 px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-border-2 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-2">
                      {entry.request?.method ?? 'HTTP'}
                    </span>
                    <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', statusTone(entry))}>
                      {entry.response.error?.code ?? entry.response.status}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-text-4">{entry.response.ms} ms</span>
                  </div>
                  <p className="mt-2 truncate text-xs font-medium text-text-1">
                    {entry.request?.name || entry.request?.url || 'Legacy saved response'}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-text-3">
                    {entry.request?.url || entry.response.contentType || 'Request metadata unavailable'}
                  </p>
                  <p className="mt-2 text-[10px] text-text-4">{formatTime(entry.recordedAt)}</p>
                </button>
                <button
                  onClick={() => removeHistoryEntry(entry.id)}
                  aria-label="Remove history entry"
                  className="w-9 opacity-0 group-hover:opacity-100 text-text-4 hover:text-error transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {selected && (
            <div className="min-w-0 flex flex-col overflow-hidden">
              <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border-1 bg-surface-1">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-1">
                    {selected.request?.name || 'Legacy saved response'}
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-text-3">
                    {selected.request ? `${selected.request.method} ${selected.request.url || '(no URL)'}` : 'Request metadata was not captured for this saved response.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => void copyBody(selected)}
                    className="h-8 flex items-center gap-1.5 px-3 rounded-md border border-border-2 text-[11px] text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors"
                  >
                    {copiedId === selected.id ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                    {copiedId === selected.id ? 'Copied' : 'Copy body'}
                  </button>
                  <button
                    onClick={() => reopen(selected)}
                    disabled={!selected.request}
                    title={selected.request ? 'Open this captured request in a new tab' : 'Legacy entries cannot be reopened'}
                    className="h-8 flex items-center gap-1.5 px-3 rounded-md bg-accent/15 text-[11px] font-medium text-accent hover:bg-accent/25 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    Open in tab <ArrowRight size={12} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-5 px-5 py-3 border-b border-border-1 font-mono text-[11px] text-text-3">
                <span className={cn('rounded border px-2 py-1', statusTone(selected))}>
                  {selected.response.error?.code ?? `${selected.response.status} ${selected.response.statusText}`}
                </span>
                <span>{selected.response.ms} ms</span>
                <span>{formatSize(selected.response.size)}</span>
                <span className="truncate">{selected.response.contentType}</span>
                <span className="ml-auto text-text-4">{formatTime(selected.recordedAt)}</span>
              </div>

              <pre className="flex-1 overflow-auto m-0 p-5 bg-surface-0 font-mono text-[12px] leading-relaxed text-text-2 whitespace-pre-wrap break-words">
                {selected.response.error?.message || selected.response.body || '(empty response body)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Columns3, Download, Maximize2, Minimize2, RefreshCw, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CellValue, detectCellType, inferColumnKind, type DbResult } from './dbShared'

type ResultTab = 'results' | 'json' | 'stats' | 'logs'

interface ResultsViewProps {
  result: DbResult | null
  isMongo: boolean
  error: string
  logs: string[]
  onExportJson: () => void
  onExportCsv: () => void
  onRerun: () => void
}

const PAGE_SIZES = [25, 50, 100, 200]

export function ResultsView({ result, isMongo, error, logs, onExportJson, onExportCsv, onRerun }: ResultsViewProps) {
  const [tab, setTab] = useState<ResultTab>('results')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [exportMenu, setExportMenu] = useState(false)
  const [columnsMenu, setColumnsMenu] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => { setPage(1); setTab('results'); setHiddenColumns([]) }, [result])

  const rows = result?.rows ?? []
  const columns = result?.columns ?? []
  const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column))

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((r) => columns.some((c) => String(r[c] ?? '').toLowerCase().includes(q)))
  }, [rows, columns, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)
  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, filtered.length)

  const tabs: { id: ResultTab; label: string }[] = [
    { id: 'results', label: 'Results' },
    { id: 'json', label: 'JSON' },
    { id: 'stats', label: 'Stats' },
    { id: 'logs', label: 'Logs' },
  ]

  return (
    <div className={cn(
      'flex min-h-0 flex-1 flex-col bg-surface-0',
      expanded && 'fixed inset-3 z-[240] rounded-md border border-border-2 shadow-2xl',
    )}>
      {/* tab strip */}
      <div className="flex h-9 flex-none items-center gap-0.5 border-b border-border-1 bg-surface-1 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative h-9 px-3 text-[12px] font-medium transition-colors',
              tab === t.id ? 'text-text-1' : 'text-text-3 hover:text-text-2'
            )}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {/* result toolbar */}
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
        {result ? (
          <span className="text-[11.5px] text-text-3">
            <b className="font-semibold text-text-1">{result.columns?.length ? filtered.length : result.rowsAffected}</b>{' '}
            {result.columns?.length ? (isMongo ? 'documents' : 'rows') : 'affected'}
            <span className="mx-1.5 text-text-4">·</span>
            <span className="text-success">{(result.durationMs / 1000).toFixed(3)}s</span>
            {result.limited && <span className="ml-1.5 text-warning">· auto-limited</span>}
          </span>
        ) : (
          <span className="text-[11.5px] text-text-4">No results</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {result?.columns?.length ? (
            <div className="relative mr-1">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Filter rows"
                className="h-7 w-40 rounded-md border border-border-2 bg-surface-2 pl-7 pr-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
              />
            </div>
          ) : null}
          <div className="relative">
            <button
              onClick={() => setColumnsMenu((value) => !value)}
              disabled={!columns.length}
              className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"
              title="Choose columns"
            >
              <Columns3 size={13} />
            </button>
            {columnsMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setColumnsMenu(false)} />
                <div className="absolute right-0 top-full z-30 mt-1 max-h-64 w-52 overflow-y-auto rounded-md border border-border-2 bg-surface-3 p-1 shadow-xl">
                  {columns.map((column) => {
                    const visible = !hiddenColumns.includes(column)
                    const lastVisible = visible && visibleColumns.length === 1
                    return (
                      <button
                        key={column}
                        disabled={lastVisible}
                        onClick={() => setHiddenColumns((current) => visible ? [...current, column] : current.filter((item) => item !== column))}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-text-2 hover:bg-surface-4 disabled:opacity-50"
                      >
                        <span className="grid h-4 w-4 place-items-center rounded border border-border-3">{visible && <Check size={11} className="text-accent" />}</span>
                        <span className="truncate font-mono">{column}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setExportMenu((v) => !v)} disabled={!result} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30" title="Export"><Download size={13} /></button>
            {exportMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setExportMenu(false)} />
                <div className="absolute right-0 top-full z-30 mt-1 w-28 overflow-hidden rounded-md border border-border-2 bg-surface-3 py-1 shadow-xl">
                  <button onClick={() => { onExportJson(); setExportMenu(false) }} className="block w-full px-3 py-1.5 text-left text-[11.5px] text-text-2 hover:bg-surface-4 hover:text-text-1">Export JSON</button>
                  <button onClick={() => { onExportCsv(); setExportMenu(false) }} className="block w-full px-3 py-1.5 text-left text-[11.5px] text-text-2 hover:bg-surface-4 hover:text-text-1">Export CSV</button>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setExpanded((value) => !value)} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1" title={expanded ? 'Exit expanded results' : 'Expand results'}>
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="m-4 rounded-lg border border-error/30 bg-error/8 p-4 font-mono text-[12px] leading-relaxed text-error">{error}</div>
        ) : !result ? (
          <EmptyState />
        ) : tab === 'json' ? (
          <pre className="p-4 font-mono text-[11.5px] leading-relaxed text-text-2">{JSON.stringify(result.rows, null, 2)}</pre>
        ) : tab === 'stats' ? (
          <StatsView result={result} isMongo={isMongo} rowCount={filtered.length} />
        ) : tab === 'logs' ? (
          <div className="p-4 font-mono text-[11.5px] leading-relaxed text-text-3">
            {logs.length === 0 ? <span className="text-text-4">No log output.</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        ) : result.columns?.length ? (
          <DataTable columns={visibleColumns} rows={pageRows} allRows={rows} startIndex={(page - 1) * pageSize} />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-text-4">
            Statement executed. Rows affected: {result.rowsAffected}
          </div>
        )}
      </div>

      {/* pagination */}
      {result?.columns?.length && tab === 'results' ? (
        <div className="flex h-10 flex-none items-center gap-3 border-t border-border-1 bg-surface-1 px-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 text-text-3 hover:text-text-1 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <span className="grid h-7 min-w-[28px] place-items-center rounded-md border border-accent/50 bg-accent/10 px-2 text-[11.5px] font-medium text-accent">{page}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="grid h-7 w-7 place-items-center rounded-md border border-border-2 text-text-3 hover:text-text-1 disabled:opacity-30"><ChevronRight size={14} /></button>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
            className="h-7 rounded-md border border-border-2 bg-surface-2 pl-2 pr-1 text-[11px] text-text-1 outline-none focus:border-accent/50"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <span className="ml-auto text-[11px] text-text-4">{rangeStart}–{rangeEnd} of {filtered.length}</span>
          <button onClick={onRerun} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1" title="Re-run"><RefreshCw size={13} /></button>
        </div>
      ) : null}
    </div>
  )
}

function DataTable({ columns, rows, allRows, startIndex }: { columns: string[]; rows: Record<string, unknown>[]; allRows: Record<string, unknown>[]; startIndex: number }) {
  return (
    <table className="min-w-full border-separate border-spacing-0 text-left">
      <thead className="sticky top-0 z-10">
        <tr>
          <th className="sticky left-0 z-20 w-10 border-b border-r border-border-1 bg-surface-2" style={{ height: 38 }} />
          {columns.map((col) => (
            <th key={col} className="whitespace-nowrap border-b border-r border-border-1 bg-surface-2 px-3.5 text-left align-middle" style={{ height: 38 }}>
              <div className="text-[11.5px] font-semibold text-text-1">{col}</div>
              <div className="text-[9.5px] font-normal text-text-4">{inferColumnKind(col, allRows)}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx} className="group">
            <td className="sticky left-0 w-10 border-b border-r border-border-1 bg-surface-1 pr-2 text-right font-mono text-[10px] text-text-4 group-hover:bg-surface-2" style={{ height: 40 }}>
              {startIndex + idx + 1}
            </td>
            {columns.map((col) => {
              const isRight = detectCellType(row[col]) === 'num'
              return (
                <td
                  key={col}
                  className={cn('max-w-[360px] truncate border-b border-r border-border-1 px-3.5 font-mono text-[11.5px] group-hover:bg-surface-1', isRight && 'text-right')}
                  style={{ height: 40 }}
                >
                  <CellValue value={row[col]} />
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatsView({ result, isMongo, rowCount }: { result: DbResult; isMongo: boolean; rowCount: number }) {
  const stats: { label: string; value: string }[] = [
    { label: isMongo ? 'Documents' : 'Rows returned', value: result.columns?.length ? String(rowCount) : '—' },
    { label: 'Rows affected', value: String(result.rowsAffected) },
    { label: 'Columns', value: String(result.columns?.length ?? 0) },
    { label: 'Duration', value: `${result.durationMs} ms` },
    { label: 'Driver', value: result.driver },
    { label: 'Statement', value: result.statementType || '—' },
    { label: 'Auto-limited', value: result.limited ? 'yes' : 'no' },
    { label: 'Destructive', value: result.destructive ? 'yes' : 'no' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-border-1 bg-surface-1 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-text-4">{s.label}</div>
          <div className="mt-1 font-mono text-[14px] font-medium text-text-1">{s.value}</div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-text-4">
      <div className="grid h-12 w-12 place-items-center rounded-xl border border-border-2 bg-surface-1">
        <Search size={20} />
      </div>
      <span className="text-[12px]">Run a query to see results.</span>
    </div>
  )
}

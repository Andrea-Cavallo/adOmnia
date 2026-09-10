import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeSelectFolder } from '@/lib/fileUtils'
import { useServerPort } from '@/lib/useServerPort'
import {
  cancelLogIndex,
  closeLogIndex,
  logIndexStatus,
  openLogIndex,
  queryLogIndex,
  type LogIndexEntry,
  type LogIndexPage,
  type LogIndexStatus,
} from '@/lib/logindex-api'
import { LEVEL_STYLE } from './EventList'

const PAGE_SIZE = 200
const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

function megabytes(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`
  return `${(bytes / (1 << 20)).toFixed(1)} MB`
}

interface LargeFilePanelProps {
  onClose: () => void
  /** Pull the visible page into the normal in-memory investigation. */
  onImportPage: (name: string, text: string) => void
}

/**
 * Browsing a log too large to hold in memory. The file stays on disk: the
 * backend indexes it once and every page here is a byte-range read, so a 1 GB
 * file costs the renderer one page, not one gigabyte.
 */
export function LargeFilePanel({ onClose, onImportPage }: LargeFilePanelProps) {
  const port = useServerPort()
  const [path, setPath] = useState('')
  const [status, setStatus] = useState<LogIndexStatus | null>(null)
  const [page, setPage] = useState<LogIndexPage | null>(null)
  const [cursors, setCursors] = useState<number[]>([0])
  const [levels, setLevels] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const idRef = useRef('')

  // The index is a backend resource: leaving the panel must release it.
  useEffect(() => () => { if (idRef.current) void closeLogIndex(port, idRef.current) }, [port])

  const load = useCallback(async (id: string, from: number) => {
    setBusy(true)
    const result = await queryLogIndex(port, {
      id, from, limit: PAGE_SIZE, levels, text: text.trim(), budgetMs: 2000,
    })
    setBusy(false)
    setPage(result)
    if (result.error) setError(result.error)
  }, [levels, port, text])

  const open = async () => {
    const target = path.trim()
    if (!target) { setError('Enter the full path of the log file.'); return }
    setError('')
    setBusy(true)
    if (idRef.current) await closeLogIndex(port, idRef.current)
    const opened = await openLogIndex(port, target)
    setBusy(false)
    if (opened.error || !opened.id) { setError(opened.error || 'Could not index this file.'); return }
    idRef.current = opened.id
    setStatus(opened)
    setCursors([0])
    void load(opened.id, 0)
  }

  // Indexing runs in the background: the first pages are browsable while it
  // is still walking the file.
  useEffect(() => {
    if (!status || status.done || !idRef.current) return
    const timer = window.setInterval(() => {
      void logIndexStatus(port, idRef.current).then((next) => {
        setStatus(next)
        if (next.done) window.clearInterval(timer)
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [port, status])

  const runSearch = () => {
    if (!idRef.current) return
    setCursors([0])
    void load(idRef.current, 0)
  }

  const nextPage = () => {
    if (!page || !idRef.current || page.nextFrom < 0) return
    setCursors((current) => [...current, page.nextFrom])
    void load(idRef.current, page.nextFrom)
  }

  const previousPage = () => {
    if (cursors.length < 2 || !idRef.current) return
    const trimmed = cursors.slice(0, -1)
    setCursors(trimmed)
    void load(idRef.current, trimmed[trimmed.length - 1])
  }

  const progress = status && status.size > 0 ? Math.min(100, (status.bytesRead / status.size) * 100) : 0

  return (
    <div className="absolute inset-4 z-40 flex flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-0 shadow-[0_18px_60px_rgba(0,0,0,.65)]">
      <header className="flex items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <Database size={12} className="text-accent" />
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-text-2">
          Large file — indexed on disk, never loaded into memory
        </p>
        <button onClick={onClose} title="Close and release the index" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-error"><X size={12} /></button>
      </header>

      <div className="shrink-0 border-b border-border-1 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void open() }}
            placeholder="Full path of the log file"
            className="h-6 min-w-[300px] flex-1 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-2 outline-none focus:border-accent/50"
          />
          <button
            onClick={() => void safeSelectFolder('Select the folder that contains the log file').then(
              (folder) => { if (folder) setPath(folder.endsWith('\\') ? folder : `${folder}\\`) },
              (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not open the folder picker'),
            )}
            className="h-6 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:text-text-1"
          >
            Folder…
          </button>
          <button
            onClick={() => void open()}
            disabled={busy}
            className="h-6 rounded border border-accent/40 bg-accent/12 px-2 text-[10px] text-accent-light hover:bg-accent/20 disabled:opacity-40"
          >
            Index
          </button>
          {status && !status.done && (
            <button
              onClick={() => void cancelLogIndex(port, idRef.current)}
              className="h-6 rounded border border-border-2 px-2 text-[10px] text-warning hover:text-text-1"
            >
              Stop indexing
            </button>
          )}
        </div>

        {status && (
          <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[9px] text-text-4">
            <span>{status.name} · {megabytes(status.size)}</span>
            <span>{status.records.toLocaleString()} records</span>
            <span>index {megabytes(status.indexBytes)}</span>
            {!status.done && <span className="text-accent-light">indexing {progress.toFixed(1)}%</span>}
            {status.cancelled && <span className="text-warning">indexing stopped — partial index</span>}
            {Object.entries(status.levelCounts).filter(([level]) => level !== 'unknown').map(([level, count]) => (
              <span key={level}>{level} {count.toLocaleString()}</span>
            ))}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 rounded border border-border-2 px-1.5">
            <Search size={10} className="text-text-4" />
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }}
              placeholder="substring, scanned on disk"
              className="h-6 w-[220px] bg-transparent font-mono text-[10px] text-text-2 outline-none"
            />
          </div>
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setLevels((current) => current.includes(level) ? current.filter((item) => item !== level) : [...current, level])}
              className={cn(
                'h-6 rounded border px-1.5 text-[9px] uppercase',
                levels.includes(level) ? 'border-accent/50 bg-accent/15 text-accent-light' : 'border-border-2 text-text-4 hover:text-text-2',
              )}
            >
              {level}
            </button>
          ))}
          <button onClick={runSearch} disabled={!status || busy} className="h-6 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:text-text-1 disabled:opacity-40">
            Apply
          </button>
          {busy && <Loader2 size={11} className="animate-spin text-accent" />}
        </div>
        {error && <p className="mt-1 text-[10px] text-error">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-surface-0">
        {!page ? (
          <p className="px-3 py-4 text-[11px] text-text-4">
            Index a file to browse it. The index holds 24 bytes per record on disk; pages are read from the file
            only when you look at them.
          </p>
        ) : page.entries.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-text-4">
            {page.budgetExceeded
              ? `No match in the first ${page.scanned.toLocaleString()} records scanned. Continue to keep searching.`
              : 'No record matches this filter.'}
          </p>
        ) : page.entries.map((entry: LogIndexEntry) => (
          <div key={entry.index} className="flex gap-2 border-b border-border-1/60 px-2 py-[2px] hover:bg-surface-1">
            <span className="w-16 shrink-0 text-right font-mono text-[9px] text-text-4">{entry.index.toLocaleString()}</span>
            <span className={cn('h-fit shrink-0 rounded px-1 font-mono text-[8px] uppercase', LEVEL_STYLE[entry.level as keyof typeof LEVEL_STYLE] ?? '')}>
              {entry.level}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[10px] text-text-2">{entry.text}</span>
          </div>
        ))}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-1 bg-surface-1 px-3 py-1.5">
        <button onClick={previousPage} disabled={cursors.length < 2 || busy} className="h-6 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:text-text-1 disabled:opacity-35">
          Previous
        </button>
        <button onClick={nextPage} disabled={!page || page.nextFrom < 0 || page.exhausted || busy} className="h-6 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:text-text-1 disabled:opacity-35">
          {page?.budgetExceeded ? 'Continue scan' : 'Next'}
        </button>
        {page && (
          <span className="font-mono text-[9px] text-text-4">
            page {cursors.length} · {page.entries.length} records · scanned {page.scanned.toLocaleString()}
            {page.budgetExceeded ? ' · stopped on the 2 s budget' : ''}
            {page.exhausted ? ' · end of index' : ''}
            {page.indexing ? ' · still indexing' : ''}
          </span>
        )}
        <button
          onClick={() => {
            if (!page || !status) return
            onImportPage(`${status.name} #${cursors.length}`, page.entries.map((entry) => entry.text).join('\n'))
          }}
          disabled={!page || page.entries.length === 0}
          title="Copy this page into the normal investigation, with parsing, correlation and analysis"
          className="ml-auto h-6 rounded border border-accent/40 bg-accent/12 px-2 text-[10px] text-accent-light hover:bg-accent/20 disabled:opacity-40"
        >
          Import this page into the session
        </button>
      </footer>
    </div>
  )
}

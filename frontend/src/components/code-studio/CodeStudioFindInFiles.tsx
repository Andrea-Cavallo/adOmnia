import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaseSensitive, Loader2, Regex, Replace, Search, WholeWord } from 'lucide-react'
import { previewReplaceInFiles } from './codeStudioReplaceInFiles'
import { startProjectSearch, cancelProjectSearch, type GoIDESearchMatch, type GoIDESearchResult } from '@/lib/code-studio-lsp-api'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'

interface CodeStudioFindInFilesProps {
  sessionId: string
}

interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** Attesa dopo l'ultima digitazione prima di avviare ripgrep: sotto i 150 ms si riavvia per niente. */
const SEARCH_DEBOUNCE_MS = 200
/** Altezza fissa di una riga: la lista virtualizzata disegna solo la finestra visibile. */
const ROW_HEIGHT = 22
const OVERSCAN_ROWS = 8

function splitPatterns(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

/** Tiene i primi limit risultati mantenendo il raggruppamento per file. */
export function limitMatches(groups: Array<[string, GoIDESearchMatch[]]>, limit: number): Array<[string, GoIDESearchMatch[]]> {
  const visible: Array<[string, GoIDESearchMatch[]]> = []
  let remaining = limit
  for (const [file, matches] of groups) {
    if (remaining <= 0) break
    visible.push([file, matches.slice(0, remaining)])
    remaining -= matches.length
  }
  return visible
}

function groupMatches(matches: GoIDESearchMatch[]): Array<[string, GoIDESearchMatch[]]> {
  const groups = new Map<string, GoIDESearchMatch[]>()
  for (const match of matches) groups.set(match.relativePath, [...(groups.get(match.relativePath) ?? []), match])
  return [...groups.entries()]
}

type ResultRow = { kind: 'file'; path: string; count: number } | { kind: 'match'; path: string; match: GoIDESearchMatch }

function rowsOf(groups: Array<[string, GoIDESearchMatch[]]>): ResultRow[] {
  const rows: ResultRow[] = []
  for (const [path, matches] of groups) {
    rows.push({ kind: 'file', path, count: matches.length })
    for (const match of matches) rows.push({ kind: 'match', path, match })
  }
  return rows
}

/** Returns the rows a virtualized list must draw: never all of them. */
export function visibleRange(total: number, scrollTop: number, viewportHeight: number, rowHeight = ROW_HEIGHT, overscan = OVERSCAN_ROWS): { start: number; end: number } {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const start = Math.min(total, Math.max(0, first - overscan))
  const end = Math.min(total, Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight) + overscan)
  return { start, end: Math.max(start, end) }
}

function Highlighted({ match }: { match: GoIDESearchMatch }) {
  // Le colonne sono UTF-16, come gli indici delle stringhe JavaScript.
  const start = Math.max(0, match.column - 1)
  const end = Math.max(start, match.endColumn - 1)
  return <>{match.preview.slice(0, start)}<mark className="rounded-sm bg-accent/30 text-text-1">{match.preview.slice(start, end)}</mark>{match.preview.slice(end)}</>
}

export function CodeStudioFindInFiles({ sessionId }: CodeStudioFindInFilesProps) {
  const result = useCodeStudioLspStore((state) => state.search[sessionId] ?? null)
  const setSearchResult = useCodeStudioLspStore((state) => state.setSearchResult)
  const findRequest = useCodeStudioLspStore((state) => state.findRequest)
  const openLocation = useCodeStudioStore((state) => state.openLocation)
  const [query, setQuery] = useState('')
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [replaceNote, setReplaceNote] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)
  const jobRef = useRef<string | null>(null)
  const ignoredJobsRef = useRef<Set<string>>(new Set())
  const accumulated = useRef<GoIDESearchMatch[]>([])
  const groups = useMemo(() => groupMatches(result?.matches ?? []), [result])
  const rows = useMemo(() => rowsOf(groups), [groups])

  // A new find request fills the form during render; focusing is the only effect left.
  const [handledRequest, setHandledRequest] = useState<typeof findRequest>(null)
  if (findRequest !== handledRequest) {
    setHandledRequest(findRequest)
    if (findRequest) {
      if (findRequest.query) setQuery(findRequest.query)
      if (findRequest.include !== undefined) setInclude(findRequest.include)
      if (findRequest.focus === 'replace') setReplaceOpen(true)
    }
  }

  useEffect(() => {
    if (!findRequest) return
    if (findRequest.focus === 'replace') {
      window.setTimeout(() => replaceRef.current?.focus(), 0)
    } else {
      window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
    }
  }, [findRequest])

  const cancelJob = useCallback(() => {
    if (jobRef.current) {
      if (jobRef.current !== 'pending') {
        ignoredJobsRef.current.add(jobRef.current)
        void cancelProjectSearch(jobRef.current)
      }
      jobRef.current = null
    }
  }, [])

  // Gli eventi arrivano in streaming: si appendono solo se appartengono alla ricerca corrente.
  useEffect(() => subscribeGoIDEEvents((event) => {
    const payload = event.payload as { searchId?: string; matches?: GoIDESearchMatch[]; filesScanned?: number; truncated?: boolean; engine?: string; message?: string } | undefined
    if (!payload?.searchId || ignoredJobsRef.current.has(payload.searchId)) return
    // StartProjectSearch can emit before the promise resolves: the first event of a pending
    // job adopts the id it was started with.
    if (jobRef.current === 'pending') jobRef.current = payload.searchId
    else if (payload.searchId !== jobRef.current) return
    if (event.type === 'search.matches') {
      accumulated.current = [...accumulated.current, ...(payload.matches ?? [])]
      setSearchResult(sessionId, {
        matches: accumulated.current,
        filesScanned: payload.filesScanned ?? 0,
        truncated: !!payload.truncated,
      } as GoIDESearchResult)
      return
    }
    if (event.type === 'search.done') {
      setEngine(payload.engine ?? null)
      setDone(true)
      setLoading(false)
      jobRef.current = null
      return
    }
    if (event.type === 'search.error') {
      setError(payload.message ?? 'Search failed')
      setLoading(false)
      jobRef.current = null
    }
  }), [sessionId, setSearchResult])

  const runSearch = useCallback(async () => {
    if (!query.trim()) return
    cancelJob()
    accumulated.current = []
    setError(null)
    setDone(false)
    setEngine(null)
    setLoading(true)
    setSearchResult(sessionId, { matches: [], filesScanned: 0, truncated: false } as GoIDESearchResult)
    jobRef.current = 'pending'
    try {
      const job = await startProjectSearch({
        sessionId,
        pattern: query,
        ...options,
        include: splitPatterns(include),
        exclude: splitPatterns(exclude),
      })
      if (jobRef.current === 'pending') jobRef.current = job.id
      else if (jobRef.current !== job.id) {
        // A newer search replaced this one while the call was in flight.
        ignoredJobsRef.current.add(job.id)
        void cancelProjectSearch(job.id)
        return
      }
      setEngine(job.engine)
    } catch (reason) {
      jobRef.current = null
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    }
  }, [cancelJob, exclude, include, options, query, sessionId, setSearchResult])

  // Debounce: ogni modifica interrompe subito la ricerca precedente, poi ne avvia una nuova.
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    cancelJob()
    if (!query.trim()) {
      accumulated.current = []
      setLoading(false)
      setDone(false)
      setError(null)
      setSearchResult(sessionId, null)
      return
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void runSearch()
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [cancelJob, exclude, include, options, query, runSearch, sessionId, setSearchResult])

  useEffect(() => () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    cancelJob()
  }, [cancelJob])

  // Measure the viewport so the virtualized list knows how many rows to draw.
  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const update = () => setViewportHeight(element.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const { start: startRow, end: endRow } = visibleRange(rows.length, scrollTop, viewportHeight)
  const visibleRows = rows.slice(startRow, endRow)

  // Sostituisce solo nei file dell'ultima ricerca e passa sempre dall'anteprima delle modifiche.
  const replaceAll = async () => {
    if (!result || groups.length === 0 || !query.trim()) return
    setReplacing(true)
    setReplaceNote(null)
    try {
      const outcome = await previewReplaceInFiles(groups.map(([file]) => file), query, replacement, options)
      setReplaceNote(outcome.files === 0 ? 'Nothing to replace: the files changed since the search.' : `Review ${outcome.occurrences} replacement${outcome.occurrences === 1 ? '' : 's'} in ${outcome.files} file${outcome.files === 1 ? '' : 's'} in the preview.`)
    } catch (reason) {
      setReplaceNote(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setReplacing(false)
    }
  }

  const toggle = (key: keyof SearchOptions, label: string, Icon: typeof Regex) => (
    <button type="button" aria-pressed={options[key]} title={label} onClick={() => setOptions((value) => ({ ...value, [key]: !value[key] }))} className={`grid h-6 w-6 place-items-center rounded ${options[key] ? 'bg-accent/20 text-accent' : 'text-text-4 hover:bg-surface-3 hover:text-text-1'}`}><Icon size={12} /></button>
  )

  const summary = result
    ? `${result.matches.length} match${result.matches.length === 1 ? '' : 'es'} in ${groups.length} file${groups.length === 1 ? '' : 's'} - ${result.filesScanned} files scanned${result.truncated ? ' - results truncated' : ''}${engine ? ` - ${engine}` : ''}`
    : ''

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={(event) => { event.preventDefault(); if (debounceRef.current !== null) { window.clearTimeout(debounceRef.current); debounceRef.current = null } void runSearch() }} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 p-3">
        <label className="flex h-9 min-w-48 flex-1 items-center gap-2 rounded-lg border border-border-1 bg-surface-0 px-1.5 focus-within:border-accent">
          <Search size={11} className="text-text-4" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} data-autofocus placeholder="Search across project files..." aria-label="Search text" className="min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none" />
        </label>
        {toggle('caseSensitive', 'Match case', CaseSensitive)}
        {toggle('wholeWord', 'Whole words', WholeWord)}
        {toggle('regex', 'Regular expression', Regex)}
        <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} className="gs-btn gs-btn-sm gs-btn-ghost">Filters</button>
        <button type="button" aria-expanded={replaceOpen} onClick={() => setReplaceOpen(!replaceOpen)} className="gs-btn gs-btn-sm gs-btn-ghost">Replace</button>
        {filtersOpen && <div className="flex w-full flex-wrap gap-2">
        <input value={include} onChange={(event) => setInclude(event.target.value)} placeholder="Include: *.go" aria-label="Include patterns" className="h-6 w-28 rounded border border-border-1 bg-surface-0 px-1.5 font-mono text-[10px] text-text-2 outline-none focus:border-accent" />
        <input value={exclude} onChange={(event) => setExclude(event.target.value)} placeholder="Exclude: testdata/**" aria-label="Exclude patterns" className="h-6 w-32 rounded border border-border-1 bg-surface-0 px-1.5 font-mono text-[10px] text-text-2 outline-none focus:border-accent" />
        </div>}
        {loading ? <button type="button" onClick={() => { cancelJob(); setLoading(false); setDone(true) }} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-text-3 hover:bg-surface-3"><Loader2 size={11} className="animate-spin" /> Cancel</button> : <button type="submit" disabled={!query.trim()} className="h-6 rounded bg-accent/15 px-2 text-[10px] font-medium text-accent disabled:opacity-40">Search</button>}
      </form>
      {replaceOpen && <div className="flex shrink-0 items-center gap-2 border-b border-border-1 px-3 py-2">
        <label className="flex h-6 min-w-48 flex-1 items-center gap-1 rounded border border-border-1 bg-surface-0 px-1.5 focus-within:border-accent">
          <Replace size={11} className="text-text-4" />
          <input ref={replaceRef} value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void replaceAll() }} placeholder={options.regex ? 'Replace with ($1, $2... for groups)' : 'Replace with'} aria-label="Replace text" className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none" />
        </label>
        <button type="button" onClick={() => void replaceAll()} disabled={replacing || !result || groups.length === 0} title={result?.truncated ? 'Results are truncated: only the files listed are changed' : 'Preview every change, then apply all or nothing'} className="flex h-6 items-center gap-1 rounded bg-accent/15 px-2 text-[10px] font-medium text-accent disabled:opacity-40">
          {replacing && <Loader2 size={11} className="animate-spin" />} Replace All... (preview)
        </button>
        {replaceNote && <span className="truncate text-[10px] text-text-4">{replaceNote}</span>}
      </div>
      }
      <div className="min-h-0 flex-1 overflow-auto py-1 text-[11px]" ref={listRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        {error && <p className="p-3 text-[10px] text-danger">{error}</p>}
        {!error && result && <div className="px-2 pb-1 text-[10px] text-text-4">{summary}{!done && loading ? ' - searching...' : ''}</div>}
        {!error && !result && <p className="p-3 text-[10px] text-text-4">Searches every text file in the project with ripgrep (the Go engine is the fallback). .git, vendor, node_modules and build output are skipped. Results appear while the scan runs.</p>}
        {startRow > 0 && <div aria-hidden="true" style={{ height: startRow * ROW_HEIGHT }} />}
        {visibleRows.map((row) => row.kind === 'file'
          ? (
            <div key={`file:${row.path}`} className="flex items-center gap-1.5 px-2 font-medium text-text-2" style={{ height: ROW_HEIGHT }}>
              <CodeStudioFileIcon name={row.path.split(/[\\/]/).pop() ?? row.path} relativePath={row.path} size={12} />
              <span className="truncate">{row.path}</span>
              <span className="text-[9px] text-text-4">{row.count}</span>
            </div>
          )
          : (
            <button key={`${row.path}:${row.match.line}:${row.match.column}`} type="button" onClick={() => { useCodeStudioStore.getState().updateLayout({ bottomOpen: false }); void openLocation(row.path, row.match.line, row.match.column) }} className="flex w-full items-center gap-2 pl-6 pr-2 text-left hover:bg-surface-3 focus:bg-surface-3 focus:outline-none" style={{ height: ROW_HEIGHT }}>
              <span className="w-12 shrink-0 text-right font-mono text-[9px] text-text-4">{row.match.line}</span>
              <span className="min-w-0 flex-1 truncate whitespace-pre font-mono text-[10px] text-text-2"><Highlighted match={row.match} /></span>
            </button>
          ))}
        {endRow < rows.length && <div aria-hidden="true" style={{ height: (rows.length - endRow) * ROW_HEIGHT }} />}
      </div>
    </div>
  )
}

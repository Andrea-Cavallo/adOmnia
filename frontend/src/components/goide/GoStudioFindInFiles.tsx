import { useEffect, useMemo, useRef, useState } from 'react'
import { CaseSensitive, Loader2, Regex, Replace, Search, WholeWord } from 'lucide-react'
import { previewReplaceInFiles } from './goStudioReplaceInFiles'
import type { CancellablePromise } from '@wailsio/runtime'
import { requestProjectSearch, type GoIDESearchMatch, type GoIDESearchResult } from '@/lib/goide-lsp-api'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioFileIcon } from './GoStudioFileIcon'
import { useGoIDELspStore } from '@/stores/goideLsp'

interface GoStudioFindInFilesProps {
  sessionId: string
}

interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

function splitPatterns(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

/** Righe disegnate subito: il resto arriva con “Show all”, così una ricerca ampia non blocca l'interfaccia. */
const MAX_RENDERED_MATCHES = 200

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

function Highlighted({ match }: { match: GoIDESearchMatch }) {
  // Le colonne sono UTF-16, come gli indici delle stringhe JavaScript.
  const start = Math.max(0, match.column - 1)
  const end = Math.max(start, match.endColumn - 1)
  return <>{match.preview.slice(0, start)}<mark className="rounded-sm bg-accent/30 text-text-1">{match.preview.slice(start, end)}</mark>{match.preview.slice(end)}</>
}

export function GoStudioFindInFiles({ sessionId }: GoStudioFindInFilesProps) {
  const result = useGoIDELspStore((state) => state.search[sessionId] ?? null)
  const setSearchResult = useGoIDELspStore((state) => state.setSearchResult)
  const findRequest = useGoIDELspStore((state) => state.findRequest)
  const openLocation = useGoIDEStore((state) => state.openLocation)
  const [query, setQuery] = useState('')
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replaceNote, setReplaceNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const running = useRef<CancellablePromise<GoIDESearchResult> | null>(null)
  const groups = useMemo(() => groupMatches(result?.matches ?? []), [result])
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setShowAll(false) }, [result])
  const visibleGroups = useMemo(() => (showAll ? groups : limitMatches(groups, MAX_RENDERED_MATCHES)), [groups, showAll])
  const hiddenMatches = (result?.matches.length ?? 0) - visibleGroups.reduce((total, [, matches]) => total + matches.length, 0)

  useEffect(() => {
    if (!findRequest) return
    if (findRequest.query) setQuery(findRequest.query)
    window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
  }, [findRequest])

  useEffect(() => () => { void running.current?.cancel() }, [])

  const search = () => {
    if (!query.trim()) return
    void running.current?.cancel()
    setLoading(true)
    setError(null)
    const request = requestProjectSearch({ sessionId, pattern: query, ...options, include: splitPatterns(include), exclude: splitPatterns(exclude) })
    running.current = request
    request.then((value) => setSearchResult(sessionId, value))
      .catch((reason: unknown) => { if (running.current === request && !String(reason).toLowerCase().includes('cancel')) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (running.current === request) setLoading(false) })
  }

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={(event) => { event.preventDefault(); search() }} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-1 px-2 py-1">
        <label className="flex h-6 min-w-48 flex-1 items-center gap-1 rounded border border-border-1 bg-surface-0 px-1.5 focus-within:border-accent">
          <Search size={11} className="text-text-4" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find in project (Enter)" aria-label="Search text" className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none" />
        </label>
        {toggle('caseSensitive', 'Match case', CaseSensitive)}
        {toggle('wholeWord', 'Whole words', WholeWord)}
        {toggle('regex', 'Regular expression', Regex)}
        <input value={include} onChange={(event) => setInclude(event.target.value)} placeholder="Include: *.go" aria-label="Include patterns" className="h-6 w-28 rounded border border-border-1 bg-surface-0 px-1.5 font-mono text-[10px] text-text-2 outline-none focus:border-accent" />
        <input value={exclude} onChange={(event) => setExclude(event.target.value)} placeholder="Exclude: testdata/**" aria-label="Exclude patterns" className="h-6 w-32 rounded border border-border-1 bg-surface-0 px-1.5 font-mono text-[10px] text-text-2 outline-none focus:border-accent" />
        {loading ? <button type="button" onClick={() => { void running.current?.cancel(); setLoading(false) }} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-text-3 hover:bg-surface-3"><Loader2 size={11} className="animate-spin" /> Cancel</button> : <button type="submit" disabled={!query.trim()} className="h-6 rounded bg-accent/15 px-2 text-[10px] font-medium text-accent disabled:opacity-40">Search</button>}
      </form>
      <div className="flex shrink-0 items-center gap-1 border-b border-border-1 px-2 py-1">
        <label className="flex h-6 min-w-48 flex-1 items-center gap-1 rounded border border-border-1 bg-surface-0 px-1.5 focus-within:border-accent">
          <Replace size={11} className="text-text-4" />
          <input value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void replaceAll() }} placeholder={options.regex ? 'Replace with ($1, $2… for groups)' : 'Replace with'} aria-label="Replace text" className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none" />
        </label>
        <button type="button" onClick={() => void replaceAll()} disabled={replacing || !result || groups.length === 0} title={result?.truncated ? 'Results are truncated: only the files listed are changed' : 'Preview every change, then apply all or nothing'} className="flex h-6 items-center gap-1 rounded bg-accent/15 px-2 text-[10px] font-medium text-accent disabled:opacity-40">
          {replacing && <Loader2 size={11} className="animate-spin" />} Replace All… (preview)
        </button>
        {replaceNote && <span className="truncate text-[10px] text-text-4">{replaceNote}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-[11px]">
        {error && <p className="p-3 text-[10px] text-danger">{error}</p>}
        {!error && result && <div className="px-2 pb-1 text-[10px] text-text-4">{result.matches.length} match{result.matches.length === 1 ? '' : 'es'} in {groups.length} file{groups.length === 1 ? '' : 's'} · {result.filesScanned} files scanned{result.truncated ? ' · results truncated' : ''}</div>}
        {!error && !result && <p className="p-3 text-[10px] text-text-4">Searches every text file in the project. .git, vendor, node_modules and build output are skipped.</p>}
        {visibleGroups.map(([file, matches]) => (
          <div key={file}>
            <div className="flex h-6 items-center gap-1.5 px-2 font-medium text-text-2"><GoStudioFileIcon name={file.split(/[\\/]/).pop() ?? file} relativePath={file} size={12} /><span className="truncate">{file}</span><span className="text-[9px] text-text-4">{matches.length}</span></div>
            {matches.map((match) => (
              <button key={`${match.line}:${match.column}`} type="button" onClick={() => void openLocation(file, match.line, match.column)} className="flex h-6 w-full items-center gap-2 pl-6 pr-2 text-left hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
                <span className="w-12 shrink-0 text-right font-mono text-[9px] text-text-4">{match.line}</span>
                <span className="min-w-0 flex-1 truncate whitespace-pre font-mono text-[10px] text-text-2"><Highlighted match={match} /></span>
              </button>
            ))}
          </div>
        ))}
        {hiddenMatches > 0 && (
          <button type="button" onClick={() => setShowAll(true)} className="mx-2 my-1 rounded px-2 py-1 text-[10px] text-accent hover:bg-accent/10">
            Show all {result?.matches.length} matches ({hiddenMatches} more)
          </button>
        )}
      </div>
    </div>
  )
}

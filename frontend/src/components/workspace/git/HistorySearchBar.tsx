import { useEffect, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { searchHistory } from '@/lib/git/gitService'
import type { CommitInfo, SearchFilters } from '@/lib/git/types'
import { cn } from '@/lib/utils'

interface HistorySearchBarProps {
  repoPath: string
  /** Push results to the graph, or null to restore the normal commit list. */
  onResults: (commits: CommitInfo[] | null) => void
  setError: (s: string) => void
}

const TOKEN = {
  author: /\bauthor:(\S+)/i,
  file: /\bfile:(\S+)/i,
  branch: /\bbranch:(\S+)/i,
  after: /\bafter:(\S+)/i,
  before: /\bbefore:(\S+)/i,
  sha: /\bsha:(\S+)/i,
}

/**
 * Parse a structured query into SearchFilters. Recognized tokens:
 *   author: message: file: branch: after: before: sha: is:merge
 * Anything left over becomes the message grep. Returns structured=false when the
 * query has no tokens, so the caller can fall back to the plain client filter.
 */
function parseQuery(raw: string): { filters: SearchFilters; structured: boolean } {
  let rest = raw
  const filters: SearchFilters = {}
  let structured = false
  for (const [key, re] of Object.entries(TOKEN)) {
    const m = rest.match(re)
    if (m) { (filters as Record<string, string>)[key] = m[1]; rest = rest.replace(re, ' '); structured = true }
  }
  if (/\bis:merge\b/i.test(rest)) { filters.isMerge = true; rest = rest.replace(/\bis:merge\b/i, ' '); structured = true }
  const message = rest.trim()
  if (message) filters.message = message
  return { filters, structured }
}

/** Structured commit-history search bar with -S / -G pickaxe code search. */
export function HistorySearchBar({ repoPath, onResults, setError }: HistorySearchBarProps) {
  const [query, setQuery] = useState('')
  const [pickaxe, setPickaxe] = useState('')
  const [pickaxeMode, setPickaxeMode] = useState<'S' | 'G'>('S')
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    const parsed = parseQuery(query)
    const filters: SearchFilters = { ...parsed.filters, limit: 300 }
    if (pickaxe.trim()) { filters.pickaxe = pickaxe.trim(); filters.pickaxeMode = pickaxeMode }
    const hasCriteria = parsed.structured || !!pickaxe.trim() || !!filters.message
    if (!hasCriteria) { setActive(false); onResults(null); return }
    setBusy(true)
    setError('')
    try {
      onResults(await searchHistory(repoPath, filters))
      setActive(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const clear = () => { setQuery(''); setPickaxe(''); setActive(false); onResults(null) }

  // Debounced live search.
  useEffect(() => {
    const h = window.setTimeout(() => { if (query.trim() || pickaxe.trim()) void run() }, 350)
    return () => window.clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pickaxe, pickaxeMode])

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-1.5">
      <div className="relative flex min-w-0 flex-1 items-center">
        <Search size={12} className="absolute left-2 text-text-4" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
          placeholder="author:Andrea  message:linux  file:*.go  is:merge  after:2026-06-01"
          className="h-7 w-full rounded border border-border-1 bg-surface-0 pl-7 pr-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent placeholder:text-text-4"
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 rounded border border-border-1 bg-surface-0 px-1">
        <button onClick={() => setPickaxeMode('S')} className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', pickaxeMode === 'S' ? 'bg-accent/20 text-accent' : 'text-text-4')} title="git log -S (string)">-S</button>
        <button onClick={() => setPickaxeMode('G')} className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', pickaxeMode === 'G' ? 'bg-accent/20 text-accent' : 'text-text-4')} title="git log -G (regex)">-G</button>
        <input
          value={pickaxe}
          onChange={(e) => setPickaxe(e.target.value)}
          placeholder="code search…"
          className="h-6 w-28 bg-transparent px-1 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4"
        />
      </div>
      {busy && <Loader2 size={13} className="animate-spin text-accent" />}
      {active && <button onClick={clear} title="Clear search" className="rounded p-1 text-text-4 hover:text-text-1"><X size={13} /></button>}
    </div>
  )
}

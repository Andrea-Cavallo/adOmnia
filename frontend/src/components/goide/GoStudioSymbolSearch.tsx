import { useEffect, useRef, useState } from 'react'
import { AtSign, Loader2, X } from 'lucide-react'
import type { CancellablePromise } from '@wailsio/runtime'
import { requestWorkspaceSymbols, type GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { navigateToLocation } from './goStudioLanguageFeatures'

const SEARCH_DEBOUNCE_MS = 140

interface GoStudioSymbolSearchProps {
  open: boolean
  sessionId: string | null
  onClose: () => void
}

/** Ricerca simboli in tutto il workspace tramite gopls, con richieste obsolete annullate. */
export function GoStudioSymbolSearch({ open, sessionId, onClose }: GoStudioSymbolSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GoIDEWorkspaceSymbol[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError(null)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open || !sessionId || !query.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    let request: CancellablePromise<GoIDEWorkspaceSymbol[]> | null = null
    setLoading(true)
    const timer = window.setTimeout(() => {
      request = requestWorkspaceSymbols(sessionId, query.trim())
      request.then((items) => { setResults(items); setSelected(0); setError(null) })
        .catch((reason: unknown) => { if (!String(reason).includes('cancel')) setError(String(reason)) })
        .finally(() => setLoading(false))
    }, SEARCH_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer); request?.cancel() }
  }, [open, query, sessionId])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  const choose = (symbol: GoIDEWorkspaceSymbol | undefined) => {
    if (!symbol) return
    navigateToLocation(symbol.location)
    onClose()
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(results.length - 1, value + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(results[selected]) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[1px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Go to symbol in workspace" className="w-[min(720px,82vw)] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-3">
          <AtSign size={14} className="text-accent" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Type a symbol: Handler, (*Server).Serve, NewClient…" aria-label="Symbol query" className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" />
          {loading ? <Loader2 size={13} className="animate-spin text-text-4" /> : <span className="text-[9px] text-text-4">{results.length ? `${results.length} symbols` : 'gopls'}</span>}
          <button type="button" onClick={onClose} title="Close" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div ref={listRef} role="listbox" className="max-h-[52vh] overflow-auto py-1">
          {results.map((symbol, index) => (
            <button
              key={`${symbol.location.uri}:${symbol.location.range.startLine}:${symbol.name}`}
              data-index={index}
              role="option"
              aria-selected={index === selected}
              type="button"
              onMouseMove={() => setSelected(index)}
              onClick={() => choose(symbol)}
              className={`flex h-8 w-full items-center gap-2 px-3 text-left ${index === selected ? 'bg-accent/15' : 'hover:bg-surface-3'}`}
            >
              <GoStudioSymbolIcon kind={symbol.kind} />
              <span className="text-[11px] font-medium text-text-1">{symbol.name}</span>
              {symbol.container && <span className="text-[10px] text-text-3">{symbol.container}</span>}
              <span className="min-w-0 flex-1 truncate text-right font-mono text-[9px] text-text-4">{symbol.location.relativePath || symbol.location.path}:{symbol.location.range.startLine}{symbol.location.external ? ' · SDK' : ''}</span>
            </button>
          ))}
          {error && <p className="px-4 py-6 text-center text-[11px] text-danger">{error}</p>}
          {!error && !loading && query.trim() && results.length === 0 && <p className="px-4 py-8 text-center text-[11px] text-text-4">No matching symbols.</p>}
          {!query.trim() && <p className="px-4 py-8 text-center text-[11px] text-text-4">Search types, functions, methods and fields across the project and its dependencies. ↑↓ to move, Enter to open.</p>}
        </div>
      </div>
    </div>
  )
}

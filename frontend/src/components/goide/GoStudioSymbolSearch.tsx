import { useEffect, useRef, useState } from 'react'
import { AtSign, Loader2 } from 'lucide-react'
import type { CancellablePromise } from '@wailsio/runtime'
import { requestWorkspaceSymbols, type GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { navigateToLocation } from './goStudioLanguageFeatures'
import { GoStudioPalette } from './GoStudioModal'

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
    <GoStudioPalette
      open
      wide
      onClose={onClose}
      ariaLabel="Go to symbol in workspace"
      icon={AtSign}
      input={<input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Symbol: Handler, (*Server).Serve, NewClient…" aria-label="Symbol query" className="gs-palette-input" />}
      meta={loading ? <Loader2 size={14} className="animate-spin" /> : results.length ? `${results.length} symbols` : 'gopls'}
    >
      <div ref={listRef} role="listbox" aria-label="Symbols">
        {results.map((symbol, index) => (
          <button
            key={`${symbol.location.uri}:${symbol.location.range.startLine}:${symbol.name}`}
            data-index={index}
            role="option"
            aria-selected={index === selected}
            type="button"
            onMouseMove={() => setSelected(index)}
            onClick={() => choose(symbol)}
            className="gs-palette-item"
          >
            <GoStudioSymbolIcon kind={symbol.kind} size={14} />
            <span className="gs-palette-item-title">{symbol.name}</span>
            {symbol.container && <span className="shrink-0 text-[12px] text-text-3">{symbol.container}</span>}
            <span className="gs-palette-item-detail gs-mono text-right text-[11px]">{symbol.location.relativePath || symbol.location.path}:{symbol.location.range.startLine}{symbol.location.external ? ' · SDK' : ''}</span>
          </button>
        ))}
        {error && <p className="gs-palette-empty text-danger">{error}</p>}
        {!error && !loading && query.trim() && results.length === 0 && <p className="gs-palette-empty">No matching symbols.</p>}
        {!query.trim() && <p className="gs-palette-empty">Types, functions, methods and fields across the project and its dependencies.</p>}
      </div>
    </GoStudioPalette>
  )
}

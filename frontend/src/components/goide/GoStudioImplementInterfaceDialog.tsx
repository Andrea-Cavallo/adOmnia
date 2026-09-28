import { useEffect, useRef, useState } from 'react'
import { Loader2, Puzzle, X } from 'lucide-react'
import type { CancellablePromise } from '@wailsio/runtime'
import { requestWorkspaceSymbols, type GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { implementInterface, implementableInterfaces, interfaceReference } from './goStudioImplementInterface'

const SEARCH_DEBOUNCE_MS = 140
const MAX_RESULTS = 40

/** Scelta dell'interfaccia da implementare (progetto, dipendenze e SDK tramite gopls). */
export function GoStudioImplementInterfaceDialog() {
  const request = useGoIDELspStore((state) => state.implementRequest)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GoIDEWorkspaceSymbol[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const close = () => useGoIDELspStore.setState({ implementRequest: null })
  useModalFocusTrap(!!request, close, dialogRef)

  useEffect(() => {
    if (!request) return
    setQuery('')
    setResults([])
    setWorking(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [request])

  useEffect(() => {
    if (!request || !query.trim()) {
      setResults([])
      return
    }
    let pending: CancellablePromise<GoIDEWorkspaceSymbol[]> | null = null
    setLoading(true)
    const timer = window.setTimeout(() => {
      pending = requestWorkspaceSymbols(request.sessionId, query.trim())
      pending
        .then((symbols) => { setResults(implementableInterfaces(symbols, request.directory).slice(0, MAX_RESULTS)); setSelected(0) })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, SEARCH_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer); pending?.cancel() }
  }, [query, request])

  if (!request) return null

  const choose = async (symbol: GoIDEWorkspaceSymbol | undefined) => {
    const editor = activeGoStudioEditor()
    if (!symbol || !editor || working) return
    setWorking(true)
    close()
    await implementInterface(editor, request, symbol)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[1px]" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Implement Interface" className="w-[min(620px,80vw)] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-3">
          <Puzzle size={14} className="text-accent" aria-hidden="true" />
          <span className="shrink-0 text-[11px] text-text-3">Implement on <strong className="font-mono text-text-1">*{request.typeName}</strong></span>
          <input
            ref={inputRef}
            value={query}
            aria-label="Interface name"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(results.length - 1, value + 1)) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
              if (event.key === 'Enter') { event.preventDefault(); void choose(results[selected]) }
            }}
            placeholder="Interface name, e.g. Reader or Handler"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          {loading && <Loader2 size={13} className="animate-spin text-text-4" aria-hidden="true" />}
          <button type="button" onClick={close} title="Close · Esc" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} aria-hidden="true" /></button>
        </div>
        <div role="listbox" aria-label="Interfaces" className="max-h-[48vh] overflow-auto py-1">
          {results.map((symbol, index) => (
            <button
              key={`${symbol.location.uri}:${symbol.location.range.startLine}:${symbol.name}`}
              type="button"
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setSelected(index)}
              onClick={() => void choose(symbol)}
              className={`flex h-7 w-full items-center gap-2 px-3 text-left ${index === selected ? 'bg-accent/15' : 'hover:bg-surface-3'}`}
            >
              <GoStudioSymbolIcon kind={symbol.kind} size={12} />
              <span className="font-mono text-[11px] text-text-1">{interfaceReference(symbol, request.directory)}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[10px] text-text-4">{symbol.container}</span>
            </button>
          ))}
          {!loading && query.trim() && results.length === 0 && <p className="px-4 py-6 text-center text-[11px] text-text-4">No exported interface matches “{query}”.</p>}
          {!query.trim() && <p className="px-4 py-6 text-center text-[11px] text-text-4">gopls generates the missing methods; you review them before anything changes.</p>}
        </div>
      </div>
    </div>
  )
}

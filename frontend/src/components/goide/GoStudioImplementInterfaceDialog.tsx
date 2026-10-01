import { useEffect, useRef, useState } from 'react'
import { Loader2, Puzzle } from 'lucide-react'
import type { CancellablePromise } from '@wailsio/runtime'
import { requestWorkspaceSymbols, type GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { implementInterface, implementableInterfaces, interfaceReference } from './goStudioImplementInterface'
import { GoStudioPalette } from './GoStudioModal'

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
  const inputRef = useRef<HTMLInputElement>(null)
  const close = () => useGoIDELspStore.setState({ implementRequest: null })

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
    <GoStudioPalette
      open
      onClose={close}
      ariaLabel="Implement interface"
      icon={Puzzle}
      prefix={<>Implement on <strong className="gs-mono font-medium text-text-1">*{request.typeName}</strong></>}
      input={
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
          placeholder="Interface, e.g. io.Reader or http.Handler"
          className="gs-palette-input"
        />
      }
      meta={loading ? <Loader2 size={14} className="animate-spin" /> : undefined}
      hints={<><span><span className="gs-kbd">↑</span><span className="gs-kbd">↓</span> move</span><span><span className="gs-kbd">Enter</span> generate methods</span><span className="ml-auto">You review the changes before anything is written.</span></>}
    >
      <div role="listbox" aria-label="Interfaces">
        {results.map((symbol, index) => (
          <button
            key={`${symbol.location.uri}:${symbol.location.range.startLine}:${symbol.name}`}
            type="button"
            role="option"
            aria-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onClick={() => void choose(symbol)}
            className="gs-palette-item"
          >
            <GoStudioSymbolIcon kind={symbol.kind} size={14} />
            <span className="gs-palette-item-title gs-mono">{interfaceReference(symbol, request.directory)}</span>
            <span className="gs-palette-item-detail text-right">{symbol.container}</span>
          </button>
        ))}
        {!loading && query.trim() && results.length === 0 && <p className="gs-palette-empty">No exported interface matches “{query}”.</p>}
        {!query.trim() && <p className="gs-palette-empty">Type an interface name. gopls generates the missing methods.</p>}
      </div>
    </GoStudioPalette>
  )
}

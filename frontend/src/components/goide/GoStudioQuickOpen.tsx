import { useEffect, useRef } from 'react'
import { FileCode2, Loader2, Search, X } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { GoGopherIcon, isGoSource } from './GoGopherIcon'

export function GoStudioQuickOpen() {
  const quickOpen = useGoIDEStore((state) => state.quickOpen)
  const setQuickOpen = useGoIDEStore((state) => state.setQuickOpen)
  const searchQuickOpen = useGoIDEStore((state) => state.searchQuickOpen)
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!quickOpen.open) return
    inputRef.current?.focus()
    void searchQuickOpen(quickOpen.query)
  }, [quickOpen.open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quickOpen.open) return
    const timer = window.setTimeout(() => void searchQuickOpen(quickOpen.query), 120)
    return () => window.clearTimeout(timer)
  }, [quickOpen.open, quickOpen.query, searchQuickOpen])

  if (!quickOpen.open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[1px]" onClick={() => setQuickOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Quick Open" className="w-[min(680px,80vw)] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-3">
          <Search size={14} className="text-accent" />
          <input
            ref={inputRef}
            value={quickOpen.query}
            onChange={(event) => useGoIDEStore.setState((state) => ({ quickOpen: { ...state.quickOpen, query: event.target.value } }))}
            onKeyDown={(event) => { if (event.key === 'Escape') setQuickOpen(false) }}
            placeholder="Search files by name or path"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          {quickOpen.loading ? <Loader2 size={13} className="animate-spin text-text-4" /> : <span className="text-[9px] text-text-4">{quickOpen.results.length}/100</span>}
          <button type="button" onClick={() => setQuickOpen(false)} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="max-h-[52vh] overflow-auto py-1">
          {quickOpen.results.map((result) => (
            <button
              key={result.relativePath}
              type="button"
              onClick={() => { void openDocument(result.relativePath); setQuickOpen(false) }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-surface-3"
            >
              {isGoSource(result.name) ? <GoGopherIcon size={13} /> : <FileCode2 size={12} className={result.language === 'go' ? 'text-accent' : 'text-text-4'} />}
              <span className="text-[11px] font-medium text-text-1">{result.name}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-text-4">{result.relativePath}</span>
            </button>
          ))}
          {!quickOpen.loading && quickOpen.results.length === 0 && <p className="px-4 py-8 text-center text-[11px] text-text-4">No matching files.</p>}
        </div>
      </div>
    </div>
  )
}

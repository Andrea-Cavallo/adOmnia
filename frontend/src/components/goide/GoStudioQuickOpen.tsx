import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioFileIcon } from './GoStudioFileIcon'

/** Next highlighted row for an arrow key, wrapping at both ends. */
export function quickOpenIndex(current: number, key: string, count: number): number {
  if (count === 0) return 0
  if (key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return Math.min(current, count - 1)
}

export function GoStudioQuickOpen() {
  const quickOpen = useGoIDEStore((state) => state.quickOpen)
  const setQuickOpen = useGoIDEStore((state) => state.setQuickOpen)
  const searchQuickOpen = useGoIDEStore((state) => state.searchQuickOpen)
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

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

  // New results start from the best match.
  useEffect(() => setActive(0), [quickOpen.results])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!quickOpen.open) return null

  const open = (relativePath: string | undefined) => {
    if (!relativePath) return
    void openDocument(relativePath)
    setQuickOpen(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setQuickOpen(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      open(quickOpen.results[active]?.relativePath)
      return
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) || ((event.key === 'Home' || event.key === 'End') && event.ctrlKey)) {
      event.preventDefault()
      setActive((current) => quickOpenIndex(current, event.key, quickOpen.results.length))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[1px]" onClick={() => setQuickOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Quick Open" className="w-[min(680px,80vw)] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-3">
          <Search size={14} className="text-accent" />
          <input
            ref={inputRef}
            value={quickOpen.query}
            onChange={(event) => useGoIDEStore.setState((state) => ({ quickOpen: { ...state.quickOpen, query: event.target.value } }))}
            onKeyDown={onKeyDown}
            placeholder="Search files by name or path"
            role="combobox"
            aria-expanded="true"
            aria-controls="go-studio-quick-open-results"
            aria-activedescendant={quickOpen.results[active] ? `go-studio-quick-open-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          {quickOpen.loading ? <Loader2 size={13} className="animate-spin text-text-4" /> : <span className="text-[9px] text-text-4">{quickOpen.results.length}/100</span>}
          <button type="button" aria-label="Close" onClick={() => setQuickOpen(false)} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div ref={listRef} id="go-studio-quick-open-results" role="listbox" aria-label="Files" className="max-h-[52vh] overflow-auto py-1">
          {quickOpen.results.map((result, index) => (
            <button
              key={result.relativePath}
              id={`go-studio-quick-open-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              onMouseEnter={() => setActive(index)}
              onClick={() => open(result.relativePath)}
              className={`flex h-8 w-full items-center gap-2 px-3 text-left ${index === active ? 'bg-accent/15' : 'hover:bg-surface-3'}`}
            >
              <GoStudioFileIcon name={result.name} relativePath={result.relativePath} size={12} />
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

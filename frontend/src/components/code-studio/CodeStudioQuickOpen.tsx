import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'
import { CodeStudioPalette } from './CodeStudioModal'

/** Next highlighted row for an arrow key, wrapping at both ends. */
export function quickOpenIndex(current: number, key: string, count: number): number {
  if (count === 0) return 0
  if (key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return Math.min(current, count - 1)
}

function scrollActiveIntoView(element: HTMLElement | null) {
  element?.scrollIntoView({ block: 'nearest' })
}

export function CodeStudioQuickOpen() {
  const quickOpen = useCodeStudioStore((state) => state.quickOpen)
  const setQuickOpen = useCodeStudioStore((state) => state.setQuickOpen)
  const searchQuickOpen = useCodeStudioStore((state) => state.searchQuickOpen)
  const openDocument = useCodeStudioStore((state) => state.openDocument)
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (quickOpen.open) inputRef.current?.focus()
  }, [quickOpen.open])

  // Search right away when the palette opens or the query is cleared, debounce while typing.
  useEffect(() => {
    if (!quickOpen.open) return
    const timer = window.setTimeout(() => void searchQuickOpen(quickOpen.query), quickOpen.query ? 120 : 0)
    return () => window.clearTimeout(timer)
  }, [quickOpen.open, quickOpen.query, searchQuickOpen])

  // New results start from the best match.
  const [prevResults, setPrevResults] = useState(quickOpen.results)
  if (prevResults !== quickOpen.results) {
    setPrevResults(quickOpen.results)
    setActive(0)
  }

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
    <CodeStudioPalette
      open
      onClose={() => setQuickOpen(false)}
      ariaLabel="Quick Open"
      icon={Search}
      input={
        <input
          ref={inputRef}
          value={quickOpen.query}
          onChange={(event) => useCodeStudioStore.setState((state) => ({ quickOpen: { ...state.quickOpen, query: event.target.value } }))}
          onKeyDown={onKeyDown}
          placeholder="Go to file by name or path"
          role="combobox"
          aria-expanded="true"
          aria-controls="code-studio-quick-open-results"
          aria-activedescendant={quickOpen.results[active] ? `code-studio-quick-open-${active}` : undefined}
          className="gs-palette-input"
        />
      }
      meta={quickOpen.loading ? <Loader2 size={14} className="animate-spin" /> : quickOpen.query ? `${quickOpen.results.length} file${quickOpen.results.length === 1 ? '' : 's'}` : undefined}
    >
      <div id="code-studio-quick-open-results" role="listbox" aria-label="Files">
        {quickOpen.results.map((result, index) => (
          <button
            key={result.relativePath}
            id={`code-studio-quick-open-${index}`}
            type="button"
            role="option"
            ref={index === active ? scrollActiveIntoView : undefined}
            aria-selected={index === active}
            tabIndex={-1}
            onMouseEnter={() => setActive(index)}
            onClick={() => open(result.relativePath)}
            className="gs-palette-item"
          >
            <CodeStudioFileIcon name={result.name} relativePath={result.relativePath} />
            <span className="gs-palette-item-title">{result.name}</span>
            <span className="gs-palette-item-detail">{result.relativePath}</span>
          </button>
        ))}
        {!quickOpen.loading && quickOpen.results.length === 0 && <p className="gs-palette-empty">No matching files.</p>}
      </div>
    </CodeStudioPalette>
  )
}

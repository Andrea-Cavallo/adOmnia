import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FolderOpen } from 'lucide-react'
import { useCodeStudioFilePickStore, filterFilePickItems } from '@/lib/codeStudioFilePicker'
import { CodeStudioPalette } from './CodeStudioModal'
import { quickOpenIndex } from './CodeStudioQuickOpen'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'

function scrollActiveIntoView(element: HTMLElement | null) {
  element?.scrollIntoView({ block: 'nearest' })
}

/** Scelta di un file da un elenco già noto: i sorgenti di una dipendenza, aperti dall'editor. */
export function CodeStudioFilePicker() {
  const pick = useCodeStudioFilePickStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => filterFilePickItems(pick.items, query), [pick.items, query])

  // Reset state when the picker opens (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(pick.open)
  if (wasOpen !== pick.open) {
    setWasOpen(pick.open)
    if (pick.open) {
      setQuery('')
      setActive(0)
    }
  }

  useEffect(() => {
    if (pick.open) inputRef.current?.focus()
  }, [pick.open])

  const updateQuery = (value: string) => {
    setQuery(value)
    setActive(0)
  }

  if (!pick.open) return null

  const choose = (id: string | undefined) => {
    if (!id) return
    pick.settle(id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      pick.settle(null)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active]?.id)
      return
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) || ((event.key === 'Home' || event.key === 'End') && event.ctrlKey)) {
      event.preventDefault()
      setActive((current) => quickOpenIndex(current, event.key, results.length))
    }
  }

  return (
    <CodeStudioPalette
      open
      onClose={() => pick.settle(null)}
      ariaLabel={pick.title}
      icon={FolderOpen}
      prefix={pick.prefix || undefined}
      input={
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Go to file"
          role="combobox"
          aria-expanded="true"
          aria-controls="code-studio-file-pick-results"
          aria-activedescendant={results[active] ? `code-studio-file-pick-${active}` : undefined}
          className="gs-palette-input"
        />
      }
      meta={`${results.length} file${results.length === 1 ? '' : 's'}`}
    >
      <div id="code-studio-file-pick-results" role="listbox" aria-label="Files">
        {results.map((item, index) => (
          <button
            key={item.id}
            id={`code-studio-file-pick-${index}`}
            type="button"
            role="option"
            ref={index === active ? scrollActiveIntoView : undefined}
            aria-selected={index === active}
            tabIndex={-1}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(item.id)}
            className="gs-palette-item"
          >
            <CodeStudioFileIcon name={item.name} relativePath={item.detail} />
            <span className="gs-palette-item-title">{item.name}</span>
            <span className="gs-palette-item-detail">{item.detail}</span>
          </button>
        ))}
        {results.length === 0 && <p className="gs-palette-empty">No matching files.</p>}
      </div>
    </CodeStudioPalette>
  )
}

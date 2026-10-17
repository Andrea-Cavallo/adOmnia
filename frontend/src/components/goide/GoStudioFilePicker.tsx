import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FolderOpen } from 'lucide-react'
import { useGoIDEFilePickStore, filterFilePickItems } from '@/lib/goideFilePicker'
import { GoStudioPalette } from './GoStudioModal'
import { quickOpenIndex } from './GoStudioQuickOpen'
import { GoStudioFileIcon } from './GoStudioFileIcon'

/** Scelta di un file da un elenco già noto: i sorgenti di una dipendenza, aperti dall'editor. */
export function GoStudioFilePicker() {
  const pick = useGoIDEFilePickStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => filterFilePickItems(pick.items, query), [pick.items, query])

  useEffect(() => {
    if (!pick.open) return
    setQuery('')
    setActive(0)
    inputRef.current?.focus()
  }, [pick.open])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

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
    <GoStudioPalette
      open
      onClose={() => pick.settle(null)}
      ariaLabel={pick.title}
      icon={FolderOpen}
      prefix={pick.prefix || undefined}
      input={
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Go to file"
          role="combobox"
          aria-expanded="true"
          aria-controls="go-studio-file-pick-results"
          aria-activedescendant={results[active] ? `go-studio-file-pick-${active}` : undefined}
          className="gs-palette-input"
        />
      }
      meta={`${results.length} file${results.length === 1 ? '' : 's'}`}
    >
      <div ref={listRef} id="go-studio-file-pick-results" role="listbox" aria-label="Files">
        {results.map((item, index) => (
          <button
            key={item.id}
            id={`go-studio-file-pick-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            tabIndex={-1}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(item.id)}
            className="gs-palette-item"
          >
            <GoStudioFileIcon name={item.name} relativePath={item.detail} />
            <span className="gs-palette-item-title">{item.name}</span>
            <span className="gs-palette-item-detail">{item.detail}</span>
          </button>
        ))}
        {results.length === 0 && <p className="gs-palette-empty">No matching files.</p>}
      </div>
    </GoStudioPalette>
  )
}

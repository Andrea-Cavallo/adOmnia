import { useState, type KeyboardEvent } from 'react'
import { Files } from 'lucide-react'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'
import { CodeStudioPalette } from './CodeStudioModal'
import { quickOpenIndex } from './CodeStudioQuickOpen'

/** File aperti che contengono la ricerca nel nome o nel percorso; il file attivo resta in fondo, come in Ctrl+Tab. */
export function filterOpenFiles(documents: GoIDEEditorDocument[], query: string, activeId: string): GoIDEEditorDocument[] {
  const needle = query.trim().toLowerCase()
  const matches = documents.filter((item) => !needle || item.document.relativePath.toLowerCase().includes(needle))
  return [...matches.filter((item) => item.document.id !== activeId), ...matches.filter((item) => item.document.id === activeId)]
}

/** Elenco ricercabile dei file aperti, accanto alle tab: si raggiunge un file anche quando la sua tab è fuori vista. */
export function CodeStudioOpenFilesSwitcher({ documents, activeId, onSelect }: { documents: GoIDEEditorDocument[]; activeId: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = filterOpenFiles(documents, query, activeId)
  const close = () => { setOpen(false); setQuery(''); setActive(0) }
  const choose = (item: GoIDEEditorDocument | undefined) => {
    if (!item) return
    onSelect(item.document.id)
    close()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); choose(results[active]); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => quickOpenIndex(current, event.key, results.length))
    }
  }

  return (
    <>
      <button type="button" aria-label={`Open files (${documents.length})`} aria-haspopup="dialog" aria-expanded={open} title="Switch between open files" disabled={documents.length === 0}
        className={`code-studio-icon-button code-studio-open-files h-7 min-w-7 shrink-0 justify-center self-center px-1.5 text-[12px] ${open ? 'is-active' : ''}`} onClick={() => setOpen(true)}>
        <span className="tabular-nums">{documents.length}</span>
      </button>
      <CodeStudioPalette open={open} onClose={close} ariaLabel="Open files" icon={Files} meta={`${results.length} open`}
        input={<input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={onKeyDown} placeholder="Find an open file" role="combobox" aria-expanded="true" aria-controls="code-studio-open-files-results"
          aria-activedescendant={results[active] ? `code-studio-open-file-${active}` : undefined} className="gs-palette-input" />}>
        <div id="code-studio-open-files-results" role="listbox" aria-label="Open files">
          {results.map((item, index) => (
            <button key={item.document.id} id={`code-studio-open-file-${index}`} type="button" role="option" aria-selected={index === active} tabIndex={-1}
              ref={index === active ? (element) => element?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseEnter={() => setActive(index)} onClick={() => choose(item)} className="gs-palette-item">
              <CodeStudioFileIcon name={item.document.name} relativePath={item.document.relativePath} />
              <span className="gs-palette-item-title">{item.document.name}{item.dirty && <span className="code-studio-tab-dirty ml-1.5 inline-block align-middle" aria-label="Unsaved changes" />}</span>
              <span className="gs-palette-item-detail">{item.document.id === activeId ? 'current · ' : ''}{item.document.relativePath}</span>
            </button>
          ))}
          {results.length === 0 && <p className="gs-palette-empty">No open file matches.</p>}
        </div>
      </CodeStudioPalette>
    </>
  )
}

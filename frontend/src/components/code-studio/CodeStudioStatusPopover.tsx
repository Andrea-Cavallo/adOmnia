import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

/** Testo con cui si cerca una voce: etichetta visibile, nome accessibile, tooltip e parole chiave extra. */
function searchableText(element: Element): string {
  const parts = [element.textContent ?? '', element.getAttribute('data-search') ?? '']
  element.querySelectorAll('[aria-label], [title]').forEach((child) => parts.push(child.getAttribute('aria-label') ?? '', child.getAttribute('title') ?? ''))
  return parts.join(' ').toLowerCase()
}

/** Corpo del popover di stato: ricerca in testa e sezioni; le voci sono `[data-status-item]` dentro `.code-studio-status-section`. */
export function CodeStudioStatusPopover({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  // ponytail: filtro sul DOM, perché le voci sono componenti eterogenei (LSP, toolchain, Copilot…) senza un modello comune.
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.querySelectorAll('.code-studio-status-section').forEach((section) => {
      let visible = 0
      section.querySelectorAll('[data-status-item]').forEach((item) => {
        const match = !needle || searchableText(item).includes(needle)
        item.toggleAttribute('hidden', !match)
        if (match) visible++
      })
      section.toggleAttribute('hidden', visible === 0)
    })
  })
  return (
    <div ref={ref} className="code-studio-status-popover">
      <label className="code-studio-status-search">
        <Search size={13} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search status and tools" aria-label="Search status and tools" />
      </label>
      {children}
    </div>
  )
}

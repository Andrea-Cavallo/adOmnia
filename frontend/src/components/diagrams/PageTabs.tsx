/** The pages of the open diagram, bottom left of the canvas: click to switch, double-click or right-click to rename, + to add. */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { confirm } from '@/lib/confirmDialog'
import { useDiagramStudio } from '@/stores/diagramStudio'

interface PageMenu { x: number; y: number; pageId: string }

export function PageTabs() {
  const pages = useDiagramStudio((state) => state.doc?.pages ?? [])
  const active = useDiagramStudio((state) => state.doc?.activePageId)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<PageMenu | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const store = useDiagramStudio.getState

  useEffect(() => {
    if (!menu) return undefined
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const finish = (pageId: string, value: string | null) => {
    if (value !== null) store().renamePage(pageId, value)
    setRenaming(null)
  }
  const onKey = (pageId: string) => (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') finish(pageId, event.currentTarget.value)
    if (event.key === 'Escape') finish(pageId, null)
  }
  const remove = async (pageId: string, name: string) => {
    const ok = await confirm({ title: 'Delete page', message: `Delete the page “${name}” and everything on it?`, confirmLabel: 'Delete', variant: 'danger' })
    if (ok) store().removePage(pageId)
  }
  const openMenu = (event: ReactMouseEvent, pageId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, pageId })
  }
  const page = menu ? pages.find((candidate) => candidate.id === menu.pageId) : undefined

  return (
    <div className="diagram-pages diagram-no-export" role="tablist" aria-label="Pages">
      {pages.map((item) => (
        <div key={item.id} className={cn('diagram-page', item.id === active && 'is-active')}>
          {renaming === item.id ? (
            <input defaultValue={item.name} autoFocus onFocus={(event) => event.currentTarget.select()} onBlur={(event) => finish(item.id, event.currentTarget.value)} onKeyDown={onKey(item.id)} aria-label="Page name" />
          ) : (
            <button
              type="button"
              role="tab"
              aria-selected={item.id === active}
              onClick={() => store().switchPage(item.id)}
              onDoubleClick={() => setRenaming(item.id)}
              onContextMenu={(event) => openMenu(event, item.id)}
              title="Double-click to rename, right-click for the page menu"
            >
              {item.name}
            </button>
          )}
          {pages.length > 1 && item.id === active && renaming !== item.id && (
            <button type="button" onClick={() => void remove(item.id, item.name)} aria-label={`Delete page ${item.name}`} title="Delete page"><X size={10} /></button>
          )}
        </div>
      ))}
      <button type="button" className="diagram-page" onClick={() => store().addPage()} title="Add a page" aria-label="Add a page"><Plus size={12} /></button>
      {menu && page && (
        <div ref={menuRef} className="diagram-menu diagram-no-export" role="menu" style={{ left: menu.x, top: menu.y }} aria-label="Page actions">
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming(page.id) }}><Pencil size={12} /> Rename page</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); store().switchPage(page.id) }} disabled={page.id === active}><Check size={12} /> Open this page</button>
          <div className="diagram-menu-divider" role="separator" />
          <button type="button" role="menuitem" onClick={() => { setMenu(null); store().addPage() }}><Plus size={12} /> Add a page</button>
          <button type="button" role="menuitem" className="is-danger" disabled={pages.length < 2} onClick={() => { setMenu(null); void remove(page.id, page.name) }}>
            <Trash2 size={12} /> Delete page
          </button>
        </div>
      )}
    </div>
  )
}

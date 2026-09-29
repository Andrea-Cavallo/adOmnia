import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Bookmark, History, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDEStore } from '@/stores/goide'
import { bookmarksFor, historyFor, recentLocations, useGoIDENavigationStore, type GoIDEBookmark } from '@/stores/goideNavigation'

interface GoStudioBookmarksDialogProps {
  open: boolean
  sessionId: string
  /** recent: Recent Locations (Ctrl+Shift+E), la stessa lista senza rimozione. */
  mode?: 'bookmarks' | 'recent'
  onClose: () => void
}

/** Testo della riga se il file è già aperto: nessuna lettura da disco solo per l'anteprima. */
function linePreview(sessionId: string, bookmark: GoIDEBookmark): string {
  const document = useGoIDEStore.getState().documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === bookmark.relativePath)
  return document?.buffer.split(/\r?\n/)[bookmark.line - 1]?.trim() ?? ''
}

/** Elenco dei segnalibri (Shift+F11): Invio apre, Canc rimuove, frecce per scorrere. */
export function GoStudioBookmarksDialog({ open, sessionId, mode = 'bookmarks', onClose }: GoStudioBookmarksDialogProps) {
  const savedBookmarks = useGoIDENavigationStore((state) => bookmarksFor(state, sessionId))
  const history = useGoIDENavigationStore((state) => historyFor(state, sessionId))
  const recent = mode === 'recent'
  const bookmarks = recent ? recentLocations(history) : savedBookmarks
  const [selected, setSelected] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  useEffect(() => {
    if (!open) return
    setSelected(0)
    const timer = window.setTimeout(() => listRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])
  useEffect(() => { setSelected((value) => Math.min(value, Math.max(bookmarks.length - 1, 0))) }, [bookmarks.length])
  if (!open) return null

  const openBookmark = (bookmark: GoIDEBookmark | undefined) => {
    if (!bookmark) return
    onClose()
    void useGoIDEStore.getState().openLocation(bookmark.relativePath, bookmark.line, 1)
  }
  const remove = (bookmark: GoIDEBookmark | undefined) => {
    if (bookmark && !recent) useGoIDENavigationStore.getState().removeBookmark(sessionId, bookmark)
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, bookmarks.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); openBookmark(bookmarks[selected]) }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(bookmarks[selected]) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={recent ? 'Recent locations' : 'Bookmarks'} tabIndex={-1} className="w-[min(620px,90vw)] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3">{recent ? <History size={12} className="text-accent" /> : <Bookmark size={12} className="text-accent" />}<h2 className="text-xs font-semibold text-text-1">{recent ? 'Recent Locations' : 'Bookmarks'}</h2><span className="text-[10px] text-text-4">{recent ? 'Enter opens · places you visited, newest first' : 'Enter opens · Delete removes · F11 toggles in the editor'}</span><button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div ref={listRef} role="listbox" aria-label="Bookmarks list" tabIndex={0} aria-activedescendant={bookmarks[selected] ? `bookmark-${selected}` : undefined} onKeyDown={onKeyDown} className="max-h-[50vh] overflow-auto py-1 outline-none">
          {bookmarks.length === 0 && <p className="px-3 py-4 text-[11px] text-text-4">{recent ? 'No locations yet: open files and move around.' : 'No bookmarks. Press F11 on a line to add one.'}</p>}
          {bookmarks.map((bookmark, index) => (
            <div key={`${bookmark.relativePath}:${bookmark.line}`} id={`bookmark-${index}`} role="option" tabIndex={-1} aria-selected={index === selected} onClick={() => openBookmark(bookmark)} onMouseEnter={() => setSelected(index)}
              className={`group flex h-8 cursor-pointer items-center gap-2 px-3 text-[11px] ${index === selected ? 'bg-accent/15 text-text-1' : 'text-text-2'}`}>
              <span className="shrink-0 font-mono text-text-3">{bookmark.relativePath}:{bookmark.line}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-4">{linePreview(sessionId, bookmark)}</span>
              <button type="button" aria-label={`Remove bookmark ${bookmark.relativePath}:${bookmark.line}`} onClick={(event) => { event.stopPropagation(); remove(bookmark) }} className={`grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:text-danger group-hover:opacity-100 ${recent ? 'hidden' : ''}`}><X size={10} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

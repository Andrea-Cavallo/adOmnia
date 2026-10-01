import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Bookmark, History, X } from 'lucide-react'
import { GoStudioModal } from './GoStudioModal'
import { GoStudioFileIcon } from './GoStudioFileIcon'
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
  const listRef = useRef<HTMLDivElement>(null)
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
    <GoStudioModal
      open={open}
      onClose={onClose}
      top
      size="lg"
      divided
      flush
      icon={recent ? History : Bookmark}
      title={recent ? 'Recent locations' : 'Bookmarks'}
      subtitle={recent ? 'Places you visited, newest first.' : 'Press F11 on a line to add or remove one.'}
      footerStart={<><span className="gs-kbd">↑↓</span> move <span className="gs-kbd">Enter</span> open{!recent && <><span className="gs-kbd">Del</span> remove</>}</>}
    >
      <div ref={listRef} role="listbox" aria-label={recent ? 'Recent locations' : 'Bookmarks'} tabIndex={0} aria-activedescendant={bookmarks[selected] ? `bookmark-${selected}` : undefined} onKeyDown={onKeyDown} className="max-h-[50vh] overflow-auto p-1.5 outline-none">
        {bookmarks.length === 0 && <p className="gs-list-empty">{recent ? 'No locations yet: open files and move around.' : 'No bookmarks yet.'}</p>}
        {bookmarks.map((bookmark, index) => (
          <div key={`${bookmark.relativePath}:${bookmark.line}`} id={`bookmark-${index}`} role="option" tabIndex={-1} aria-selected={index === selected} onClick={() => openBookmark(bookmark)} onMouseEnter={() => setSelected(index)}
            className={`group flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 ${index === selected ? 'bg-accent/15 text-text-1' : 'text-text-2'}`}>
            <GoStudioFileIcon name={bookmark.relativePath.split('/').pop() ?? bookmark.relativePath} relativePath={bookmark.relativePath} />
            <span className="shrink-0 text-[12.5px]">{bookmark.relativePath.split('/').pop()}<span className="text-text-4">:{bookmark.line}</span></span>
            <span className="gs-mono min-w-0 flex-1 truncate text-[11.5px] text-text-4">{linePreview(sessionId, bookmark)}</span>
            {!recent && <button type="button" aria-label={`Remove bookmark ${bookmark.relativePath}:${bookmark.line}`} onClick={(event) => { event.stopPropagation(); remove(bookmark) }} className="gs-btn gs-btn-danger-ghost gs-btn-sm gs-btn-icon opacity-0 group-hover:opacity-100"><X size={13} /></button>}
          </div>
        ))}
      </div>
    </GoStudioModal>
  )
}

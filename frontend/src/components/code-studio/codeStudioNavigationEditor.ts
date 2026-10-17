import { useCodeStudioStore } from '@/stores/codeStudio'
import { useMemo, type MutableRefObject } from 'react'
import { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { bookmarksFor, useCodeStudioNavigationStore, type GoIDEBookmark } from '@/stores/codeStudioNavigation'
import { documentForModel } from './codeStudioLanguageFeatures'
import { useTrackedLineMarkers } from './codeStudioLineMarkers'

/** Solo i file del progetto entrano in cronologia e segnalibri: i sorgenti SDK non si riaprono per percorso. */
function projectDocument(model: monaco.editor.ITextModel | null): GoIDEEditorDocument | null {
  const document = model ? documentForModel(model) : null
  return document && !document.document.external ? document : null
}

/** Registra la posizione del cursore nella cronologia Back/Forward della sessione. */
export function recordCaretPosition(model: monaco.editor.ITextModel | null, position: monaco.IPosition): void {
  const document = projectDocument(model)
  if (!document) return
  useCodeStudioNavigationStore.getState().record(document.document.sessionId, { relativePath: document.document.relativePath, line: position.lineNumber, column: position.column })
}

/** F11: segnalibro sulla riga del cursore. */
export function toggleBookmarkAtCursor(editor: monaco.editor.ICodeEditor | null): boolean {
  const document = projectDocument(editor?.getModel() ?? null)
  const position = editor?.getPosition()
  if (!document || !position) return false
  useCodeStudioNavigationStore.getState().toggleBookmark(document.document.sessionId, { relativePath: document.document.relativePath, line: position.lineNumber })
  return true
}

export function bookmarkDecorations(bookmarks: GoIDEBookmark[], relativePath: string): monaco.editor.IModelDeltaDecoration[] {
  return bookmarks.filter((bookmark) => bookmark.relativePath === relativePath).map((bookmark) => ({
    range: { startLineNumber: bookmark.line, startColumn: 1, endLineNumber: bookmark.line, endColumn: 1 },
    options: {
      linesDecorationsClassName: 'code-studio-bookmark',
      linesDecorationsTooltip: 'Bookmark · F11 to remove, Shift+F11 to list',
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      overviewRuler: { color: 'rgba(139, 92, 246, 0.9)', position: monaco.editor.OverviewRulerLane.Left },
    },
  }))
}

/** Segnalibri del file nell'editor: seguono il testo mentre si scrive. */
export function useCodeStudioBookmarks(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const { sessionId, relativePath, id, external } = document.document
  const bookmarks = useCodeStudioNavigationStore((state) => bookmarksFor(state, sessionId))
  const decorations = useMemo(() => bookmarkDecorations(bookmarks, relativePath), [bookmarks, relativePath])
  useTrackedLineMarkers(editorRef, {
    documentId: id, mountCount, decorations, tracked: !external,
    onMoved: (lines) => useCodeStudioNavigationStore.getState().moveBookmarks(sessionId, relativePath, lines),
  })
}

/** Esegue i comandi di cronologia e segnalibri; false se il comando non appartiene a quest'area. */
export function runNavigationCommand(id: string, sessionId: string | null, editor: monaco.editor.ICodeEditor | null, openList: (mode: 'bookmarks' | 'recent') => void): boolean {
  if (!sessionId) return false
  switch (id) {
    case 'nav.back': void useCodeStudioNavigationStore.getState().go(sessionId, -1); return true
    case 'nav.forward': void useCodeStudioNavigationStore.getState().go(sessionId, 1); return true
    case 'nav.toggleBookmark': toggleBookmarkAtCursor(editor); return true
    case 'nav.bookmarks': openList('bookmarks'); return true
    case 'nav.recentLocations': openList('recent'); return true
    case 'nav.lastEdit': {
      const last = useCodeStudioNavigationStore.getState().lastEdit[sessionId]
      if (last) void useCodeStudioStore.getState().openLocation(last.relativePath, last.line, last.column)
      return true
    }
    default: return false
  }
}

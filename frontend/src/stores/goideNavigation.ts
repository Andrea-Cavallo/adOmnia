import { create } from 'zustand'
import { registerSessionViewExtension, useGoIDEStore } from './goide'

const MAX_HISTORY = 50
const MAX_BOOKMARKS = 200
/** Spostamenti più brevi nello stesso file aggiornano la voce corrente invece di crearne una nuova (come GoLand). */
const NEARBY_LINES = 10
const PERSIST_DEBOUNCE_MS = 1000

export interface GoIDENavigationEntry {
  relativePath: string
  line: number
  column: number
}

export interface GoIDENavigationHistory {
  entries: GoIDENavigationEntry[]
  index: number
}

export interface GoIDEBookmark {
  relativePath: string
  line: number
}

const EMPTY_HISTORY: GoIDENavigationHistory = { entries: [], index: -1 }
const EMPTY_BOOKMARKS: GoIDEBookmark[] = []

/** Registra una posizione: un salto crea una voce e taglia il "futuro", un piccolo spostamento aggiorna la corrente. */
export function recordNavigation(history: GoIDENavigationHistory, entry: GoIDENavigationEntry): GoIDENavigationHistory {
  const current = history.entries[history.index]
  if (current && current.relativePath === entry.relativePath && Math.abs(current.line - entry.line) < NEARBY_LINES) {
    if (current.line === entry.line && current.column === entry.column) return history
    const entries = [...history.entries]
    entries[history.index] = entry
    return { entries, index: history.index }
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-MAX_HISTORY)
  return { entries, index: entries.length - 1 }
}

/** Voce raggiunta con Back (-1) o Forward (+1), o null se non c'è. */
export function stepNavigation(history: GoIDENavigationHistory, direction: -1 | 1): { history: GoIDENavigationHistory; target: GoIDENavigationEntry } | null {
  const index = history.index + direction
  const target = history.entries[index]
  return target ? { history: { entries: history.entries, index }, target } : null
}

/** Aggiunge o toglie il segnalibro della riga, mantenendo l'elenco ordinato per file e riga. */
export function toggleBookmarkIn(bookmarks: GoIDEBookmark[], bookmark: GoIDEBookmark): GoIDEBookmark[] {
  const exists = bookmarks.some((item) => item.relativePath === bookmark.relativePath && item.line === bookmark.line)
  const next = exists
    ? bookmarks.filter((item) => item.relativePath !== bookmark.relativePath || item.line !== bookmark.line)
    : [...bookmarks, bookmark]
  return next.sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.line - right.line).slice(0, MAX_BOOKMARKS)
}

interface GoIDENavigationState {
  history: Record<string, GoIDENavigationHistory>
  bookmarks: Record<string, GoIDEBookmark[]>
  record: (sessionId: string, entry: GoIDENavigationEntry) => void
  go: (sessionId: string, direction: -1 | 1) => Promise<void>
  toggleBookmark: (sessionId: string, bookmark: GoIDEBookmark) => void
  removeBookmark: (sessionId: string, bookmark: GoIDEBookmark) => void
  /** Le righe dei segnalibri di un file dopo una modifica del testo (i segnalibri seguono il codice). */
  moveBookmarks: (sessionId: string, relativePath: string, lines: number[]) => void
}

let navigating = false
const persistTimers: Record<string, number> = {}

function schedulePersist(sessionId: string): void {
  window.clearTimeout(persistTimers[sessionId])
  persistTimers[sessionId] = window.setTimeout(() => void useGoIDEStore.getState().persistSessionView(sessionId), PERSIST_DEBOUNCE_MS)
}

export const useGoIDENavigationStore = create<GoIDENavigationState>((set, get) => ({
  history: {},
  bookmarks: {},

  record: (sessionId, entry) => {
    if (navigating) return
    const before = get().history[sessionId] ?? EMPTY_HISTORY
    const after = recordNavigation(before, entry)
    if (after === before) return
    set((state) => ({ history: { ...state.history, [sessionId]: after } }))
    if (after.entries.length !== before.entries.length || after.index !== before.index) schedulePersist(sessionId)
  },

  go: async (sessionId, direction) => {
    const step = stepNavigation(get().history[sessionId] ?? EMPTY_HISTORY, direction)
    if (!step) return
    set((state) => ({ history: { ...state.history, [sessionId]: step.history } }))
    // Durante il salto il cursore si muove: non va registrato come nuova navigazione.
    navigating = true
    try {
      await useGoIDEStore.getState().openLocation(step.target.relativePath, step.target.line, step.target.column)
    } finally {
      window.setTimeout(() => { navigating = false }, 100)
    }
    schedulePersist(sessionId)
  },

  toggleBookmark: (sessionId, bookmark) => {
    set((state) => ({ bookmarks: { ...state.bookmarks, [sessionId]: toggleBookmarkIn(state.bookmarks[sessionId] ?? EMPTY_BOOKMARKS, bookmark) } }))
    schedulePersist(sessionId)
  },

  removeBookmark: (sessionId, bookmark) => {
    set((state) => ({ bookmarks: { ...state.bookmarks, [sessionId]: (state.bookmarks[sessionId] ?? EMPTY_BOOKMARKS).filter((item) => item.relativePath !== bookmark.relativePath || item.line !== bookmark.line) } }))
    schedulePersist(sessionId)
  },

  moveBookmarks: (sessionId, relativePath, lines) => {
    const current = get().bookmarks[sessionId] ?? EMPTY_BOOKMARKS
    const before = current.filter((item) => item.relativePath === relativePath).map((item) => item.line)
    const after = [...new Set(lines)].sort((left, right) => left - right)
    if (before.length === after.length && before.every((line, index) => line === after[index])) return
    const others = current.filter((item) => item.relativePath !== relativePath)
    set((state) => ({ bookmarks: { ...state.bookmarks, [sessionId]: [...others, ...after.map((line) => ({ relativePath, line }))].sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.line - right.line) } }))
    schedulePersist(sessionId)
  },
}))

export function bookmarksFor(state: Pick<GoIDENavigationState, 'bookmarks'>, sessionId: string): GoIDEBookmark[] {
  return state.bookmarks[sessionId] ?? EMPTY_BOOKMARKS
}

export function historyFor(state: Pick<GoIDENavigationState, 'history'>, sessionId: string): GoIDENavigationHistory {
  return state.history[sessionId] ?? EMPTY_HISTORY
}

registerSessionViewExtension({
  save: (sessionId) => {
    const { history, bookmarks } = useGoIDENavigationStore.getState()
    const saved = history[sessionId] ?? EMPTY_HISTORY
    return { bookmarks: bookmarks[sessionId] ?? [], navigation: saved.entries, navigationIndex: Math.max(saved.index, 0) }
  },
  restore: (sessionId, view) => {
    const entries = view.navigation ?? []
    useGoIDENavigationStore.setState((state) => ({
      history: { ...state.history, [sessionId]: { entries, index: entries.length ? Math.min(view.navigationIndex ?? entries.length - 1, entries.length - 1) : -1 } },
      bookmarks: { ...state.bookmarks, [sessionId]: view.bookmarks ?? [] },
    }))
  },
})

import { create } from 'zustand'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/goide-api'
import {
  MAIN_GO_STUDIO_WINDOW, closeGoIDESessionWindow, focusGoIDESessionWindow, goStudioWindowContext,
  listGoIDESessionWindows, openGoIDESessionWindow, type GoIDESessionWindow, type GoStudioWindowContext,
} from '@/lib/goide-window-api'
import { registerSessionOwnershipGuard, useGoIDEStore } from './goide'

interface GoIDEWindowsState {
  context: GoStudioWindowContext
  /** Solo i progetti spostati in una finestra separata: gli altri appartengono alla principale. */
  owners: Record<string, string>
  error: string | null
  load: () => Promise<void>
  ownerOf: (sessionId: string) => string
  /** true se il progetto è modificabile in questa finestra. */
  ownsSession: (sessionId: string) => boolean
  moveToNewWindow: (sessionId: string) => Promise<boolean>
  focusOwner: (sessionId: string) => Promise<void>
  /** Chiude la finestra separata (con conferma se ha modifiche): il progetto torna alla principale. */
  bringBack: (sessionId: string) => Promise<void>
  handleEvent: (event: GoIDEEvent) => void
  clearError: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let unsubscribe: (() => void) | null = null

export const useGoIDEWindowsStore = create<GoIDEWindowsState>((set, get) => ({
  context: goStudioWindowContext(),
  owners: {},
  error: null,

  load: async () => {
    unsubscribe ??= subscribeGoIDEEvents((event) => get().handleEvent(event))
    try {
      const windows = await listGoIDESessionWindows()
      set({ owners: Object.fromEntries(windows.map((item) => [item.sessionId, item.windowId])) })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  ownerOf: (sessionId) => get().owners[sessionId] ?? MAIN_GO_STUDIO_WINDOW,

  ownsSession: (sessionId) => get().ownerOf(sessionId) === get().context.windowId,

  moveToNewWindow: async (sessionId) => {
    const goide = useGoIDEStore.getState()
    // I buffer non salvati vivono nel frontend di questa finestra: spostarli li perderebbe.
    const dirty = goide.documents.filter((item) => item.document.sessionId === sessionId && item.dirty)
    if (dirty.length > 0) {
      set({ error: `Save or discard ${dirty.length} unsaved file${dirty.length === 1 ? '' : 's'} before moving the project to a new window.` })
      return false
    }
    try {
      // La nuova finestra ripristina i tab da questa vista: va salvata prima di cedere il progetto.
      await goide.persistSessionView(sessionId)
      await openGoIDESessionWindow(sessionId)
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  focusOwner: async (sessionId) => {
    const owner = get().ownerOf(sessionId)
    if (owner === get().context.windowId) return
    try {
      await focusGoIDESessionWindow(owner)
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  bringBack: async (sessionId) => {
    const owner = get().ownerOf(sessionId)
    if (owner === MAIN_GO_STUDIO_WINDOW) return
    try {
      await closeGoIDESessionWindow(owner)
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  handleEvent: (event) => {
    if (event.type !== 'session.window-changed') return
    const change = event.payload as GoIDESessionWindow | undefined
    if (!change?.sessionId || !change.windowId) return
    const here = get().context.windowId
    set((state) => {
      const owners = { ...state.owners }
      if (change.windowId === MAIN_GO_STUDIO_WINDOW) delete owners[change.sessionId]
      else owners[change.sessionId] = change.windowId
      return { owners }
    })
    if (change.previousWindowId === here && change.windowId !== here) releaseSessionHere(change.sessionId)
    if (change.windowId === here && change.previousWindowId !== here && useGoIDEStore.getState().activeSessionId === change.sessionId) {
      void useGoIDEStore.getState().selectSession(change.sessionId)
    }
  },

  clearError: () => set({ error: null }),
}))

/**
 * Il progetto è passato a un'altra finestra: si chiudono qui i suoi editor puliti e si permette un
 * nuovo ripristino della vista quando tornerà. Un buffer modificato non viene mai scartato.
 */
function releaseSessionHere(sessionId: string): void {
  useGoIDEStore.setState((state) => ({
    documents: state.documents.filter((item) => item.document.sessionId !== sessionId || item.dirty),
    restoredSessions: { ...state.restoredSessions, [sessionId]: false },
  }))
}

registerSessionOwnershipGuard((sessionId) => useGoIDEWindowsStore.getState().ownsSession(sessionId))

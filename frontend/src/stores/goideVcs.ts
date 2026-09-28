import { create } from 'zustand'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/goide-api'
import {
  checkoutGoIDEBranch, commitGoIDEFiles, getGoIDEBlame, getGoIDEFileAtRevision, getGoIDEVCSStatus,
  type GoIDEVCSBlameLine, type GoIDEVCSStatus,
} from '@/lib/goide-vcs-api'
import type { GoStudioLineHunk } from '@/components/goide/goStudioLineDiff'

const STATUS_REFRESH_DEBOUNCE_MS = 700

export interface GoIDEHunkPopup {
  documentId: string
  hunk: GoStudioLineHunk
  anchor: { x: number; y: number }
}

interface GoIDEVCSState {
  status: Record<string, GoIDEVCSStatus | null>
  /** Contenuto HEAD per sessione e file: undefined non ancora letto, null se il file non è versionato. */
  head: Record<string, string | null>
  /** Annotazioni blame attive, per documento. */
  blame: Record<string, GoIDEVCSBlameLine[]>
  hunkPopup: GoIDEHunkPopup | null
  error: string | null
  refreshStatus: (sessionId: string) => Promise<void>
  loadHead: (sessionId: string, relativePath: string) => Promise<void>
  toggleBlame: (sessionId: string, documentId: string, relativePath: string) => Promise<void>
  commit: (sessionId: string, message: string, relativePaths: string[]) => Promise<string | null>
  checkout: (sessionId: string, branch: string) => Promise<boolean>
  showHunk: (popup: GoIDEHunkPopup | null) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function headKey(sessionId: string, relativePath: string): string {
  return `${sessionId}\u0000${relativePath}`
}

let unsubscribe: (() => void) | null = null
const refreshTimers: Record<string, number> = {}

export const useGoIDEVCSStore = create<GoIDEVCSState>((set, get) => {
  const ensureSubscribed = () => {
    if (unsubscribe) return
    unsubscribe = subscribeGoIDEEvents((event: GoIDEEvent) => {
      // Salvataggi e modifiche su disco cambiano le modifiche locali: lo stato si rilegge a scrittura ferma.
      if (!event.sessionId || (event.type !== 'document.saved' && event.type !== 'files.changed')) return
      const sessionId = event.sessionId
      window.clearTimeout(refreshTimers[sessionId])
      refreshTimers[sessionId] = window.setTimeout(() => void get().refreshStatus(sessionId), STATUS_REFRESH_DEBOUNCE_MS)
    })
  }

  const dropHeads = (sessionId: string) => set((state) => ({
    head: Object.fromEntries(Object.entries(state.head).filter(([key]) => !key.startsWith(`${sessionId}\u0000`))),
  }))

  return {
    status: {},
    head: {},
    blame: {},
    hunkPopup: null,
    error: null,

    refreshStatus: async (sessionId) => {
      ensureSubscribed()
      try {
        const next = await getGoIDEVCSStatus(sessionId)
        const previous = get().status[sessionId]
        set((state) => ({ status: { ...state.status, [sessionId]: next } }))
        // Nuovo commit o cambio di branch (anche dal terminale): i contenuti HEAD vanno riletti.
        if (previous && (previous.head !== next.head || previous.branch !== next.branch)) dropHeads(sessionId)
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    loadHead: async (sessionId, relativePath) => {
      const key = headKey(sessionId, relativePath)
      if (key in get().head) return
      const status = get().status[sessionId]
      if (!status?.available) return
      const tracked = !status.changes.some((change) => change.relativePath === relativePath && change.untracked)
      try {
        const content = tracked ? await getGoIDEFileAtRevision(sessionId, relativePath, 'HEAD') : null
        set((state) => ({ head: { ...state.head, [key]: content } }))
      } catch {
        set((state) => ({ head: { ...state.head, [key]: null } }))
      }
    },

    toggleBlame: async (sessionId, documentId, relativePath) => {
      if (get().blame[documentId]) {
        set((state) => ({ blame: Object.fromEntries(Object.entries(state.blame).filter(([id]) => id !== documentId)) }))
        return
      }
      try {
        const lines = await getGoIDEBlame(sessionId, relativePath)
        set((state) => ({ blame: { ...state.blame, [documentId]: lines } }))
      } catch (error) {
        set({ error: errorMessage(error) })
        throw error
      }
    },

    commit: async (sessionId, message, relativePaths) => {
      try {
        const result = await commitGoIDEFiles(sessionId, message, relativePaths)
        dropHeads(sessionId)
        await get().refreshStatus(sessionId)
        return result.hash
      } catch (error) {
        set({ error: errorMessage(error) })
        throw error
      }
    },

    checkout: async (sessionId, branch) => {
      try {
        await checkoutGoIDEBranch(sessionId, branch)
        dropHeads(sessionId)
        set({ blame: {} })
        await get().refreshStatus(sessionId)
        return true
      } catch (error) {
        set({ error: errorMessage(error) })
        return false
      }
    },

    showHunk: (popup) => set({ hunkPopup: popup }),
  }
})

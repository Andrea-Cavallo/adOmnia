import { create } from 'zustand'
import { safeSetItem } from '@/lib/safeLocalStorage'
import {
  chooseGoIDEProjectFolder,
  closeGoIDESession,
  getGoIDECapabilities,
  listGoIDESessions,
  openGoIDEProject,
  setGoIDEToolAuthorization,
  type GoIDECapabilities,
  type GoIDESession,
} from '@/lib/goide-api'

const LAYOUT_KEY = 'adomnia.goide.layout.v1'

export interface GoIDELayout {
  projectWidth: number
  structureWidth: number
  bottomHeight: number
  structureOpen: boolean
  bottomOpen: boolean
}

const DEFAULT_LAYOUT: GoIDELayout = {
  projectWidth: 244,
  structureWidth: 220,
  bottomHeight: 164,
  structureOpen: true,
  bottomOpen: true,
}

function loadLayout(): GoIDELayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<GoIDELayout>
    return {
      projectWidth: Math.min(420, Math.max(180, parsed.projectWidth ?? DEFAULT_LAYOUT.projectWidth)),
      structureWidth: Math.min(360, Math.max(180, parsed.structureWidth ?? DEFAULT_LAYOUT.structureWidth)),
      bottomHeight: Math.min(360, Math.max(112, parsed.bottomHeight ?? DEFAULT_LAYOUT.bottomHeight)),
      structureOpen: parsed.structureOpen ?? true,
      bottomOpen: parsed.bottomOpen ?? true,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

interface GoIDEState {
  sessions: GoIDESession[]
  activeSessionId: string | null
  capabilities: GoIDECapabilities | null
  loading: boolean
  initialized: boolean
  error: string | null
  layout: GoIDELayout
  initialize: () => Promise<void>
  openProject: () => Promise<void>
  selectSession: (sessionId: string) => void
  setToolAuthorization: (allowed: boolean) => Promise<void>
  closeActiveSession: () => Promise<void>
  updateLayout: (patch: Partial<GoIDELayout>) => void
  clearError: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function replaceSession(sessions: GoIDESession[], next: GoIDESession): GoIDESession[] {
  const index = sessions.findIndex((session) => session.id === next.id)
  if (index < 0) return [...sessions, next]
  return sessions.map((session) => session.id === next.id ? next : session)
}

export const useGoIDEStore = create<GoIDEState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  capabilities: null,
  loading: false,
  initialized: false,
  error: null,
  layout: loadLayout(),

  initialize: async () => {
    if (get().initialized || get().loading) return
    set({ loading: true, error: null })
    try {
      const [capabilities, sessions] = await Promise.all([
        getGoIDECapabilities(),
        listGoIDESessions(),
      ])
      set((state) => ({
        capabilities,
        sessions,
        activeSessionId: sessions.some((session) => session.id === state.activeSessionId)
          ? state.activeSessionId
          : sessions[0]?.id ?? null,
        initialized: true,
        loading: false,
      }))
    } catch (error) {
      set({ loading: false, initialized: true, error: errorMessage(error) })
    }
  },

  openProject: async () => {
    set({ loading: true, error: null })
    try {
      const path = await chooseGoIDEProjectFolder()
      if (!path) {
        set({ loading: false })
        return
      }
      const session = await openGoIDEProject(path)
      set((state) => ({
        sessions: replaceSession(state.sessions, session),
        activeSessionId: session.id,
        loading: false,
      }))
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  selectSession: (activeSessionId) => set({ activeSessionId }),

  setToolAuthorization: async (allowed) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ loading: true, error: null })
    try {
      const session = await setGoIDEToolAuthorization(sessionId, allowed)
      set((state) => ({ sessions: replaceSession(state.sessions, session), loading: false }))
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  closeActiveSession: async () => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ loading: true, error: null })
    try {
      await closeGoIDESession(sessionId)
      set((state) => {
        const sessions = state.sessions.filter((session) => session.id !== sessionId)
        return { sessions, activeSessionId: sessions[0]?.id ?? null, loading: false }
      })
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  updateLayout: (patch) => set((state) => {
    const layout = { ...state.layout, ...patch }
    safeSetItem(LAYOUT_KEY, JSON.stringify(layout))
    return { layout }
  }),

  clearError: () => set({ error: null }),
}))

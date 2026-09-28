import { create } from 'zustand'
import { safeSetItem } from '@/lib/safeLocalStorage'
import {
  checkGoIDEDocument,
  chooseGoIDEProjectFolder,
  closeGoIDEDocument,
  closeGoIDESession,
  configureGoIDEToolchain,
  createGoIDEProject,
  detectGoIDEToolchain,
  getGoIDECapabilities,
  hasActiveGoIDERuns,
  listGoIDEDirectory,
  listGoIDERuns,
  listGoIDESessions,
  listRecentGoIDEProjects,
  openGoIDEDocument,
  openGoIDEProject,
  quickOpenGoIDEFiles,
  removeRecentGoIDEProject,
  restartGoIDERun,
  saveGoIDEDocument,
  setGoIDEToolAuthorization,
  startGoIDERun,
  stopGoIDERun,
  subscribeGoIDEEvents,
  writeGoIDERunInput,
  type GoIDECapabilities,
  type GoIDEDocumentDiskState,
  type GoIDEEvent,
  type GoIDEExecution,
  type GoIDEFileEntry,
  type GoIDEOpenDocument,
  type GoIDEQuickOpenResult,
  type GoIDERecentProject,
  type GoIDERunRequest,
  type GoIDESession,
  type GoIDEToolchainInfo,
  type GoIDEToolchainInstallation,
} from '@/lib/goide-api'
import { openExternalDocument } from '@/lib/goide-lsp-api'

const LAYOUT_KEY = 'adomnia.goide.layout.v1'
const MAX_CLOSED_HISTORY = 20

export type GoIDESplitOrientation = 'right' | 'down'

export interface GoIDESplit {
  orientation: GoIDESplitOrientation
  documentId: string
}

interface ClosedDocument {
  path: string
  external: boolean
}
const MAX_CONSOLE_BYTES = 4 * 1024 * 1024

export interface GoIDELayout {
  projectWidth: number
  structureWidth: number
  bottomHeight: number
  structureOpen: boolean
  bottomOpen: boolean
}

export interface GoIDEEditorDocument extends GoIDEOpenDocument {
  buffer: string
  savedContent: string
  dirty: boolean
  saving: boolean
  saveError: string | null
  externalState: GoIDEDocumentDiskState | null
}

export interface GoIDEConsoleChunk {
  sequence: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

const DEFAULT_LAYOUT: GoIDELayout = {
  projectWidth: 244,
  structureWidth: 220,
  bottomHeight: 190,
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
      bottomHeight: Math.min(480, Math.max(112, parsed.bottomHeight ?? DEFAULT_LAYOUT.bottomHeight)),
      structureOpen: parsed.structureOpen ?? true,
      bottomOpen: parsed.bottomOpen ?? true,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

interface GoIDEState {
  sessions: GoIDESession[]
  recentProjects: GoIDERecentProject[]
  activeSessionId: string | null
  capabilities: GoIDECapabilities | null
  loading: boolean
  initialized: boolean
  error: string | null
  layout: GoIDELayout
  directoryEntries: Record<string, Record<string, GoIDEFileEntry[]>>
  directoryLoading: Record<string, boolean>
  showIgnoredBySession: Record<string, boolean>
  documents: GoIDEEditorDocument[]
  activeDocumentBySession: Record<string, string | null>
  pinnedDocuments: Record<string, boolean>
  closedDocuments: Record<string, ClosedDocument[]>
  splitBySession: Record<string, GoIDESplit | null>
  toolchains: Record<string, GoIDEToolchainInfo | null>
  toolchainInstallations: Record<string, GoIDEToolchainInstallation>
  executions: GoIDEExecution[]
  activeRunBySession: Record<string, string | null>
  consoleByRun: Record<string, GoIDEConsoleChunk[]>
  quickOpen: { open: boolean; query: string; loading: boolean; results: GoIDEQuickOpenResult[]; request: number }
  revealLocation: { documentId: string; line: number; column: number } | null
  initialize: () => Promise<void>
  openProject: (path?: string) => Promise<void>
  createProject: (parentPath: string, name: string, modulePath: string) => Promise<boolean>
  removeRecentProject: (path: string) => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  setToolAuthorization: (allowed: boolean) => Promise<void>
  closeActiveSession: (discardDocuments?: boolean) => Promise<boolean>
  loadDirectory: (relativePath?: string) => Promise<void>
  toggleShowIgnored: () => Promise<void>
  openDocument: (relativePath: string) => Promise<string | null>
  openLocation: (relativePath: string, line: number, column?: number) => Promise<void>
  openExternalLocation: (path: string, line: number, column?: number) => Promise<void>
  ensureDocumentLoaded: (relativePath: string) => Promise<GoIDEEditorDocument | null>
  selectDocument: (documentId: string) => void
  updateDocument: (documentId: string, buffer: string) => void
  saveDocument: (documentId?: string, force?: boolean) => Promise<boolean>
  saveAllDocuments: (sessionId: string) => Promise<boolean>
  checkActiveDocument: () => Promise<void>
  resolveExternalChange: (documentId: string, action: 'reload' | 'keep') => void
  closeDocument: (documentId: string) => Promise<void>
  togglePinned: (documentId: string) => void
  reopenClosedDocument: () => Promise<void>
  setSplit: (orientation: GoIDESplitOrientation | null) => void
  setSplitDocument: (documentId: string) => void
  setQuickOpen: (open: boolean) => void
  searchQuickOpen: (query: string) => Promise<void>
  detectToolchain: () => Promise<void>
  configureToolchain: (goBinary: string, environment: Record<string, string>) => Promise<boolean>
  startRun: (kind: 'build' | 'run' | 'test' | 'tidy', partial?: Partial<GoIDERunRequest>) => Promise<void>
  stopRun: (runId?: string) => Promise<void>
  restartRun: (runId?: string) => Promise<void>
  sendRunInput: (runId: string, text: string) => Promise<void>
  hasActiveRuns: (sessionId: string) => Promise<boolean>
  handleEvent: (event: GoIDEEvent) => void
  clearRevealLocation: () => void
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

function replaceExecution(executions: GoIDEExecution[], next: GoIDEExecution): GoIDEExecution[] {
  const index = executions.findIndex((execution) => execution.id === next.id)
  if (index < 0) return [...executions, next]
  return executions.map((execution) => execution.id === next.id ? next : execution)
}

function toEditorDocument(opened: GoIDEOpenDocument): GoIDEEditorDocument {
  return {
    ...opened,
    buffer: opened.content,
    savedContent: opened.content,
    dirty: false,
    saving: false,
    saveError: null,
    externalState: null,
  }
}

function appendConsole(chunks: GoIDEConsoleChunk[], next: GoIDEConsoleChunk): GoIDEConsoleChunk[] {
  const result = [...chunks, next]
  let bytes = result.reduce((total, chunk) => total + chunk.text.length, 0)
  while (bytes > MAX_CONSOLE_BYTES && result.length > 1) {
    bytes -= result[0].text.length
    result.shift()
  }
  return result
}

function findSessionDocument(documents: GoIDEEditorDocument[], sessionId: string, path: string): GoIDEEditorDocument | undefined {
  return documents.find((item) => item.document.sessionId === sessionId && (item.document.relativePath === path || item.document.path === path))
}

function isExecution(value: unknown): value is GoIDEExecution {
  return !!value && typeof value === 'object' && typeof (value as GoIDEExecution).id === 'string'
}

let eventUnsubscribe: (() => void) | null = null

export const useGoIDEStore = create<GoIDEState>((set, get) => ({
  sessions: [],
  recentProjects: [],
  activeSessionId: null,
  capabilities: null,
  loading: false,
  initialized: false,
  error: null,
  layout: loadLayout(),
  directoryEntries: {},
  directoryLoading: {},
  showIgnoredBySession: {},
  documents: [],
  activeDocumentBySession: {},
  pinnedDocuments: {},
  closedDocuments: {},
  splitBySession: {},
  toolchains: {},
  toolchainInstallations: {},
  executions: [],
  activeRunBySession: {},
  consoleByRun: {},
  quickOpen: { open: false, query: '', loading: false, results: [], request: 0 },
  revealLocation: null,

  initialize: async () => {
    if (get().initialized || get().loading) return
    set({ loading: true, error: null })
    try {
      const [capabilities, sessions, recentProjects] = await Promise.all([
        getGoIDECapabilities(), listGoIDESessions(), listRecentGoIDEProjects(),
      ])
      if (!eventUnsubscribe) eventUnsubscribe = subscribeGoIDEEvents((event) => get().handleEvent(event))
      const activeSessionId = sessions.some((session) => session.id === get().activeSessionId)
        ? get().activeSessionId
        : sessions[0]?.id ?? null
      set({ capabilities, sessions, recentProjects, activeSessionId, initialized: true, loading: false })
      if (activeSessionId) await get().selectSession(activeSessionId)
    } catch (error) {
      set({ loading: false, initialized: true, error: errorMessage(error) })
    }
  },

  openProject: async (providedPath) => {
    set({ loading: true, error: null })
    try {
      const path = providedPath ?? await chooseGoIDEProjectFolder()
      if (!path) return set({ loading: false })
      const session = await openGoIDEProject(path)
      const recentProjects = await listRecentGoIDEProjects()
      set((state) => ({ sessions: replaceSession(state.sessions, session), recentProjects, activeSessionId: session.id, loading: false }))
      await get().selectSession(session.id)
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  createProject: async (parentPath, name, modulePath) => {
    set({ loading: true, error: null })
    try {
      const session = await createGoIDEProject({ parentPath, name, modulePath, confirmed: true })
      const recentProjects = await listRecentGoIDEProjects()
      set((state) => ({ sessions: replaceSession(state.sessions, session), recentProjects, activeSessionId: session.id, loading: false }))
      await get().selectSession(session.id)
      return true
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
      return false
    }
  },

  removeRecentProject: async (path) => {
    try {
      await removeRecentGoIDEProject(path)
      set((state) => ({ recentProjects: state.recentProjects.filter((project) => project.realPath !== path && project.rootPath !== path) }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  selectSession: async (activeSessionId) => {
    set({ activeSessionId, error: null })
    try {
      const [entries, executions] = await Promise.all([
        listGoIDEDirectory(activeSessionId), listGoIDERuns(activeSessionId),
      ])
      const running = executions.find((execution) => execution.status === 'running')?.id ?? null
      set((state) => ({
        directoryEntries: { ...state.directoryEntries, [activeSessionId]: { ...(state.directoryEntries[activeSessionId] ?? {}), '': entries } },
        executions: [...state.executions.filter((execution) => execution.sessionId !== activeSessionId), ...executions],
        activeRunBySession: { ...state.activeRunBySession, [activeSessionId]: running ?? state.activeRunBySession[activeSessionId] ?? executions[executions.length - 1]?.id ?? null },
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

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

  closeActiveSession: async (discardDocuments = false) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return true
    const dirty = get().documents.filter((item) => item.document.sessionId === sessionId && item.dirty)
    if (dirty.length > 0 && !discardDocuments) return false
    try {
      if (await hasActiveGoIDERuns(sessionId)) {
        set({ error: 'Stop active runs before closing this project.' })
        return false
      }
      await closeGoIDESession(sessionId)
      set((state) => {
        const sessions = state.sessions.filter((session) => session.id !== sessionId)
        return {
          sessions,
          documents: state.documents.filter((item) => item.document.sessionId !== sessionId),
          activeSessionId: sessions[0]?.id ?? null,
        }
      })
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  loadDirectory: async (relativePath = '') => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    const key = `${sessionId}:${relativePath}`
    set((state) => ({ directoryLoading: { ...state.directoryLoading, [key]: true } }))
    try {
      const entries = await listGoIDEDirectory(sessionId, relativePath, get().showIgnoredBySession[sessionId] ?? false)
      set((state) => ({
        directoryEntries: { ...state.directoryEntries, [sessionId]: { ...(state.directoryEntries[sessionId] ?? {}), [relativePath]: entries } },
        directoryLoading: { ...state.directoryLoading, [key]: false },
      }))
    } catch (error) {
      set((state) => ({ error: errorMessage(error), directoryLoading: { ...state.directoryLoading, [key]: false } }))
    }
  },

  toggleShowIgnored: async () => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set((state) => ({
      showIgnoredBySession: { ...state.showIgnoredBySession, [sessionId]: !(state.showIgnoredBySession[sessionId] ?? false) },
      directoryEntries: { ...state.directoryEntries, [sessionId]: {} },
    }))
    await get().loadDirectory('')
  },

  openDocument: async (path) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return null
    const activate = (documentId: string) => set((state) => ({ activeDocumentBySession: { ...state.activeDocumentBySession, [sessionId]: documentId } }))
    const existing = findSessionDocument(get().documents, sessionId, path)
    if (existing) {
      activate(existing.document.id)
      return existing.document.id
    }
    set({ loading: true, error: null })
    try {
      const opened = await openGoIDEDocument(sessionId, path)
      // Percorsi diversi (relativo, "./", assoluto) possono indicare lo stesso file: l'id stabile lo deduplica.
      if (get().documents.some((item) => item.document.id === opened.document.id)) {
        set({ loading: false })
        activate(opened.document.id)
        return opened.document.id
      }
      set((state) => ({ documents: [...state.documents, toEditorDocument(opened)], loading: false }))
      activate(opened.document.id)
      return opened.document.id
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
      return null
    }
  },

  openLocation: async (path, line, column = 1) => {
    const documentId = await get().openDocument(path)
    if (documentId) set({ revealLocation: { documentId, line: Math.max(1, line), column: Math.max(1, column) } })
  },

  openExternalLocation: async (path, line, column = 1) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ error: null })
    try {
      const existing = findSessionDocument(get().documents, sessionId, path)
      const documentId = existing?.document.id ?? await (async () => {
        const opened = await openExternalDocument(sessionId, path)
        if (!get().documents.some((item) => item.document.id === opened.document.id)) {
          set((state) => ({ documents: [...state.documents, toEditorDocument(opened)] }))
        }
        return opened.document.id
      })()
      set((state) => ({
        activeDocumentBySession: { ...state.activeDocumentBySession, [sessionId]: documentId },
        revealLocation: { documentId, line: Math.max(1, line), column: Math.max(1, column) },
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  // Carica un documento senza renderlo attivo: serve ad applicare modifiche su più file.
  ensureDocumentLoaded: async (relativePath) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return null
    const existing = findSessionDocument(get().documents, sessionId, relativePath)
    if (existing) return existing
    const opened = await openGoIDEDocument(sessionId, relativePath)
    const loaded = get().documents.find((item) => item.document.id === opened.document.id)
    if (loaded) return loaded
    const document = toEditorDocument(opened)
    set((state) => ({ documents: [...state.documents, document] }))
    return document
  },

  selectDocument: (documentId) => {
    const document = get().documents.find((item) => item.document.id === documentId)
    if (!document) return
    set((state) => ({ activeDocumentBySession: { ...state.activeDocumentBySession, [document.document.sessionId]: documentId } }))
  },

  updateDocument: (documentId, buffer) => set((state) => ({
    documents: state.documents.map((item) => item.document.id === documentId
      ? { ...item, buffer, dirty: buffer !== item.savedContent, saveError: null }
      : item),
  })),

  saveDocument: async (providedId, force = false) => {
    const sessionId = get().activeSessionId
    const documentId = providedId ?? (sessionId ? get().activeDocumentBySession[sessionId] : null)
    const current = get().documents.find((item) => item.document.id === documentId)
    if (!current || !current.dirty) return true
    set((state) => ({ documents: state.documents.map((item) => item.document.id === current.document.id ? { ...item, saving: true, saveError: null } : item) }))
    try {
      const saved = await saveGoIDEDocument(current.document.sessionId, current.document.id, current.buffer, current.diskToken, force)
      set((state) => ({ documents: state.documents.map((item) => item.document.id === current.document.id ? toEditorDocument(saved) : item) }))
      return true
    } catch (error) {
      const message = errorMessage(error)
      set((state) => ({
        error: message,
        documents: state.documents.map((item) => item.document.id === current.document.id ? { ...item, saving: false, saveError: message } : item),
      }))
      await get().checkActiveDocument()
      return false
    }
  },

  saveAllDocuments: async (sessionId) => {
    const dirtyIds = get().documents.filter((item) => item.document.sessionId === sessionId && item.dirty).map((item) => item.document.id)
    for (const documentId of dirtyIds) {
      if (!await get().saveDocument(documentId)) return false
    }
    return true
  },

  checkActiveDocument: async () => {
    const sessionId = get().activeSessionId
    const documentId = sessionId ? get().activeDocumentBySession[sessionId] : null
    const current = get().documents.find((item) => item.document.id === documentId)
    if (!current) return
    try {
      const externalState = await checkGoIDEDocument(current.document.sessionId, current.document.id, current.diskToken)
      if (externalState.changed) {
        set((state) => ({ documents: state.documents.map((item) => item.document.id === current.document.id ? { ...item, externalState } : item) }))
      }
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  resolveExternalChange: (documentId, action) => set((state) => ({
    documents: state.documents.map((item) => {
      if (item.document.id !== documentId || !item.externalState) return item
      if (action === 'reload') {
        const content = item.externalState.content ?? ''
        return { ...item, content, buffer: content, savedContent: content, dirty: false, diskToken: item.externalState.diskToken, externalState: null, saveError: null }
      }
      return { ...item, diskToken: item.externalState.diskToken, externalState: null }
    }),
  })),

  closeDocument: async (documentId) => {
    const current = get().documents.find((item) => item.document.id === documentId)
    if (!current) return
    await closeGoIDEDocument(current.document.sessionId, current.document.id)
    const sessionId = current.document.sessionId
    set((state) => {
      const documents = state.documents.filter((item) => item.document.id !== documentId)
      const sessionDocuments = documents.filter((item) => item.document.sessionId === sessionId)
      const wasActive = state.activeDocumentBySession[sessionId] === documentId
      const replacement = wasActive ? sessionDocuments[sessionDocuments.length - 1]?.document.id ?? null : state.activeDocumentBySession[sessionId] ?? null
      const closed: ClosedDocument = { path: current.document.external ? current.document.path : current.document.relativePath, external: !!current.document.external }
      const history = [closed, ...(state.closedDocuments[sessionId] ?? []).filter((item) => item.path !== closed.path)].slice(0, MAX_CLOSED_HISTORY)
      const { [documentId]: _pinned, ...pinnedDocuments } = state.pinnedDocuments
      const split = state.splitBySession[sessionId]
      return {
        documents,
        pinnedDocuments,
        activeDocumentBySession: { ...state.activeDocumentBySession, [sessionId]: replacement },
        closedDocuments: { ...state.closedDocuments, [sessionId]: history },
        splitBySession: split?.documentId === documentId ? { ...state.splitBySession, [sessionId]: null } : state.splitBySession,
      }
    })
  },

  togglePinned: (documentId) => set((state) => ({ pinnedDocuments: { ...state.pinnedDocuments, [documentId]: !state.pinnedDocuments[documentId] } })),

  reopenClosedDocument: async () => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    const [last, ...rest] = get().closedDocuments[sessionId] ?? []
    if (!last) return
    set((state) => ({ closedDocuments: { ...state.closedDocuments, [sessionId]: rest } }))
    if (last.external) await get().openExternalLocation(last.path, 1, 1)
    else await get().openDocument(last.path)
  },

  setSplit: (orientation) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    const documentId = get().activeDocumentBySession[sessionId]
    set((state) => ({ splitBySession: { ...state.splitBySession, [sessionId]: orientation && documentId ? { orientation, documentId } : null } }))
  },

  setSplitDocument: (documentId) => {
    const sessionId = get().activeSessionId
    const split = sessionId ? get().splitBySession[sessionId] : null
    if (!sessionId || !split) return
    set((state) => ({ splitBySession: { ...state.splitBySession, [sessionId]: { ...split, documentId } } }))
  },

  setQuickOpen: (open) => set((state) => ({ quickOpen: { ...state.quickOpen, open, query: open ? state.quickOpen.query : '', results: open ? state.quickOpen.results : [] } })),

  searchQuickOpen: async (query) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    const request = get().quickOpen.request + 1
    set((state) => ({ quickOpen: { ...state.quickOpen, query, loading: true, request } }))
    try {
      const results = await quickOpenGoIDEFiles(sessionId, query, 100)
      if (get().quickOpen.request === request) set((state) => ({ quickOpen: { ...state.quickOpen, loading: false, results } }))
    } catch (error) {
      if (get().quickOpen.request === request) set((state) => ({ error: errorMessage(error), quickOpen: { ...state.quickOpen, loading: false } }))
    }
  },

  detectToolchain: async () => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ loading: true, error: null })
    try {
      const info = await detectGoIDEToolchain(sessionId)
      set((state) => ({ toolchains: { ...state.toolchains, [sessionId]: info }, loading: false, error: info.available ? null : info.error ?? 'Go toolchain is unavailable.' }))
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  configureToolchain: async (goBinary, environment) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return false
    set({ loading: true, error: null })
    try {
      await configureGoIDEToolchain(sessionId, { goBinary, environment })
      const info = await detectGoIDEToolchain(sessionId)
      set((state) => ({ toolchains: { ...state.toolchains, [sessionId]: info }, loading: false }))
      return info.available
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
      return false
    }
  },

  startRun: async (kind, partial = {}) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ error: null })
    try {
      const execution = await startGoIDERun({
        sessionId,
        kind,
        target: partial.target ?? '.',
        workingDirectory: partial.workingDirectory ?? '',
        goArguments: partial.goArguments ?? [],
        programArguments: partial.programArguments ?? [],
        buildTags: partial.buildTags ?? [],
        environment: partial.environment ?? {},
      })
      set((state) => ({
        executions: replaceExecution(state.executions, execution),
        activeRunBySession: { ...state.activeRunBySession, [sessionId]: execution.id },
        layout: { ...state.layout, bottomOpen: true },
        consoleByRun: { ...state.consoleByRun, [execution.id]: appendConsole(state.consoleByRun[execution.id] ?? [], { sequence: 0, stream: 'system', text: `$ ${execution.command}\n${execution.workingDirectory}\n\n` }) },
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  stopRun: async (providedId) => {
    const sessionId = get().activeSessionId
    const runId = providedId ?? (sessionId ? get().activeRunBySession[sessionId] : null)
    if (!runId) return
    try { await stopGoIDERun(runId) } catch (error) { set({ error: errorMessage(error) }) }
  },

  restartRun: async (providedId) => {
    const sessionId = get().activeSessionId
    const runId = providedId ?? (sessionId ? get().activeRunBySession[sessionId] : null)
    if (!runId || !sessionId) return
    try {
      const execution = await restartGoIDERun(runId)
      set((state) => ({ executions: replaceExecution(state.executions, execution), activeRunBySession: { ...state.activeRunBySession, [sessionId]: execution.id } }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  sendRunInput: async (runId, text) => {
    try { await writeGoIDERunInput(runId, text) } catch (error) { set({ error: errorMessage(error) }) }
  },

  hasActiveRuns: async (sessionId) => hasActiveGoIDERuns(sessionId),

  handleEvent: (event) => {
    if (event.type === 'toolchain.install.progress') {
      const installation = event.payload as GoIDEToolchainInstallation | undefined
      if (!installation?.id || installation.sessionId !== event.sessionId) return
      set((state) => ({ toolchainInstallations: { ...state.toolchainInstallations, [installation.id]: installation } }))
      if (installation.status === 'installed' && installation.sessionId === get().activeSessionId) void get().detectToolchain()
      return
    }
    if (event.type === 'run.output') {
      const payload = event.payload as { runId?: string; stream?: string; text?: string } | undefined
      const runId = payload?.runId ?? event.resourceId
      if (!runId || !event.sessionId || !payload?.text) return
      const known = get().executions.some((execution) => execution.id === runId && execution.sessionId === event.sessionId)
      if (!known) return
      const stream = payload.stream === 'stderr' ? 'stderr' : 'stdout'
      set((state) => ({ consoleByRun: { ...state.consoleByRun, [runId]: appendConsole(state.consoleByRun[runId] ?? [], { sequence: event.sequence, stream, text: payload.text ?? '' }) } }))
      return
    }
    if ((event.type === 'run.started' || event.type === 'run.finished') && isExecution(event.payload)) {
      const execution = event.payload
      set((state) => ({
        executions: replaceExecution(state.executions, execution),
        activeRunBySession: { ...state.activeRunBySession, [execution.sessionId]: execution.id },
      }))
    }
  },

  clearRevealLocation: () => set({ revealLocation: null }),

  updateLayout: (patch) => set((state) => {
    const layout = { ...state.layout, ...patch }
    safeSetItem(LAYOUT_KEY, JSON.stringify(layout))
    return { layout }
  }),

  clearError: () => set({ error: null }),
}))

export function activeGoIDEDocument(state: GoIDEState): GoIDEEditorDocument | null {
  const sessionId = state.activeSessionId
  const documentId = sessionId ? state.activeDocumentBySession[sessionId] : null
  return state.documents.find((item) => item.document.id === documentId) ?? null
}

export function dirtyGoIDEDocuments(state: GoIDEState, sessionId: string): GoIDEEditorDocument[] {
  return state.documents.filter((item) => item.document.sessionId === sessionId && item.dirty)
}

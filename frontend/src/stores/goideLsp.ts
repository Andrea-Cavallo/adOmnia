import { create } from 'zustand'
import { safeSetItem } from '@/lib/safeLocalStorage'
import type { CancellablePromise } from '@wailsio/runtime'
import { subscribeGoIDEEvents, type GoIDEEvent, type GoIDEExecution } from '@/lib/goide-api'
import {
  detectGopls,
  detectLinter,
  installGopls,
  installLinter,
  requestLint,
  restartLanguageServer,
  startLanguageServer,
  stopLanguageServer,
  getLanguageServerStatus,
  type GoIDEDiagnosticsReport,
  type GoIDEEditorLocation,
  type GoIDEGoplsInfo,
  type GoIDELanguageServerProgress,
  type GoIDELanguageServerSettings,
  type GoIDELanguageServerStatus,
  type GoIDESearchResult,
  type GoIDEWorkspaceChange,
  type GoIDELinterInfo,
  type GoIDELinterKind,
  type GoIDELintResult,
  type GoIDESymbolNode,
} from '@/lib/goide-lsp-api'
import { useGoIDEStore } from './goide'

const SETTINGS_KEY = 'adomnia.goide.lsp.v1'

export type GoIDEToolWindow = 'run' | 'problems' | 'references' | 'find' | 'terminal'

export interface GoIDEEditorPreferences {
  formatOnSave: boolean
  organizeImportsOnSave: boolean
  lintOnSave: boolean
}

export interface GoIDELintState {
  running: boolean
  result: GoIDELintResult | null
  error: string | null
  reports: Record<string, GoIDEDiagnosticsReport>
}

export interface GoIDEReferencesView {
  title: string
  locations: GoIDEEditorLocation[]
}

interface GoIDELspState {
  settings: GoIDELanguageServerSettings
  preferences: GoIDEEditorPreferences
  status: Record<string, GoIDELanguageServerStatus>
  progress: Record<string, GoIDELanguageServerProgress | null>
  gopls: Record<string, GoIDEGoplsInfo | null>
  linter: Record<string, GoIDELinterInfo | null>
  lint: Record<string, GoIDELintState>
  symbols: Record<string, GoIDESymbolNode[]>
  diagnostics: Record<string, Record<string, GoIDEDiagnosticsReport>>
  userStopped: Record<string, boolean>
  toolWindow: GoIDEToolWindow
  references: Record<string, GoIDEReferencesView | null>
  search: Record<string, GoIDESearchResult | null>
  message: string | null
  pendingChange: GoIDEWorkspaceChange | null
  renameRequest: { sessionId: string; documentId: string; line: number; column: number } | null
  findRequest: { token: number; query: string } | null
  requestFind: (query: string) => void
  detectGopls: (sessionId: string) => Promise<GoIDEGoplsInfo | null>
  ensureStarted: (sessionId: string) => Promise<void>
  start: (sessionId: string) => Promise<void>
  stop: (sessionId: string) => Promise<void>
  restart: (sessionId: string) => Promise<void>
  install: (sessionId: string) => Promise<GoIDEExecution | null>
  detectLinter: (sessionId: string) => Promise<GoIDELinterInfo | null>
  installLinter: (sessionId: string, kind: GoIDELinterKind) => Promise<GoIDEExecution | null>
  runLint: (sessionId: string) => Promise<void>
  cancelLint: (sessionId: string) => void
  updateSettings: (sessionId: string | null, patch: Partial<GoIDELanguageServerSettings>) => Promise<void>
  updatePreferences: (patch: Partial<GoIDEEditorPreferences>) => void
  showToolWindow: (view: GoIDEToolWindow) => void
  showReferences: (sessionId: string, view: GoIDEReferencesView) => void
  setSearchResult: (sessionId: string, result: GoIDESearchResult | null) => void
  handleEvent: (event: GoIDEEvent) => void
  clearMessage: () => void
}

interface PersistedSettings {
  settings: GoIDELanguageServerSettings
  preferences: GoIDEEditorPreferences
}

const DEFAULT_SETTINGS: GoIDELanguageServerSettings = { gofumpt: false, staticcheck: false, placeholders: true, semanticLinks: false }
const DEFAULT_PREFERENCES: GoIDEEditorPreferences = { formatOnSave: true, organizeImportsOnSave: true, lintOnSave: false }
const EMPTY_LINT: GoIDELintState = { running: false, result: null, error: null, reports: {} }
const runningLints = new Map<string, CancellablePromise<GoIDELintResult>>()

function loadPersisted(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { settings: DEFAULT_SETTINGS, preferences: DEFAULT_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    return {
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings, semanticLinks: false },
      preferences: { ...DEFAULT_PREFERENCES, ...parsed.preferences },
    }
  } catch {
    return { settings: DEFAULT_SETTINGS, preferences: DEFAULT_PREFERENCES }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTrusted(sessionId: string): boolean {
  const session = useGoIDEStore.getState().sessions.find((item) => item.id === sessionId)
  return session?.project.authorization === 'tooling-permitted'
}

const persisted = loadPersisted()
let unsubscribe: (() => void) | null = null

export const useGoIDELspStore = create<GoIDELspState>((set, get) => ({
  settings: persisted.settings,
  preferences: persisted.preferences,
  status: {},
  progress: {},
  gopls: {},
  linter: {},
  lint: {},
  symbols: {},
  diagnostics: {},
  userStopped: {},
  toolWindow: 'run',
  references: {},
  search: {},
  message: null,
  pendingChange: null,
  renameRequest: null,
  findRequest: null,

  requestFind: (query) => {
    set((state) => ({ findRequest: { token: (state.findRequest?.token ?? 0) + 1, query } }))
    get().showToolWindow('find')
  },

  detectGopls: async (sessionId) => {
    try {
      const info = await detectGopls(sessionId)
      set((state) => ({ gopls: { ...state.gopls, [sessionId]: info } }))
      return info
    } catch (error) {
      set({ message: errorMessage(error) })
      return null
    }
  },

  // Avvio automatico solo per progetti già autorizzati, con gopls presente e mai fermato dall'utente.
  ensureStarted: async (sessionId) => {
    if (!unsubscribe) unsubscribe = subscribeGoIDEEvents((event) => get().handleEvent(event))
    if (!isTrusted(sessionId)) return
    if (get().linter[sessionId] === undefined) void get().detectLinter(sessionId)
    if (get().userStopped[sessionId]) return
    try {
      const status = await getLanguageServerStatus(sessionId)
      set((state) => ({ status: { ...state.status, [sessionId]: status } }))
      if (status.state === 'ready' || status.state === 'starting') return
    } catch {
      return
    }
    const info = get().gopls[sessionId] ?? await get().detectGopls(sessionId)
    if (info?.available) await get().start(sessionId)
  },

  start: async (sessionId) => {
    set((state) => ({ userStopped: { ...state.userStopped, [sessionId]: false }, message: null }))
    try {
      const status = await startLanguageServer(sessionId, get().settings)
      set((state) => ({ status: { ...state.status, [sessionId]: status } }))
    } catch (error) {
      set({ message: errorMessage(error) })
    }
  },

  stop: async (sessionId) => {
    set((state) => ({ userStopped: { ...state.userStopped, [sessionId]: true } }))
    try { await stopLanguageServer(sessionId) } catch (error) { set({ message: errorMessage(error) }) }
  },

  restart: async (sessionId) => {
    set((state) => ({ userStopped: { ...state.userStopped, [sessionId]: false }, message: null }))
    try {
      const status = await restartLanguageServer(sessionId, get().settings)
      set((state) => ({ status: { ...state.status, [sessionId]: status } }))
    } catch (error) {
      set({ message: errorMessage(error) })
    }
  },

  install: async (sessionId) => {
    try {
      return await installGopls(sessionId)
    } catch (error) {
      set({ message: errorMessage(error) })
      return null
    }
  },

  detectLinter: async (sessionId) => {
    try {
      const info = await detectLinter(sessionId)
      set((state) => ({ linter: { ...state.linter, [sessionId]: info } }))
      return info
    } catch (error) {
      set({ message: errorMessage(error) })
      return null
    }
  },

  installLinter: async (sessionId, kind) => {
    try {
      return await installLinter(sessionId, kind)
    } catch (error) {
      set({ message: errorMessage(error) })
      return null
    }
  },

  // Una sola esecuzione per sessione: una nuova richiesta annulla quella in corso.
  runLint: async (sessionId) => {
    get().cancelLint(sessionId)
    const request = requestLint(sessionId)
    runningLints.set(sessionId, request)
    const update = (patch: Partial<GoIDELintState>) => set((state) => ({ lint: { ...state.lint, [sessionId]: { ...(state.lint[sessionId] ?? EMPTY_LINT), ...patch } } }))
    update({ running: true, error: null })
    try {
      const result = await request
      if (runningLints.get(sessionId) !== request) return
      const reports = Object.fromEntries(result.reports.map((report) => [report.uri, report as unknown as GoIDEDiagnosticsReport]))
      update({ running: false, result, reports })
    } catch (error) {
      if (runningLints.get(sessionId) !== request) return
      update({ running: false, error: errorMessage(error) })
    } finally {
      if (runningLints.get(sessionId) === request) runningLints.delete(sessionId)
    }
  },

  cancelLint: (sessionId) => {
    const running = runningLints.get(sessionId)
    if (!running) return
    runningLints.delete(sessionId)
    void running.cancel()
    set((state) => ({ lint: { ...state.lint, [sessionId]: { ...(state.lint[sessionId] ?? EMPTY_LINT), running: false } } }))
  },

  updateSettings: async (sessionId, patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    safeSetItem(SETTINGS_KEY, JSON.stringify({ settings, preferences: get().preferences }))
    if (sessionId && get().status[sessionId]?.state === 'ready') await get().restart(sessionId)
  },

  updatePreferences: (patch) => {
    const preferences = { ...get().preferences, ...patch }
    set({ preferences })
    safeSetItem(SETTINGS_KEY, JSON.stringify({ settings: get().settings, preferences }))
  },

  showToolWindow: (toolWindow) => {
    set({ toolWindow })
    if (!useGoIDEStore.getState().layout.bottomOpen) useGoIDEStore.getState().updateLayout({ bottomOpen: true })
  },

  showReferences: (sessionId, view) => {
    set((state) => ({ references: { ...state.references, [sessionId]: view } }))
    get().showToolWindow('references')
  },

  setSearchResult: (sessionId, result) => set((state) => ({ search: { ...state.search, [sessionId]: result } })),

  handleEvent: (event) => {
    const sessionId = event.sessionId
    if (!sessionId) return
    if (event.type === 'lsp.status') {
      const status = event.payload as GoIDELanguageServerStatus
      set((state) => {
        const cleared = status.state === 'stopped' || status.state === 'crashed'
        return {
          status: { ...state.status, [sessionId]: status },
          progress: cleared ? { ...state.progress, [sessionId]: null } : state.progress,
          diagnostics: cleared ? { ...state.diagnostics, [sessionId]: {} } : state.diagnostics,
        }
      })
      return
    }
    if (event.type === 'lsp.diagnostics') {
      const report = event.payload as GoIDEDiagnosticsReport
      set((state) => {
        const current = { ...(state.diagnostics[sessionId] ?? {}) }
        if (report.diagnostics.length === 0) delete current[report.uri]
        else current[report.uri] = report
        return { diagnostics: { ...state.diagnostics, [sessionId]: current } }
      })
      return
    }
    if (event.type === 'lsp.progress') {
      const progress = event.payload as GoIDELanguageServerProgress
      set((state) => ({ progress: { ...state.progress, [sessionId]: progress.kind === 'end' ? null : { ...state.progress[sessionId], ...progress } } }))
      return
    }
    if (event.type === 'lsp.message') {
      set({ message: (event.payload as { message?: string })?.message ?? null })
      return
    }
    if (event.type === 'run.finished') {
      const execution = event.payload as GoIDEExecution
      if (execution?.kind !== 'install') return
      void get().detectLinter(sessionId)
      void get().detectGopls(sessionId).then((info) => {
        if (info?.available && execution.status === 'exited') void get().start(sessionId)
      })
    }
  },

  clearMessage: () => set({ message: null }),
}))

/** Unisce diagnostica gopls e risultati del linter per file, mantenendo la sorgente di ogni voce. */
export function mergedReports(gopls: Record<string, GoIDEDiagnosticsReport> | undefined, lint: Record<string, GoIDEDiagnosticsReport> | undefined): Record<string, GoIDEDiagnosticsReport> {
  const merged: Record<string, GoIDEDiagnosticsReport> = { ...(gopls ?? {}) }
  for (const [uri, report] of Object.entries(lint ?? {})) {
    const existing = merged[uri]
    merged[uri] = existing ? { ...existing, diagnostics: [...existing.diagnostics, ...report.diagnostics] } : report
  }
  return merged
}

/** Conta errori e warning della sessione per status bar e Problems. */
export function diagnosticCounts(reports: Record<string, GoIDEDiagnosticsReport> | undefined): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const report of Object.values(reports ?? {})) {
    for (const diagnostic of report.diagnostics) {
      if (diagnostic.severity === 1) errors += 1
      else if (diagnostic.severity === 2) warnings += 1
    }
  }
  return { errors, warnings }
}

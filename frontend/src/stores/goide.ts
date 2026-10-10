import { isGoModPath, syncLocalReplaces } from '@/lib/goModLocalReplaces'
import { fuzzTargetOfCommand, parseFuzzSession, recordFuzzSession } from '@/lib/goide/goStudioFuzzSessions'
import { recordRunHistory } from '@/lib/goide/goStudioRunHistory'
import { caretsFor, restoreCarets } from '@/lib/goide/goStudioCaretMemory'
import { create } from 'zustand'
import { startSharedEnvironmentSync } from '@/lib/goide/sharedEnvironment'
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
  getGoIDESessionView,
  saveGoIDESessionView,
  listGoIDERecoveredBuffers,
  pruneMissingGoIDESessions,
  findGoIDESessionsForPath,
  listGoIDERunConfigurations,
  saveGoIDERunConfiguration,
  duplicateGoIDERunConfiguration,
  renameGoIDERunConfiguration,
  reorderGoIDERunConfigurations,
  deleteGoIDERunConfiguration,
  startGoIDEConfiguredRun,
  startGoIDEConfiguredBuild,
  type GoIDECapabilities,
  type GoIDEDocumentDiskState,
  type GoIDEEvent,
  type GoIDEExecution,
  type GoIDEFileEntry,
  type GoIDEOpenDocument,
  type GoIDEQuickOpenResult,
  type GoIDESessionView,
  type GoIDERecentProject,
  type GoIDERunRequest,
  type GoIDESession,
  type GoIDEToolchainInfo,
  type GoIDERecoveredBuffer,
  type GoIDERunConfiguration,
  type GoIDEToolchainInstallation,
} from '@/lib/goide-api'
import { openExternalDocument } from '@/lib/goide-lsp-api'
import { DEFAULT_STUDIO_WORKSPACE_ID, listGoIDEStudioWorkspaces, type GoIDEStudioWorkspace } from '@/lib/goide-workspaces-api'
import { goStudioWindowContext } from '@/lib/goide-window-api'
import { confirm } from '@/lib/confirmDialog'
import { cancelBufferRecovery, scheduleBufferRecovery } from '@/lib/goide/goStudioRecovery'
import { directoriesToRefresh, documentsToCheck, wasDeleted, type GoIDEFilesChanged } from '@/lib/goide/goStudioDiskChanges'

const LAYOUT_KEY = 'adomnia.goide.layout.v1'
const MAX_CLOSED_HISTORY = 20

/** Comandi go lanciabili direttamente da menu, CodeLens e gutter. */
export type GoIDEQuickRunKind = 'build' | 'run' | 'test' | 'tidy' | 'vet' | 'generate' | 'install' | 'make' | 'docker-build' | 'docker-run' | 'docker-compose'

export type GoIDESplitOrientation = 'right' | 'down'

export interface GoIDESplit {
  orientation: GoIDESplitOrientation
  /** File visibile nello split. */
  documentId: string
  /** Gruppo di tab proprio dello split, indipendente da quello principale. */
  tabs: string[]
}

/** Toglie un documento dal gruppo dello split: se era l'ultimo lo split si chiude. */
/** Split dell'editor nella forma salvata: percorsi al posto degli ID di documento, che cambiano a ogni avvio. */
function splitViewFor(split: GoIDESplit | null | undefined, documents: GoIDEEditorDocument[]) {
  const pathOf = (id: string) => documents.find((item) => item.document.id === id && !item.document.external)?.document.relativePath
  const activePath = split ? pathOf(split.documentId) : undefined
  if (!split || !activePath) return undefined
  return { orientation: split.orientation, activePath, paths: split.tabs.flatMap((id) => pathOf(id) ?? []) }
}

function splitFromView(view: { orientation: string; activePath: string; paths?: string[] } | null | undefined, documents: GoIDEEditorDocument[]): GoIDESplit | null {
  if (!view || (view.orientation !== 'right' && view.orientation !== 'down')) return null
  const idOf = (path: string) => documents.find((item) => item.document.relativePath === path)?.document.id
  const documentId = idOf(view.activePath)
  if (!documentId) return null
  const tabs = (view.paths ?? []).flatMap((path) => idOf(path) ?? [])
  return { orientation: view.orientation, documentId, tabs: tabs.includes(documentId) ? tabs : [documentId, ...tabs] }
}

export function removeFromSplit(split: GoIDESplit | null | undefined, documentId: string): GoIDESplit | null {
  if (!split) return null
  const tabs = split.tabs.filter((id) => id !== documentId)
  if (tabs.length === 0) return null
  if (split.documentId !== documentId) return { ...split, tabs }
  const index = split.tabs.indexOf(documentId)
  return { ...split, tabs, documentId: tabs[Math.min(index, tabs.length - 1)] }
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
  projectOpen: boolean
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
  projectOpen: true,
  structureOpen: true,
  bottomOpen: true,
}

function loadLayout(): GoIDELayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<GoIDELayout>
    return {
      projectWidth: Math.max(180, parsed.projectWidth ?? DEFAULT_LAYOUT.projectWidth),
      structureWidth: Math.max(180, parsed.structureWidth ?? DEFAULT_LAYOUT.structureWidth),
      bottomHeight: Math.max(112, parsed.bottomHeight ?? DEFAULT_LAYOUT.bottomHeight),
      projectOpen: parsed.projectOpen ?? true,
      structureOpen: parsed.structureOpen ?? true,
      bottomOpen: parsed.bottomOpen ?? true,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

/** Sessioni del workspace Go Studio indicato; quelle senza workspace appartengono al predefinito. */
export function sessionsInWorkspace(sessions: readonly GoIDESession[], workspaceId: string): GoIDESession[] {
  return sessions.filter((session) => (session.workspaceId || DEFAULT_STUDIO_WORKSPACE_ID) === workspaceId)
}

export interface GoIDEState {
  /** Tutte le sessioni aperte, di ogni workspace Go Studio: l'interfaccia mostra solo quelle del workspace attivo. */
  sessions: GoIDESession[]
  recentProjects: GoIDERecentProject[]
  activeSessionId: string | null
  /** Workspace Go Studio, indipendenti dai workspace API di adOmnia. */
  studioWorkspaces: GoIDEStudioWorkspace[]
  activeWorkspaceId: string
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
  recoveredBySession: Record<string, GoIDERecoveredBuffer[]>
  runConfigsBySession: Record<string, GoIDERunConfiguration[]>
  /** Esecuzione → configurazione che l'ha avviata: serve alla cronologia e al riavvio al salvataggio. */
  configByRun: Record<string, string>
  activeConfigBySession: Record<string, string | null>
  restoredSessions: Record<string, boolean>
  pathConflicts: Record<string, string[]>
  initialize: () => Promise<void>
  openProject: (path?: string) => Promise<void>
  createProject: (parentPath: string, name: string, modulePath: string, template?: string) => Promise<boolean>
  removeRecentProject: (path: string) => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  setToolAuthorization: (allowed: boolean) => Promise<void>
  closeActiveSession: (discardDocuments?: boolean) => Promise<boolean>
  loadDirectory: (relativePath?: string) => Promise<void>
  toggleShowIgnored: () => Promise<void>
  /** preview: tab di anteprima, sostituita dalla prossima anteprima finché non la si modifica o la si rende permanente. */
  openDocument: (relativePath: string, options?: { preview?: boolean }) => Promise<string | null>
  /** Tab di anteprima (una per sessione), mostrata in corsivo. */
  previewDocumentBySession: Record<string, string | null>
  openLocation: (relativePath: string, line: number, column?: number) => Promise<void>
  openExternalLocation: (path: string, line: number, column?: number) => Promise<void>
  ensureDocumentLoaded: (relativePath: string) => Promise<GoIDEEditorDocument | null>
  selectDocument: (documentId: string) => void
  updateDocument: (documentId: string, buffer: string) => void
  saveDocument: (documentId?: string, force?: boolean) => Promise<boolean>
  saveAllDocuments: (sessionId: string) => Promise<boolean>
  checkActiveDocument: () => Promise<void>
  /** Rilegge deliberatamente un file dal disco; conferma prima di scartare un buffer non salvato. */
  reloadDocumentFromDisk: (relativePath: string) => Promise<void>
  /** Aggiorna l'albero già aperto e i buffer del ramo scelto senza perdere modifiche non salvate. */
  refreshProject: (relativePath?: string) => Promise<void>
  resolveExternalChange: (documentId: string, action: 'reload' | 'keep') => void
  closeDocument: (documentId: string) => Promise<void>
  togglePinned: (documentId: string) => void
  reopenClosedDocument: () => Promise<void>
  setSplit: (orientation: GoIDESplitOrientation | null) => void
  setSplitDocument: (documentId: string) => void
  closeSplitTab: (documentId: string) => void
  setQuickOpen: (open: boolean) => void
  searchQuickOpen: (query: string) => Promise<void>
  detectToolchain: () => Promise<void>
  configureToolchain: (goBinary: string, environment: Record<string, string>) => Promise<boolean>
  startRun: (kind: GoIDEQuickRunKind, partial?: Partial<GoIDERunRequest>) => Promise<void>
  /** Ricarica go.mod/go.sum aperti dopo un comando che li modifica; i buffer sporchi ricevono solo l'avviso. */
  refreshModuleFiles: (sessionId: string) => Promise<void>
  /** Modifiche su disco segnalate dal watcher: ricarica i buffer puliti, avvisa sui modificati, aggiorna l'albero. */
  handleFilesChanged: (sessionId: string, batch: GoIDEFilesChanged) => Promise<void>
  stopRun: (runId?: string) => Promise<void>
  restartRun: (runId?: string) => Promise<void>
  sendRunInput: (runId: string, text: string) => Promise<void>
  hasActiveRuns: (sessionId: string) => Promise<boolean>
  loadRunConfigurations: (sessionId: string) => Promise<void>
  saveRunConfiguration: (config: GoIDERunConfiguration) => Promise<GoIDERunConfiguration | null>
  duplicateRunConfiguration: (configId: string) => Promise<void>
  renameRunConfiguration: (configId: string, name: string) => Promise<void>
  reorderRunConfigurations: (configIds: string[]) => Promise<void>
  deleteRunConfiguration: (configId: string) => Promise<void>
  selectRunConfiguration: (configId: string | null) => void
  startConfiguredRun: (configId: string, secrets: Record<string, string>) => Promise<void>
  startConfiguredBuild: (configId: string) => Promise<void>
  restoreSessionView: (sessionId: string) => Promise<void>
  checkPathConflicts: (sessionId: string, relativePath: string) => Promise<void>
  persistSessionView: (sessionId: string) => Promise<void>
  recoverBuffer: (sessionId: string, relativePath: string, options?: { confirmConflict?: boolean }) => Promise<void>
  discardRecoveredBuffer: (sessionId: string, relativePath: string) => Promise<void>
  handleEvent: (event: GoIDEEvent) => void
  clearRevealLocation: () => void
  updateLayout: (patch: Partial<GoIDELayout>) => void
  /** Hide All Tool Windows: chiude Project, Structure e il pannello in basso; di nuovo li ripristina com'erano. */
  toggleEditorMaximized: () => void
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

/** Un'esecuzione di una configurazione salvata entra nella cronologia locale del progetto. */
function recordConfiguredRun(state: Pick<GoIDEState, 'configByRun' | 'sessions' | 'runConfigsBySession'>, execution: GoIDEExecution): void {
  const configId = state.configByRun[execution.id]
  if (!configId) return
  const session = state.sessions.find((item) => item.id === execution.sessionId)
  const config = state.runConfigsBySession[execution.sessionId]?.find((item) => item.id === configId)
  if (!session) return
  recordRunHistory(session.project.realPath, {
    configId, configName: config?.name ?? configId, status: execution.status, exitCode: execution.exitCode ?? null,
    startedAt: execution.startedAt, durationMillis: execution.durationMillis, command: execution.command,
  })
}

/** Archivia statistiche e crash di una sessione `go test -fuzz` terminata, per il Fuzzing Studio. */
function recordFuzzRun(state: Pick<GoIDEState, 'sessions' | 'consoleByRun'>, execution: GoIDEExecution): void {
  if (execution.kind !== 'test' || !fuzzTargetOfCommand(execution.command)) return
  const session = state.sessions.find((item) => item.id === execution.sessionId)
  if (!session) return
  const output = (state.consoleByRun[execution.id] ?? []).map((chunk) => chunk.text).join('')
  const parsed = parseFuzzSession({ id: execution.id, command: execution.command, status: execution.status, startedAt: execution.startedAt, durationMillis: execution.durationMillis }, output)
  if (parsed) recordFuzzSession(session.project.realPath, parsed)
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

/**
 * Indica se questa finestra possiede la sessione. Con più finestre solo la proprietaria salva la
 * vista: una finestra che ha ceduto il progetto non deve cancellare i tab che l'altra ripristina.
 * Registrata dallo store delle finestre, così questo store non ne dipende.
 */
let ownsSession: (sessionId: string) => boolean = () => true

export function registerSessionOwnershipGuard(guard: (sessionId: string) => boolean): void {
  ownsSession = guard
}

/**
 * Estensioni della vista salvata: altri store (es. navigazione e bookmark) aggiungono i propri campi
 * senza che questo store li importi, così non nascono dipendenze circolari.
 */
export interface GoIDESessionViewExtension {
  save: (sessionId: string) => Partial<GoIDESessionView>
  restore: (sessionId: string, view: GoIDESessionView) => void
}

const sessionViewExtensions: GoIDESessionViewExtension[] = []

export function registerSessionViewExtension(extension: GoIDESessionViewExtension): void {
  sessionViewExtensions.push(extension)
}

export const useGoIDEStore = create<GoIDEState>((set, get) => ({
  sessions: [],
  recentProjects: [],
  activeSessionId: null,
  studioWorkspaces: [],
  activeWorkspaceId: DEFAULT_STUDIO_WORKSPACE_ID,
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
  previewDocumentBySession: {},
  closedDocuments: {},
  splitBySession: {},
  toolchains: {},
  toolchainInstallations: {},
  executions: [],
  activeRunBySession: {},
  consoleByRun: {},
  quickOpen: { open: false, query: '', loading: false, results: [], request: 0 },
  revealLocation: null,
  recoveredBySession: {},
  runConfigsBySession: {},
  configByRun: {},
  activeConfigBySession: {},
  restoredSessions: {},
  pathConflicts: {},

  initialize: async () => {
    if (get().initialized || get().loading) return
    set({ loading: true, error: null })
    startSharedEnvironmentSync()
    try {
      // Le cartelle sparite vanno rimosse prima di mostrare le sessioni, senza
      // perdere le altre e senza toccare i progetti recenti.
      const [capabilities, sessions, recentProjects, workspaces] = await Promise.all([
        getGoIDECapabilities(), pruneMissingGoIDESessions(), listRecentGoIDEProjects(), listGoIDEStudioWorkspaces(),
      ])
      if (!eventUnsubscribe) eventUnsubscribe = subscribeGoIDEEvents((event) => get().handleEvent(event))
      const visible = sessionsInWorkspace(sessions, workspaces.activeId)
      // Una finestra separata apre sempre il proprio progetto, anche se appartiene a un altro workspace.
      const pinned = goStudioWindowContext().pinnedSessionId
      const activeSessionId = pinned
        ? sessions.some((session) => session.id === pinned) ? pinned : null
        : visible.some((session) => session.id === get().activeSessionId)
          ? get().activeSessionId
          : visible[0]?.id ?? null
      set({ capabilities, sessions, recentProjects, activeSessionId, studioWorkspaces: workspaces.workspaces, activeWorkspaceId: workspaces.activeId, initialized: true, loading: false })
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

  createProject: async (parentPath, name, modulePath, template) => {
    set({ loading: true, error: null })
    try {
      const { session, warning } = await createGoIDEProject({ parentPath, name, modulePath, template, confirmed: true })
      const recentProjects = await listRecentGoIDEProjects()
      set((state) => ({ sessions: replaceSession(state.sessions, session), recentProjects, activeSessionId: session.id, loading: false }))
      await get().selectSession(session.id)
      if (warning) set({ error: warning })
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
      await get().restoreSessionView(activeSessionId)
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  restoreSessionView: async (sessionId) => {
    if (get().restoredSessions[sessionId]) return
    set((state) => ({ restoredSessions: { ...state.restoredSessions, [sessionId]: true } }))
    try {
      const [view, recovered] = await Promise.all([
        getGoIDESessionView(sessionId), listGoIDERecoveredBuffers(sessionId),
      ])
      await get().loadRunConfigurations(sessionId)
      if (view.activeConfigId) {
        set((state) => ({ activeConfigBySession: { ...state.activeConfigBySession, [sessionId]: view.activeConfigId ?? null } }))
      }
      set((state) => ({ recoveredBySession: { ...state.recoveredBySession, [sessionId]: recovered } }))
      restoreCarets(sessionId, view.cursors)
      for (const path of view.openPaths ?? []) {
        // Riaprire un tab legge il file senza eseguire nulla; un file sparito si salta in silenzio.
        await get().ensureDocumentLoaded(path).catch(() => null)
      }
      const split = splitFromView(view.split, get().documents.filter((item) => item.document.sessionId === sessionId))
      if (split) set((state) => ({ splitBySession: { ...state.splitBySession, [sessionId]: split } }))
      if (view.activePath) {
        const restored = get().documents.find(
          (item) => item.document.sessionId === sessionId && item.document.relativePath === view.activePath,
        )
        if (restored) get().selectDocument(restored.document.id)
      }
      for (const extension of sessionViewExtensions) extension.restore(sessionId, view)
      if (view.showIgnoredEntries) {
        set((state) => ({ showIgnoredBySession: { ...state.showIgnoredBySession, [sessionId]: true } }))
      }
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  loadRunConfigurations: async (sessionId) => {
    try {
      const configs = await listGoIDERunConfigurations(sessionId)
      set((state) => ({
        runConfigsBySession: { ...state.runConfigsBySession, [sessionId]: configs },
        activeConfigBySession: {
          ...state.activeConfigBySession,
          [sessionId]: configs.some((config) => config.id === state.activeConfigBySession[sessionId])
            ? state.activeConfigBySession[sessionId]
            : configs[0]?.id ?? null,
        },
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  saveRunConfiguration: async (config) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return null
    try {
      const saved = await saveGoIDERunConfiguration(sessionId, config)
      await get().loadRunConfigurations(sessionId)
      set((state) => ({ activeConfigBySession: { ...state.activeConfigBySession, [sessionId]: saved.id } }))
      return saved
    } catch (error) {
      set({ error: errorMessage(error) })
      return null
    }
  },

  duplicateRunConfiguration: async (configId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      const copied = await duplicateGoIDERunConfiguration(sessionId, configId)
      await get().loadRunConfigurations(sessionId)
      set((state) => ({ activeConfigBySession: { ...state.activeConfigBySession, [sessionId]: copied.id } }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  renameRunConfiguration: async (configId, name) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      await renameGoIDERunConfiguration(sessionId, configId, name)
      await get().loadRunConfigurations(sessionId)
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  reorderRunConfigurations: async (configIds) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      const ordered = await reorderGoIDERunConfigurations(sessionId, configIds)
      set((state) => ({ runConfigsBySession: { ...state.runConfigsBySession, [sessionId]: ordered } }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  deleteRunConfiguration: async (configId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      await deleteGoIDERunConfiguration(sessionId, configId)
      await get().loadRunConfigurations(sessionId)
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  selectRunConfiguration: (configId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set((state) => ({ activeConfigBySession: { ...state.activeConfigBySession, [sessionId]: configId } }))
  },

  startConfiguredBuild: async (configId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ error: null })
    try {
      const execution = await startGoIDEConfiguredBuild(sessionId, configId)
      set((state) => ({
        executions: replaceExecution(state.executions, execution),
        activeRunBySession: { ...state.activeRunBySession, [sessionId]: execution.id },
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  startConfiguredRun: async (configId, secrets) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ error: null })
    try {
      const execution = await startGoIDEConfiguredRun(sessionId, configId, secrets)
      set((state) => ({
        executions: replaceExecution(state.executions, execution),
        activeRunBySession: { ...state.activeRunBySession, [sessionId]: execution.id },
        configByRun: { ...state.configByRun, [execution.id]: configId },
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  checkPathConflicts: async (sessionId, relativePath) => {
    try {
      const others = await findGoIDESessionsForPath(sessionId, relativePath)
      const open = others.filter((other) => get().documents.some(
        (item) => item.document.sessionId === other.id && item.document.relativePath === relativePath,
      ))
      set((state) => {
        const next = { ...state.pathConflicts }
        if (open.length === 0) delete next[relativePath]
        else next[relativePath] = open.map((other) => other.project.name)
        return { pathConflicts: next }
      })
    } catch {
      // Il rilevamento conflitti è informativo: non deve bloccare l'apertura.
    }
  },

  persistSessionView: async (sessionId) => {
    if (!ownsSession(sessionId)) return
    const state = get()
    const documents = state.documents.filter((item) => item.document.sessionId === sessionId)
    const activeId = state.activeDocumentBySession[sessionId] ?? null
    const active = documents.find((item) => item.document.id === activeId)
    try {
      await saveGoIDESessionView(sessionId, {
        // I sorgenti SDK in sola lettura non fanno parte del progetto: non si ripristinano.
        openPaths: documents.filter((item) => !item.document.external).map((item) => item.document.relativePath),
        activePath: active && !active.document.external ? active.document.relativePath : '',
        activeConfigId: state.activeConfigBySession[sessionId] ?? '',
        structureOpen: state.layout.structureOpen,
        bottomOpen: state.layout.bottomOpen,
        terminalPanelOpen: false,
        showIgnoredEntries: !!state.showIgnoredBySession[sessionId],
        cursors: caretsFor(sessionId, documents.filter((item) => !item.document.external).map((item) => item.document.relativePath)),
        split: splitViewFor(state.splitBySession[sessionId], documents),
        ...Object.assign({}, ...sessionViewExtensions.map((extension) => extension.save(sessionId))),
      })
    } catch {
      // Il layout è una comodità: non deve mai far fallire un'azione dell'utente.
    }
  },

  recoverBuffer: async (sessionId, relativePath, options = {}) => {
    const recovered = (get().recoveredBySession[sessionId] ?? []).find((item) => item.relativePath === relativePath)
    if (!recovered) return
    // Il dialog di ripristino dopo crash ha già mostrato il conflitto: lì "Use Recovered" è la conferma.
    if (recovered.diskChanged && options.confirmConflict !== false) {
      const approved = await confirm({
        title: 'File changed on disk',
        message: `${relativePath} changed on disk after this buffer was saved.\n\nRestoring puts the recovered text in the editor as unsaved changes. The file on disk is not touched until you save.`,
        confirmLabel: 'Restore anyway',
      })
      if (!approved) return
    }
    const documentId = await get().openDocument(relativePath)
    if (documentId) get().updateDocument(documentId, recovered.content)
    await get().discardRecoveredBuffer(sessionId, relativePath)
  },

  discardRecoveredBuffer: async (sessionId, relativePath) => {
    cancelBufferRecovery(sessionId, relativePath)
    set((state) => ({
      recoveredBySession: {
        ...state.recoveredBySession,
        [sessionId]: (state.recoveredBySession[sessionId] ?? []).filter((item) => item.relativePath !== relativePath),
      },
    }))
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
          activeSessionId: sessionsInWorkspace(sessions, state.activeWorkspaceId)[0]?.id ?? null,
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

  openDocument: async (path, options = {}) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return null
    const previousPreview = get().previewDocumentBySession[sessionId] ?? null
    const setPreview = (documentId: string | null) => set((state) => ({ previewDocumentBySession: { ...state.previewDocumentBySession, [sessionId]: documentId } }))
    const activate = (documentId: string, created: boolean) => {
      set((state) => ({ activeDocumentBySession: { ...state.activeDocumentBySession, [sessionId]: documentId } }))
      if (!options.preview) {
        // Aperto in modo permanente (doppio clic, navigazione, ricerca): l'anteprima diventa una tab normale.
        if (previousPreview === documentId) setPreview(null)
        return
      }
      if (!created) return
      setPreview(documentId)
      const old = previousPreview ? get().documents.find((item) => item.document.id === previousPreview) : undefined
      if (old && !old.dirty && !get().pinnedDocuments[old.document.id]) void get().closeDocument(old.document.id)
    }
    const existing = findSessionDocument(get().documents, sessionId, path)
    if (existing) {
      activate(existing.document.id, false)
      return existing.document.id
    }
    set({ loading: true, error: null })
    try {
      const opened = await openGoIDEDocument(sessionId, path)
      // Percorsi diversi (relativo, "./", assoluto) possono indicare lo stesso file: l'id stabile lo deduplica.
      if (get().documents.some((item) => item.document.id === opened.document.id)) {
        set({ loading: false })
        activate(opened.document.id, false)
        return opened.document.id
      }
      set((state) => ({ documents: [...state.documents, toEditorDocument(opened)], loading: false }))
      activate(opened.document.id, true)
      void get().checkPathConflicts(sessionId, opened.document.relativePath)
      void get().persistSessionView(sessionId)
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

  updateDocument: (documentId, buffer) => {
    const current = get().documents.find((item) => item.document.id === documentId)
    if (current) {
      const dirty = buffer !== current.savedContent
      if (dirty) scheduleBufferRecovery(current.document.sessionId, current.document.relativePath, buffer, current.diskToken)
      else cancelBufferRecovery(current.document.sessionId, current.document.relativePath)
    }
    set((state) => {
      const sessionId = current?.document.sessionId
      // Modificare l'anteprima la rende una tab permanente.
      const promote = sessionId && state.previewDocumentBySession[sessionId] === documentId && current && buffer !== current.savedContent
      return {
        documents: state.documents.map((item) => item.document.id === documentId
          ? { ...item, buffer, dirty: buffer !== item.savedContent, saveError: null }
          : item),
        ...(promote ? { previewDocumentBySession: { ...state.previewDocumentBySession, [sessionId]: null } } : {}),
      }
    })
  },

  saveDocument: async (providedId, force = false) => {
    const sessionId = get().activeSessionId
    const documentId = providedId ?? (sessionId ? get().activeDocumentBySession[sessionId] : null)
    const current = get().documents.find((item) => item.document.id === documentId)
    if (!current || !current.dirty) return true
    set((state) => ({ documents: state.documents.map((item) => item.document.id === current.document.id ? { ...item, saving: true, saveError: null } : item) }))
    try {
      // go.mod: un replace locale spegne quello "vero" dello stesso modulo, toglierlo lo riattiva.
      const buffer = isGoModPath(current.document.relativePath) ? syncLocalReplaces(current.buffer) : current.buffer
      const saved = await saveGoIDEDocument(current.document.sessionId, current.document.id, buffer, current.diskToken, force)
      cancelBufferRecovery(current.document.sessionId, current.document.relativePath)
      set((state) => ({ documents: state.documents.map((item) => item.document.id === current.document.id ? toEditorDocument(saved) : item) }))
      void get().persistSessionView(current.document.sessionId)
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

  reloadDocumentFromDisk: async (relativePath) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    const current = findSessionDocument(get().documents, sessionId, relativePath)
    // Il file non è ancora in un tab: OpenDocument è già una lettura dal disco.
    if (!current) {
      await get().openDocument(relativePath)
      return
    }
    if (current.dirty) {
      const approved = await confirm({
        title: 'Reload from disk?',
        message: `${current.document.relativePath} has unsaved editor changes. Reloading replaces them with the version currently on disk.`,
        details: [{ label: 'File', value: current.document.relativePath, mono: true }],
        confirmLabel: 'Reload and discard my changes',
        variant: 'danger',
      })
      if (!approved) return
    }
    try {
      // Un token volutamente nuovo impone una lettura completa: CheckDocument restituisce anche il contenuto.
      const externalState = await checkGoIDEDocument(sessionId, current.document.id, `force-reload:${Date.now()}`)
      if (!externalState.changed || externalState.content === undefined) {
        set({ error: `Could not reload ${current.document.relativePath} from disk.` })
        return
      }
      set((state) => ({ documents: state.documents.map((item) => item.document.id === current.document.id ? { ...item, externalState } : item) }))
      get().resolveExternalChange(current.document.id, 'reload')
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  refreshProject: async (relativePath = '') => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    const prefix = relativePath ? `${relativePath}/` : ''
    const documents = get().documents.filter((item) =>
      item.document.sessionId === sessionId && !item.document.external &&
      (!relativePath || item.document.relativePath === relativePath || item.document.relativePath.startsWith(prefix)),
    )
    // I tab puliti adottano il disco; quelli modificati ricevono Reload / Keep / Compare.
    await refreshFromDisk(sessionId, documents.map((item) => item.document.id))
    const cachedDirectories = Object.keys(get().directoryEntries[sessionId] ?? {})
    const directories = new Set([relativePath, ...cachedDirectories.filter((directory) =>
      !relativePath || directory === relativePath || directory.startsWith(prefix),
    )])
    await Promise.all([...directories].map((directory) => get().loadDirectory(directory)))
  },

  refreshModuleFiles: async (sessionId) => {
    const moduleFiles = get().documents.filter((item) => item.document.sessionId === sessionId && !item.document.external && isModuleFile(item.document.relativePath))
    await refreshFromDisk(sessionId, moduleFiles.map((item) => item.document.id))
  },

  handleFilesChanged: async (sessionId, batch) => {
    const open = get().documents.filter((item) => item.document.sessionId === sessionId && !item.document.external && !item.document.readOnly)
    const affected = documentsToCheck(open.map((item) => ({ id: item.document.id, relativePath: item.document.relativePath, dirty: item.dirty })), batch)
    const deleted = affected.filter((item) => wasDeleted(item.relativePath, batch))
    for (const item of deleted) {
      if (item.dirty) set({ error: `${item.relativePath} was deleted on disk. Your unsaved changes are still in the editor.` })
      else await get().closeDocument(item.id).catch((error: unknown) => set({ error: errorMessage(error) }))
    }
    await refreshFromDisk(sessionId, affected.filter((item) => !deleted.includes(item)).map((item) => item.id))
    const loaded = Object.keys(get().directoryEntries[sessionId] ?? {})
    for (const directory of directoriesToRefresh(loaded, batch)) {
      try {
        const entries = await listGoIDEDirectory(sessionId, directory, get().showIgnoredBySession[sessionId] ?? false)
        set((state) => ({ directoryEntries: { ...state.directoryEntries, [sessionId]: { ...(state.directoryEntries[sessionId] ?? {}), [directory]: entries } } }))
      } catch {
        // Una cartella eliminata sparisce con il ricaricamento del genitore.
      }
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
    cancelBufferRecovery(current.document.sessionId, current.document.relativePath)
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
        splitBySession: { ...state.splitBySession, [sessionId]: removeFromSplit(split, documentId) },
      }
    })
    void get().persistSessionView(current.document.sessionId)
  },

  togglePinned: (documentId) => set((state) => {
    // Una tab pinnata non è mai un'anteprima.
    const previews = Object.fromEntries(Object.entries(state.previewDocumentBySession).map(([session, id]) => [session, id === documentId ? null : id]))
    return { pinnedDocuments: { ...state.pinnedDocuments, [documentId]: !state.pinnedDocuments[documentId] }, previewDocumentBySession: previews }
  }),

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
    set((state) => {
      const current = state.splitBySession[sessionId]
      if (!orientation || !documentId) return { splitBySession: { ...state.splitBySession, [sessionId]: null } }
      // Cambiare orientamento conserva il gruppo di tab dello split.
      const split = current ? { ...current, orientation } : { orientation, documentId, tabs: [documentId] }
      return { splitBySession: { ...state.splitBySession, [sessionId]: split } }
    })
  },

  closeSplitTab: (documentId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set((state) => ({ splitBySession: { ...state.splitBySession, [sessionId]: removeFromSplit(state.splitBySession[sessionId], documentId) } }))
  },

  setSplitDocument: (documentId) => {
    const sessionId = get().activeSessionId
    const split = sessionId ? get().splitBySession[sessionId] : null
    if (!sessionId || !split) return
    const tabs = split.tabs.includes(documentId) ? split.tabs : [...split.tabs, documentId]
    set((state) => ({ splitBySession: { ...state.splitBySession, [sessionId]: { ...split, documentId, tabs } } }))
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
        docker: partial.docker ?? {},
        secrets: partial.secrets ?? [],
      })
      set((state) => ({
        executions: replaceExecution(state.executions, execution),
        activeRunBySession: { ...state.activeRunBySession, [sessionId]: execution.id },
        layout: { ...state.layout, bottomOpen: true },
        consoleByRun: withConsoleHeader(state.consoleByRun, execution),
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
      set((state) => ({
        executions: replaceExecution(state.executions, execution),
        activeRunBySession: { ...state.activeRunBySession, [sessionId]: execution.id },
        // Il riavvio resta della stessa configurazione.
        configByRun: state.configByRun[runId] ? { ...state.configByRun, [execution.id]: state.configByRun[runId] } : state.configByRun,
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  sendRunInput: async (runId, text) => {
    try { await writeGoIDERunInput(runId, text) } catch (error) { set({ error: errorMessage(error) }) }
  },

  hasActiveRuns: async (sessionId) => hasActiveGoIDERuns(sessionId),

  handleEvent: (event) => {
    // Moduli o go.work cambiati (es. Go Workspace): la sessione arriva già aggiornata dal backend.
    if (event.type === 'session.updated' && event.payload && typeof event.payload === 'object' && 'project' in event.payload) {
      set((state) => ({ sessions: replaceSession(state.sessions, event.payload as GoIDESession) }))
      return
    }
    // go env finisce in background dopo il rilevamento veloce: aggiorna i valori senza toccare loading.
    if (event.type === 'toolchain.detected' && event.sessionId && event.payload && typeof event.payload === 'object' && 'available' in event.payload) {
      const info = event.payload as GoIDEToolchainInfo
      set((state) => ({ toolchains: { ...state.toolchains, [event.sessionId!]: info } }))
      return
    }
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
    if (event.type === 'files.changed' && event.sessionId) {
      void get().handleFilesChanged(event.sessionId, event.payload as GoIDEFilesChanged)
      return
    }
    if ((event.type === 'run.started' || event.type === 'run.finished') && isExecution(event.payload)) {
      const execution = event.payload
      // Ogni esecuzione (anche Go Tools e dipendenze) mostra il comando in testa e l'esito in fondo.
      set((state) => ({
        executions: replaceExecution(state.executions, execution),
        // Solo l'avvio sposta il focus: la fine di una docker build arriva dopo l'avvio del suo container.
        activeRunBySession: event.type === 'run.started' || !state.activeRunBySession[execution.sessionId] ? { ...state.activeRunBySession, [execution.sessionId]: execution.id } : state.activeRunBySession,
        consoleByRun: event.type === 'run.started' ? withConsoleHeader(state.consoleByRun, execution) : withConsoleFooter(state.consoleByRun, execution, event.sequence),
      }))
      if (event.type === 'run.finished' && MODULE_CHANGING_KINDS.has(execution.kind)) void get().refreshModuleFiles(execution.sessionId)
      if (event.type === 'run.finished') {
        recordConfiguredRun(get(), execution)
        recordFuzzRun(get(), execution)
      }
    }
  },

  clearRevealLocation: () => set({ revealLocation: null }),

  updateLayout: (patch) => set((state) => {
    const layout = { ...state.layout, ...patch }
    safeSetItem(LAYOUT_KEY, JSON.stringify(layout))
    return { layout }
  }),

  toggleEditorMaximized: () => {
    const { layout, updateLayout } = get()
    const open = { projectOpen: layout.projectOpen, structureOpen: layout.structureOpen, bottomOpen: layout.bottomOpen }
    if (open.projectOpen || open.structureOpen || open.bottomOpen) {
      toolWindowsBeforeMaximize = open
      return updateLayout({ projectOpen: false, structureOpen: false, bottomOpen: false })
    }
    // Nessun pannello aperto: torna alla disposizione precedente, o a quella di default.
    updateLayout(toolWindowsBeforeMaximize ?? { projectOpen: true, structureOpen: true, bottomOpen: true })
    toolWindowsBeforeMaximize = null
  },

  clearError: () => set({ error: null }),
}))

// ponytail: in memoria, non persistito; dopo un riavvio "ripristina" riapre tutti i pannelli.
let toolWindowsBeforeMaximize: Pick<GoIDELayout, 'projectOpen' | 'structureOpen' | 'bottomOpen'> | null = null

/**
 * Ricontrolla i documenti su disco: un buffer pulito si ricarica in silenzio, uno modificato riceve
 * l'avviso Reload/Keep/Compare. Nessuna modifica dell'utente viene mai scartata.
 */
async function refreshFromDisk(sessionId: string, documentIds: string[]): Promise<void> {
  const store = useGoIDEStore.getState()
  for (const documentId of documentIds) {
    const current = useGoIDEStore.getState().documents.find((item) => item.document.id === documentId)
    if (!current) continue
    try {
      const externalState = await checkGoIDEDocument(sessionId, documentId, current.diskToken)
      if (!externalState.changed) continue
      useGoIDEStore.setState((state) => ({ documents: state.documents.map((item) => item.document.id === documentId ? { ...item, externalState } : item) }))
      const latest = useGoIDEStore.getState().documents.find((item) => item.document.id === documentId)
      if (latest && !latest.dirty) store.resolveExternalChange(documentId, 'reload')
    } catch (error) {
      useGoIDEStore.setState({ error: errorMessage(error) })
    }
  }
}

const MODULE_CHANGING_KINDS = new Set(['dependency', 'tidy'])

type ConsoleByRun = Record<string, GoIDEConsoleChunk[]>

/** Riga "$ comando" all'inizio della console, una sola volta per esecuzione. */
function withConsoleHeader(consoleByRun: ConsoleByRun, execution: GoIDEExecution): ConsoleByRun {
  const current = consoleByRun[execution.id] ?? []
  if (current.some((chunk) => chunk.stream === 'system' && chunk.sequence === 0)) return consoleByRun
  const header = { sequence: 0, stream: 'system' as const, text: `$ ${execution.command}\n${execution.workingDirectory}\n\n` }
  return { ...consoleByRun, [execution.id]: [header, ...current] }
}

/** Esito in fondo alla console, come in GoLand: anche un comando senza output mostra che è finito. */
function withConsoleFooter(consoleByRun: ConsoleByRun, execution: GoIDEExecution, sequence: number): ConsoleByRun {
  if (execution.status === 'running') return consoleByRun
  const outcome = execution.status === 'stopped' ? 'Process stopped' : `Process finished with exit code ${execution.exitCode ?? '?'}`
  return { ...consoleByRun, [execution.id]: appendConsole(consoleByRun[execution.id] ?? [], { sequence, stream: 'system', text: `\n${outcome}\n` }) }
}
const MODULE_FILE_NAMES = new Set(['go.mod', 'go.sum', 'go.work', 'go.work.sum'])

function isModuleFile(relativePath: string): boolean {
  return MODULE_FILE_NAMES.has(relativePath.split('/').pop() ?? '')
}

export function activeGoIDEDocument(state: GoIDEState): GoIDEEditorDocument | null {
  const sessionId = state.activeSessionId
  const documentId = sessionId ? state.activeDocumentBySession[sessionId] : null
  return state.documents.find((item) => item.document.id === documentId) ?? null
}

export function dirtyGoIDEDocuments(state: GoIDEState, sessionId: string): GoIDEEditorDocument[] {
  return state.documents.filter((item) => item.document.sessionId === sessionId && item.dirty)
}

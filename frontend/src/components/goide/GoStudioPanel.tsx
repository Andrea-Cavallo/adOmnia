import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { GoStudioEmptyState } from './GoStudioEmptyState'
import { CreateProjectDialog, UnsavedChangesDialog } from './GoStudioDialogs'
import { GoStudioWindowControls, useGoStudioTitlebar } from './GoStudioTitlebar'
import { DEFAULT_RUN_DRAFT, runRequest } from './goStudioRunDraft'
import { ToolchainDialog } from './GoStudioToolchains'
import { GoStudioDependencies } from './GoStudioDependencies'
import { GoStudioQuickOpen } from './GoStudioQuickOpen'
import { GoStudioRecoveryBanner } from './GoStudioRecoveryBanner'
import { GoStudioRunConfigurations } from './GoStudioRunConfigurations'
import { GoStudioSecretsPrompt } from './GoStudioSecretsPrompt'
import { GoStudioHierarchyDialog } from './GoStudioHierarchyDialog'
import { GoStudioGoWorkDialog } from './GoStudioGoWorkDialog'
import { GoStudioCloneDialog } from './GoStudioCloneDialog'
import { GoStudioGenerateMenu } from './GoStudioGenerateMenu'
import { useAppStore } from '@/stores/app'
import { GoStudioToolbar } from './GoStudioToolbar'
import { GoStudioElsewhere } from './GoStudioElsewhere'
import { useGoIDEWindowsStore } from '@/stores/goideWindows'
import { closeGoIDESessionWindow } from '@/lib/goide-window-api'
import { GoStudioWorkspace } from './GoStudioWorkspace'
import { GoStudioMenuBar, type GoStudioCommandState } from './GoStudioMenuBar'
import { GoStudioWorkspaceSwitcher } from './GoStudioWorkspaceSwitcher'
import './goStudioChrome.css'
import { GoStudioShortcutsDialog } from './GoStudioShortcutsDialog'
import { commandAvailability, commandChecked, commandForKey, type GoStudioCommandContext, type GoStudioCommandId } from './goStudioCommands'
import { activeGoStudioEditor, hasGoStudioEditor, isGoStudioEditorCommand, runGoStudioEditorCommand } from './goStudioEditorRegistry'
import { GoStudioStatusBar } from './GoStudioStatusBar'
import { GoStudioSymbolSearch } from './GoStudioSymbolSearch'
import { GoStudioChangePreviewDialog, GoStudioRenameDialog } from './GoStudioRefactorDialogs'
import { GoStudioLanguageServerLog } from './GoStudioLanguageServerLog'
import { GoStudioToolPathsDialog } from './GoStudioToolPathsDialog'
import { runLanguageCommand } from './goStudioLanguageCommands'
import { runSaveActions } from './goStudioSaveActions'
import { runCommandFor, type GoStudioGoRunTarget, type GoStudioRunTarget } from './goStudioRunTargets'
import { isToolTarget, toolConfigurationDraft, toolRunRequest } from './goStudioToolTargets'
import type { GoIDERunConfiguration } from '@/lib/goide-api'
import { useGoStudioCloseFlow } from './useGoStudioCloseFlow'
import { GoStudioCaretPopup } from './GoStudioCaretPopup'
import { GoStudioImplementInterfaceDialog } from './GoStudioImplementInterfaceDialog'
import { GoStudioSearchEverywhere } from './GoStudioSearchEverywhere'
import { createDoubleShiftDetector } from './goStudioSearchRanking'
import { runGoStudioQuickCommand, runModuleDependencyAction } from './goStudioQuickActions'
import { flushBufferRecovery } from './goStudioRecovery'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { debugRequestForTarget, testRequestForTarget } from './goStudioQuickActions'
import { runDebugCommand, selectDebugState } from './goStudioDebugCommands'
import { GoStudioRunTargetMenu, type GoStudioRunTargetAction } from './GoStudioRunTargetMenu'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { bookmarksFor, historyFor, useGoIDENavigationStore } from '@/stores/goideNavigation'
import { runNavigationCommand } from './goStudioNavigationEditor'
import { GoStudioBookmarksDialog } from './GoStudioBookmarksDialog'
import { GoStudioBranchWidget } from './GoStudioBranchWidget'
import { GoStudioCommitDialog } from './GoStudioCommitDialog'
import { GoStudioGitHistoryDialog } from './GoStudioGitHistoryDialog'
import { GoStudioProjectServicesDialog } from './GoStudioProjectServicesDialog'
import { runIntegrationCommand } from './goStudioIntegrationCommands'
import { GoStudioHunkPopup } from './GoStudioHunkPopup'
import { GoStudioBreakpointPopover } from './GoStudioBreakpointPopover'
import { GoStudioBreakpointsDialog } from './GoStudioBreakpointsDialog'
import { runVcsCommand, type GoStudioVcsDialog } from './goStudioVcsCommands'
import { useGoIDEVCSStore } from '@/stores/goideVcs'
import { GoStudioLocalHistoryDialog } from './GoStudioLocalHistoryDialog'
import { GoStudioAttachDialog, type GoStudioAttachMode } from './GoStudioAttachDialog'
import { GoStudioGoToolDialog, type GoStudioGoToolDialogState } from './GoStudioGoToolDialog'
import { goToolDialogFor } from './goStudioGoToolCommands'
import type { GoIDEDebugRequest } from '@/lib/goide-debug-api'
import { confirm } from '@/lib/confirmDialog'
import { useShallow } from 'zustand/react/shallow'
import { activeGoIDEDocument, dirtyGoIDEDocuments, sessionsInWorkspace, useGoIDEStore, type GoIDEEditorDocument, type GoIDEState } from '@/stores/goide'
import { useGoStudioCursorStore } from './goStudioCursor'
import { useGoIDELspStore } from '@/stores/goideLsp'


const PANEL_STATE_KEYS = [
  'activeSessionId', 'activeWorkspaceId', 'layout', 'sessions', 'error', 'recentProjects', 'loading', 'initialized', 'toolchains', 'splitBySession', 'showIgnoredBySession',
  'runConfigsBySession', 'executions', 'closedDocuments', 'activeRunBySession', 'activeConfigBySession',
  'updateLayout', 'toggleEditorMaximized', 'openProject', 'startRun', 'startConfiguredRun', 'setSplit', 'detectToolchain', 'stopRun', 'initialize', 'clearError',
  'toggleShowIgnored', 'togglePinned', 'setToolAuthorization', 'setQuickOpen', 'selectSession', 'selectRunConfiguration', 'restartRun',
  'reopenClosedDocument', 'removeRecentProject',
] as const satisfies ReadonlyArray<keyof GoIDEState>

type PanelState = Pick<GoIDEState, (typeof PANEL_STATE_KEYS)[number]>

/** Solo i campi usati dal pannello: buffer, console e ricerche non devono ridisegnare l'intero IDE. */
function selectPanelState(state: GoIDEState): PanelState {
  return Object.fromEntries(PANEL_STATE_KEYS.map((key) => [key, state[key]])) as PanelState
}

/** Riassunto primitivo dei documenti: cambia solo quando cambia il file attivo o lo stato dirty, non a ogni tasto. */
function selectDocumentSummary(state: GoIDEState) {
  const active = activeGoIDEDocument(state)
  let documentCount = 0
  let sessionDirty = false
  for (const item of state.documents) {
    if (item.document.sessionId !== state.activeSessionId) continue
    documentCount++
    sessionDirty = sessionDirty || item.dirty
  }
  return {
    activeId: active?.document.id ?? null,
    activePath: active?.document.relativePath ?? null,
    activeLanguage: active?.document.language ?? null,
    activeReadOnly: !!active?.document.readOnly,
    activeDirty: !!active?.dirty,
    documentCount,
    sessionDirty,
  }
}

function currentSessionDocuments(sessionId: string | undefined) {
  return useGoIDEStore.getState().documents.filter((item) => item.document.sessionId === sessionId)
}

function currentActiveDocument() {
  return activeGoIDEDocument(useGoIDEStore.getState())
}

export function GoStudioPanel() {
  const store = useGoIDEStore(useShallow(selectPanelState))
  const summary = useGoIDEStore(useShallow(selectDocumentSummary))
  const setCursor = useGoStudioCursorStore((state) => state.setCursor)
  const [createOpen, setCreateOpen] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [goWorkOpen, setGoWorkOpen] = useState(false)
  const goStudioMaximized = useAppStore((state) => state.goStudioMaximized)
  const titlebar = useGoStudioTitlebar()
  const toggleGoStudioMaximized = useAppStore((state) => state.toggleGoStudioMaximized)
  const zen = useAppStore((state) => state.goStudioZen)
  const setZen = useAppStore((state) => state.setGoStudioZen)
  // Zen Mode: nasconde la chrome di Go Studio e chiude i pannelli; all'uscita li ripristina com'erano.
  const toggleZen = () => {
    const { projectOpen, structureOpen, bottomOpen } = store.layout
    const anyOpen = projectOpen || structureOpen || bottomOpen
    if (zen ? !anyOpen : anyOpen) store.toggleEditorMaximized()
    setZen(!zen)
  }
  const [configDraft, setConfigDraft] = useState<GoIDERunConfiguration | null>(null)
  const openConfigurations = (draft: GoIDERunConfiguration | null = null) => { setConfigDraft(draft); setConfigureOpen(true) }
  const [toolchainOpen, setToolchainOpen] = useState(false)
  const [dependenciesOpen, setDependenciesOpen] = useState(false)
  const [runDraft] = useState(DEFAULT_RUN_DRAFT)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false)
  const [searchEverywhereOpen, setSearchEverywhereOpen] = useState(false)
  const [lspLogOpen, setLspLogOpen] = useState(false)
  const [toolPathsOpen, setToolPathsOpen] = useState(false)
  const lsp = useGoIDELspStore(useShallow((state) => {
    const sessionId = store.activeSessionId ?? ''
    return {
      preferences: state.preferences, settings: state.settings, message: state.message, start: state.start, clearMessage: state.clearMessage,
      statusInfo: state.status[sessionId], goplsInfo: state.gopls[sessionId], linterInfo: state.linter[sessionId], linting: !!state.lint[sessionId]?.running,
    }
  }))
  const windows = useGoIDEWindowsStore(useShallow((state) => ({ context: state.context, owners: state.owners, error: state.error, clearError: state.clearError })))
  const pinnedSessionId = windows.context.pinnedSessionId
  // Una finestra separata mostra soltanto il proprio progetto, di qualunque workspace sia.
  const workspaceSessions = useMemo(() => pinnedSessionId
    ? store.sessions.filter((session) => session.id === pinnedSessionId)
    : sessionsInWorkspace(store.sessions, store.activeWorkspaceId), [pinnedSessionId, store.activeWorkspaceId, store.sessions])
  const activeSession = useMemo(() => store.sessions.find((session) => session.id === store.activeSessionId) ?? null, [store.activeSessionId, store.sessions])
  const closeFlow = useGoStudioCloseFlow(activeSession)
  const sessionExecutions = store.executions.filter((execution) => execution.sessionId === store.activeSessionId)
  const activeRunId = store.activeSessionId ? store.activeRunBySession[store.activeSessionId] : null
  const activeExecution = sessionExecutions.find((execution) => execution.id === activeRunId) ?? sessionExecutions[sessionExecutions.length - 1] ?? null
  const toolchain = store.activeSessionId ? store.toolchains[store.activeSessionId] ?? null : null
  const runConfigurations = store.activeSessionId ? store.runConfigsBySession[store.activeSessionId] ?? [] : []
  const activeConfigId = store.activeSessionId ? store.activeConfigBySession[store.activeSessionId] ?? null : null
  const activeConfig = runConfigurations.find((config) => config.id === activeConfigId) ?? null
  const [pendingSecrets, setPendingSecrets] = useState<string[] | null>(null)
  const [runTargetMenu, setRunTargetMenu] = useState<{ target: GoStudioRunTarget; x: number; y: number } | null>(null)
  const debugState = useGoIDEDebugStore(selectDebugState(store.activeSessionId))
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [locationsMode, setLocationsMode] = useState<'bookmarks' | 'recent'>('bookmarks')
  const [goTool, setGoTool] = useState<GoStudioGoToolDialogState | null>(null)
  const [attachMode, setAttachMode] = useState<GoStudioAttachMode | null>(null)
  const [localHistoryOpen, setLocalHistoryOpen] = useState(false)
  const [vcsDialog, setVcsDialog] = useState<GoStudioVcsDialog>(null)
  const [servicesOpen, setServicesOpen] = useState(false)
  const vcs = useGoIDEVCSStore(useShallow((state) => {
    const status = state.status[store.activeSessionId ?? '']
    return { vcsAvailable: !!status?.available, vcsChanges: status?.changes.length ?? 0 }
  }))
  const navigation = useGoIDENavigationStore(useShallow((state) => {
    const history = historyFor(state, store.activeSessionId ?? '')
    return { canGoBack: history.index > 0, canGoForward: history.index < history.entries.length - 1, bookmarkCount: bookmarksFor(state, store.activeSessionId ?? '').length }
  }))

  useEffect(() => { void store.initialize() }, [store.initialize])
  useEffect(() => { void useGoIDEWindowsStore.getState().load() }, [])

  // Progetti già autorizzati: rileva l'SDK e avvia gopls senza clic extra; quelli non autorizzati restano inerti.
  const activeSessionId = activeSession?.id ?? null
  const activeSessionTrusted = activeSession?.project.authorization === 'tooling-permitted'
  useEffect(() => {
    if (!activeSessionId || !activeSessionTrusted) return
    void (async () => {
      if (!useGoIDEStore.getState().toolchains[activeSessionId]) await useGoIDEStore.getState().detectToolchain()
      await useGoIDELspStore.getState().ensureStarted(activeSessionId)
    })()
  }, [activeSessionId, activeSessionTrusted])

  // Le scorciatoie restano attive solo mentre il pannello è montato e hanno la precedenza su quelle globali.
  const runCommandRef = useRef<(id: GoStudioCommandId) => void>(() => undefined)
  const availabilityRef = useRef<(id: GoStudioCommandId) => true | string>(() => true)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandForKey(event)
      if (!command) return
      if (command.passThroughWhenUnavailable && availabilityRef.current(command.id) !== true) return
      event.preventDefault()
      runCommandRef.current(command.id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Build e Run partono dalla configurazione salvata attiva; senza configurazioni
  // resta la bozza locale, così il pannello è usabile anche prima di salvarne una.
  const configuredRequest = useCallback(() => {
    // Build compila il package della configurazione; per file, binari e test si usa la radice del progetto.
    if (!activeConfig || (activeConfig.kind !== 'package' && activeConfig.kind !== 'build')) return runRequest(runDraft)
    const environment: Record<string, string> = {}
    for (const entry of activeConfig.environment ?? []) {
      if (!entry.secret) environment[entry.key] = entry.value ?? ''
    }
    return {
      target: activeConfig.target || '.',
      workingDirectory: activeConfig.workingDirectory,
      goArguments: activeConfig.goArguments ?? [],
      programArguments: activeConfig.programArguments ?? [],
      buildTags: activeConfig.buildTags ?? [],
      environment,
    }
  }, [activeConfig, runDraft])

  const startConfigured = useCallback((kind: 'build' | 'run') => {
    // Variabili d'ambiente e build arg segreti: stesso nome, stesso valore richiesto una sola volta.
    const secretKeys = [...new Set([...(activeConfig?.environment ?? []), ...(activeConfig?.docker?.buildArgs ?? [])].filter((entry) => entry.secret).map((entry) => entry.key))]
    if (kind === 'run' && activeConfig && secretKeys.length > 0) {
      setPendingSecrets(secretKeys)
      return
    }
    if (kind === 'run' && activeConfig) {
      void store.startConfiguredRun(activeConfig.id, {})
      return
    }
    void store.startRun(kind, configuredRequest())
  }, [activeConfig, configuredRequest, store.startConfiguredRun, store.startRun])

  const saveDocumentWithActions = async (documentId?: string) => {
    const sessionId = store.activeSessionId
    const id = documentId ?? (sessionId ? useGoIDEStore.getState().activeDocumentBySession[sessionId] : null)
    if (!id) return false
    await runSaveActions(id)
    const saved = await useGoIDEStore.getState().saveDocument(id)
    const lspState = useGoIDELspStore.getState()
    if (saved && sessionId && lspState.preferences.lintOnSave && lspState.linter[sessionId]?.available) scheduleLintOnSave(sessionId)
    return saved
  }

  const saveAllWithActions = async () => {
    if (!activeSession) return
    const dirty = dirtyGoIDEDocuments(useGoIDEStore.getState(), activeSession.id)
    for (const document of dirty) if (!await saveDocumentWithActions(document.document.id)) return
  }
  // Save Files on Focus Change: come negli IDE JetBrains, salva quando la finestra va in secondo piano
  // e quando si cambia file. Nessun salvataggio mentre si scrive.
  const autoSave = lsp.preferences.autoSave
  const autoSaveRef = useRef(saveAllWithActions)
  autoSaveRef.current = saveAllWithActions
  const activeDocumentId = useGoIDEStore((state) => (activeSession ? state.activeDocumentBySession[activeSession.id] ?? null : null))
  useEffect(() => {
    if (!autoSave) return
    const onBlur = () => void autoSaveRef.current()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [autoSave])
  const previousActiveRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousActiveRef.current
    previousActiveRef.current = activeDocumentId
    if (!autoSave || !previous || previous === activeDocumentId) return
    const document = useGoIDEStore.getState().documents.find((item) => item.document.id === previous)
    if (document?.dirty) void saveDocumentWithActions(previous)
  }, [activeDocumentId, autoSave]) // eslint-disable-line react-hooks/exhaustive-deps


  // Doppio Shift apre Search Everywhere solo quando c'è un progetto aperto.
  useEffect(() => {
    if (!activeSessionId) return
    const detect = createDoubleShiftDetector(() => setSearchEverywhereOpen(true))
    window.addEventListener('keydown', detect, true)
    return () => window.removeEventListener('keydown', detect, true)
  }, [activeSessionId])

  useEffect(() => {
    const protectDirtyBuffers = (event: BeforeUnloadEvent) => {
      flushBufferRecovery()
      if (!useGoIDEStore.getState().documents.some((document) => document.dirty)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectDirtyBuffers)
    return () => window.removeEventListener('beforeunload', protectDirtyBuffers)
  }, [])

  const beginResize = useCallback((key: 'projectWidth' | 'structureWidth' | 'bottomHeight', initial: number, direction = 1) => (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const horizontal = key === 'bottomHeight'
    const start = horizontal ? event.clientY : event.clientX
    const onMove = (moveEvent: MouseEvent) => {
      const coordinate = horizontal ? moveEvent.clientY : moveEvent.clientX
      const value = initial + (coordinate - start) * direction
      const min = horizontal ? 112 : 180
      const max = key === 'bottomHeight' ? 480 : key === 'projectWidth' ? 420 : 360
      store.updateLayout({ [key]: Math.min(max, Math.max(min, value)) })
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [store.updateLayout])

  const authorize = async (allowed: boolean) => {
    await store.setToolAuthorization(allowed)
    if (!allowed || !store.activeSessionId) return
    await store.detectToolchain()
    await useGoIDELspStore.getState().ensureStarted(store.activeSessionId)
  }

  const tidy = async () => {
    const approved = await confirm({ title: 'Run go mod tidy?', message: `Command: go mod tidy\nWorking directory: ${runDraft.workingDirectory || activeSession?.project.rootPath || ''}\n\nThis may access the network through your configured Go proxy.`, confirmLabel: 'Run tidy' })
    if (approved) await store.startRun('tidy', runRequest(runDraft))
  }

  const authorized = activeSessionTrusted
  const lspStatus = activeSession ? lsp.statusInfo : undefined
  const commandContext: GoStudioCommandContext = {
    hasSession: !!activeSession,
    documentCount: summary.documentCount,
    hasClosedDocuments: !!activeSession && (store.closedDocuments[activeSession.id]?.length ?? 0) > 0,
    split: !!activeSession && !!store.splitBySession[activeSession.id],
    lspState: (lspStatus?.state || 'stopped') as GoStudioCommandContext['lspState'],
    goplsAvailable: !!activeSession && !!lsp.goplsInfo?.available,
    formatOnSave: lsp.preferences.formatOnSave,
    importsOnSave: lsp.preferences.organizeImportsOnSave,
    gofumpt: lsp.settings.gofumpt,
    vulncheck: lsp.settings.vulncheck,
    staticcheck: lsp.settings.staticcheck,
    lintOnSave: lsp.preferences.lintOnSave,
    linterAvailable: !!activeSession && !!lsp.linterInfo?.available,
    linting: !!activeSession && lsp.linting,
    authorized,
    toolchainReady: !!toolchain?.available,
    running: activeExecution?.status === 'running',
    restartable: !!activeExecution && activeExecution.kind !== 'dependency',
    hasEditor: !!summary.activeId && hasGoStudioEditor(),
    activeDocumentDirty: summary.activeDirty,
    sessionDirty: !!activeSession && summary.sessionDirty,
    detached: !!pinnedSessionId,
    ownedElsewhere: !!activeSession && (windows.owners[activeSession.id] ?? 'main') !== windows.context.windowId,
    structureOpen: store.layout.structureOpen,
    bottomOpen: store.layout.bottomOpen,
    showIgnored: !!activeSession && (store.showIgnoredBySession[activeSession.id] ?? false),
    maximized: goStudioMaximized,
    zen,
    editorPrefs: {
      previewTab: lsp.preferences.previewTab, stickyScroll: lsp.preferences.stickyScroll, minimap: lsp.preferences.minimap, fontLigatures: lsp.preferences.fontLigatures,
      typeHints: lsp.preferences.typeHints, autoSave: lsp.preferences.autoSave, trimTrailingWhitespace: lsp.preferences.trimTrailingWhitespace,
    },
    projectOpen: store.layout.projectOpen,
    semanticHighlighting: lsp.preferences.semanticHighlighting,
    inlayHints: lsp.preferences.inlayHints,
    semanticTokensSupported: !!lspStatus?.features?.semanticTokens,
    inlayHintsSupported: !!lspStatus?.features?.inlayHints,
    debugState,
    ...navigation,
    ...vcs,
  }
  const commandState: GoStudioCommandState = {
    availability: (id) => commandAvailability(id, commandContext),
    checked: (id) => commandChecked(id, commandContext),
  }

  availabilityRef.current = (id) => commandAvailability(id, commandContext)

  const runTarget = (target: GoStudioRunTarget, action: GoStudioRunTargetAction = 'run') => {
    if (isToolTarget(target)) {
      if (!activeSession) return
      if (action === 'save') return openConfigurations(toolConfigurationDraft(target, activeSession.id))
      if (!commandContext.authorized) return useGoIDEStore.setState({ error: 'Trust this project to run its Makefile or Dockerfile' })
      const { kind, partial } = toolRunRequest(target, action === 'buildRun' || action === 'build' || action === 'down' ? action : 'run')
      return void store.startRun(kind, partial)
    }
    const goTarget: GoStudioGoRunTarget = target
    const availability = commandAvailability('run.run', commandContext)
    if (availability !== true) return useGoIDEStore.setState({ error: availability })
    if (!activeSession) return
    if (action === 'debug') return void useGoIDEDebugStore.getState().start(debugRequestForTarget(activeSession, goTarget))
    if (target.kind !== 'main') {
      void useGoIDETestsStore.getState().start(testRequestForTarget(activeSession, goTarget, action === 'coverage'))
      return
    }
    const command = runCommandFor(target)
    void store.startRun(command.kind, { ...runRequest(runDraft), target: command.target })
  }

  // Debug (Shift+F9) usa la configurazione Run attiva: stesso package, argomenti, tag e variabili.
  const configuredDebugRequest = (): GoIDEDebugRequest | null => {
    if (!activeSession) return null
    const request = configuredRequest()
    return { sessionId: activeSession.id, mode: 'debug', target: request.target, workingDirectory: request.workingDirectory, programArguments: request.programArguments, buildTags: request.buildTags, environment: request.environment }
  }

  const openLanguageServerMenu = () => {
    if (!activeSession) return
    if (lspStatus?.state === 'ready' || lspStatus?.state === 'starting') return setLspLogOpen(true)
    if (commandAvailability('go.lspStart', commandContext) === true) return void lsp.start(activeSession.id)
    if (authorized && !lsp.goplsInfo?.available) return runCommand('go.lspInstall')
    setLspLogOpen(true)
  }

  const withActiveDocument = (action: (document: GoIDEEditorDocument) => void) => {
    const active = currentActiveDocument()
    if (active) action(active)
  }

  const runCommand = (id: GoStudioCommandId) => {
    const availability = commandAvailability(id, commandContext)
    if (availability !== true) {
      if (/^(run|nav|code|debug)\./.test(id)) useGoIDELspStore.setState({ message: availability })
      return
    }
    if (isGoStudioEditorCommand(id)) { runGoStudioEditorCommand(id); return }
    if (runLanguageCommand(id, activeSession?.id ?? null)) return
    if (runDebugCommand(id, activeSession?.id ?? null, configuredDebugRequest)) return
    if (id === 'file.localHistory') return setLocalHistoryOpen(true)
    if (runVcsCommand(id, activeSession?.id ?? null, currentActiveDocument(), setVcsDialog)) return
    if (runIntegrationCommand(id, currentActiveDocument(), activeGoStudioEditor(), () => setServicesOpen(true))) return
    if (id === 'debug.attach' || id === 'debug.remote') return setAttachMode(id === 'debug.attach' ? 'attach' : 'remote')
    const toolDialog = goToolDialogFor(id, activeSession)
    if (toolDialog) return setGoTool(toolDialog)
    if (runNavigationCommand(id, activeSession?.id ?? null, activeGoStudioEditor(), (mode) => { setLocationsMode(mode); setBookmarksOpen(true) })) return
    switch (id) {
      case 'file.openProject': return void store.openProject()
      case 'file.newProject': return setCreateOpen(true)
      case 'file.clone': return setCloneOpen(true)
      case 'go.goWork': return setGoWorkOpen(true)
      case 'file.save': return void saveDocumentWithActions()
      case 'file.saveAll': return void saveAllWithActions()
      case 'file.closeEditor': return withActiveDocument((active) => closeFlow.requestCloseDocuments([active]))
      case 'file.closeOthers': return closeFlow.requestCloseDocuments(currentSessionDocuments(activeSession?.id).filter((item) => item.document.id !== summary.activeId && !useGoIDEStore.getState().pinnedDocuments[item.document.id]))
      case 'file.closeAll': return closeFlow.requestCloseDocuments(currentSessionDocuments(activeSession?.id).filter((item) => !useGoIDEStore.getState().pinnedDocuments[item.document.id]))
      case 'file.pinTab': return withActiveDocument((active) => store.togglePinned(active.document.id))
      case 'file.reopenClosed': return void store.reopenClosedDocument()
      case 'file.closeProject': return void closeFlow.requestCloseSession()
      case 'window.openInNewWindow': return activeSession ? void useGoIDEWindowsStore.getState().moveToNewWindow(activeSession.id) : undefined
      case 'window.moveBack': return void closeGoIDESessionWindow(windows.context.windowId)
      case 'view.splitRight': return store.setSplit('right')
      case 'view.splitDown': return store.setSplit('down')
      case 'view.unsplit': return store.setSplit(null)
      case 'view.quickOpen': return store.setQuickOpen(true)
      case 'view.maximize': return toggleGoStudioMaximized()
      case 'view.maximizeEditor': return store.toggleEditorMaximized()
      case 'view.zenMode': return toggleZen()
      case 'view.toggleProject': return store.updateLayout({ projectOpen: !store.layout.projectOpen })
      case 'view.toggleStructure': return store.updateLayout({ structureOpen: !store.layout.structureOpen })
      case 'view.toggleBottom': return store.updateLayout({ bottomOpen: !store.layout.bottomOpen })
      case 'view.toggleIgnored': return void store.toggleShowIgnored()
      case 'go.toolchains': return setToolchainOpen(true)
      case 'go.detect': return void store.detectToolchain()
      case 'go.dependencies': return setDependenciesOpen(true)
      case 'go.tidy': return void tidy()
      case 'go.trust': return void authorize(!authorized)
      case 'run.run': return startConfigured('run')
      case 'run.build': return startConfigured('build')
      case 'run.stop': return void store.stopRun()
      case 'run.restart': return void store.restartRun()
      case 'run.configure': return setConfigureOpen(true)
      case 'run.buildPackage': return void runGoStudioQuickCommand('build', 'package')
      case 'run.testPackage': return void runGoStudioQuickCommand('test', 'package')
      case 'run.vetPackage': return void runGoStudioQuickCommand('vet', 'package')
      case 'run.buildAll': return void runGoStudioQuickCommand('build', 'module')
      case 'run.testAll': return void runGoStudioQuickCommand('test', 'module')
      case 'run.vetAll': return void runGoStudioQuickCommand('vet', 'module')
      case 'run.generateAll': return void runGoStudioQuickCommand('generate', 'module')
      case 'run.install': return void runGoStudioQuickCommand('install', 'package')
      case 'run.testCoverage': return void runGoStudioQuickCommand('test', 'package', undefined, { coverage: true })
      case 'run.testRace': return void runGoStudioQuickCommand('test', 'package', undefined, { race: true })
      case 'run.runRace': return void store.startRun('run', withRaceDetector(configuredRequest()))
      case 'run.rerunFailedTests': return activeSession ? void useGoIDETestsStore.getState().rerunFailed(activeSession.id) : undefined
      case 'go.updateAll': return void runModuleDependencyAction('updateall')
      case 'go.updatePatch': return void runModuleDependencyAction('updatepatch')
      case 'go.modDownload': return void runModuleDependencyAction('download')
      case 'go.modVerify': return void runModuleDependencyAction('verify')
      case 'help.shortcuts': return setShortcutsOpen(true)
      case 'nav.symbol': return setSymbolSearchOpen(true)
      case 'nav.searchEverywhere': return setSearchEverywhereOpen(true)
      case 'go.lspLog': return setLspLogOpen(true)
      case 'go.toolPaths': return setToolPathsOpen(true)
    }
  }
  runCommandRef.current = runCommand

  const openRealPaths = new Set(store.sessions.map((session) => session.project.realPath))
  const recentNotOpen = store.recentProjects.filter((project) => !openRealPaths.has(project.realPath))
  const mainMenu = <GoStudioMenuBar state={commandState} recentProjects={store.recentProjects} openProjectPaths={workspaceSessions.map((session) => session.project.realPath)} onCommand={runCommand} onOpenRecent={(path) => void store.openProject(path)} />
  const menuBar = <div role="toolbar" aria-label="Go Studio toolbar" {...titlebar.props} className={`flex h-12 shrink-0 items-center gap-1 pl-2 ${titlebar.active ? 'go-studio-titlebar' : 'pr-2'}`}>{mainMenu}<span className="flex-1" /><GoStudioWorkspaceSwitcher /><GoStudioWindowControls /></div>
  const sharedDialogs = <><CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} /><GoStudioCloneDialog open={cloneOpen} onClose={() => setCloneOpen(false)} /><GoStudioShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} /></>

  const windowError = windows.error && <ErrorBanner message={windows.error} onClose={windows.clearError} />
  if (!activeSession && pinnedSessionId && store.initialized) {
    return <div className="go-studio-root flex min-h-0 flex-1 flex-col">{menuBar}{windowError}<GoStudioElsewhere mode="closed" projectName="" onClose={() => void closeGoIDESessionWindow(windows.context.windowId)} /></div>
  }
  if (activeSession && (windows.owners[activeSession.id] ?? 'main') !== windows.context.windowId) {
    return (
      <div className="go-studio-root flex min-h-0 flex-1 flex-col text-text-1">
        <GoStudioToolbar mainMenu={mainMenu} trailing={<GoStudioWorkspaceSwitcher />} onSearchEverywhere={() => runCommand('nav.searchEverywhere')} onDebug={() => runCommand('debug.debug')} recentProjects={recentNotOpen} onOpenRecent={(path) => void store.openProject(path)} runConfigurations={runConfigurations} activeConfigId={activeConfigId} onSelectConfiguration={(id) => store.selectRunConfiguration(id)} sessions={workspaceSessions} activeSession={activeSession} activeExecution={activeExecution} toolchain={toolchain} loading={store.loading} onSelect={(id) => void store.selectSession(id)} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onSetAuthorization={(allowed) => void authorize(allowed)} onDetectToolchain={() => void store.detectToolchain()} onToolchainSettings={() => setToolchainOpen(true)} onDependencies={() => setDependenciesOpen(true)} onConfigure={() => setConfigureOpen(true)} onBuild={() => startConfigured('build')} onRun={() => startConfigured('run')} onTidy={() => void tidy()} onStop={() => void store.stopRun()} onClose={() => void useGoIDEWindowsStore.getState().bringBack(activeSession.id)} />
        {windowError}
        <GoStudioElsewhere mode="elsewhere" projectName={activeSession.project.name} onFocus={() => void useGoIDEWindowsStore.getState().focusOwner(activeSession.id)} onBringBack={() => void useGoIDEWindowsStore.getState().bringBack(activeSession.id)} />
        {sharedDialogs}
      </div>
    )
  }

  if (!activeSession) {
    return <div className="go-studio-root flex min-h-0 flex-1 flex-col">{menuBar}{store.error && <ErrorBanner message={store.error} onClose={store.clearError} />}<GoStudioEmptyState loading={store.loading} recentProjects={store.recentProjects} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onClone={() => setCloneOpen(true)} onOpenRecent={(path) => void store.openProject(path)} onRemoveRecent={(path) => void store.removeRecentProject(path)} />{sharedDialogs}</div>
  }

  return (
    <div className="go-studio-root flex min-h-0 flex-1 flex-col text-text-1">
      {!zen && <GoStudioToolbar mainMenu={mainMenu} trailing={<GoStudioWorkspaceSwitcher />} onSearchEverywhere={() => runCommand('nav.searchEverywhere')} onDebug={() => runCommand('debug.debug')} extra={<GoStudioBranchWidget sessionId={activeSession.id} onCommit={() => setVcsDialog('commit')} />} maximized={goStudioMaximized} onToggleMaximize={toggleGoStudioMaximized} recentProjects={recentNotOpen} onOpenRecent={(path) => void store.openProject(path)} runConfigurations={runConfigurations} activeConfigId={activeConfigId} onSelectConfiguration={(id) => store.selectRunConfiguration(id)} sessions={workspaceSessions} activeSession={activeSession} activeExecution={activeExecution} toolchain={toolchain} loading={store.loading} onSelect={(id) => void store.selectSession(id)} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onSetAuthorization={(allowed) => void authorize(allowed)} onDetectToolchain={() => void store.detectToolchain()} onToolchainSettings={() => setToolchainOpen(true)} onDependencies={() => setDependenciesOpen(true)} onConfigure={() => setConfigureOpen(true)} onBuild={() => startConfigured('build')} onRun={() => startConfigured('run')} onTidy={() => void tidy()} onStop={() => void store.stopRun()} onClose={() => void closeFlow.requestCloseSession()} />}
      {store.error && <ErrorBanner message={store.error} onClose={store.clearError} />}
      {windowError}
      {lsp.message && <NoticeBanner message={lsp.message} onClose={lsp.clearMessage} />}
      <GoStudioRecoveryBanner sessionId={activeSession.id} />
      <GoStudioWorkspace session={activeSession} {...store.layout} zen={zen} onProjectResize={beginResize('projectWidth', store.layout.projectWidth)} onStructureResize={beginResize('structureWidth', store.layout.structureWidth, -1)} onBottomResize={beginResize('bottomHeight', store.layout.bottomHeight, -1)} onCursor={setCursor} onRequestCloseDocument={closeFlow.requestCloseDocuments} onRunTarget={(target, anchor) => setRunTargetMenu({ target, ...anchor })} onCommit={() => setVcsDialog('commit')} onBookmarks={() => setBookmarksOpen(true)} onDependencies={() => setDependenciesOpen(true)} />
      {runTargetMenu && <GoStudioRunTargetMenu {...runTargetMenu} onAction={runTarget} onClose={() => setRunTargetMenu(null)} />}
      {zen ? <ZenExit onExit={toggleZen} /> : <GoStudioStatusBar session={activeSession} toolchain={toolchain} documentInfo={summary.activeId ? { language: summary.activeLanguage ?? '', readOnly: summary.activeReadOnly } : null} execution={activeExecution} onLanguageServer={openLanguageServerMenu} onLinter={() => runCommand(commandAvailability('code.lint', commandContext) === true ? 'code.lint' : 'go.toolPaths')} onSetAuthorization={(allowed) => void authorize(allowed)} />}
      <GoStudioQuickOpen />
      <GoStudioCaretPopup />
      <GoStudioHierarchyDialog />
      <GoStudioGoWorkDialog open={goWorkOpen} sessionId={activeSession.id} onClose={() => setGoWorkOpen(false)} />
      <GoStudioGenerateMenu />
      <GoStudioImplementInterfaceDialog />
      {sharedDialogs}
      {store.activeSessionId && <GoStudioRunConfigurations open={configureOpen} sessionId={store.activeSessionId} initialDraft={configDraft} onClose={() => { setConfigureOpen(false); setConfigDraft(null) }} />}
      <GoStudioSecretsPrompt
        open={!!pendingSecrets && !!activeConfig}
        configurationName={activeConfig?.name ?? ''}
        keys={pendingSecrets ?? []}
        onCancel={() => setPendingSecrets(null)}
        onSubmit={(secrets) => {
          setPendingSecrets(null)
          if (activeConfig) void store.startConfiguredRun(activeConfig.id, secrets)
        }}
      />
      <ToolchainDialog open={toolchainOpen} onClose={() => setToolchainOpen(false)} />
      <GoStudioDependencies open={dependenciesOpen} session={activeSession} onClose={() => setDependenciesOpen(false)} />
      <GoStudioSearchEverywhere open={searchEverywhereOpen} sessionId={activeSession.id} availability={(id) => commandAvailability(id, commandContext)} onCommand={runCommand} onClose={() => setSearchEverywhereOpen(false)} />
      <GoStudioCommitDialog sessionId={activeSession.id} open={vcsDialog === 'commit'} onClose={() => setVcsDialog(null)} />
      <GoStudioProjectServicesDialog sessionId={activeSession.id} projectName={activeSession.project.name} open={servicesOpen} onClose={() => setServicesOpen(false)} />
      <GoStudioGitHistoryDialog document={vcsDialog === 'history' ? currentActiveDocument() : null} open={vcsDialog === 'history'} onClose={() => setVcsDialog(null)} />
      <GoStudioHunkPopup />
      <GoStudioBreakpointPopover />
      <GoStudioBreakpointsDialog sessionId={activeSession.id} />
      <GoStudioLocalHistoryDialog document={localHistoryOpen ? currentActiveDocument() : null} open={localHistoryOpen} onClose={() => setLocalHistoryOpen(false)} />
      <GoStudioAttachDialog sessionId={activeSession.id} mode={attachMode} onClose={() => setAttachMode(null)} />
      <GoStudioGoToolDialog sessionId={activeSession.id} state={goTool} onClose={() => setGoTool(null)} />
      <GoStudioBookmarksDialog open={bookmarksOpen} sessionId={activeSession.id} mode={locationsMode} onClose={() => { setBookmarksOpen(false); setLocationsMode('bookmarks') }} />
      <GoStudioSymbolSearch open={symbolSearchOpen} sessionId={activeSession.id} onClose={() => setSymbolSearchOpen(false)} />
      <GoStudioRenameDialog />
      <GoStudioChangePreviewDialog />
      <GoStudioToolPathsDialog open={toolPathsOpen} sessionId={activeSession.id} onClose={() => setToolPathsOpen(false)} />
      <GoStudioLanguageServerLog open={lspLogOpen} sessionId={activeSession.id} onClose={() => setLspLogOpen(false)} />
      <UnsavedChangesDialog open={!!closeFlow.pending} documents={closeFlow.pending?.documents ?? []} onSave={() => closeFlow.settle(true)} onDiscard={() => closeFlow.settle(false)} onCancel={closeFlow.cancel} />
    </div>
  )
}

/** Run with Race Detector: la configurazione attiva più -race, una volta sola. I segreti non vengono richiesti. */
function withRaceDetector<T extends { goArguments?: string[] }>(request: T): T {
  const goArguments = request.goArguments ?? []
  return goArguments.includes('-race') ? request : { ...request, goArguments: [...goArguments, '-race'] }
}

const LINT_ON_SAVE_DEBOUNCE_MS = 800
let lintOnSaveTimer: ReturnType<typeof setTimeout> | null = null

/** Salvataggi ravvicinati producono un solo lint; quello in corso viene annullato dal successivo. */
function scheduleLintOnSave(sessionId: string): void {
  if (lintOnSaveTimer) clearTimeout(lintOnSaveTimer)
  lintOnSaveTimer = setTimeout(() => void useGoIDELspStore.getState().runLint(sessionId), LINT_ON_SAVE_DEBOUNCE_MS)
}

function NoticeBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div role="status" className="flex shrink-0 items-center gap-2 border-b border-accent/25 bg-accent/10 px-3 py-1.5 text-[11px] text-text-2"><span className="flex-1 whitespace-pre-wrap">{message}</span><button type="button" onClick={onClose} title="Dismiss" className="grid h-5 w-5 place-items-center rounded text-text-3 hover:bg-accent/10"><X size={12} /></button></div>
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger"><AlertTriangle size={13} /><span className="flex-1 whitespace-pre-wrap">{message}</span><button type="button" onClick={onClose} title="Dismiss error" className="grid h-5 w-5 place-items-center rounded hover:bg-danger/10"><X size={12} /></button></div>
}

/** In Zen Mode l'unica chrome: una pillola discreta in basso che compare al passaggio del mouse. */
function ZenExit({ onExit }: { onExit: () => void }) {
  return (
    <div className="group pointer-events-none fixed inset-x-0 bottom-0 z-40 flex h-10 items-end justify-center pb-2">
      <button type="button" onClick={onExit} className="pointer-events-auto rounded-full border border-border-2 bg-surface-1/95 px-3 py-1 text-[11px] text-text-3 opacity-0 shadow-lg transition-opacity duration-150 hover:text-text-1 focus-visible:opacity-100 group-hover:opacity-100">
        Exit Zen Mode · Alt+Shift+Z
      </button>
    </div>
  )
}

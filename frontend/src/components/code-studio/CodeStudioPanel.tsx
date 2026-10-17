import { useActivityScope } from '@/hooks/useActivity'
import { CODE_STUDIO_USED_KEY } from './CodeStudioWarmup'
import { heavyFeatureEnabled } from './codeStudioResourceMode'
import { startStudioToolOwner } from './studioToolBridge'
import { restartRunsOnSave } from './codeStudioRunOnSave'
import { pinnedFirst } from '@/lib/code-studio/codeStudioRunHistory'
import { devServerPreviewRequest, hasWebAppToPreview } from '@/lib/code-studio/runPreview'
import { projectProfile } from '@/lib/code-studio/projectProfile'
import { useLivePreviewStore } from '@/stores/livePreview'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { CodeStudioEmptyState } from './CodeStudioEmptyState'
import { CreateProjectDialog, UnsavedChangesDialog } from './CodeStudioDialogs'
import { CodeStudioWindowControls, useCodeStudioTitlebar } from './CodeStudioTitlebar'
import { DEFAULT_RUN_DRAFT, runRequest } from './codeStudioRunDraft'
import { ToolchainDialog } from './CodeStudioToolchains'
import { CodeStudioDependencies } from './CodeStudioDependencies'
import { CodeStudioDependencyGraph } from './CodeStudioDependencyGraph'
import { CodeStudioADRLinks } from './CodeStudioADRLinks'
import { CodeStudioRuntimeEnrichment } from './CodeStudioRuntimeEnrichment'
import { ConflictResolverDialog } from '@/components/workspace/git/ConflictResolverDialog'
import { CodeStudioQuickOpen } from './CodeStudioQuickOpen'
import { CodeStudioFilePicker } from './CodeStudioFilePicker'
import { CodeStudioRecoveryBanner } from './CodeStudioRecoveryBanner'
import { CodeStudioCrashRecoveryDialog } from './CodeStudioCrashRecoveryDialog'
import { CodeStudioSettingsDialog } from './CodeStudioSettingsDialog'
import { CodeStudioRunConfigurations } from './CodeStudioRunConfigurations'
import { CodeStudioSecretsPrompt } from './CodeStudioSecretsPrompt'
import { CodeStudioHierarchyDialog } from './CodeStudioHierarchyDialog'
import { CodeStudioGoWorkDialog } from './CodeStudioGoWorkDialog'
import { CodeStudioCloneDialog } from './CodeStudioCloneDialog'
import { CodeStudioGenerateMenu } from './CodeStudioGenerateMenu'
import { useAppStore } from '@/stores/app'
import { CodeStudioToolbar } from './CodeStudioToolbar'
import { CodeStudioElsewhere } from './CodeStudioElsewhere'
import { useCodeStudioWindowsStore } from '@/stores/codeStudioWindows'
import { closeGoIDESessionWindow } from '@/lib/code-studio-window-api'
import { CodeStudioWorkspace } from './CodeStudioWorkspace'
import { CodeStudioMenuBar, type CodeStudioCommandState } from './CodeStudioMenuBar'
import { CodeStudioWorkspaceSwitcher } from './CodeStudioWorkspaceSwitcher'
// Font sans della UI di Code Studio, locale via @fontsource: il codice resta sul font mono dell'utente.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
// Font mono di codice, console e terminale (primo in --font-mono): locale e caricato solo con Code Studio.
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './codeStudioChrome.css'
import { CodeStudioCopilotDialog } from './CodeStudioCopilotDialog'
import { CodeStudioMilkDialog } from './CodeStudioMilkDialog'
import { CodeStudioOpenCodeDialog } from './CodeStudioOpenCode'
import { CodeStudioClaudeDialog } from './CodeStudioClaudeCode'
import { useCodeStudioCopilot } from './useCodeStudioCopilot'
import { useCopilotStore } from '@/stores/copilot'
import { useAgentReviewStore } from '@/stores/codeStudioAgentReview'
import { useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import { CodeStudioShortcutsDialog } from './CodeStudioShortcutsDialog'
import { commandAvailability, commandChecked, commandsForKey, isStaleEditorKey, type CodeStudioCommandContext, type CodeStudioCommandId } from './codeStudioCommands'
import { activeWhenContext } from '@/stores/codeStudioWhenContext'
import { useCodeStudioProjectSettings } from '@/stores/codeStudioProjectSettings'
import { activeCodeStudioEditor, hasCodeStudioEditor, subscribeCodeStudioEditor, isCodeStudioEditorCommand, runCodeStudioEditorCommand } from './codeStudioEditorRegistry'
import { CodeStudioStatusBar } from './CodeStudioStatusBar'
import { CodeStudioSymbolSearch } from './CodeStudioSymbolSearch'
import { CodeStudioChangePreviewDialog, CodeStudioRenameDialog } from './CodeStudioRefactorDialogs'
import { CodeStudioLanguageServerLog } from './CodeStudioLanguageServerLog'
import { CodeStudioActivityBar } from './CodeStudioActivityBar'
import { CodeStudioToolPathsDialog } from './CodeStudioToolPathsDialog'
import { runLanguageCommand } from './codeStudioLanguageCommands'
import { runPreviewCommand } from './codeStudioPreviewCommands'
import { isWebOnlyProject } from '@/lib/code-studio/livePreview'
import { runSaveActions } from './codeStudioSaveActions'
import { contextRunTarget, runCommandFor, type CodeStudioGoRunTarget, type CodeStudioRunTarget } from './codeStudioRunTargets'
import { isToolTarget, toolConfigurationDraft, toolRunRequest } from './codeStudioToolTargets'
import { isJavaTarget, javaTestRequest } from './codeStudioJavaTargets'
import { startJavaMain } from '@/lib/code-studio-debug-api'
import { listGoIDERunTargets, type GoIDERunConfiguration, type GoIDERunTarget } from '@/lib/code-studio-api'
import { useCodeStudioCloseFlow } from './useCodeStudioCloseFlow'
import { CodeStudioCaretPopup } from './CodeStudioCaretPopup'
import { CodeStudioInlineAssistantPopup } from './CodeStudioInlineAssistantPopup'
import { CodeStudioImplementInterfaceDialog } from './CodeStudioImplementInterfaceDialog'
import { CodeStudioChangeSignatureDialog } from './CodeStudioChangeSignatureDialog'
import { CodeStudioMoveSymbolDialog } from './CodeStudioMoveSymbolDialog'
import { CodeStudioSearchEverywhere } from './CodeStudioSearchEverywhere'
import { createDoubleShiftDetector } from './codeStudioSearchRanking'
import { rememberCommand } from './codeStudioSearchExtras'
import { runCodeStudioBenchmarks, runCodeStudioChangedTests, runCodeStudioQuickCommand, runModuleDependencyAction, targetScope } from './codeStudioQuickActions'
import { flushBufferRecovery } from '@/lib/code-studio/codeStudioRecovery'
import { cancelAutoSave, scheduleAutoSave, setAutoSaveDelay, setAutoSaveHandler } from '@/lib/code-studio/codeStudioAutoSave'
import { useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { debugRequestForTarget, fuzzRunRequestForTarget, testRequestForTarget } from './codeStudioQuickActions'
import { runDebugCommand, selectDebugState } from './codeStudioDebugCommands'
import { CodeStudioRunTargetMenu, type CodeStudioRunTargetAction } from './CodeStudioRunTargetMenu'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { bookmarksFor, historyFor, useCodeStudioNavigationStore } from '@/stores/codeStudioNavigation'
import { runNavigationCommand } from './codeStudioNavigationEditor'
import { CodeStudioBookmarksDialog } from './CodeStudioBookmarksDialog'
import { CodeStudioQualityDialog } from './CodeStudioQualityDialog'
import { CodeStudioBranchWidget } from './CodeStudioBranchWidget'
import { CodeStudioCommitDialog } from './CodeStudioCommitDialog'
import { CodeStudioGitHistoryDialog } from './CodeStudioGitHistoryDialog'
import { CodeStudioProjectServicesDialog } from './CodeStudioProjectServicesDialog'
import { runIntegrationCommand } from './codeStudioIntegrationCommands'
import { CodeStudioHunkPopup } from './CodeStudioHunkPopup'
import { CodeStudioAgentReviewDialog } from './CodeStudioAgentReviewDialog'
import { CodeStudioBreakpointPopover } from './CodeStudioBreakpointPopover'
import { CodeStudioBreakpointsDialog } from './CodeStudioBreakpointsDialog'
import { runVcsCommand, type CodeStudioVcsDialog } from './codeStudioVcsCommands'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { CodeStudioLocalHistoryDialog } from './CodeStudioLocalHistoryDialog'
import { CodeStudioAttachDialog, type CodeStudioAttachMode } from './CodeStudioAttachDialog'
import { CodeStudioExtensionsDialog } from './CodeStudioExtensionsDialog'
import { useCodeStudioRemoteHandoff } from './useCodeStudioRemoteHandoff'
import { useCodeStudioRuntimeContextHandoff } from './useCodeStudioRuntimeContext'
import { CodeStudioGoToolDialog, type CodeStudioGoToolDialogState } from './CodeStudioGoToolDialog'
import { goToolDialogFor } from './codeStudioGoToolCommands'
import {
  activeWorkspaceRunIds,
  composeConfigurationForDetectedFile,
  composeConfigurationForFile,
  detectedComposeFiles,
  detectedGoServices,
  requiredSecretKeysForRun,
  serviceConfigurationForDetectedDirectory,
  serviceConfigurationForDirectory,
  workspaceStartConfiguration,
  workspaceStartDraft,
  declaredWorkspacePorts,
  workspacePortConflicts,
  detectedWorkspaceTasks,
  isRunnableTask,
  taskConfiguration,
  taskConfigurationForDetected,
} from './codeStudioWorkspaceStart'
import * as DevContextBindings from '../../../bindings/adomnia/devcontext'
import { ListLocalPorts } from '../../../bindings/adomnia/devsession'
import { CodeStudioWorkspaceBar } from './CodeStudioWorkspaceBar'
import { CodeStudioToasts } from './CodeStudioToasts'
import { CodeStudioSnapshots, useSnapshotsDrawer } from './CodeStudioSnapshots'
import { CodeStudioStartupAnalyzer, useStartupDrawer } from './CodeStudioStartupAnalyzer'
import { openWorkspaceApi, openWorkspaceLogs } from '@/lib/devsession/workspaceFlow'
import { clampPaneSize, DEFAULT_PANE_SIZES, type GoIDEPaneSizeKey, type PaneBounds } from '@/lib/codeStudioLayout'
import type { ResizeHandleInteraction } from '@/components/ui/ResizeHandle'
import type { GoIDEDebugRequest, GoIDEJavaDebugRequest } from '@/lib/code-studio-debug-api'
import { javaDebugTargetOf } from '@/lib/code-studio/javaDebug'
import { confirm } from '@/lib/confirmDialog'
import { useShallow } from 'zustand/react/shallow'
import { activeGoIDEDocument, dirtyGoIDEDocuments, sessionsInWorkspace, useCodeStudioStore, type GoIDEEditorDocument, type GoIDEState } from '@/stores/codeStudio'
import { useCodeStudioCursorStore } from './codeStudioCursor'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { usePanelVisible, usePanelActiveRef } from '@/components/layout/PanelActivity'
import type { GoDebugStartDetail } from '@/lib/devsession/debugRequest'
import { CodeStudioRunTargetPicker } from './CodeStudioRunTargetPicker'
import { configurationForRunTarget, preferredRunTarget } from './codeStudioDiscoveredRunTargets'


const PANEL_STATE_KEYS = [
  'activeSessionId', 'capabilities', 'activeWorkspaceId', 'layout', 'sessions', 'error', 'recentProjects', 'loading', 'initialized', 'toolchains', 'splitBySession', 'showIgnoredBySession',
  'runConfigsBySession', 'executions', 'closedDocuments', 'activeRunBySession', 'activeConfigBySession',
  'updateLayout', 'toggleEditorMaximized', 'openProject', 'startRun', 'startConfiguredRun', 'startConfiguredBuild', 'saveRunConfiguration', 'setSplit', 'detectToolchain', 'stopRun', 'initialize', 'clearError',
  'toggleShowIgnored', 'togglePinned', 'setToolAuthorization', 'setQuickOpen', 'selectSession', 'selectRunConfiguration', 'restartRun',
  'reopenClosedDocument', 'removeRecentProject',
] as const satisfies ReadonlyArray<keyof GoIDEState>

type PanelState = Pick<GoIDEState, (typeof PANEL_STATE_KEYS)[number]>

/** Solo i campi usati dal pannello: buffer, console e ricerche non devono ridisegnare l'intero IDE. */
function selectPanelState(state: GoIDEState): PanelState {
  return Object.fromEntries(PANEL_STATE_KEYS.map((key) => [key, state[key]])) as PanelState
}

/** Riassunto primitivo dei documenti: cambia solo quando cambia il file attivo o lo stato dirty, non a ogni tasto. */
/** Separatore di riga mostrato in status bar, come in IntelliJ. */
function lineEndingOf(buffer: string): 'LF' | 'CRLF' {
  return buffer.includes('\r\n') ? 'CRLF' : 'LF'
}

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
    activeLineEnding: active ? lineEndingOf(active.buffer) : null,
    activeDirty: !!active?.dirty,
    documentCount,
    sessionDirty,
  }
}

function currentSessionDocuments(sessionId: string | undefined) {
  return useCodeStudioStore.getState().documents.filter((item) => item.document.sessionId === sessionId)
}

function currentActiveDocument() {
  return activeGoIDEDocument(useCodeStudioStore.getState())
}

export function CodeStudioPanel() {
  // Kept mounted while hidden: its shortcuts must not fire from other tools.
  const panelActive = usePanelActiveRef()
  const store = useCodeStudioStore(useShallow(selectPanelState))
  useActivityScope(store.activeSessionId ? `code-studio:${store.activeSessionId}` : null, usePanelVisible())
  const summary = useCodeStudioStore(useShallow(selectDocumentSummary))
  const setCursor = useCodeStudioCursorStore((state) => state.setCursor)
  const [createOpen, setCreateOpen] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [goWorkOpen, setGoWorkOpen] = useState(false)
  const codeStudioMaximized = useAppStore((state) => state.codeStudioMaximized)
  const titlebar = useCodeStudioTitlebar()
  const toggleCodeStudioMaximized = useAppStore((state) => state.toggleCodeStudioMaximized)
  const zen = useAppStore((state) => state.codeStudioZen)
  const setZen = useAppStore((state) => state.setCodeStudioZen)
  // Zen Mode: nasconde la chrome di Code Studio e chiude i pannelli; all'uscita li ripristina com'erano.
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
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [dependencyGraphOpen, setDependencyGraphOpen] = useState(false)
  const [adrLinksOpen, setADRLinksOpen] = useState(false)
  const [runtimeEnrichmentOpen, setRuntimeEnrichmentOpen] = useState(false)
  const [runDraft] = useState(DEFAULT_RUN_DRAFT)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false)
  const [searchEverywhereOpen, setSearchEverywhereOpen] = useState(false)
  const [lspLogOpen, setLspLogOpen] = useState(false)
  const [toolPathsOpen, setToolPathsOpen] = useState(false)
  const lsp = useCodeStudioLspStore(useShallow((state) => {
    const sessionId = store.activeSessionId ?? ''
    return {
      preferences: state.preferences, settings: state.settings, message: state.message, start: state.start, clearMessage: state.clearMessage,
      statusInfo: state.status[sessionId], goplsInfo: state.gopls[sessionId], linterInfo: state.linter[sessionId], linting: !!state.lint[sessionId]?.running,
    }
  }))
  const windows = useCodeStudioWindowsStore(useShallow((state) => ({ context: state.context, owners: state.owners, error: state.error, clearError: state.clearError })))
  const pinnedSessionId = windows.context.pinnedSessionId
  // Una finestra separata mostra soltanto il proprio progetto, di qualunque workspace sia.
  const workspaceSessions = useMemo(() => pinnedSessionId
    ? store.sessions.filter((session) => session.id === pinnedSessionId)
    : sessionsInWorkspace(store.sessions, store.activeWorkspaceId), [pinnedSessionId, store.activeWorkspaceId, store.sessions])
  const activeSession = useMemo(() => store.sessions.find((session) => session.id === store.activeSessionId) ?? null, [store.activeSessionId, store.sessions])
  useCodeStudioCopilot(activeSession?.project.realPath ?? null, summary.activeId)
  const closeFlow = useCodeStudioCloseFlow(activeSession)
  const sessionExecutions = store.executions.filter((execution) => execution.sessionId === store.activeSessionId)
  const activeRunId = store.activeSessionId ? store.activeRunBySession[store.activeSessionId] : null
  const activeExecution = sessionExecutions.find((execution) => execution.id === activeRunId) ?? sessionExecutions[sessionExecutions.length - 1] ?? null
  const editorMounted = useSyncExternalStore(subscribeCodeStudioEditor, hasCodeStudioEditor)
  const workspaceRunIds = activeSession ? activeWorkspaceRunIds(sessionExecutions, activeSession.id) : []
  const toolchain = store.activeSessionId ? store.toolchains[store.activeSessionId] ?? null : null
  const runConfigurations = pinnedFirst(store.activeSessionId ? store.runConfigsBySession[store.activeSessionId] ?? [] : [])
  const activeConfigId = store.activeSessionId ? store.activeConfigBySession[store.activeSessionId] ?? null : null
  const activeConfig = runConfigurations.find((config) => config.id === activeConfigId) ?? null
  const [pendingSecrets, setPendingSecrets] = useState<{ config: GoIDERunConfiguration; keys: string[] } | null>(null)
  const workspaceStartPending = useRef(false)
  const [runTargetMenu, setRunTargetMenu] = useState<{ target: CodeStudioRunTarget; x: number; y: number } | null>(null)
  const [runTargetChoice, setRunTargetChoice] = useState<{ targets: GoIDERunTarget[]; kind: 'build' | 'run' } | null>(null)
  const debugState = useCodeStudioDebugStore(selectDebugState(store.activeSessionId))
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [locationsMode, setLocationsMode] = useState<'bookmarks' | 'recent'>('bookmarks')
  const [goTool, setGoTool] = useState<CodeStudioGoToolDialogState | null>(null)
  const [attachMode, setAttachMode] = useState<CodeStudioAttachMode | null>(null)
  const [localHistoryOpen, setLocalHistoryOpen] = useState(false)
  const [vcsDialog, setVcsDialog] = useState<CodeStudioVcsDialog>(null)
  const [servicesOpen, setServicesOpen] = useState(false)
  const vcs = useCodeStudioVCSStore(useShallow((state) => {
    const status = state.status[store.activeSessionId ?? '']
    return { vcsAvailable: !!status?.available, vcsChanges: status?.changes.length ?? 0, vcsConflicts: status?.changes.filter((change) => change.conflicted).length ?? 0, vcsRepoRoot: status?.repoRoot ?? '' }
  }))
  const navigation = useCodeStudioNavigationStore(useShallow((state) => {
    const history = historyFor(state, store.activeSessionId ?? '')
    return { canGoBack: history.index > 0, canGoForward: history.index < history.entries.length - 1, bookmarkCount: bookmarksFor(state, store.activeSessionId ?? '').length }
  }))

  useEffect(() => { void store.initialize() }, [store.initialize])
  useEffect(() => { startStudioToolOwner() }, [])
  useEffect(() => { try { localStorage.setItem(CODE_STUDIO_USED_KEY, '1') } catch { /* storage non disponibile: niente warm-up */ } }, [])
  useEffect(() => { void useCodeStudioWindowsStore.getState().load() }, [])

  // Progetti già autorizzati: rileva l'SDK e avvia gopls senza clic extra; quelli non autorizzati restano inerti.
  const activeSessionId = activeSession?.id ?? null
  const activeSessionTrusted = activeSession?.project.authorization === 'tooling-permitted'
  useEffect(() => {
    if (!activeSessionId || !activeSessionTrusted) return
    void (async () => {
      if (!useCodeStudioStore.getState().toolchains[activeSessionId]) await useCodeStudioStore.getState().detectToolchain()
      await useCodeStudioLspStore.getState().ensureStarted(activeSessionId)
    })()
  }, [activeSessionId, activeSessionTrusted])

  // Le scorciatoie restano attive solo mentre il pannello è montato e hanno la precedenza su quelle globali.
  const runCommandRef = useRef<(id: CodeStudioCommandId) => void>(() => undefined)
  // Stabile per i figli memoizzati (albero del progetto): chiama sempre la versione corrente di runCommand.
  const runCommandStable = useCallback((id: CodeStudioCommandId) => runCommandRef.current(id), [])
  const availabilityRef = useRef<(id: CodeStudioCommandId) => true | string>(() => true)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!panelActive.current) return
      // Il dialog Scorciatoie sta registrando un tasto: va a lui, non ai comandi.
      if ((event.target as HTMLElement | null)?.closest?.('[data-keymap-recorder]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.altKey && !event.shiftKey
        && !(event.target as HTMLElement | null)?.closest?.('[role="dialog"], .xterm')) {
        event.preventDefault()
        event.stopPropagation()
        useCodeStudioLspStore.getState().requestFind('')
        return
      }
      // Più comandi possono condividere un tasto (es. F5 di VS Code): vince il primo disponibile.
      // Il contesto `when` (editor, input, vim.normal…) filtra i binding condizionati della keymap.
      const when = activeWhenContext(event.target as HTMLElement | null)
      const candidates = commandsForKey(event, when)
      const command = candidates.find((item) => availabilityRef.current(item.id) === true) ?? candidates[0]
      if (!command) {
        // Tasto predefinito di un'azione dell'editor rimappata altrove: non deve più eseguirla.
        if (isStaleEditorKey(event, when)) { event.preventDefault(); event.stopPropagation() }
        return
      }
      if (command.passThroughWhenUnavailable && availabilityRef.current(command.id) !== true) return
      event.preventDefault()
      if (command.editorOwned) event.stopPropagation()
      runCommandRef.current(command.id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Impostazioni di progetto (`.adomnia/settings.json`): caricate per la sessione attiva; il
  // file si modifica nell'editor e il buffer aperto viene ricaricato da `useProjectSettings`.
  useEffect(() => {
    if (activeSessionId) void useCodeStudioProjectSettings.getState().refresh(activeSessionId)
  }, [activeSessionId])

  // Comandi chiesti da fuori del pannello (es. il rilancio dopo un crash): passano dallo stesso flusso dei menu.
  useEffect(() => {
    const onCommand = (event: Event) => runCommandRef.current((event as CustomEvent<CodeStudioCommandId>).detail)
    document.addEventListener('adomnia:code-studio-command', onCommand)
    return () => document.removeEventListener('adomnia:code-studio-command', onCommand)
  }, [])

  // Pod e servizi remoti (Kubernetes Studio): debug, profilo e trace attraverso un port forward.
  useCodeStudioRemoteHandoff()
  useCodeStudioRuntimeContextHandoff()

  // Debug Request dall'API Workspace: avvia la configurazione Debug attiva del progetto indicato.
  useEffect(() => {
    const onDebugStart = (event: Event) => {
      const detail = (event as CustomEvent<GoDebugStartDetail>).detail
      detail.handled = true
      void (async () => {
        try {
          const store = useCodeStudioStore.getState()
          if (!store.sessions.some((session) => session.id === detail.goSessionId)) return detail.done?.('The project is no longer open in Code Studio.')
          if (store.activeSessionId !== detail.goSessionId) await store.selectSession(detail.goSessionId)
          await new Promise((resolve) => setTimeout(resolve, 60)) // i comandi leggono la sessione appena selezionata
          const command = detail.command ?? 'debug.debug'
          const availability = availabilityRef.current(command)
          if (availability !== true) return detail.done?.(availability)
          runCommandRef.current(command)
          detail.done?.()
        } catch (error) {
          detail.done?.(error instanceof Error ? error.message : String(error))
        }
      })()
    }
    document.addEventListener('adomnia:go-debug-start', onDebugStart)
    return () => document.removeEventListener('adomnia:go-debug-start', onDebugStart)
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

  const startDiscoveredTarget = useCallback(async (target: GoIDERunTarget, kind: 'build' | 'run') => {
    if (!activeSession) return
    const config = configurationForRunTarget(activeSession, target)
    if (!config) {
      useCodeStudioStore.setState({ error: 'The selected main package is outside the project.' })
      return
    }
    const saved = await store.saveRunConfiguration(config)
    if (!saved) return
    if (kind === 'build') await store.startConfiguredBuild(saved.id)
    else await store.startConfiguredRun(saved.id, {})
  }, [activeSession, store.saveRunConfiguration, store.startConfiguredBuild, store.startConfiguredRun])

  // ▶ senza configurazione in un progetto solo web: Live Preview se c'è un'app da mostrare, altrimenti il gestore Run.
  const goLiveOrConfigure = useCallback(async (sessionId: string) => {
    const report = await useLivePreviewStore.getState().load(sessionId)
    if (hasWebAppToPreview(report)) runPreviewCommand('preview.goLive', sessionId)
    else setConfigureOpen(true)
  }, [])

  const startConfigured = useCallback(async (kind: 'build' | 'run') => {
    // Variabili d'ambiente e build arg segreti: stesso nome, stesso valore richiesto una sola volta.
    const secretKeys = requiredSecretKeysForRun(activeConfig, runConfigurations)
    if (kind === 'run' && activeConfig && secretKeys.length > 0) {
      setPendingSecrets({ config: activeConfig, keys: secretKeys })
      return
    }
    if (kind === 'run' && activeConfig) {
      // Lo script dev di un'app Node vive nella Live Preview (URL, prontezza, proxy): niente secondo processo.
      const previews = useLivePreviewStore.getState()
      const sessionId = activeSession?.id
      const report = sessionId ? await previews.load(sessionId) : null
      const previewRequest = sessionId ? devServerPreviewRequest(activeConfig, report) : null
      if (sessionId && previewRequest) {
        previews.show(sessionId)
        await previews.goLive(sessionId, previewRequest)
        return
      }
      void store.startConfiguredRun(activeConfig.id, {})
      return
    }
    // La build di una configurazione salvata passa dal backend: GOOS/GOARCH, env file, race e tag inclusi.
    if (kind === 'build' && activeConfig && (activeConfig.kind === 'package' || activeConfig.kind === 'build')) {
      await store.startConfiguredBuild(activeConfig.id)
      return
    }
    // Senza moduli Go non c'è un "main package" da cercare: si apre il gestore, dove compaiono le proposte rilevate.
    if (!activeConfig && activeSession && !projectProfile(activeSession.project).hasGo) {
      setConfigureOpen(true)
      return
    }
    if (!activeConfig && activeSession) {
      try {
        const targets = await listGoIDERunTargets(activeSession.id)
        if (targets.length === 0) {
          useCodeStudioStore.setState({ error: `No main package found under ${activeSession.project.rootPath}` })
          return
        }
        const active = activeGoIDEDocument(useCodeStudioStore.getState())
        const preferred = preferredRunTarget(activeSession, targets, active?.document.relativePath ?? null)
        if (preferred) await startDiscoveredTarget(preferred, kind)
        else setRunTargetChoice({ targets, kind })
      } catch (error) {
        useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    await store.startRun(kind, configuredRequest())
  }, [activeConfig, activeSession, configuredRequest, runConfigurations, startDiscoveredTarget, store.startConfiguredRun, store.startConfiguredBuild, store.startRun])

  // Detect ports: before starting, a port the workspace binds that another process already holds.
  const portsAreFree = useCallback(async (workspace: GoIDERunConfiguration, configs: readonly GoIDERunConfiguration[], entities?: Parameters<typeof declaredWorkspacePorts>[0]) => {
    try {
      const ids = new Set(workspace.compound ?? [])
      const members = configs.filter((config) => ids.has(config.id))
      const known = entities ?? (await DevContextBindings.GetContext(workspace.sessionId)).entities
      const conflicts = workspacePortConflicts(declaredWorkspacePorts(known, members), (await ListLocalPorts()) ?? [])
      if (conflicts.length === 0) return true
      const start = await confirm({
        title: conflicts.length === 1 ? `Port ${conflicts[0].port} is already in use` : `${conflicts.length} ports are already in use`,
        message: 'Another process holds ports this workspace binds: the services that need them will fail to start.',
        details: conflicts.map((conflict) => ({ label: `:${conflict.port}`, value: `${conflict.declaredBy} ← ${conflict.process || 'unknown process'}${conflict.pid ? ` (PID ${conflict.pid})` : ''}` })),
        confirmLabel: 'Start anyway',
      })
      if (!start) useCodeStudioLspStore.setState({ message: `Start workspace cancelled: free port ${conflicts.map((conflict) => conflict.port).join(', ')} first.` })
      return start
    } catch {
      return true // ponytail: port listing unavailable (netstat/ss missing) must not block the start
    }
  }, [])

  const startWorkspace = useCallback(async () => {
    if (!activeSession || workspaceStartPending.current) return
    const workspaceConfig = workspaceStartConfiguration(runConfigurations)
    if (workspaceConfig) {
      if (!await portsAreFree(workspaceConfig, runConfigurations)) return
      const secretKeys = requiredSecretKeysForRun(workspaceConfig, runConfigurations)
      if (secretKeys.length > 0) {
        setPendingSecrets({ config: workspaceConfig, keys: secretKeys })
        return
      }
      void store.startConfiguredRun(workspaceConfig.id, {})
      return
    }

    workspaceStartPending.current = true
    useCodeStudioLspStore.setState({ message: 'Detecting local containers from Compose files…' })
    try {
      const snapshot = await DevContextBindings.GetContext(activeSession.id)
      const files = detectedComposeFiles(snapshot.entities)
      const services = detectedGoServices(snapshot.entities)
      const detectedTasks = detectedWorkspaceTasks(snapshot.entities)
      const runnableTasks = detectedTasks.filter(isRunnableTask)
      const manualTasks = detectedTasks.filter((task) => !isRunnableTask(task))
      if (files.length === 0 && services.length === 0) {
        openConfigurations(workspaceStartDraft(activeSession.id))
        useCodeStudioLspStore.setState({ message: 'No Compose stack or Go service detected. Add containers, services or migrations to the Start workspace compound, then run it again.' })
        return
      }

      const members: GoIDERunConfiguration[] = []
      for (const file of files) {
        const existing = composeConfigurationForDetectedFile(runConfigurations, file)
        const config = existing ?? await useCodeStudioStore.getState().saveRunConfiguration(composeConfigurationForFile(activeSession.id, file))
        if (!config) throw new Error(`Could not save the Compose configuration for ${file}`)
        members.push(config)
      }
      for (const service of services) {
        const existing = serviceConfigurationForDetectedDirectory(runConfigurations, service.directory, activeSession)
        const config = existing ?? await useCodeStudioStore.getState().saveRunConfiguration(serviceConfigurationForDirectory(activeSession.id, service, activeSession))
        if (!config) throw new Error(`Could not save the service configuration for ${service.name}`)
        members.push(config)
      }
      // Migrations and seed data run after the containers are ready and before the services.
      const tasks: GoIDERunConfiguration[] = []
      for (const task of runnableTasks) {
        const existing = taskConfigurationForDetected(runConfigurations, task)
        const config = existing ?? await useCodeStudioStore.getState().saveRunConfiguration(taskConfiguration(activeSession.id, task))
        if (!config) throw new Error(`Could not save the ${task.role} task ${task.name}`)
        tasks.push(config)
      }
      const savedWorkspace = await useCodeStudioStore.getState().saveRunConfiguration(workspaceStartDraft(activeSession.id, members.map((config) => config.id), tasks.map((config) => config.id)))
      if (!savedWorkspace) throw new Error('Could not save the Start workspace configuration')
      if (manualTasks.length > 0) {
        useCodeStudioLspStore.setState({ message: `SQL migrations found in ${manualTasks.map((task) => `${task.path} (${task.runner})`).join(', ')}: add a Command task with your tool and DSN to Start workspace.` })
      }
      if (!await portsAreFree(savedWorkspace, members, snapshot.entities)) return
      const secretKeys = requiredSecretKeysForRun(savedWorkspace, [...runConfigurations, ...members, ...tasks, savedWorkspace])
      if (secretKeys.length > 0) {
        setPendingSecrets({ config: savedWorkspace, keys: secretKeys })
        useCodeStudioLspStore.setState({ message: `Detected ${files.length} Compose ${files.length === 1 ? 'stack' : 'stacks'} and ${services.length} Go ${services.length === 1 ? 'service' : 'services'}. Provide runtime secrets to start.` })
        return
      }
      useCodeStudioLspStore.setState({ message: `Starting ${files.length} Compose ${files.length === 1 ? 'stack' : 'stacks'} and ${services.length} Go ${services.length === 1 ? 'service' : 'services'}…` })
      void useCodeStudioStore.getState().startConfiguredRun(savedWorkspace.id, {})
    } catch (error) {
      openConfigurations(workspaceStartDraft(activeSession.id))
      useCodeStudioLspStore.setState({ message: `Compose detection failed: ${error instanceof Error ? error.message : String(error)}. Configure Start workspace manually.` })
    } finally {
      workspaceStartPending.current = false
    }
  }, [activeSession, runConfigurations, store.startConfiguredRun, portsAreFree])

  // Clean workspace: ferma i run del workspace e smonta i container Compose; i volumi solo se confermato.
  const cleanWorkspace = useCallback(async () => {
    if (!activeSession) return
    const sessionId = activeSession.id
    let files: string[]
    try {
      files = detectedComposeFiles((await DevContextBindings.GetContext(sessionId)).entities)
    } catch (error) {
      useCodeStudioLspStore.setState({ message: `Compose detection failed: ${error instanceof Error ? error.message : String(error)}` })
      return
    }
    const ok = await confirm({
      title: 'Clean workspace',
      message: files.length > 0
        ? 'Stop every run of this project and remove its Compose containers and networks?'
        : 'Stop every run of this project? No Compose file was detected.',
      details: files.map((file) => ({ label: 'Compose', value: `docker compose -f ${file} down --remove-orphans`, mono: true })),
      confirmLabel: 'Clean',
      variant: 'danger',
    })
    if (!ok) return
    const volumes = files.length > 0 && await confirm({
      title: 'Delete volumes too?',
      message: 'Removing the Compose volumes deletes local database and broker data. Migrations and seeds recreate it at the next Start Workspace.',
      confirmLabel: 'Delete volumes',
      cancelLabel: 'Keep data',
      variant: 'danger',
    })
    await Promise.all(workspaceRunIds.map((runId) => store.stopRun(runId)))
    for (const file of files) {
      await store.startRun('docker-compose', { target: file, programArguments: ['down', '--remove-orphans', ...(volumes ? ['--volumes'] : [])] })
    }
    useCodeStudioLspStore.setState({ message: files.length > 0 ? `Cleaning ${files.length} Compose ${files.length === 1 ? 'stack' : 'stacks'}${volumes ? ' and volumes' : ''}: output in the Run console.` : 'Workspace runs stopped.' })
  }, [activeSession, workspaceRunIds, store.stopRun, store.startRun])

  const saveDocumentWithActions = async (documentId?: string) => {
    const sessionId = store.activeSessionId
    const id = documentId ?? (sessionId ? useCodeStudioStore.getState().activeDocumentBySession[sessionId] : null)
    if (!id) return false
    await runSaveActions(id)
    const saved = await useCodeStudioStore.getState().saveDocument(id)
    const lspState = useCodeStudioLspStore.getState()
    const savedDocument = useCodeStudioStore.getState().documents.find((item) => item.document.id === id)?.document
    const savedPath = savedDocument?.relativePath ?? ''
    if (saved && sessionId && savedDocument) restartRunsOnSave(sessionId, { relativePath: savedPath, editorLanguage: savedDocument.language })
    if (saved && sessionId && heavyFeatureEnabled(lspState, 'lintOnSave') && lspState.linter[sessionId]?.available) scheduleLintOnSave(sessionId)
    return saved
  }

  const saveAllWithActions = async () => {
    if (!activeSession) return
    const dirty = dirtyGoIDEDocuments(useCodeStudioStore.getState(), activeSession.id)
    for (const document of dirty) if (!await saveDocumentWithActions(document.document.id)) return
  }
  // Save Files on Focus Change: come negli IDE JetBrains, salva quando la finestra va in secondo piano
  // e quando si cambia file. Nessun salvataggio mentre si scrive.
  const autoSave = lsp.preferences.autoSave
  const autoSaveRef = useRef(saveAllWithActions)
  autoSaveRef.current = saveAllWithActions
  const activeDocumentId = useCodeStudioStore((state) => (activeSession ? state.activeDocumentBySession[activeSession.id] ?? null : null))
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
    const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === previous)
    if (document?.dirty) void saveDocumentWithActions(previous)
  }, [activeDocumentId, autoSave]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto save a tempo (come "files.autoSave": "afterDelay" di VS Code): salva quando si smette
  // di scrivere per autoSaveDelayMs. Se un salvataggio è già in corso riprova al prossimo tick
  // invece di sovrapporsi, per non rischiare due scritture con lo stesso diskToken.
  const autoSaveDelayMs = lsp.preferences.autoSaveDelayMs
  useEffect(() => {
    setAutoSaveDelay(autoSaveDelayMs)
    if (!autoSaveDelayMs) return
    setAutoSaveHandler(() => {
      if (useCodeStudioStore.getState().documents.some((item) => item.saving)) {
        scheduleAutoSave()
        return
      }
      void autoSaveRef.current()
    })
    return () => { setAutoSaveHandler(null); cancelAutoSave() }
  }, [autoSaveDelayMs])


  // Doppio Shift apre Search Everywhere solo quando c'è un progetto aperto.
  useEffect(() => {
    if (!activeSessionId) return
    const detect = createDoubleShiftDetector(() => { if (panelActive.current) setSearchEverywhereOpen(true) })
    window.addEventListener('keydown', detect, true)
    return () => window.removeEventListener('keydown', detect, true)
  }, [activeSessionId])

  useEffect(() => {
    const protectDirtyBuffers = (event: BeforeUnloadEvent) => {
      flushBufferRecovery()
      if (!useCodeStudioStore.getState().documents.some((document) => document.dirty)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectDirtyBuffers)
    return () => window.removeEventListener('beforeunload', protectDirtyBuffers)
  }, [])

  // Un solo splitter per i tre pannelli: mouse, frecce da tastiera e doppio click
  // (reset alla dimensione di default) condividono clamp e costanti di lib/codeStudioLayout,
  // le stesse usate dal caricamento del layout salvato.
  const beginResize = useCallback((key: GoIDEPaneSizeKey, direction = 1): ResizeHandleInteraction => {
    const boundsOf = (element: Element | null): PaneBounds => {
      const rect = element?.closest('.grid')?.getBoundingClientRect()
      return {
        width: rect?.width ?? window.innerWidth,
        height: rect?.height ?? window.innerHeight,
        otherWidth: key === 'structureWidth' && store.layout.projectOpen ? store.layout.projectWidth : key === 'projectWidth' && store.layout.structureOpen ? store.layout.structureWidth : 0,
      }
    }
    const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      const horizontal = key === 'bottomHeight'
      const start = horizontal ? event.clientY : event.clientX
      const initial = store.layout[key]
      const bounds = boundsOf(event.currentTarget)
      const onMove = (moveEvent: MouseEvent) => {
        const coordinate = horizontal ? moveEvent.clientY : moveEvent.clientX
        store.updateLayout({ [key]: clampPaneSize(key, initial + (coordinate - start) * direction, bounds) })
      }
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    const onArrow = (delta: number, event: ReactKeyboardEvent<HTMLDivElement>) => {
      store.updateLayout({ [key]: clampPaneSize(key, store.layout[key] + delta * direction, boundsOf(event.currentTarget)) })
    }
    const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
      store.updateLayout({ [key]: clampPaneSize(key, DEFAULT_PANE_SIZES[key], boundsOf(event.currentTarget)) })
    }
    return { onMouseDown, onArrow, onDoubleClick }
  }, [store.updateLayout, store.layout])

  const authorize = async (allowed: boolean) => {
    await store.setToolAuthorization(allowed)
    if (!allowed || !store.activeSessionId) return
    await store.detectToolchain()
    await useCodeStudioLspStore.getState().ensureStarted(store.activeSessionId)
  }

  // Prima apertura di una cartella non fidata: un solo popup. Il "sì" è ricordato dal backend;
  // un "no" vale per la sessione, poi si autorizza da Go → Trust Project Tools.
  const trustAsked = useRef(new Set<string>())
  useEffect(() => {
    if (!activeSession || activeSessionTrusted || trustAsked.current.has(activeSession.id)) return
    trustAsked.current.add(activeSession.id)
    void confirm({
      title: 'Trust this folder?',
      message: `${activeSession.project.rootPath}

Trusting lets Code Studio run gopls, go build, tests, the debugger and the terminal for this project. Only trust code you know. You can still browse and edit files without trusting it.`,
      confirmLabel: 'Trust Folder',
      cancelLabel: 'Browse Only',
    }).then((approved) => { if (approved) void authorize(true) })
  }, [activeSession?.id, activeSessionTrusted])

  const tidy = async () => {
    const approved = await confirm({ title: 'Run go mod tidy?', message: `Command: go mod tidy\nWorking directory: ${runDraft.workingDirectory || activeSession?.project.rootPath || ''}\n\nThis may access the network through your configured Go proxy.`, confirmLabel: 'Run tidy' })
    if (approved) await store.startRun('tidy', runRequest(runDraft))
  }

  const authorized = activeSessionTrusted
  const lspStatus = activeSession ? lsp.statusInfo : undefined
  const commandContext: CodeStudioCommandContext = {
    hasSession: !!activeSession,
    webOnly: !!activeSession && isWebOnlyProject(activeSession.project),
    languages: store.capabilities?.languages,
    documentCount: summary.documentCount,
    hasClosedDocuments: !!activeSession && (store.closedDocuments[activeSession.id]?.length ?? 0) > 0,
    split: !!activeSession && !!store.splitBySession[activeSession.id],
    lspState: (lspStatus?.state || 'stopped') as CodeStudioCommandContext['lspState'],
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
    running: workspaceRunIds.length > 0,
    restartable: !!activeExecution && activeExecution.kind !== 'dependency',
    hasEditor: !!summary.activeId && editorMounted,
    activeDocumentDirty: summary.activeDirty,
    sessionDirty: !!activeSession && summary.sessionDirty,
    detached: !!pinnedSessionId,
    ownedElsewhere: !!activeSession && (windows.owners[activeSession.id] ?? 'main') !== windows.context.windowId,
    structureOpen: store.layout.structureOpen,
    bottomOpen: store.layout.bottomOpen,
    showIgnored: !!activeSession && (store.showIgnoredBySession[activeSession.id] ?? false),
    maximized: codeStudioMaximized,
    zen,
    editorPrefs: {
      resourceMode: lsp.preferences.resourceMode, editorMode: lsp.preferences.editorMode, previewTab: lsp.preferences.previewTab, stickyScroll: lsp.preferences.stickyScroll, fontLigatures: lsp.preferences.fontLigatures,
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
  const commandState: CodeStudioCommandState = {
    availability: (id) => commandAvailability(id, commandContext),
    checked: (id) => commandChecked(id, commandContext),
  }

  availabilityRef.current = (id) => commandAvailability(id, commandContext)

  const runTarget = (target: CodeStudioRunTarget, action: CodeStudioRunTargetAction = 'run') => {
    if (isToolTarget(target)) {
      if (!activeSession) return
      if (action === 'save') return openConfigurations(toolConfigurationDraft(target, activeSession.id))
      if (!commandContext.authorized) return useCodeStudioStore.setState({ error: 'Trust this project to run its Makefile or Dockerfile' })
      const { kind, partial } = toolRunRequest(target, action === 'buildRun' || action === 'build' || action === 'down' ? action : 'run')
      return void store.startRun(kind, partial)
    }
    if (isJavaTarget(target)) {
      if (!activeSession) return
      if (!commandContext.authorized) return useCodeStudioStore.setState({ error: 'Trust this project to run its code' })
      if (target.kind === 'java-test' && action === 'debug') return void useCodeStudioDebugStore.getState().startJava({ sessionId: activeSession.id, testFile: target.relativePath, testMethod: target.name, workingDirectory: '' })
      if (target.kind === 'java-test') return void useCodeStudioTestsStore.getState().start(javaTestRequest(activeSession.id, activeSession.project, target))
      if (action === 'debug') return void useCodeStudioDebugStore.getState().startJava({ sessionId: activeSession.id, mainClass: target.className, workingDirectory: '' })
      useCodeStudioLspStore.getState().showToolWindow('run')
      return void startJavaMain(activeSession.id, target.relativePath, target.className).catch((error: unknown) => useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) }))
    }
    const goTarget: CodeStudioGoRunTarget = target
    const availability = commandAvailability('run.run', commandContext)
    if (availability !== true) return useCodeStudioStore.setState({ error: availability })
    if (!activeSession) return
    if (action === 'debug') return void useCodeStudioDebugStore.getState().start(debugRequestForTarget(activeSession, goTarget))
    if (target.kind === 'fuzz' && action === 'fuzz') return void store.startRun('test', fuzzRunRequestForTarget(activeSession, goTarget))
    if (target.kind !== 'main') {
      void useCodeStudioTestsStore.getState().start(testRequestForTarget(activeSession, goTarget, action === 'coverage'))
      return
    }
    const command = runCommandFor(target)
    const scope = targetScope(activeSession, goTarget)
    void store.startRun(command.kind, { ...runRequest(runDraft), target: scope.packageTarget, workingDirectory: scope.moduleDirectory })
  }

  // Debug (Shift+F9) usa la configurazione Run attiva: stesso package, argomenti, tag e variabili.
  const configuredDebugRequest = (): GoIDEDebugRequest | null => {
    if (!activeSession) return null
    const request = configuredRequest()
    const debugConfig = activeConfig && (activeConfig.kind === 'package' || activeConfig.kind === 'build') ? activeConfig : null
    const environment = debugConfig?.port ? { ...request.environment, PORT: String(debugConfig.port) } : request.environment
    return { sessionId: activeSession.id, mode: 'debug', target: request.target, workingDirectory: request.workingDirectory, programArguments: request.programArguments, buildTags: request.buildTags, environment, envFile: debugConfig?.envFile ?? '', buildFlags: debugConfig?.debugFlags ?? [] }
  }

  // Debug di una configurazione Java: classe main, JVM remota oppure test/Spring Boot con la porta JDWP aperta.
  const configuredJavaDebugRequest = (): GoIDEJavaDebugRequest | null => {
    const target = activeSession && activeConfig ? javaDebugTargetOf(activeConfig) : null
    return target && activeSession ? { sessionId: activeSession.id, ...target } : null
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

  const runCommand = (id: CodeStudioCommandId) => {
    const availability = commandAvailability(id, commandContext)
    if (availability !== true) {
      if (/^(run|nav|code|debug)\./.test(id)) useCodeStudioLspStore.setState({ message: availability })
      return
    }
    // Uso recente per il ranking della palette e la sezione "Recent actions": vale per ogni via.
    rememberCommand(id)
    if (isCodeStudioEditorCommand(id)) { runCodeStudioEditorCommand(id); return }
    if (runLanguageCommand(id, activeSession?.id ?? null)) return
    if (runPreviewCommand(id, activeSession?.id ?? null)) return
    if (runDebugCommand(id, activeSession?.id ?? null, configuredDebugRequest, configuredJavaDebugRequest)) return
    if (id === 'file.localHistory') return setLocalHistoryOpen(true)
    if (runVcsCommand(id, activeSession?.id ?? null, currentActiveDocument(), setVcsDialog)) return
    if (runIntegrationCommand(id, currentActiveDocument(), activeCodeStudioEditor(), () => setServicesOpen(true))) return
    if (id === 'debug.attach' || id === 'debug.remote') return setAttachMode(id === 'debug.attach' ? 'attach' : 'remote')
    const toolDialog = goToolDialogFor(id, activeSession)
    if (toolDialog) return setGoTool(toolDialog)
    if (id === 'code.quality') return void setQualityOpen(true)
    if (runNavigationCommand(id, activeSession?.id ?? null, activeCodeStudioEditor(), (mode) => { setLocationsMode(mode); setBookmarksOpen(true) })) return
    switch (id) {
      case 'file.openProject': return void store.openProject()
      case 'file.newProject': return setCreateOpen(true)
      case 'file.clone': return setCloneOpen(true)
      case 'go.goWork': return setGoWorkOpen(true)
      case 'file.save': return void saveDocumentWithActions()
      case 'file.saveAll': return void saveAllWithActions()
      case 'file.closeEditor': return withActiveDocument((active) => closeFlow.requestCloseDocuments([active]))
      case 'file.closeOthers': return closeFlow.requestCloseDocuments(currentSessionDocuments(activeSession?.id).filter((item) => item.document.id !== summary.activeId && !useCodeStudioStore.getState().pinnedDocuments[item.document.id]))
      case 'file.closeAll': return closeFlow.requestCloseDocuments(currentSessionDocuments(activeSession?.id).filter((item) => !useCodeStudioStore.getState().pinnedDocuments[item.document.id]))
      case 'file.pinTab': return withActiveDocument((active) => store.togglePinned(active.document.id))
      case 'file.reopenClosed': return void store.reopenClosedDocument()
      case 'file.closeProject': return void closeFlow.requestCloseSession()
      case 'window.openInNewWindow': return activeSession ? void useCodeStudioWindowsStore.getState().moveToNewWindow(activeSession.id) : undefined
      case 'window.moveBack': return void closeGoIDESessionWindow(windows.context.windowId)
      case 'view.splitRight': return store.setSplit('right')
      case 'view.splitDown': return store.setSplit('down')
      case 'view.unsplit': return store.setSplit(null)
      case 'view.quickOpen': return store.setQuickOpen(true)
      case 'view.maximize': return toggleCodeStudioMaximized()
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
      case 'run.run': return activeSession && !activeConfig && isWebOnlyProject(activeSession.project) ? void goLiveOrConfigure(activeSession.id) : startConfigured('run')
      case 'run.build': return startConfigured('build')
      case 'run.startWorkspace': return startWorkspace()
      case 'run.stopWorkspace': return void Promise.all(workspaceRunIds.map((runId) => store.stopRun(runId)))
      case 'run.cleanWorkspace': return void cleanWorkspace()
      case 'run.runtimeSnapshots': return useSnapshotsDrawer.getState().setOpen(true)
      case 'run.analyzeStartup': return useStartupDrawer.getState().setOpen(true)
      case 'run.openWorkspaceApi': return void (activeSession && openWorkspaceApi(activeSession.id).catch((error) => useCodeStudioLspStore.setState({ message: `Open API failed: ${error instanceof Error ? error.message : String(error)}` })))
      case 'run.openWorkspaceLogs': return void ((activeSession && openWorkspaceLogs(activeSession.id)) || useCodeStudioLspStore.setState({ message: 'No service of this project is running: Start Workspace or Run first.' }))
      case 'run.stop': return void store.stopRun()
      case 'run.restart': return void store.restartRun()
      case 'run.configure': return setConfigureOpen(true)
      case 'run.buildPackage': return void runCodeStudioQuickCommand('build', 'package')
      case 'run.context': {
        const active = useCodeStudioStore.getState().documents.find((item) => item.document.id === activeDocumentId)
        const target = active ? contextRunTarget(active.document.relativePath, active.buffer, useCodeStudioCursorStore.getState().line) : null
        return target ? runTarget(target) : void runCodeStudioQuickCommand('test', 'package')
      }
      case 'run.testPackage': return void runCodeStudioQuickCommand('test', 'package')
      case 'run.testChanged': return void runCodeStudioChangedTests()
      case 'run.benchPackage': return void runCodeStudioBenchmarks('package')
      case 'run.vetPackage': return void runCodeStudioQuickCommand('vet', 'package')
      case 'run.buildAll': return void runCodeStudioQuickCommand('build', 'module')
      case 'run.testAll': return void runCodeStudioQuickCommand('test', 'module')
      case 'run.vetAll': return void runCodeStudioQuickCommand('vet', 'module')
      case 'run.generateAll': return void runCodeStudioQuickCommand('generate', 'module')
      case 'run.install': return void runCodeStudioQuickCommand('install', 'package')
      case 'run.testCoverage': return void runCodeStudioQuickCommand('test', 'package', undefined, { coverage: true })
      case 'run.testRace': return void runCodeStudioQuickCommand('test', 'package', undefined, { race: true })
      case 'run.runRace': return void store.startRun('run', withRaceDetector(configuredRequest()))
      case 'run.rerunFailedTests': return activeSession ? void useCodeStudioTestsStore.getState().rerunFailed(activeSession.id) : undefined
      case 'go.updateAll': return void runModuleDependencyAction('updateall')
      case 'go.updatePatch': return void runModuleDependencyAction('updatepatch')
      case 'go.modDownload': return void runModuleDependencyAction('download')
      case 'go.modVerify': return void runModuleDependencyAction('verify')
      case 'help.shortcuts': return setShortcutsOpen(true)
      case 'file.settings': return setSettingsOpen(true)
      case 'nav.symbol': return setSymbolSearchOpen(true)
      case 'nav.searchEverywhere': return setSearchEverywhereOpen(true)
      case 'go.lspLog': return setLspLogOpen(true)
      case 'go.toolPaths': return setToolPathsOpen(true)
      case 'tools.copilot': return useCopilotStore.getState().setDialogOpen(true)
      case 'tools.extensions': return setExtensionsOpen(true)
      case 'tools.copilotChat':
      case 'tools.opencodeChat':
      case 'tools.claudeChat':
      case 'tools.milkChat':
      case 'tools.aiHub': {
        // L'hub AI riapre l'ultimo provider scelto; i tre comandi restano alias espliciti.
        const pane = id === 'tools.opencodeChat' ? 'opencode' : id === 'tools.copilotChat' ? 'copilot' : id === 'tools.claudeChat' ? 'claude' : id === 'tools.milkChat' ? 'milk' : useCodeStudioAssistantStore.getState().lastProvider
        useCodeStudioAssistantStore.getState().open(pane)
        return store.updateLayout({ structureOpen: true, structureWidth: Math.max(340, store.layout.structureWidth) })
      }
      case 'tools.reviewAgentChanges': return activeSession ? useAgentReviewStore.getState().open(activeSession.project.realPath) : undefined
      case 'tools.copilotCompletions': return void useCopilotStore.getState().toggleCompletions()
      case 'tools.dependencyGraph': return setDependencyGraphOpen(true)
      case 'tools.adrLinks': return setADRLinksOpen(true)
      case 'tools.runtimeEnrichment': return setRuntimeEnrichmentOpen(true)
    }
  }
  runCommandRef.current = runCommand

  const openRealPaths = new Set(store.sessions.map((session) => session.project.realPath))
  const recentNotOpen = store.recentProjects.filter((project) => !openRealPaths.has(project.realPath))
  const mainMenu = <CodeStudioMenuBar state={commandState} recentProjects={store.recentProjects} openProjectPaths={workspaceSessions.map((session) => session.project.realPath)} onCommand={runCommand} onOpenRecent={(path) => void store.openProject(path)} />
  const menuBar = <div role="toolbar" aria-label="Code Studio toolbar" {...titlebar.props} className={`flex h-12 shrink-0 items-center gap-1 pl-2 ${titlebar.active ? 'code-studio-titlebar' : 'pr-2'}`}>{mainMenu}<span className="flex-1" /><CodeStudioWorkspaceSwitcher /><CodeStudioWindowControls /></div>
  const sharedDialogs = <><CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} /><CodeStudioCloneDialog open={cloneOpen} onClose={() => setCloneOpen(false)} /><CodeStudioShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} /><CodeStudioSettingsDialog open={settingsOpen} sessionId={store.activeSessionId} onCommand={runCommandStable} onClose={() => setSettingsOpen(false)} /></>

  const windowError = windows.error && <ErrorBanner message={windows.error} onClose={windows.clearError} />
  if (!activeSession && pinnedSessionId && store.initialized) {
    return <div className="code-studio-root flex min-h-0 flex-1 flex-col">{menuBar}{windowError}<CodeStudioElsewhere mode="closed" projectName="" onClose={() => void closeGoIDESessionWindow(windows.context.windowId)} /></div>
  }
  if (activeSession && (windows.owners[activeSession.id] ?? 'main') !== windows.context.windowId) {
    return (
      <div className="code-studio-root flex min-h-0 flex-1 flex-col text-text-1">
        <CodeStudioToolbar mainMenu={mainMenu} trailing={<CodeStudioWorkspaceSwitcher />} onSearchEverywhere={() => runCommand('nav.searchEverywhere')} onDebug={() => runCommand('debug.debug')} recentProjects={recentNotOpen} onOpenRecent={(path) => void store.openProject(path)} runConfigurations={runConfigurations} activeConfigId={activeConfigId} onSelectConfiguration={(id) => store.selectRunConfiguration(id)} sessions={workspaceSessions} activeSession={activeSession} activeExecution={activeExecution} toolchain={toolchain} loading={store.loading} onSelect={(id) => void store.selectSession(id)} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onClone={() => setCloneOpen(true)} onDetectToolchain={() => void store.detectToolchain()} onToolchainSettings={() => setToolchainOpen(true)} onDependencies={() => setDependenciesOpen(true)} onConfigure={() => setConfigureOpen(true)} onBuild={() => startConfigured('build')} onRun={() => runCommand('run.run')} onTidy={() => void tidy()} onStop={() => void store.stopRun()} onClose={() => void useCodeStudioWindowsStore.getState().bringBack(activeSession.id)} />
        {windowError}
        <CodeStudioElsewhere mode="elsewhere" projectName={activeSession.project.name} onFocus={() => void useCodeStudioWindowsStore.getState().focusOwner(activeSession.id)} onBringBack={() => void useCodeStudioWindowsStore.getState().bringBack(activeSession.id)} />
        {sharedDialogs}
      </div>
    )
  }

  if (!activeSession) {
    return <div className="code-studio-root flex min-h-0 flex-1 flex-col">{menuBar}{store.error && <ErrorBanner message={store.error} onClose={store.clearError} />}<CodeStudioEmptyState loading={store.loading} recentProjects={store.recentProjects} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onClone={() => setCloneOpen(true)} onOpenRecent={(path) => void store.openProject(path)} onRemoveRecent={(path) => void store.removeRecentProject(path)} />{sharedDialogs}</div>
  }

  return (
    <div className="code-studio-root flex min-h-0 flex-1 flex-col text-text-1">
      {!zen && <CodeStudioToolbar mainMenu={mainMenu} trailing={<CodeStudioWorkspaceSwitcher />} onSearchEverywhere={() => runCommand('nav.searchEverywhere')} onDebug={() => runCommand('debug.debug')} extra={<CodeStudioBranchWidget sessionId={activeSession.id} onCommit={() => setVcsDialog('commit')} />} maximized={codeStudioMaximized} onToggleMaximize={toggleCodeStudioMaximized} recentProjects={recentNotOpen} onOpenRecent={(path) => void store.openProject(path)} runConfigurations={runConfigurations} activeConfigId={activeConfigId} onSelectConfiguration={(id) => store.selectRunConfiguration(id)} sessions={workspaceSessions} activeSession={activeSession} activeExecution={activeExecution} toolchain={toolchain} loading={store.loading} onSelect={(id) => void store.selectSession(id)} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onClone={() => setCloneOpen(true)} onDetectToolchain={() => void store.detectToolchain()} onToolchainSettings={() => setToolchainOpen(true)} onDependencies={() => setDependenciesOpen(true)} onConfigure={() => setConfigureOpen(true)} onBuild={() => startConfigured('build')} onRun={() => runCommand('run.run')} onTidy={() => void tidy()} onStop={() => void store.stopRun()} onClose={() => void closeFlow.requestCloseSession()} />}
      {store.error && <ErrorBanner message={store.error} onClose={store.clearError} />}
      {windowError}
      {lsp.message && <NoticeBanner message={lsp.message} onClose={lsp.clearMessage} />}
      {!zen && <CodeStudioWorkspaceBar goSessionId={activeSession.id} />}
      <CodeStudioToasts />
      <CodeStudioSnapshots sessionId={activeSession.id} />
      <CodeStudioStartupAnalyzer sessionId={activeSession.id} />
      <CodeStudioRecoveryBanner sessionId={activeSession.id} />
      <CodeStudioCrashRecoveryDialog sessionId={activeSession.id} />
      <CodeStudioWorkspace session={activeSession} {...store.layout} zen={zen} onProjectResize={beginResize('projectWidth')} onStructureResize={beginResize('structureWidth', -1)} onBottomResize={beginResize('bottomHeight', -1)} onCursor={setCursor} onRequestCloseDocument={closeFlow.requestCloseDocuments} onRunTarget={(target, anchor) => setRunTargetMenu({ target, ...anchor })} onCommit={() => setVcsDialog('commit')} onBookmarks={() => setBookmarksOpen(true)} onDependencies={() => setDependenciesOpen(true)} onCommand={runCommandStable} />
      {runTargetMenu && <CodeStudioRunTargetMenu {...runTargetMenu} onAction={runTarget} onClose={() => setRunTargetMenu(null)} />}
      <CodeStudioRunTargetPicker
        open={!!runTargetChoice}
        targets={runTargetChoice?.targets ?? []}
        onClose={() => setRunTargetChoice(null)}
        onChoose={(target) => {
          const kind = runTargetChoice?.kind ?? 'run'
          setRunTargetChoice(null)
          void startDiscoveredTarget(target, kind)
        }}
      />
      {zen ? <ZenExit onExit={toggleZen} /> : <CodeStudioStatusBar session={activeSession} toolchain={toolchain} documentInfo={summary.activeId ? { id: summary.activeId, relativePath: summary.activePath ?? '', language: summary.activeLanguage ?? '', readOnly: summary.activeReadOnly, lineEnding: summary.activeLineEnding ?? 'LF' } : null} execution={activeExecution} onLanguageServer={openLanguageServerMenu} onLinter={() => runCommand(commandAvailability('code.lint', commandContext) === true ? 'code.lint' : 'go.toolPaths')} onSetAuthorization={(allowed) => void authorize(allowed)} onManageToolchains={() => setToolchainOpen(true)} />}
      <CodeStudioQuickOpen />
      <CodeStudioFilePicker />
      <CodeStudioCaretPopup />
      <CodeStudioInlineAssistantPopup />
      <CodeStudioHierarchyDialog />
      <CodeStudioGoWorkDialog open={goWorkOpen} sessionId={activeSession.id} onClose={() => setGoWorkOpen(false)} />
      <CodeStudioGenerateMenu />
      <CodeStudioImplementInterfaceDialog />
      <CodeStudioChangeSignatureDialog />
      <CodeStudioMoveSymbolDialog />
      {sharedDialogs}
      {store.activeSessionId && <CodeStudioRunConfigurations open={configureOpen} sessionId={store.activeSessionId} initialDraft={configDraft} onClose={() => { setConfigureOpen(false); setConfigDraft(null) }} />}
      <CodeStudioSecretsPrompt
        open={!!pendingSecrets}
        configurationName={pendingSecrets?.config.name ?? ''}
        keys={pendingSecrets?.keys ?? []}
        onCancel={() => setPendingSecrets(null)}
        onSubmit={(secrets) => {
          const config = pendingSecrets?.config
          setPendingSecrets(null)
          if (config) void store.startConfiguredRun(config.id, secrets)
        }}
      />
      <ToolchainDialog open={toolchainOpen} onClose={() => setToolchainOpen(false)} onRunCommand={runCommand} />
      <CodeStudioDependencies open={dependenciesOpen} session={activeSession} onClose={() => setDependenciesOpen(false)} />
      <CodeStudioExtensionsDialog open={extensionsOpen} sessionId={activeSession.id} onClose={() => setExtensionsOpen(false)} />
      <CodeStudioDependencyGraph open={dependencyGraphOpen} session={activeSession} onClose={() => setDependencyGraphOpen(false)} />
      <CodeStudioADRLinks open={adrLinksOpen} sessionId={activeSession.id} onClose={() => setADRLinksOpen(false)} />
      <CodeStudioRuntimeEnrichment open={runtimeEnrichmentOpen} session={activeSession} onClose={() => setRuntimeEnrichmentOpen(false)} />
      <CodeStudioSearchEverywhere open={searchEverywhereOpen} sessionId={activeSession.id} availability={(id) => commandAvailability(id, commandContext)} onCommand={runCommand} onClose={() => setSearchEverywhereOpen(false)} />
      <CodeStudioCommitDialog sessionId={activeSession.id} open={vcsDialog === 'commit'} onClose={() => setVcsDialog(null)} onResolveConflicts={() => setVcsDialog('conflicts')} />
      {vcsDialog === 'conflicts' && vcs.vcsRepoRoot && (
        <ConflictResolverDialog
          repoPath={vcs.vcsRepoRoot}
          operation=""
          initialConflicts={[]}
          onResolved={() => { setVcsDialog(null); void useCodeStudioVCSStore.getState().refreshStatus(activeSession.id) }}
          onClose={() => { setVcsDialog(null); void useCodeStudioVCSStore.getState().refreshStatus(activeSession.id) }}
        />
      )}
      <CodeStudioProjectServicesDialog sessionId={activeSession.id} projectName={activeSession.project.name} open={servicesOpen} onClose={() => setServicesOpen(false)} />
      <CodeStudioGitHistoryDialog document={vcsDialog === 'history' || vcsDialog === 'lineHistory' ? currentActiveDocument() : null} open={vcsDialog === 'history' || vcsDialog === 'lineHistory'} lines={vcsDialog === 'lineHistory'} onClose={() => setVcsDialog(null)} />
      <CodeStudioHunkPopup />
      <CodeStudioBreakpointPopover />
      <CodeStudioBreakpointsDialog sessionId={activeSession.id} />
      <CodeStudioLocalHistoryDialog document={localHistoryOpen ? currentActiveDocument() : null} open={localHistoryOpen} onClose={() => setLocalHistoryOpen(false)} />
      <CodeStudioCopilotDialog projectRoot={activeSession.project.realPath} projectName={activeSession.project.name} />
      <CodeStudioMilkDialog />
      <CodeStudioClaudeDialog />
      <CodeStudioOpenCodeDialog />
      <CodeStudioAgentReviewDialog />
      <CodeStudioAttachDialog sessionId={activeSession.id} mode={attachMode} onClose={() => setAttachMode(null)} />
      <CodeStudioGoToolDialog sessionId={activeSession.id} state={goTool} onClose={() => setGoTool(null)} />
      <CodeStudioQualityDialog session={activeSession} open={qualityOpen} onClose={() => setQualityOpen(false)} />
      <CodeStudioBookmarksDialog open={bookmarksOpen} sessionId={activeSession.id} mode={locationsMode} onClose={() => { setBookmarksOpen(false); setLocationsMode('bookmarks') }} />
      <CodeStudioSymbolSearch open={symbolSearchOpen} sessionId={activeSession.id} onClose={() => setSymbolSearchOpen(false)} />
      <CodeStudioRenameDialog />
      <CodeStudioChangePreviewDialog />
      <CodeStudioToolPathsDialog open={toolPathsOpen} sessionId={activeSession.id} onClose={() => setToolPathsOpen(false)} />
      <CodeStudioLanguageServerLog open={lspLogOpen} sessionId={activeSession.id} onClose={() => setLspLogOpen(false)} />
      {!zen && <CodeStudioActivityBar session={activeSession} onOpenLog={() => setLspLogOpen(true)} />}
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
  lintOnSaveTimer = setTimeout(() => void useCodeStudioLspStore.getState().runLint(sessionId), LINT_ON_SAVE_DEBOUNCE_MS)
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

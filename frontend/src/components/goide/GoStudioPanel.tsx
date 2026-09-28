import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { AlertTriangle, PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { GoStudioEmptyState } from './GoStudioEmptyState'
import { CreateProjectDialog, UnsavedChangesDialog } from './GoStudioDialogs'
import { DEFAULT_RUN_DRAFT, runRequest } from './goStudioRunDraft'
import { ToolchainDialog } from './GoStudioToolchains'
import { GoStudioDependencies } from './GoStudioDependencies'
import { GoStudioQuickOpen } from './GoStudioQuickOpen'
import { GoStudioRecoveryBanner } from './GoStudioRecoveryBanner'
import { GoStudioRunConfigurations } from './GoStudioRunConfigurations'
import { GoStudioSecretsPrompt } from './GoStudioSecretsPrompt'
import { GoStudioToolbar } from './GoStudioToolbar'
import { GoStudioWorkspace } from './GoStudioWorkspace'
import { GoStudioMenuBar, type GoStudioCommandState } from './GoStudioMenuBar'
import { GoStudioShortcutsDialog } from './GoStudioShortcutsDialog'
import { commandAvailability, commandChecked, commandForKey, type GoStudioCommandContext, type GoStudioCommandId } from './goStudioCommands'
import { hasGoStudioEditor, isGoStudioEditorCommand, runGoStudioEditorCommand } from './goStudioEditorRegistry'
import { GoStudioStatusBar } from './GoStudioStatusBar'
import { GoStudioSymbolSearch } from './GoStudioSymbolSearch'
import { GoStudioChangePreviewDialog, GoStudioRenameDialog } from './GoStudioRefactorDialogs'
import { GoStudioLanguageServerLog } from './GoStudioLanguageServerLog'
import { GoStudioToolPathsDialog } from './GoStudioToolPathsDialog'
import { runLanguageCommand } from './goStudioLanguageCommands'
import { runSaveActions } from './goStudioSaveActions'
import { runCommandFor, type GoStudioRunTarget } from './goStudioRunTargets'
import { useGoStudioCloseFlow } from './useGoStudioCloseFlow'
import { confirm } from '@/lib/confirmDialog'
import { activeGoIDEDocument, dirtyGoIDEDocuments, useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'


export function GoStudioPanel() {
  const store = useGoIDEStore()
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [createOpen, setCreateOpen] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [toolchainOpen, setToolchainOpen] = useState(false)
  const [dependenciesOpen, setDependenciesOpen] = useState(false)
  const [runDraft] = useState(DEFAULT_RUN_DRAFT)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false)
  const [lspLogOpen, setLspLogOpen] = useState(false)
  const [toolPathsOpen, setToolPathsOpen] = useState(false)
  const lsp = useGoIDELspStore()
  const activeSession = useMemo(() => store.sessions.find((session) => session.id === store.activeSessionId) ?? null, [store.activeSessionId, store.sessions])
  const activeDocument = activeGoIDEDocument(store)
  const closeFlow = useGoStudioCloseFlow(activeSession)
  const sessionExecutions = store.executions.filter((execution) => execution.sessionId === store.activeSessionId)
  const activeRunId = store.activeSessionId ? store.activeRunBySession[store.activeSessionId] : null
  const activeExecution = sessionExecutions.find((execution) => execution.id === activeRunId) ?? sessionExecutions[sessionExecutions.length - 1] ?? null
  const toolchain = store.activeSessionId ? store.toolchains[store.activeSessionId] ?? null : null
  const runConfigurations = store.activeSessionId ? store.runConfigsBySession[store.activeSessionId] ?? [] : []
  const activeConfigId = store.activeSessionId ? store.activeConfigBySession[store.activeSessionId] ?? null : null
  const activeConfig = runConfigurations.find((config) => config.id === activeConfigId) ?? null
  const [pendingSecrets, setPendingSecrets] = useState<string[] | null>(null)

  useEffect(() => { void store.initialize() }, [store.initialize])

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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandForKey(event)
      if (!command) return
      event.preventDefault()
      runCommandRef.current(command.id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Build e Run partono dalla configurazione salvata attiva; senza configurazioni
  // resta la bozza locale, così il pannello è usabile anche prima di salvarne una.
  const configuredRequest = useCallback(() => {
    if (!activeConfig) return runRequest(runDraft)
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
    const secretKeys = (activeConfig?.environment ?? []).filter((entry) => entry.secret).map((entry) => entry.key)
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
    const id = documentId ?? (sessionId ? store.activeDocumentBySession[sessionId] : null)
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

  useEffect(() => {
    const protectDirtyBuffers = (event: BeforeUnloadEvent) => {
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
  const sessionDocuments = store.documents.filter((item) => item.document.sessionId === activeSession?.id)
  const lspStatus = activeSession ? lsp.status[activeSession.id] : undefined
  const commandContext: GoStudioCommandContext = {
    hasSession: !!activeSession,
    documentCount: sessionDocuments.length,
    hasClosedDocuments: !!activeSession && (store.closedDocuments[activeSession.id]?.length ?? 0) > 0,
    split: !!activeSession && !!store.splitBySession[activeSession.id],
    lspState: (lspStatus?.state || 'stopped') as GoStudioCommandContext['lspState'],
    goplsAvailable: !!activeSession && !!lsp.gopls[activeSession.id]?.available,
    formatOnSave: lsp.preferences.formatOnSave,
    importsOnSave: lsp.preferences.organizeImportsOnSave,
    gofumpt: lsp.settings.gofumpt,
    staticcheck: lsp.settings.staticcheck,
    lintOnSave: lsp.preferences.lintOnSave,
    linterAvailable: !!activeSession && !!lsp.linter[activeSession.id]?.available,
    linting: !!activeSession && !!lsp.lint[activeSession.id]?.running,
    authorized,
    toolchainReady: !!toolchain?.available,
    running: activeExecution?.status === 'running',
    restartable: !!activeExecution && activeExecution.kind !== 'dependency',
    hasEditor: !!activeDocument && hasGoStudioEditor(),
    activeDocumentDirty: !!activeDocument?.dirty,
    sessionDirty: !!activeSession && dirtyGoIDEDocuments(store, activeSession.id).length > 0,
    structureOpen: store.layout.structureOpen,
    bottomOpen: store.layout.bottomOpen,
    showIgnored: !!activeSession && (store.showIgnoredBySession[activeSession.id] ?? false),
  }
  const commandState: GoStudioCommandState = {
    availability: (id) => commandAvailability(id, commandContext),
    checked: (id) => commandChecked(id, commandContext),
  }

  const runTarget = (target: GoStudioRunTarget) => {
    const availability = commandAvailability('run.run', commandContext)
    if (availability !== true) return useGoIDEStore.setState({ error: availability })
    const command = runCommandFor(target)
    const configured = runRequest(runDraft)
    void store.startRun(command.kind, command.kind === 'run'
      ? { ...configured, target: command.target }
      : { ...configured, target: command.target, programArguments: command.programArguments })
  }

  const openLanguageServerMenu = () => {
    if (!activeSession) return
    if (lspStatus?.state === 'ready' || lspStatus?.state === 'starting') return setLspLogOpen(true)
    if (commandAvailability('go.lspStart', commandContext) === true) return void lsp.start(activeSession.id)
    if (authorized && !lsp.gopls[activeSession.id]?.available) return runCommand('go.lspInstall')
    setLspLogOpen(true)
  }

  const runCommand = (id: GoStudioCommandId) => {
    const availability = commandAvailability(id, commandContext)
    if (availability !== true) {
      if (id.startsWith('run.') || id.startsWith('nav.') || id.startsWith('code.')) useGoIDELspStore.setState({ message: availability })
      return
    }
    if (isGoStudioEditorCommand(id)) { runGoStudioEditorCommand(id); return }
    if (runLanguageCommand(id, activeSession?.id ?? null)) return
    switch (id) {
      case 'file.openProject': return void store.openProject()
      case 'file.newProject': return setCreateOpen(true)
      case 'file.save': return void saveDocumentWithActions()
      case 'file.saveAll': return void saveAllWithActions()
      case 'file.closeEditor': return activeDocument ? closeFlow.requestCloseDocuments([activeDocument]) : undefined
      case 'file.closeOthers': return closeFlow.requestCloseDocuments(sessionDocuments.filter((item) => item.document.id !== activeDocument?.document.id && !store.pinnedDocuments[item.document.id]))
      case 'file.closeAll': return closeFlow.requestCloseDocuments(sessionDocuments.filter((item) => !store.pinnedDocuments[item.document.id]))
      case 'file.pinTab': return activeDocument ? store.togglePinned(activeDocument.document.id) : undefined
      case 'file.reopenClosed': return void store.reopenClosedDocument()
      case 'file.closeProject': return void closeFlow.requestCloseSession()
      case 'view.splitRight': return store.setSplit('right')
      case 'view.splitDown': return store.setSplit('down')
      case 'view.unsplit': return store.setSplit(null)
      case 'view.quickOpen': return store.setQuickOpen(true)
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
      case 'help.shortcuts': return setShortcutsOpen(true)
      case 'nav.symbol': return setSymbolSearchOpen(true)
      case 'go.lspLog': return setLspLogOpen(true)
      case 'go.toolPaths': return setToolPathsOpen(true)
    }
  }
  runCommandRef.current = runCommand

  const menuBar = <GoStudioMenuBar state={commandState} recentProjects={store.recentProjects} openProjectPaths={store.sessions.map((session) => session.project.realPath)} onCommand={runCommand} onOpenRecent={(path) => void store.openProject(path)} />
  const sharedDialogs = <><CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} /><GoStudioShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} /></>

  if (!activeSession) {
    return <div className="flex min-h-0 flex-1 flex-col bg-surface-0">{menuBar}{store.error && <ErrorBanner message={store.error} onClose={store.clearError} />}<GoStudioEmptyState loading={store.loading} recentProjects={store.recentProjects} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onOpenRecent={(path) => void store.openProject(path)} onRemoveRecent={(path) => void store.removeRecentProject(path)} />{sharedDialogs}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-0 text-text-1">
      {menuBar}
      <GoStudioToolbar runConfigurations={runConfigurations} activeConfigId={activeConfigId} onSelectConfiguration={(id) => store.selectRunConfiguration(id)} sessions={store.sessions} activeSession={activeSession} activeExecution={activeExecution} toolchain={toolchain} loading={store.loading} onSelect={(id) => void store.selectSession(id)} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onSetAuthorization={(allowed) => void authorize(allowed)} onDetectToolchain={() => void store.detectToolchain()} onToolchainSettings={() => setToolchainOpen(true)} onDependencies={() => setDependenciesOpen(true)} onConfigure={() => setConfigureOpen(true)} onBuild={() => startConfigured('build')} onRun={() => startConfigured('run')} onTidy={() => void tidy()} onStop={() => void store.stopRun()} onClose={() => void closeFlow.requestCloseSession()} />
      {store.error && <ErrorBanner message={store.error} onClose={store.clearError} />}
      {lsp.message && <NoticeBanner message={lsp.message} onClose={lsp.clearMessage} />}
      <div className="flex h-7 shrink-0 items-center justify-end gap-1 border-b border-border-1 bg-surface-0 px-2"><span className="mr-auto truncate font-mono text-[9px] text-text-4">{activeDocument?.document.relativePath ?? activeSession.project.rootPath}</span><button type="button" onClick={() => store.updateLayout({ structureOpen: !store.layout.structureOpen })} title={store.layout.structureOpen ? 'Hide project overview · Alt+7' : 'Show project overview · Alt+7'} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">{store.layout.structureOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}</button><button type="button" onClick={() => store.updateLayout({ bottomOpen: !store.layout.bottomOpen })} title={store.layout.bottomOpen ? 'Hide run panel · Alt+4' : 'Show run panel · Alt+4'} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">{store.layout.bottomOpen ? <PanelBottomClose size={13} /> : <PanelBottomOpen size={13} />}</button></div>
      <GoStudioRecoveryBanner sessionId={activeSession.id} />
      <GoStudioWorkspace session={activeSession} {...store.layout} onProjectResize={beginResize('projectWidth', store.layout.projectWidth)} onStructureResize={beginResize('structureWidth', store.layout.structureWidth, -1)} onBottomResize={beginResize('bottomHeight', store.layout.bottomHeight, -1)} onCursor={(line, column) => setCursor({ line, column })} onRequestCloseDocument={closeFlow.requestCloseDocuments} onRunTarget={runTarget} />
      <GoStudioStatusBar session={activeSession} toolchain={toolchain} document={activeDocument} cursor={cursor} execution={activeExecution} onLanguageServer={openLanguageServerMenu} onLinter={() => runCommand(commandAvailability('code.lint', commandContext) === true ? 'code.lint' : 'go.toolPaths')} />
      <GoStudioQuickOpen />
      {sharedDialogs}
      {store.activeSessionId && <GoStudioRunConfigurations open={configureOpen} sessionId={store.activeSessionId} onClose={() => setConfigureOpen(false)} />}
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
      <GoStudioSymbolSearch open={symbolSearchOpen} sessionId={activeSession.id} onClose={() => setSymbolSearchOpen(false)} />
      <GoStudioRenameDialog />
      <GoStudioChangePreviewDialog />
      <GoStudioToolPathsDialog open={toolPathsOpen} sessionId={activeSession.id} onClose={() => setToolPathsOpen(false)} />
      <GoStudioLanguageServerLog open={lspLogOpen} sessionId={activeSession.id} onClose={() => setLspLogOpen(false)} />
      <UnsavedChangesDialog open={!!closeFlow.pending} documents={closeFlow.pending?.documents ?? []} onSave={() => closeFlow.settle(true)} onDiscard={() => closeFlow.settle(false)} onCancel={closeFlow.cancel} />
    </div>
  )
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

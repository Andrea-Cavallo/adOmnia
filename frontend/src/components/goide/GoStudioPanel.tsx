import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { AlertTriangle, PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { GoStudioEmptyState } from './GoStudioEmptyState'
import { CreateProjectDialog, RunConfigurationDialog, UnsavedChangesDialog, type GoStudioRunDraft } from './GoStudioDialogs'
import { ToolchainDialog } from './GoStudioToolchains'
import { GoStudioDependencies } from './GoStudioDependencies'
import { GoStudioQuickOpen } from './GoStudioQuickOpen'
import { GoStudioToolbar } from './GoStudioToolbar'
import { GoStudioWorkspace } from './GoStudioWorkspace'
import { GoStudioMenuBar, type GoStudioCommandState } from './GoStudioMenuBar'
import { GoStudioShortcutsDialog } from './GoStudioShortcutsDialog'
import { commandAvailability, commandChecked, commandForKey, type GoStudioCommandContext, type GoStudioCommandId } from './goStudioCommands'
import { hasGoStudioEditor, isGoStudioEditorCommand, runGoStudioEditorCommand } from './goStudioEditorRegistry'
import { confirm } from '@/lib/confirmDialog'
import { activeGoIDEDocument, dirtyGoIDEDocuments, useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'

const DEFAULT_RUN_DRAFT: GoStudioRunDraft = {
  target: '.',
  workingDirectory: '',
  goArguments: '',
  programArguments: '',
  buildTags: '',
  environment: '',
}

type PendingClose = { kind: 'document'; documents: GoIDEEditorDocument[] } | { kind: 'session'; documents: GoIDEEditorDocument[] }

function splitArguments(value: string): string[] {
  const result: string[] = []
  let current = ''
  let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === quote) quote = ''
      else if (character === '\\' && value[index + 1] === quote) current += value[++index]
      else current += character
    } else if (character === '"' || character === "'") quote = character
    else if (/\s/.test(character)) { if (current) { result.push(current); current = '' } }
    else current += character
  }
  if (current) result.push(current)
  return result
}

function runRequest(draft: GoStudioRunDraft) {
  const environment: Record<string, string> = {}
  for (const line of draft.environment.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) environment[line.slice(0, separator).trim()] = line.slice(separator + 1)
  }
  return {
    target: draft.target || '.',
    workingDirectory: draft.workingDirectory,
    goArguments: splitArguments(draft.goArguments),
    programArguments: splitArguments(draft.programArguments),
    buildTags: draft.buildTags.split(',').map((tag) => tag.trim()).filter(Boolean),
    environment,
  }
}

export function GoStudioPanel() {
  const store = useGoIDEStore()
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [createOpen, setCreateOpen] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [toolchainOpen, setToolchainOpen] = useState(false)
  const [dependenciesOpen, setDependenciesOpen] = useState(false)
  const [runDraft, setRunDraft] = useState(DEFAULT_RUN_DRAFT)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const activeSession = useMemo(() => store.sessions.find((session) => session.id === store.activeSessionId) ?? null, [store.activeSessionId, store.sessions])
  const activeDocument = activeGoIDEDocument(store)
  const sessionExecutions = store.executions.filter((execution) => execution.sessionId === store.activeSessionId)
  const activeRunId = store.activeSessionId ? store.activeRunBySession[store.activeSessionId] : null
  const activeExecution = sessionExecutions.find((execution) => execution.id === activeRunId) ?? sessionExecutions[sessionExecutions.length - 1] ?? null
  const toolchain = store.activeSessionId ? store.toolchains[store.activeSessionId] ?? null : null

  useEffect(() => { void store.initialize() }, [store.initialize])

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

  const startConfigured = useCallback((kind: 'build' | 'run') => {
    void store.startRun(kind, runRequest(runDraft))
  }, [runDraft, store.startRun])

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
    if (allowed) await store.detectToolchain()
  }

  const requestCloseDocument = (document: GoIDEEditorDocument) => {
    if (document.dirty) setPendingClose({ kind: 'document', documents: [document] })
    else void store.closeDocument(document.document.id)
  }

  const stopRunsAndCloseSession = async () => {
    if (!activeSession) return false
    const running = store.executions.filter((execution) => execution.sessionId === activeSession.id && execution.status === 'running')
    if (running.length) {
      const approved = await confirm({ title: 'Stop active runs?', message: `Closing ${activeSession.project.name} will stop ${running.length} active process tree${running.length === 1 ? '' : 's'}.`, confirmLabel: 'Stop and close', variant: 'danger' })
      if (!approved) return false
      await Promise.all(running.map((execution) => store.stopRun(execution.id)))
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!await store.hasActiveRuns(activeSession.id)) break
        await new Promise((resolve) => window.setTimeout(resolve, 100))
      }
    }
    return store.closeActiveSession(true)
  }

  const requestCloseSession = async () => {
    if (!activeSession) return
    const dirty = dirtyGoIDEDocuments(store, activeSession.id)
    if (dirty.length) return setPendingClose({ kind: 'session', documents: dirty })
    await stopRunsAndCloseSession()
  }

  const tidy = async () => {
    const approved = await confirm({ title: 'Run go mod tidy?', message: `Command: go mod tidy\nWorking directory: ${runDraft.workingDirectory || activeSession?.project.rootPath || ''}\n\nThis may access the network through your configured Go proxy.`, confirmLabel: 'Run tidy' })
    if (approved) await store.startRun('tidy', runRequest(runDraft))
  }

  const settlePending = async (save: boolean) => {
    if (!pendingClose || !activeSession) return
    if (save) {
      for (const document of pendingClose.documents) if (!await store.saveDocument(document.document.id)) return
    }
    if (pendingClose.kind === 'document') {
      await store.closeDocument(pendingClose.documents[0].document.id)
      setPendingClose(null)
      return
    }
    setPendingClose(null)
    await stopRunsAndCloseSession()
  }

  const authorized = activeSession?.project.authorization === 'tooling-permitted'
  const commandContext: GoStudioCommandContext = {
    hasSession: !!activeSession,
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

  const runCommand = (id: GoStudioCommandId) => {
    if (commandAvailability(id, commandContext) !== true) return
    if (isGoStudioEditorCommand(id)) { runGoStudioEditorCommand(id); return }
    switch (id) {
      case 'file.openProject': return void store.openProject()
      case 'file.newProject': return setCreateOpen(true)
      case 'file.save': return void store.saveDocument()
      case 'file.saveAll': return void (activeSession && store.saveAllDocuments(activeSession.id))
      case 'file.closeEditor': return activeDocument ? requestCloseDocument(activeDocument) : undefined
      case 'file.closeProject': return void requestCloseSession()
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
      <GoStudioToolbar sessions={store.sessions} activeSession={activeSession} activeExecution={activeExecution} toolchain={toolchain} loading={store.loading} onSelect={(id) => void store.selectSession(id)} onOpenProject={() => void store.openProject()} onCreateProject={() => setCreateOpen(true)} onSetAuthorization={(allowed) => void authorize(allowed)} onDetectToolchain={() => void store.detectToolchain()} onToolchainSettings={() => setToolchainOpen(true)} onDependencies={() => setDependenciesOpen(true)} onConfigure={() => setConfigureOpen(true)} onBuild={() => startConfigured('build')} onRun={() => startConfigured('run')} onTidy={() => void tidy()} onStop={() => void store.stopRun()} onClose={() => void requestCloseSession()} />
      {store.error && <ErrorBanner message={store.error} onClose={store.clearError} />}
      <div className="flex h-7 shrink-0 items-center justify-end gap-1 border-b border-border-1 bg-surface-0 px-2"><span className="mr-auto truncate font-mono text-[9px] text-text-4">{activeDocument?.document.relativePath ?? activeSession.project.rootPath}</span><button type="button" onClick={() => store.updateLayout({ structureOpen: !store.layout.structureOpen })} title={store.layout.structureOpen ? 'Hide project overview · Alt+7' : 'Show project overview · Alt+7'} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">{store.layout.structureOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}</button><button type="button" onClick={() => store.updateLayout({ bottomOpen: !store.layout.bottomOpen })} title={store.layout.bottomOpen ? 'Hide run panel · Alt+4' : 'Show run panel · Alt+4'} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">{store.layout.bottomOpen ? <PanelBottomClose size={13} /> : <PanelBottomOpen size={13} />}</button></div>
      <GoStudioWorkspace session={activeSession} {...store.layout} onProjectResize={beginResize('projectWidth', store.layout.projectWidth)} onStructureResize={beginResize('structureWidth', store.layout.structureWidth, -1)} onBottomResize={beginResize('bottomHeight', store.layout.bottomHeight, -1)} onCursor={(line, column) => setCursor({ line, column })} onRequestCloseDocument={requestCloseDocument} />
      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-border-1 bg-surface-1 px-3 text-[9px] text-text-4"><span>{toolchain?.available ? (toolchain.version ?? 'Go ready').replace(/^go version\s+/, '') : 'Go not detected'}</span><span>{activeDocument?.document.language ?? (activeSession.project.goWorkPath ? 'go.work' : activeSession.project.goModPath ? 'go.mod' : 'Go folder')}</span>{activeDocument && <span>Ln {cursor.line}, Col {cursor.column}</span>}<span className="ml-auto">{activeExecution ? `${activeExecution.kind}: ${activeExecution.status}` : 'idle'}</span></div>
      <GoStudioQuickOpen />
      {sharedDialogs}
      <RunConfigurationDialog open={configureOpen} draft={runDraft} onSave={setRunDraft} onClose={() => setConfigureOpen(false)} />
      <ToolchainDialog open={toolchainOpen} onClose={() => setToolchainOpen(false)} />
      <GoStudioDependencies open={dependenciesOpen} session={activeSession} onClose={() => setDependenciesOpen(false)} />
      <UnsavedChangesDialog open={!!pendingClose} documents={pendingClose?.documents ?? []} onSave={() => settlePending(true)} onDiscard={() => settlePending(false)} onCancel={() => setPendingClose(null)} />
    </div>
  )
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger"><AlertTriangle size={13} /><span className="flex-1 whitespace-pre-wrap">{message}</span><button type="button" onClick={onClose} title="Dismiss error" className="grid h-5 w-5 place-items-center rounded hover:bg-danger/10"><X size={12} /></button></div>
}

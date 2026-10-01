import * as GoIDEBindings from '../../bindings/adomnia/goide'
import { Events } from '@wailsio/runtime'
import type {
  WatcherStatus,
  HistoryRevision,
  GoToolRequest,
  GoToolPreview,
  Capabilities,
  CreateProjectRequest,
  CreateProjectResult,
  ProjectTemplateList,
  DocumentDiskState,
  Execution,
  DependencyActionRequest,
  DependencyState,
  FileEntry,
  OpenDocument,
  QuickOpenResult,
  RecentProject,
  RunRequest,
  Session,
  ToolchainConfiguration,
  ToolchainInfo,
  ToolchainSettings,
  ToolchainInstallation,
  ToolchainRelease,
  InstalledToolchain,
  RunConfiguration,
  EnvironmentEntry,
  SessionView,
  RecoveredBuffer,
  TerminalSession,
  TerminalRequest,
  TerminalProfile,
} from '../../bindings/adomnia/internal/goide/models'

export type GoIDECapabilities = Capabilities
export type GoIDESession = Session
export type GoIDERecentProject = RecentProject
export type GoIDEFileEntry = FileEntry
export type GoIDEOpenDocument = OpenDocument
export type GoIDEDocumentDiskState = DocumentDiskState
export type GoIDEQuickOpenResult = QuickOpenResult
export type GoIDEToolchainInfo = ToolchainInfo
export type GoIDEToolchainConfiguration = ToolchainConfiguration
export type GoIDEToolchainSettings = ToolchainSettings
export type GoIDERunRequest = RunRequest
export type GoIDEExecution = Execution
export type GoIDEDependencyActionRequest = DependencyActionRequest
export type GoIDEDependencyState = DependencyState
export type GoIDEToolchainInstallation = ToolchainInstallation
export type GoIDEToolchainRelease = ToolchainRelease
export type GoIDEInstalledToolchain = InstalledToolchain
export type GoIDERunConfiguration = RunConfiguration
export { RunConfigurationKind as GoIDERunConfigurationKind } from '../../bindings/adomnia/internal/goide/models'
export type GoIDEEnvironmentEntry = EnvironmentEntry
export type GoIDESessionView = SessionView
export type GoIDERecoveredBuffer = RecoveredBuffer
export type GoIDETerminalSession = TerminalSession
export type GoIDETerminalRequest = TerminalRequest
/** Payload dell'evento `terminal.output` (goide.TerminalOutput), non generato da Wails perché solo evento. */
export interface GoIDETerminalOutput {
  terminalId: string
  data: string
}
export interface GoIDEEvent {
  version: number
  type: string
  sessionId?: string
  resourceId?: string
  sequence: number
  timestamp: string
  payload?: unknown
}

export interface GoIDEAppCloseRequest {
  dirtyDocumentCount: number
  activeRuns: boolean
}

export async function getGoIDECapabilities(): Promise<GoIDECapabilities> {
  return GoIDEBindings.GetCapabilities()
}

export async function listGoIDESessions(): Promise<GoIDESession[]> {
  return GoIDEBindings.ListSessions()
}

export async function listRecentGoIDEProjects(): Promise<GoIDERecentProject[]> {
  return GoIDEBindings.ListRecentProjects()
}

export async function removeRecentGoIDEProject(path: string): Promise<void> {
  await GoIDEBindings.RemoveRecentProject(path)
}

export async function chooseGoIDEProjectFolder(): Promise<string> {
  return GoIDEBindings.SelectProjectFolder()
}

export async function openGoIDEProject(path: string): Promise<GoIDESession> {
  return GoIDEBindings.OpenProject(path)
}

export async function chooseGoIDEProjectParent(): Promise<string> {
  return GoIDEBindings.SelectProjectParent()
}

export type GoIDEProjectTemplateList = ProjectTemplateList

export async function createGoIDEProject(request: CreateProjectRequest): Promise<CreateProjectResult> {
  return GoIDEBindings.CreateProject(request)
}

export async function listGoIDEProjectTemplates(): Promise<ProjectTemplateList> {
  return GoIDEBindings.ListProjectTemplates()
}

export async function setGoIDEToolAuthorization(sessionId: string, allowed: boolean): Promise<GoIDESession> {
  return GoIDEBindings.SetToolAuthorization(sessionId, allowed)
}

export async function closeGoIDESession(sessionId: string): Promise<void> {
  await GoIDEBindings.CloseSession(sessionId)
}

export async function listGoIDEDirectory(sessionId: string, relativePath = '', includeIgnored = false): Promise<GoIDEFileEntry[]> {
  return GoIDEBindings.ListDirectory(sessionId, relativePath, includeIgnored)
}

export async function openGoIDEDocument(sessionId: string, relativePath: string): Promise<GoIDEOpenDocument> {
  return GoIDEBindings.OpenDocument(sessionId, relativePath)
}

/** Crea file nuovi nel progetto, tutti o nessuno; un file esistente non viene mai sovrascritto. */
export async function createGoIDEFiles(sessionId: string, files: Array<{ relativePath: string; content: string }>): Promise<void> {
  await GoIDEBindings.CreateFiles(sessionId, files)
}

export async function saveGoIDEDocument(sessionId: string, documentId: string, content: string, diskToken: string, force = false): Promise<GoIDEOpenDocument> {
  return GoIDEBindings.SaveDocument(sessionId, documentId, content, diskToken, force)
}

export async function checkGoIDEDocument(sessionId: string, documentId: string, diskToken: string): Promise<GoIDEDocumentDiskState> {
  return GoIDEBindings.CheckDocument(sessionId, documentId, diskToken)
}

export async function closeGoIDEDocument(sessionId: string, documentId: string): Promise<void> {
  await GoIDEBindings.CloseDocument(sessionId, documentId)
}

export async function quickOpenGoIDEFiles(sessionId: string, query: string, limit = 100): Promise<GoIDEQuickOpenResult[]> {
  return GoIDEBindings.QuickOpen(sessionId, query, limit)
}

export async function detectGoIDEToolchain(sessionId: string): Promise<GoIDEToolchainInfo> {
  return GoIDEBindings.DetectToolchain(sessionId)
}

export async function configureGoIDEToolchain(sessionId: string, config: ToolchainConfiguration): Promise<void> {
  await GoIDEBindings.ConfigureToolchain(sessionId, config)
}

export async function getGoIDEToolchainSettings(sessionId: string): Promise<GoIDEToolchainSettings> {
  return GoIDEBindings.ToolchainSettings(sessionId)
}

export async function configureGoIDEGlobalToolchain(config: ToolchainConfiguration): Promise<void> {
  await GoIDEBindings.ConfigureGlobalToolchain(config)
}

export async function resetGoIDEToolchainToGlobal(sessionId: string): Promise<void> {
  await GoIDEBindings.UseGlobalToolchain(sessionId)
}

export async function listGoIDEToolchainReleases(sessionId: string): Promise<ToolchainRelease[]> {
  return GoIDEBindings.ListToolchainReleases(sessionId)
}

export async function listInstalledGoIDEToolchains(sessionId: string): Promise<InstalledToolchain[]> {
  return GoIDEBindings.ListInstalledToolchains(sessionId)
}

export async function installGoIDEToolchain(sessionId: string, version: string, activate = true): Promise<ToolchainInstallation> {
  return GoIDEBindings.InstallToolchain({ sessionId, version, confirmed: true, activate })
}

export async function cancelGoIDEToolchainInstall(installId: string): Promise<void> {
  await GoIDEBindings.CancelToolchainInstall(installId)
}

export async function selectInstalledGoIDEToolchain(sessionId: string, version: string): Promise<void> {
  await GoIDEBindings.SelectInstalledToolchain(sessionId, version)
}

export async function removeInstalledGoIDEToolchain(version: string): Promise<void> {
  await GoIDEBindings.RemoveInstalledToolchain(version, true)
}

export async function listGoIDEDependencies(sessionId: string, moduleDirectory: string): Promise<DependencyState> {
  return GoIDEBindings.ListDependencies(sessionId, moduleDirectory)
}

export async function startGoIDEDependencyAction(request: DependencyActionRequest): Promise<Execution> {
  return GoIDEBindings.StartDependencyAction(request)
}

export type GoIDEDependencyGraphReport = Awaited<ReturnType<typeof GoIDEBindings.DependencyGraph>>
export type GoIDEDependencyUpdate = Awaited<ReturnType<typeof GoIDEBindings.DependencyUpdates>>[number]
export type GoIDEDependencyVulnerability = Awaited<ReturnType<typeof GoIDEBindings.DependencyVulnerabilities>>[number]

/** Grafo delle dipendenze offline: albero, duplicati transitivi, licenze, peso e pacchetti. */
export async function getGoIDEDependencyGraph(sessionId: string, moduleDirectory: string): Promise<GoIDEDependencyGraphReport> {
  return GoIDEBindings.DependencyGraph(sessionId, moduleDirectory)
}

/** Versioni più recenti disponibili (richiede rete). */
export async function listGoIDEDependencyUpdates(sessionId: string, moduleDirectory: string): Promise<GoIDEDependencyUpdate[]> {
  return GoIDEBindings.DependencyUpdates(sessionId, moduleDirectory)
}

/** Esegue govulncheck sul modulo (richiede rete e govulncheck installato). */
export async function scanGoIDEDependencyVulnerabilities(sessionId: string, moduleDirectory: string): Promise<GoIDEDependencyVulnerability[]> {
  return GoIDEBindings.DependencyVulnerabilities(sessionId, moduleDirectory)
}

export type GoIDEGoTool = 'vet' | 'generate' | 'fix' | 'modWhy' | 'modGraph' | 'doc'
export type GoIDEGoToolRequest = GoToolRequest
export type GoIDEGoToolPreview = GoToolPreview

/** Comando esatto che Go Tools eseguirà, senza eseguirlo. */
export async function previewGoIDETool(request: GoToolRequest): Promise<GoToolPreview> {
  return GoIDEBindings.PreviewGoTool(request)
}

/** Esegue un comando Go Tools; l'output arriva nella Run console tramite gli eventi run.*. */
export async function startGoIDETool(request: GoToolRequest): Promise<Execution> {
  return GoIDEBindings.StartGoTool(request)
}

export type GoIDEHistoryRevision = HistoryRevision

/** Versioni salvate di un file nella local history, dalla più recente. */
export async function listGoIDELocalHistory(sessionId: string, relativePath: string): Promise<HistoryRevision[]> {
  return GoIDEBindings.ListLocalHistory(sessionId, relativePath)
}

export async function getGoIDELocalHistoryContent(sessionId: string, relativePath: string, revisionId: string): Promise<string> {
  return GoIDEBindings.LocalHistoryContent(sessionId, relativePath, revisionId)
}

export type GoIDEWatcherStatus = WatcherStatus

/** Quanto del progetto è osservato per le modifiche esterne. */
export async function getGoIDEWatcherStatus(sessionId: string): Promise<WatcherStatus> {
  return GoIDEBindings.WatcherStatus(sessionId)
}

/** Selettore nativo di cartelle; stringa vuota se l'utente annulla. */
export async function selectGoIDEFolder(title: string): Promise<string> {
  return GoIDEBindings.SelectFolder(title)
}

export async function startGoIDERun(request: RunRequest): Promise<GoIDEExecution> {
  return GoIDEBindings.StartRun(request)
}

export async function stopGoIDERun(runId: string): Promise<void> {
  await GoIDEBindings.StopRun(runId)
}

export async function restartGoIDERun(runId: string): Promise<GoIDEExecution> {
  return GoIDEBindings.RestartRun(runId)
}

export async function writeGoIDERunInput(runId: string, text: string): Promise<void> {
  await GoIDEBindings.WriteRunInput(runId, text)
}

export async function listGoIDERuns(sessionId: string): Promise<GoIDEExecution[]> {
  return GoIDEBindings.ListRuns(sessionId)
}

export async function hasActiveGoIDERuns(sessionId: string): Promise<boolean> {
  return GoIDEBindings.HasActiveRuns(sessionId)
}

export async function setGoIDEDirtyDocumentCount(count: number): Promise<void> {
  await GoIDEBindings.SetDirtyDocumentCount(count)
}

export async function confirmGoIDEAppClose(): Promise<void> {
  await GoIDEBindings.ConfirmAppClose()
}

export function subscribeGoIDEEvents(callback: (event: GoIDEEvent) => void): () => void {
  return Events.On('goide:event', (event) => callback(event.data as GoIDEEvent))
}

export function subscribeGoIDEAppCloseRequests(callback: (request: GoIDEAppCloseRequest) => void): () => void {
  return Events.On('goide:close-requested', (event) => callback(event.data as GoIDEAppCloseRequest))
}

// --- Configurazioni Run persistenti -----------------------------------------

export async function listGoIDERunConfigurations(sessionId: string): Promise<GoIDERunConfiguration[]> {
  return GoIDEBindings.ListRunConfigurations(sessionId)
}

export async function saveGoIDERunConfiguration(sessionId: string, config: GoIDERunConfiguration): Promise<GoIDERunConfiguration> {
  return GoIDEBindings.SaveRunConfiguration(sessionId, config)
}

export async function duplicateGoIDERunConfiguration(sessionId: string, configId: string): Promise<GoIDERunConfiguration> {
  return GoIDEBindings.DuplicateRunConfiguration(sessionId, configId)
}

export async function renameGoIDERunConfiguration(sessionId: string, configId: string, name: string): Promise<GoIDERunConfiguration> {
  return GoIDEBindings.RenameRunConfiguration(sessionId, configId, name)
}

export async function reorderGoIDERunConfigurations(sessionId: string, configIds: string[]): Promise<GoIDERunConfiguration[]> {
  return GoIDEBindings.ReorderRunConfigurations(sessionId, configIds)
}

export async function deleteGoIDERunConfiguration(sessionId: string, configId: string): Promise<void> {
  await GoIDEBindings.DeleteRunConfiguration(sessionId, configId)
}

export async function startGoIDEConfiguredRun(sessionId: string, configId: string, secrets: Record<string, string>): Promise<GoIDEExecution> {
  return GoIDEBindings.StartConfiguredRun(sessionId, configId, secrets)
}

export async function startGoIDEConfiguredBuild(sessionId: string, configId: string): Promise<GoIDEExecution> {
  return GoIDEBindings.StartConfiguredBuild(sessionId, configId)
}

// --- Terminale PTY ----------------------------------------------------------

export type GoIDETerminalProfile = TerminalProfile

export async function listGoIDETerminalProfiles(): Promise<GoIDETerminalProfile[]> {
  return GoIDEBindings.ListTerminalProfiles()
}

export async function openGoIDETerminal(request: GoIDETerminalRequest): Promise<GoIDETerminalSession> {
  return GoIDEBindings.OpenTerminal(request)
}

export async function writeGoIDETerminal(terminalId: string, data: string): Promise<void> {
  await GoIDEBindings.WriteTerminal(terminalId, data)
}

export async function resizeGoIDETerminal(terminalId: string, columns: number, rows: number): Promise<void> {
  await GoIDEBindings.ResizeTerminal(terminalId, columns, rows)
}

export async function closeGoIDETerminal(terminalId: string): Promise<void> {
  await GoIDEBindings.CloseTerminal(terminalId)
}

export async function renameGoIDETerminal(terminalId: string, name: string): Promise<GoIDETerminalSession> {
  return GoIDEBindings.RenameTerminal(terminalId, name)
}

export async function listGoIDETerminals(sessionId: string): Promise<GoIDETerminalSession[]> {
  return GoIDEBindings.ListTerminals(sessionId)
}

export async function hasActiveGoIDETerminals(sessionId: string): Promise<boolean> {
  return GoIDEBindings.HasActiveTerminals(sessionId)
}

// --- Ripristino sessione e buffer -------------------------------------------

export async function getGoIDESessionView(sessionId: string): Promise<GoIDESessionView> {
  return GoIDEBindings.GetSessionView(sessionId)
}

export async function saveGoIDESessionView(sessionId: string, view: GoIDESessionView): Promise<void> {
  await GoIDEBindings.SaveSessionView(sessionId, view)
}

export async function rememberGoIDEBuffer(sessionId: string, relativePath: string, content: string, diskToken: string): Promise<void> {
  await GoIDEBindings.RememberBuffer(sessionId, relativePath, content, diskToken)
}

export async function forgetGoIDEBuffer(sessionId: string, relativePath: string): Promise<void> {
  await GoIDEBindings.ForgetBuffer(sessionId, relativePath)
}

export type GoIDECrashStatus = Awaited<ReturnType<typeof GoIDEBindings.CrashRecoveryStatus>>

/** Il precedente avvio di adOmnia si è chiuso in modo anomalo? (heartbeat del runtime lock fermo) */
export async function getGoIDECrashStatus(): Promise<GoIDECrashStatus> {
  return GoIDEBindings.CrashRecoveryStatus()
}

export type GoIDEProcessDescriptor = Awaited<ReturnType<typeof GoIDEBindings.InterruptedProcesses>>[number]

/** Esecuzioni delle configurazioni Run ancora in corso quando adOmnia si è chiusa in modo anomalo. */
export type GoIDEGoToolInfo = Awaited<ReturnType<typeof GoIDEBindings.DetectGoTool>>

export async function detectGoIDEGoTool(sessionId: string, binary: string): Promise<GoIDEGoToolInfo> {
  return GoIDEBindings.DetectGoTool(sessionId, binary)
}

/** go install modulo@versione nella cartella strumenti di adOmnia: solo dopo conferma dell'utente. */
export async function installGoIDEGoModule(sessionId: string, module: string): Promise<GoIDEExecution> {
  return GoIDEBindings.InstallGoModule(sessionId, module, true)
}

export async function runGoIDEGoTool(sessionId: string, binary: string, args: string[], workingDirectory: string): Promise<GoIDEExecution> {
  return GoIDEBindings.RunGoTool(sessionId, binary, args, workingDirectory)
}

export async function listGoIDEInterruptedProcesses(): Promise<GoIDEProcessDescriptor[]> {
  return (await GoIDEBindings.InterruptedProcesses()) ?? []
}

export async function dismissGoIDEInterruptedProcess(runId: string): Promise<void> {
  await GoIDEBindings.DismissInterruptedProcess(runId)
}

export async function acknowledgeGoIDECrash(): Promise<void> {
  await GoIDEBindings.AcknowledgeCrash()
}

export async function listGoIDERecoveredBuffers(sessionId: string): Promise<GoIDERecoveredBuffer[]> {
  return GoIDEBindings.ListRecoveredBuffers(sessionId)
}

export async function pruneMissingGoIDESessions(): Promise<GoIDESession[]> {
  return GoIDEBindings.PruneMissingSessions()
}

export async function findGoIDESessionsForPath(sessionId: string, relativePath: string): Promise<GoIDESession[]> {
  return GoIDEBindings.FindSessionsForPath(sessionId, relativePath)
}

/** make usato per i Makefile della sessione (binario personalizzato, PATH o GnuWin32). */
export async function detectGoIDEMake(sessionId: string) {
  return GoIDEBindings.DetectMake(sessionId)
}

export async function configureGoIDEMake(sessionId: string, binary: string): Promise<void> {
  return GoIDEBindings.ConfigureMake(sessionId, binary)
}

// --- Operazioni sui file del Project tree ---------------------------------------

export async function createGoIDEDirectory(sessionId: string, relativePath: string): Promise<void> {
  return GoIDEBindings.CreateDirectory(sessionId, relativePath)
}

export async function moveGoIDEPath(sessionId: string, from: string, to: string): Promise<void> {
  return GoIDEBindings.MovePath(sessionId, from, to)
}

export async function duplicateGoIDEPath(sessionId: string, from: string, to: string): Promise<void> {
  return GoIDEBindings.DuplicatePath(sessionId, from, to)
}

export async function deleteGoIDEPath(sessionId: string, relativePath: string): Promise<void> {
  return GoIDEBindings.DeletePath(sessionId, relativePath)
}

export async function revealGoIDEPath(sessionId: string, relativePath: string): Promise<void> {
  return GoIDEBindings.RevealPath(sessionId, relativePath)
}

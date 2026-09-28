import * as GoIDEBindings from '../../bindings/adomnia/goide'
import { Events } from '@wailsio/runtime'
import type {
  Capabilities,
  CreateProjectRequest,
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
  ToolchainInstallation,
  ToolchainRelease,
  InstalledToolchain,
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
export type GoIDERunRequest = RunRequest
export type GoIDEExecution = Execution
export type GoIDEDependencyActionRequest = DependencyActionRequest
export type GoIDEDependencyState = DependencyState
export type GoIDEToolchainInstallation = ToolchainInstallation
export type GoIDEToolchainRelease = ToolchainRelease
export type GoIDEInstalledToolchain = InstalledToolchain
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

export async function createGoIDEProject(request: CreateProjectRequest): Promise<GoIDESession> {
  return GoIDEBindings.CreateProject(request)
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

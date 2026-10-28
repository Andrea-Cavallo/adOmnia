import type { JavaJDKReport, JavaJFRRecording, PythonInterpreterReport, PythonUnitDependencies, RustCacheCleanReport, RustEnvironmentReport, RustToolchainReport, ServerInstallPreview } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'
import type { EnvironmentPlan } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/python/models'
import type { JVMHeapSample, JVMProcess, MainClassInfo, MyBatisIndex, PomDependency, SpringEndpoint, TreeNode, SpringIndex, SpringMetadataReport, VersionInfo } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'
import type { CargoTreeNode } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/rust/models'
import * as GoIDEBindings from '../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import { Events } from '@wailsio/runtime'
import type { CancellablePromise } from '@wailsio/runtime'
import type { FileChange as AgentReviewFileModel, Review as AgentReviewModel } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/agentreview/models'
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
} from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'
import type { FieldSchema, RunTarget, Suggestion as RunSuggestion } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/run/models'

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
export type GoIDERunTarget = RunTarget
export { RunConfigurationKind as GoIDERunConfigurationKind } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'
export type GoIDEEnvironmentEntry = EnvironmentEntry
export type GoIDESessionView = SessionView
export type GoIDERecoveredBuffer = RecoveredBuffer
export type GoIDETerminalSession = TerminalSession
export type GoIDETerminalRequest = TerminalRequest
export interface GoIDEPathDifference { relativePath: string; status: string }
export interface GoIDEPathComparison {
  kind: 'file' | 'directory'
  leftPath: string
  rightPath: string
  leftContent?: string
  rightContent?: string
  differences: GoIDEPathDifference[]
}
/** Payload dell'evento `terminal.output` (codeStudio.TerminalOutput), non generato da Wails perché solo evento. */
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

export async function getRunSchema(language: string, kind: string): Promise<FieldSchema> {
  return GoIDEBindings.GetRunSchema(language, kind)
}

export async function getRunSuggestions(sessionId: string): Promise<RunSuggestion[]> {
  return GoIDEBindings.GetRunSuggestions(sessionId)
}

export async function listGoIDESessions(): Promise<GoIDESession[]> {
  return GoIDEBindings.ListSessions()
}

export async function listGoIDERunTargets(sessionId: string): Promise<GoIDERunTarget[]> {
  return GoIDEBindings.ListRunTargets(sessionId)
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

export async function compareGoIDEPaths(sessionId: string, leftPath: string, rightPath: string): Promise<GoIDEPathComparison> {
  return GoIDEBindings.ComparePaths(sessionId, leftPath, rightPath) as Promise<GoIDEPathComparison>
}

export async function createGoIDEGist(sessionId: string, relativePath: string, description: string, publicGist: boolean): Promise<string> {
  return GoIDEBindings.CreateGist(sessionId, relativePath, description, publicGist)
}

/** Immagine del progetto come data URL, per l'anteprima nell'editor e i link relativi del Markdown. */
export async function readGoIDEAssetDataUrl(sessionId: string, relativePath: string): Promise<string> {
  return GoIDEBindings.ReadFileDataURL(sessionId, relativePath)
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

/** `go list` sul modulo: cancellabile — un cambio cartella/sessione ferma il lavoro. */
export function listGoIDEDependencies(sessionId: string, moduleDirectory: string): CancellablePromise<DependencyState> {
  return GoIDEBindings.ListDependencies(sessionId, moduleDirectory)
}

export type GoIDEDependencySource = Awaited<ReturnType<typeof GoIDEBindings.ResolveDependencySource>>
export type GoIDEDependencySourceFile = GoIDEDependencySource['files'][number]

/**
 * Dove si trova il codice di una dipendenza del go.mod: il target di una replace locale, un altro
 * modulo del progetto oppure il sorgente nella module cache. Non esegue comandi e non tocca la rete.
 */
export function resolveGoIDEDependencySource(sessionId: string, moduleDirectory: string, modulePath: string): CancellablePromise<GoIDEDependencySource> {
  return GoIDEBindings.ResolveDependencySource(sessionId, moduleDirectory, modulePath)
}

/** Versioni pubblicate di una dipendenza, dalla più recente (go list -m -versions, passa dal GOPROXY). */
export function listGoIDEModuleVersions(sessionId: string, moduleDirectory: string, modulePath: string): CancellablePromise<string[]> {
  return GoIDEBindings.ListModuleVersions(sessionId, moduleDirectory, modulePath)
}

export async function startGoIDEDependencyAction(request: DependencyActionRequest): Promise<Execution> {
  return GoIDEBindings.StartDependencyAction(request)
}

export type GoIDEDependencyGraphReport = Awaited<ReturnType<typeof GoIDEBindings.DependencyGraph>>
export type GoIDEDependencyUpdate = Awaited<ReturnType<typeof GoIDEBindings.DependencyUpdates>>[number]
export type GoIDEDependencyVulnerability = Awaited<ReturnType<typeof GoIDEBindings.DependencyVulnerabilities>>[number]

/** Grafo delle dipendenze offline: albero, duplicati transitivi, licenze, peso e pacchetti. */
export function getGoIDEDependencyGraph(sessionId: string, moduleDirectory: string): CancellablePromise<GoIDEDependencyGraphReport> {
  return GoIDEBindings.DependencyGraph(sessionId, moduleDirectory)
}

/** Versioni più recenti disponibili (richiede rete). */
export function listGoIDEDependencyUpdates(sessionId: string, moduleDirectory: string): CancellablePromise<GoIDEDependencyUpdate[]> {
  return GoIDEBindings.DependencyUpdates(sessionId, moduleDirectory)
}

/** Esegue govulncheck sul modulo (richiede rete e govulncheck installato). */
export function scanGoIDEDependencyVulnerabilities(sessionId: string, moduleDirectory: string): CancellablePromise<GoIDEDependencyVulnerability[]> {
  return GoIDEBindings.DependencyVulnerabilities(sessionId, moduleDirectory)
}

export type GoIDEVulnReport = Awaited<ReturnType<typeof GoIDEBindings.VulnerabilityScan>>
export type GoIDEVulnFinding = GoIDEVulnReport['findings'][number]
export type GoIDEVulnFrame = NonNullable<GoIDEVulnFinding['callPaths']>[number][number]

/** govulncheck con percorsi di chiamata, versione corretta e catena di dipendenze (contatta vuln.go.dev). */
export function scanGoIDEVulnerabilities(sessionId: string, moduleDirectory: string): CancellablePromise<GoIDEVulnReport> {
  return GoIDEBindings.VulnerabilityScan(sessionId, moduleDirectory)
}

export type GoIDESecurityReport = Awaited<ReturnType<typeof GoIDEBindings.SecurityScan>>
export type GoIDESecurityFinding = GoIDESecurityReport['findings'][number]
export type GoIDESecurityRule = GoIDESecurityReport['rules'][number]

export type GoIDESecurityExposure = Awaited<ReturnType<typeof GoIDEBindings.SecurityExposures>>[number]

/** Da quali route, metodi gRPC e topic (workspace graph) si raggiunge la funzione di ogni finding. */
export function securityExposures(sessionId: string, findings: readonly GoIDESecurityFinding[]): CancellablePromise<GoIDESecurityExposure[]> {
  return GoIDEBindings.SecurityExposures(sessionId, findings.filter((finding) => finding.file.endsWith('.go')).map((finding) => ({ fingerprint: finding.fingerprint, file: finding.file, line: finding.line })))
}

/** Scansione offline dei file del progetto: segreti e regole statiche (TLS, crypto, injection, permessi). */
export function scanGoIDESecurity(sessionId: string): CancellablePromise<GoIDESecurityReport> {
  return GoIDEBindings.SecurityScan(sessionId)
}

export async function suppressGoIDESecurityFinding(sessionId: string, finding: GoIDESecurityFinding, reason: string): Promise<void> {
  await GoIDEBindings.SuppressSecurityFinding(sessionId, finding, reason)
}

export async function unsuppressGoIDESecurityFinding(sessionId: string, fingerprint: string): Promise<void> {
  await GoIDEBindings.UnsuppressSecurityFinding(sessionId, fingerprint)
}

export async function saveGoIDESecurityBaseline(sessionId: string): Promise<number> {
  return GoIDEBindings.SaveSecurityBaseline(sessionId)
}

export async function clearGoIDESecurityBaseline(sessionId: string): Promise<void> {
  await GoIDEBindings.ClearSecurityBaseline(sessionId)
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
  return Events.On('code-studio:event', (event) => callback(event.data as GoIDEEvent))
}

export function subscribeGoIDEAppCloseRequests(callback: (request: GoIDEAppCloseRequest) => void): () => void {
  return Events.On('code-studio:close-requested', (event) => callback(event.data as GoIDEAppCloseRequest))
}

// --- Configurazioni Run persistenti -----------------------------------------

export async function listGoIDERunConfigurations(sessionId: string): Promise<GoIDERunConfiguration[]> {
  return GoIDEBindings.ListRunConfigurations(sessionId)
}

// A new draft has no timestamps yet: Go's time.Time rejects "", the zero time is what the backend replaces.
const ZERO_TIME = '0001-01-01T00:00:00Z'

export async function saveGoIDERunConfiguration(sessionId: string, config: GoIDERunConfiguration): Promise<GoIDERunConfiguration> {
  return GoIDEBindings.SaveRunConfiguration(sessionId, { ...config, createdAt: config.createdAt || ZERO_TIME, updatedAt: config.updatedAt || ZERO_TIME })
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

// --- Performance Studio (pprof) ---------------------------------------------

export type GoIDEProfileFile = Awaited<ReturnType<typeof GoIDEBindings.ListProfileFiles>>[number]
export type GoIDEProfileReport = Awaited<ReturnType<typeof GoIDEBindings.LoadProfile>>

/** Profili pprof (*.pprof) trovati nel progetto, dal più recente. */
export async function listGoIDEProfileFiles(sessionId: string): Promise<GoIDEProfileFile[]> {
  return GoIDEBindings.ListProfileFiles(sessionId)
}

/** Interpreta un profilo del progetto per le viste Top / Flame / Call graph. */
export async function loadGoIDEProfile(sessionId: string, relativePath: string): Promise<GoIDEProfileReport> {
  return GoIDEBindings.LoadProfile(sessionId, relativePath)
}

export type GoIDELiveProfileRequest = Parameters<typeof GoIDEBindings.CaptureLiveProfile>[0]

/** Scarica un profilo da /debug/pprof di un servizio locale e lo salva nel progetto. */
export async function captureGoIDELiveProfile(request: GoIDELiveProfileRequest): Promise<GoIDEProfileFile> {
  return GoIDEBindings.CaptureLiveProfile(request)
}

/** Registra qualche secondo di /debug/pprof/trace e salva la trace nel progetto. */
export async function captureGoIDELiveTrace(request: Omit<GoIDELiveProfileRequest, 'kind'>): Promise<GoIDEProfileFile> {
  return GoIDEBindings.CaptureLiveTrace({ ...request, kind: 'trace' })
}

export type GoIDETraceReport = Awaited<ReturnType<typeof GoIDEBindings.LoadTrace>>

/** File di esecuzione trace (`trace.out`, `*.trace`) trovati nel progetto. */
export async function listGoIDETraceFiles(sessionId: string): Promise<GoIDEProfileFile[]> {
  return GoIDEBindings.ListTraceFiles(sessionId)
}

/** Interpreta una traccia Go in una timeline per goroutine, scheduler, GC ed eventi. */
export async function loadGoIDETrace(sessionId: string, relativePath: string): Promise<GoIDETraceReport> {
  return GoIDEBindings.LoadTrace(sessionId, relativePath)
}

// --- Error Handling Intelligence ----------------------------------------------

export type GoIDEErrorReport = Awaited<ReturnType<typeof GoIDEBindings.AnalyzeErrorHandling>>
export type GoIDEErrorFinding = GoIDEErrorReport['findings'][number]
export type GoIDEErrorFix = NonNullable<GoIDEErrorFinding['fix']>
export type GoIDEErrorLocation = GoIDEErrorFinding['location']

/** Analizza la gestione degli errori di ogni modulo (go/packages: richiede un progetto autorizzato). */
export async function analyzeGoIDEErrorHandling(sessionId: string): Promise<GoIDEErrorReport> {
  return GoIDEBindings.AnalyzeErrorHandling(sessionId)
}

// --- Architecture Explorer --------------------------------------------------------

export type GoIDEArchitectureResult = Awaited<ReturnType<typeof GoIDEBindings.AnalyzeArchitecture>>
export type GoIDEArchitecture = NonNullable<GoIDEArchitectureResult['report']>
export type GoIDEArchInterface = GoIDEArchitecture['interfaces'][number]
export type GoIDEArchEntry = GoIDEArchitecture['entries'][number]
export type GoIDEArchSite = GoIDEArchEntry['site']

/** Package, chiamate, moduli, interfacce ed entry point di ogni modulo (go/packages: progetto autorizzato). */
export async function analyzeGoIDEArchitecture(sessionId: string): Promise<GoIDEArchitectureResult> {
  return GoIDEBindings.AnalyzeArchitecture(sessionId)
}

// --- Documentation Intelligence ------------------------------------------------

export type GoIDEDocumentation = Awaited<ReturnType<typeof GoIDEBindings.Documentation>>
export type GoIDEPackageDoc = GoIDEDocumentation['packages'][number]
export type GoIDEProtoFile = GoIDEDocumentation['protos'][number]

/** Documentazione dei package Go (go/doc) e dei file .proto: solo parsing, nessun processo. */
export async function loadGoIDEDocumentation(sessionId: string): Promise<GoIDEDocumentation> {
  return GoIDEBindings.Documentation(sessionId)
}

// --- Fuzzing Studio -------------------------------------------------------------

export type GoIDEFuzzTarget = Awaited<ReturnType<typeof GoIDEBindings.ListFuzzTargets>>[number]
export type GoIDEFuzzInput = GoIDEFuzzTarget['seeds'][number]
export type GoIDEFuzzInputContent = Awaited<ReturnType<typeof GoIDEBindings.ReadFuzzInput>>
export type GoIDEFuzzSource = 'testdata' | 'cache'

export async function listGoIDEFuzzTargets(sessionId: string): Promise<GoIDEFuzzTarget[]> {
  return GoIDEBindings.ListFuzzTargets(sessionId)
}

export async function readGoIDEFuzzInput(sessionId: string, target: GoIDEFuzzTarget, source: GoIDEFuzzSource, name: string): Promise<GoIDEFuzzInputContent> {
  return GoIDEBindings.ReadFuzzInput(sessionId, target.packageDir, target.name, source, name)
}

/** Copia un input generato in testdata/fuzz; restituisce il percorso relativo al progetto. */
export async function promoteGoIDEFuzzInput(sessionId: string, target: GoIDEFuzzTarget, name: string): Promise<string> {
  return GoIDEBindings.PromoteFuzzInput(sessionId, target.packageDir, target.name, name)
}

export async function deleteGoIDEFuzzInput(sessionId: string, target: GoIDEFuzzTarget, source: GoIDEFuzzSource, name: string): Promise<void> {
  return GoIDEBindings.DeleteFuzzInput(sessionId, target.packageDir, target.name, source, name)
}

// --- SonarQube (opzionale) ---------------------------------------------------

export type GoIDESonarConfig = Awaited<ReturnType<typeof GoIDEBindings.SonarConfigFor>>
export type GoIDESonarScannerInfo = Awaited<ReturnType<typeof GoIDEBindings.DetectSonarScanner>>
export type GoIDESonarScanResult = Awaited<ReturnType<typeof GoIDEBindings.RunSonarScan>>
export type GoIDESonarIssue = GoIDESonarScanResult['issues'][number]

export async function detectGoIDESonarScanner(sessionId: string): Promise<GoIDESonarScannerInfo> {
  return GoIDEBindings.DetectSonarScanner(sessionId)
}

export async function configureGoIDESonarScanner(sessionId: string, binary: string): Promise<void> {
  await GoIDEBindings.ConfigureSonarScanner(sessionId, binary)
}

export async function getGoIDESonarConfig(sessionId: string): Promise<GoIDESonarConfig> {
  return GoIDEBindings.SonarConfigFor(sessionId)
}

export async function saveGoIDESonarConfig(sessionId: string, config: GoIDESonarConfig): Promise<GoIDESonarConfig> {
  return GoIDEBindings.SaveSonarConfig(sessionId, config)
}

/** Il token resta in memoria per la sessione e non viene mai riletto dal backend. */
export async function setGoIDESonarToken(sessionId: string, token: string): Promise<void> {
  await GoIDEBindings.SetSonarToken(sessionId, token)
}

/**
 * Esegue sonar-scanner sul progetto e importa gli issue dalla Web API. Restituisce la
 * `CancellablePromise` del binding: `cancel()` ferma il ctx Go, il subprocess e il polling.
 */
export function runGoIDESonarScan(sessionId: string, token: string): CancellablePromise<GoIDESonarScanResult> {
  return GoIDEBindings.RunSonarScan(sessionId, token)
}

/** Reimporta gli issue già presenti sul server, senza rieseguire la scansione. Cancellabile come la scansione. */
export function fetchGoIDESonarIssues(sessionId: string, token: string): CancellablePromise<GoIDESonarScanResult> {
  return GoIDEBindings.FetchSonarIssues(sessionId, token)
}

export async function saveGoIDESonarBaseline(sessionId: string, token: string): Promise<number> {
  return GoIDEBindings.SaveSonarBaseline(sessionId, token)
}

export async function clearGoIDESonarBaseline(sessionId: string): Promise<void> {
  await GoIDEBindings.ClearSonarBaseline(sessionId)
}

// --- Terminale PTY ----------------------------------------------------------

export type GoIDETerminalProfile = TerminalProfile

export async function listGoIDETerminalProfiles(): Promise<GoIDETerminalProfile[]> {
  return GoIDEBindings.ListTerminalProfiles()
}

/** Ambiente in cui eseguire run e test: distro WSL, host SSH o container. */
export interface GoIDERemoteTarget {
  kind: 'wsl' | 'ssh' | 'container'
  name: string
  directory?: string
  devContainerConfig?: string
}

export async function listGoIDERemoteTargets(): Promise<GoIDERemoteTarget[]> {
  return (await GoIDEBindings.ListRemoteTargets()) as GoIDERemoteTarget[]
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

/**
 * Percorsi che non devono andare al provider AI: segreti noti, .adomnia/aiignore e la politica
 * .adomnia/ai-policy.json del progetto (localProvider: il modello gira su questa macchina).
 */
export async function listGoIDEAIExcludedPaths(sessionId: string, relativePaths: string[], localProvider: boolean): Promise<string[]> {
  return relativePaths.length === 0 ? [] : GoIDEBindings.AIExcludedPaths(sessionId, relativePaths, localProvider)
}

export type GoIDEAIPolicy = 'allowed' | 'local-only' | 'off'

export const getGoIDEProjectRules = (sessionId: string) => GoIDEBindings.AIProjectRules(sessionId)

export async function getGoIDEAIPolicy(sessionId: string): Promise<GoIDEAIPolicy> {
  return (await GoIDEBindings.AIProjectPolicy(sessionId)) as GoIDEAIPolicy
}

export async function setGoIDEAIPolicy(sessionId: string, policy: GoIDEAIPolicy): Promise<void> {
  await GoIDEBindings.SetAIProjectPolicy(sessionId, policy)
}

/** Un provider è locale se gira su questa macchina: Ollama o un endpoint compatibile su loopback. */
export function isLocalAIProvider(ai: { provider: string; baseURL?: string }): boolean {
  let host = ''
  try { host = new URL(ai.baseURL ?? '').hostname } catch { host = '' }
  const loopback = host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host)
  return (ai.provider === 'ollama' || ai.provider === 'openai-compatible') && loopback
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

export type AgentReview = AgentReviewModel
export type AgentReviewFile = AgentReviewFileModel

/** Evento emesso dal backend quando cambia la review delle modifiche di un agente in un progetto. */
export const AGENT_REVIEW_CHANGED_EVENT = 'agentReview.changed'

export const getAgentReview = (root: string): Promise<AgentReview> => GoIDEBindings.AgentReview(root)
export const acceptAgentFile = (root: string, path: string): Promise<void> => GoIDEBindings.AcceptAgentFile(root, path)
export const rejectAgentFile = (root: string, path: string): Promise<void> => GoIDEBindings.RejectAgentFile(root, path)
export const acceptAllAgentChanges = (root: string): Promise<void> => GoIDEBindings.AcceptAllAgentChanges(root)
export const rejectAllAgentChanges = (root: string): Promise<void> => GoIDEBindings.RejectAllAgentChanges(root)
export const acceptAgentHunks = (root: string, path: string, baseline: string): Promise<void> => GoIDEBindings.AcceptAgentHunks(root, path, baseline)
export const rejectAgentHunks = (root: string, path: string, content: string, expected: string): Promise<void> => GoIDEBindings.RejectAgentHunks(root, path, content, expected)

export function subscribeAgentReviewChanges(handler: (root: string) => void): () => void {
  return Events.On(AGENT_REVIEW_CHANGED_EVENT, (event) => handler((event.data as { root: string }).root))
}

/** Coordinate del pom.xml (anche non salvato) con le posizioni delle versioni: nessun file, nessuna rete. */
export async function getPomDependencies(sessionId: string, content: string): Promise<PomDependency[]> {
  return GoIDEBindings.PomDependencies(sessionId, content)
}

/** Versioni stabili su Maven Central per `group:artifact` → versione corrente. Solo su azione esplicita. */
export async function getPomVersions(sessionId: string, current: Record<string, string>): Promise<VersionInfo[]> {
  return GoIDEBindings.PomVersions(sessionId, current)
}

/**
 * Indice Spring del progetto: proprietà note, valori con il loro profilo, bean, iniezioni ed endpoint.
 * Solo filesystem — nessun server, nessuna rete.
 */
export async function getSpringIndex(sessionId: string): Promise<SpringIndex> {
  return GoIDEBindings.SpringIndex(sessionId)
}

/** JDK installati, scelta del progetto e versione richiesta dal build. */
export async function getJavaJdks(sessionId: string): Promise<JavaJDKReport> {
  return GoIDEBindings.JavaJDKs(sessionId)
}

/** Sceglie il JDK del progetto (Run, Debug e Test lo usano allo stesso modo); '' torna al JDK di sistema. */
export async function setJavaJdk(sessionId: string, home: string): Promise<void> {
  return GoIDEBindings.SetJavaJDK(sessionId, home)
}

/** Interprete Python candidato (dal report di `getPythonInterpreters`). */
export type GoIDEPythonInterpreter = PythonInterpreterReport['installed'][number]

/** Interpreti Python candidati, scelta corrente e — solo con il progetto autorizzato — versioni e strumenti. */
export async function getPythonInterpreters(sessionId: string, unit = ''): Promise<PythonInterpreterReport> {
  return GoIDEBindings.PythonUnitInterpreters(sessionId, unit)
}

export type GoIDEPythonUnitDependencies = PythonUnitDependencies

/** Dipendenze dichiarate dalle unità Python, con la versione risolta dal lockfile (lettura statica). */
export async function listPythonDependencies(sessionId: string): Promise<PythonUnitDependencies[]> {
  return GoIDEBindings.PythonDependencies(sessionId)
}

/** Sceglie l'interprete Python del progetto (unit = '') o di un'unità; path = '' torna alla scelta automatica. */
export async function setPythonInterpreter(sessionId: string, unit: string, path: string): Promise<void> {
  return GoIDEBindings.SetPythonInterpreter(sessionId, unit, path)
}

/** Installa uno strumento (debugpy) nell'interprete scelto; richiede la conferma con il comando esatto. */
export async function installPythonTool(sessionId: string, interpreter: string, tool: string, confirmed: boolean): Promise<Execution> {
  return GoIDEBindings.InstallPythonTool(sessionId, interpreter, tool, confirmed)
}

/** Ambiente Python dell'unità ('' = progetto): gestore, percorso, comandi di creazione e installazione. */
export type GoIDEPythonEnvironment = EnvironmentPlan

export async function getPythonEnvironment(sessionId: string, unit = ''): Promise<EnvironmentPlan> {
  return GoIDEBindings.PythonEnvironment(sessionId, unit)
}

/** Crea `.venv` nell'unità: solo su conferma, con il comando visibile e nessun download di Python. */
export async function createPythonEnvironment(sessionId: string, unit: string, interpreter: string, confirmed: boolean): Promise<Execution> {
  return GoIDEBindings.CreatePythonEnvironment(sessionId, unit, interpreter, confirmed)
}

/** Installa le dipendenze dichiarate nell'ambiente dell'unità: solo su conferma. */
export async function installPythonDependencies(sessionId: string, unit: string, confirmed: boolean): Promise<Execution> {
  return GoIDEBindings.InstallPythonDependencies(sessionId, unit, confirmed)
}

/** Toolchain Rust candidata (dal report di `getRustToolchains`). */
export type GoIDERustToolchain = RustToolchainReport['installed'][number]

/** Toolchain Rust candidate, scelta corrente e — solo con il progetto autorizzato — versione e host. */
export async function getRustToolchains(sessionId: string): Promise<RustToolchainReport> {
  return GoIDEBindings.RustToolchains(sessionId)
}

/** Sceglie il cargo del progetto; path = '' torna alla scelta automatica. */
export async function setRustToolchain(sessionId: string, path: string): Promise<void> {
  return GoIDEBindings.SetRustToolchain(sessionId, path)
}

/** Opzione "Low resources" per rust-analyzer (RS-9.5): spenge proc-macro e build script senza riavviare il server. */
export async function setRustLowResources(sessionId: string, enabled: boolean): Promise<void> {
  return GoIDEBindings.SetRustLowResources(sessionId, enabled)
}

/** Installa un componente rustup (es. rust-src, clippy): solo su conferma, con il comando esatto. */
export async function installRustComponent(sessionId: string, component: string, confirmed: boolean): Promise<Execution> {
  return GoIDEBindings.InstallRustComponent(sessionId, component, confirmed)
}

/** Installa un canale rustup (es. 1.85.0): solo su conferma. */
export async function installRustToolchain(sessionId: string, channel: string, confirmed: boolean): Promise<Execution> {
  return GoIDEBindings.InstallRustToolchain(sessionId, channel, confirmed)
}

/** Comando esatto che installerebbe un componente rustup. */
export async function previewRustComponentInstall(sessionId: string, component: string): Promise<ServerInstallPreview> {
  return GoIDEBindings.PreviewRustComponentInstall(sessionId, component)
}

/** Comando esatto che installerebbe un canale rustup. */
export async function previewRustToolchainInstall(sessionId: string, channel: string): Promise<ServerInstallPreview> {
  return GoIDEBindings.PreviewRustToolchainInstall(sessionId, channel)
}

/** Albero delle dipendenze dal Cargo.lock (offline) con i duplicati di versione in evidenza. */
export async function getRustDependencyTree(sessionId: string): Promise<CargoTreeNode[]> {
  return GoIDEBindings.RustDependencyTree(sessionId)
}

/** Ambiente Rust del progetto: variabili, `.cargo/config.toml`, cache di rust-analyzer, Low resources (RS-2). */
export async function getRustEnvironment(sessionId: string): Promise<RustEnvironmentReport> {
  return GoIDEBindings.RustEnvironment(sessionId)
}

/** Cancella la cache target di rust-analyzer dopo una conferma esplicita; mai la cartella dell'utente. */
export async function cleanRustAnalyzerCache(sessionId: string, confirmed: boolean): Promise<RustCacheCleanReport> {
  return GoIDEBindings.CleanRustAnalyzerCache(sessionId, confirmed)
}

/** Albero delle dipendenze Maven di un modulo (cartella relativa al progetto): lancia `mvn dependency:tree`. */
export async function getJavaDependencyTree(sessionId: string, module: string): Promise<TreeNode[]> {
  return GoIDEBindings.JavaDependencyTree(sessionId, module)
}

/** Collegamenti mapper MyBatis ↔ statement XML del progetto (analisi dei sorgenti, nessun server). */
export async function getMyBatisIndex(sessionId: string): Promise<MyBatisIndex> {
  return GoIDEBindings.MyBatisIndex(sessionId)
}

/** JVM locali dell'utente (jcmd -l). */
export async function getJavaJvms(sessionId: string): Promise<JVMProcess[]> {
  return GoIDEBindings.JavaJVMs(sessionId)
}

/** Memoria e GC di una JVM locale (jstat -gc). */
export async function getJavaJvmSample(sessionId: string, pid: number): Promise<JVMHeapSample> {
  return GoIDEBindings.JavaJVMSample(sessionId, pid)
}

/** Avvia una registrazione JFR; il file è completo dopo `stopJavaJfr`. */
export async function startJavaJfr(sessionId: string, pid: number): Promise<JavaJFRRecording> {
  return GoIDEBindings.JavaStartJFR(sessionId, pid)
}

export async function stopJavaJfr(sessionId: string, pid: number, name: string): Promise<void> {
  return GoIDEBindings.JavaStopJFR(sessionId, pid, name)
}

/** Versioni che il pom eredita da parent e BOM (già sul disco), per `group:artifact`. */
export async function getPomManagedVersions(sessionId: string, relativePath: string): Promise<Record<string, { version: string; owner: string } | undefined>> {
  return (await GoIDEBindings.PomManagedVersions(sessionId, relativePath)) ?? {}
}

/** Classi lanciabili: decise da JDT LS quando è pronto, altrimenti dalla scansione dei sorgenti. */
export async function getJavaMainClasses(sessionId: string): Promise<MainClassInfo[]> {
  return GoIDEBindings.JavaMainClasses(sessionId)
}

/** Endpoint HTTP MVC del progetto (route, metodo, posizione navigabile). */
export async function getSpringEndpoints(sessionId: string): Promise<SpringEndpoint[]> {
  return GoIDEBindings.SpringEndpoints(sessionId)
}

/**
 * Indicizza i `spring-configuration-metadata.json` degli jar già scaricati nella repository Maven
 * locale: porta i default e le descrizioni delle liberie nel completamento. Lavoro pesante, solo su
 * azione esplicita dell'utente; riprende dalla cache.
 */
export async function refreshSpringMetadata(sessionId: string, limit = 20000): Promise<SpringMetadataReport> {
  return GoIDEBindings.SpringMetadataRefresh(sessionId, limit)
}

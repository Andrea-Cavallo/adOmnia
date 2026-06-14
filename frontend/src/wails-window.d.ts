// Central declaration for window.go.main — shared by all Wails binding api files.
// Each file extends WailsGoMain via: declare global { interface WailsGoMain { ... } }

interface WailsGoMain {
  App: {
    LoadSettings: () => Promise<string>
    SaveSettings: (settingsJSON: string) => Promise<void>
    SaveBinaryFileBase64: (defaultName: string, dataBase64: string) => Promise<string>
    SignPdfDocumentBase64: (reqJSON: string) => Promise<string>
    VerifyPdfSignatureBase64: (pdfBase64: string) => Promise<string>
    InspectSigningCertificateBase64: (reqJSON: string) => Promise<string>
    StorageGet: (bucket: string, key: string) => Promise<string>
    StoragePut: (bucket: string, key: string, value: string) => Promise<void>
    StorageDelete: (bucket: string, key: string) => Promise<void>
    StorageList: (bucket: string, prefix: string) => Promise<string[]>
    StorageGetAll: (bucket: string) => Promise<Array<{ bucket: string; key: string; value: string }>>
    GetServerPort: () => Promise<number>
    GetStartupWindowChrome: () => Promise<string>
    SelectFolder: (title: string) => Promise<string>
    GetDevLogs: () => Promise<string>
    ClearDevLogs: () => Promise<void>
    CompareFolders: (left: string, right: string, maxFileMB: number) => Promise<string>
    ReadFolderDiffFile: (scanID: string, path: string, maxBytes: number) => Promise<string>
    RecordFrontendLog: (level: string, message: string) => Promise<void>
    ListLogFiles: () => Promise<Array<{ name: string; size: number; modTime: string }>>
    ReadLogFile: (filename: string) => Promise<string>
    IsDevMode: () => Promise<boolean>
    SetDevMode: (enabled: boolean) => Promise<void>
    OpenDevLogsFolder: () => Promise<void>
    GetVaultTimeout: () => Promise<number>
    SetVaultTimeout: (minutes: number) => Promise<void>
  }
  DockerLab: {
    GetPresets: () => Promise<PresetDef[]>
    GenerateLab: (ids: string[]) => Promise<LabOutput>
  }
  AIEngine: {
    Configure: (configJSON: string) => Promise<void>
    TestConnection: (configJSON: string) => Promise<string>
    Complete: (provider: string, prompt: string, maxTokens: number) => Promise<string>
    GenerateMockEndpoints: (inputType: string, userInput: string) => Promise<string>
  }
  GitSync: {
    IsGitInstalled: () => Promise<boolean>
    InitRepo: (repoPath: string) => Promise<void>
    Clone: (remoteURL: string, destination: string) => Promise<void>
    ConfigureUser: (repoPath: string, name: string, email: string) => Promise<void>
    AddIgnorePattern: (repoPath: string, pattern: string) => Promise<void>
    GetStatus: (repoPath: string) => Promise<string>
    Overview: (repoPath: string, limit: number) => Promise<string>
    CommitAll: (repoPath: string, message: string) => Promise<string>
    Fetch: (repoPath: string) => Promise<void>
    AddRemote: (repoPath: string, name: string, remoteURL: string) => Promise<void>
    RemoveRemote: (repoPath: string, name: string) => Promise<void>
    Push: (repoPath: string, remote: string) => Promise<void>
    Pull: (repoPath: string, remote: string) => Promise<void>
    Stash: (repoPath: string) => Promise<void>
    StashPop: (repoPath: string) => Promise<void>
    StashDrop: (repoPath: string, stashRef: string) => Promise<void>
    Log: (repoPath: string, limit: number) => Promise<string>
    Show: (repoPath: string, ref: string) => Promise<string>
    StageFile: (repoPath: string, path: string) => Promise<void>
    UnstageFile: (repoPath: string, path: string) => Promise<void>
    RestoreFile: (repoPath: string, path: string) => Promise<void>
    RemoveFile: (repoPath: string, path: string) => Promise<void>
    MoveFile: (repoPath: string, oldPath: string, newPath: string) => Promise<void>
    CreateBranch: (repoPath: string, branch: string) => Promise<void>
    CheckoutBranch: (repoPath: string, branch: string) => Promise<void>
    CreateAndCheckoutBranch: (repoPath: string, branch: string) => Promise<void>
    MergeBranch: (repoPath: string, branch: string) => Promise<void>
    RebaseBranch: (repoPath: string, branch: string) => Promise<void>
    ResetHard: (repoPath: string, ref: string) => Promise<void>
    CheckoutConflictSide: (repoPath: string, path: string, side: string) => Promise<void>
    AbortIntegration: (repoPath: string) => Promise<void>
    CompareRefs: (repoPath: string, refA: string, refB: string) => Promise<string>
    GetFileDiff: (repoPath: string, refA: string, refB: string, filePath: string) => Promise<string>
    GetWorkingTreeFileSnapshot: (repoPath: string, filePath: string, oldPath: string) => Promise<string>
    CreateTag: (repoPath: string, name: string, ref: string) => Promise<void>
    DeleteTag: (repoPath: string, name: string) => Promise<void>
  }
  MCPClient: {
    Connect: (serverConfigJSON: string) => Promise<string>
    ConnectSession: (sessionID: string, serverConfigJSON: string) => Promise<string>
    Disconnect: () => Promise<void>
    DisconnectSession: (sessionID: string) => Promise<void>
    GetSessionStatus: (sessionID: string) => Promise<string>
    ListTools: () => Promise<string>
    ListToolsSession: (sessionID: string) => Promise<string>
    CallTool: (toolName: string, argsJSON: string) => Promise<string>
    CallToolSession: (sessionID: string, toolName: string, argsJSON: string) => Promise<string>
    ListResources: () => Promise<string>
    ListResourcesSession: (sessionID: string) => Promise<string>
    ListPrompts: () => Promise<string>
    ListPromptsSession: (sessionID: string) => Promise<string>
    GetPrompt: (promptName: string, argsJSON: string) => Promise<string>
    GetPromptSession: (sessionID: string, promptName: string, argsJSON: string) => Promise<string>
    ListSessions: () => Promise<string>
    RestartSession: (sessionID: string) => Promise<string>
  }
  MCPServerGenerator: {
    Generate: (inputJSON: string, outputDir: string) => Promise<string>
  }
  SchedulerBinding: {
    AddJob: (name: string, cronExpr: string, requestID: string) => Promise<import('@/wailsjs/go/main/SchedulerBinding').ScheduledJob>
    UpdateJob: (id: string, name: string, cronExpr: string, requestID: string) => Promise<import('@/wailsjs/go/main/SchedulerBinding').ScheduledJob>
    DeleteJob: (id: string) => Promise<void>
    EnableJob: (id: string) => Promise<void>
    DisableJob: (id: string) => Promise<void>
    ListJobs: () => Promise<import('@/wailsjs/go/main/SchedulerBinding').ScheduledJob[]>
    GetHistory: (jobID: string) => Promise<import('@/wailsjs/go/main/SchedulerBinding').JobRun[]>
  }
}

interface DockerService {
  image: string
  ports: string[]
  environment?: Record<string, string>
  volumes?: string[]
  command?: string
  dependsOn?: string[]
  restart?: string
  healthCheck?: {
    test: string[]
    interval: string
    timeout: string
    retries: number
  }
  networks?: string[]
}

interface PresetDef {
  id: string
  name: string
  description: string
  tag: string
  services: Record<string, DockerService>
  volumes?: string[]
  networks?: string[]
  envVars: Record<string, string>
  readmeIntro: string
  readmeSteps: string[]
}

interface LabOutput {
  composeContent: string
  envContent: string
  readmeContent: string
}

interface Window {
  go: { main: WailsGoMain }
}

// Central declaration for window.go.main — shared by all Wails binding api files.
// Each file extends WailsGoMain via: declare global { interface WailsGoMain { ... } }

interface WailsGoMain {
  App: {
    LoadSettings: () => Promise<string>
    SaveSettings: (settingsJSON: string) => Promise<void>
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

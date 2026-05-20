export interface PresetDef {
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

export interface DockerService {
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

export interface LabOutput {
  composeContent: string
  envContent: string
  readmeContent: string
}

export interface ContainerStatus {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  running: boolean
}

export interface LabRunResult {
  projectName: string
  dir: string
  ids: string[]
  output: string
}

export interface LabInfo {
  projectName: string
  status: string
  configFiles: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getBinding(): any {
  return (window as any)?.go?.main?.DockerLab
}

export async function getPresets(): Promise<PresetDef[]> {
  try {
    const b = getBinding()
    if (!b) return []
    return await b.GetPresets()
  } catch {
    return []
  }
}

export async function generateLab(ids: string[]): Promise<LabOutput> {
  const b = getBinding()
  if (!b) return { composeContent: '', envContent: '', readmeContent: '' }
  return await b.GenerateLab(ids)
}

export async function labUp(ids: string[]): Promise<LabRunResult> {
  const b = getBinding()
  if (!b) throw new Error('Docker Lab backend not available')
  return await b.LabUp(ids)
}

export async function labDown(projectName: string): Promise<string> {
  const b = getBinding()
  if (!b) throw new Error('Docker Lab backend not available')
  return await b.LabDown(projectName)
}

export async function labStatus(projectName: string): Promise<ContainerStatus[]> {
  const b = getBinding()
  if (!b) return []
  try {
    return await b.LabStatus(projectName)
  } catch {
    return []
  }
}

export async function labLogs(projectName: string, lines = 150): Promise<string> {
  const b = getBinding()
  if (!b) return ''
  try {
    return await b.LabLogs(projectName, lines)
  } catch {
    return ''
  }
}

export async function labList(): Promise<LabInfo[]> {
  const b = getBinding()
  if (!b) return []
  try {
    return await b.LabList()
  } catch {
    return []
  }
}

// Python Bridge API — Wails binding wrappers for PythonBridge Go struct.

export interface RuntimeInfo {
  available: boolean
  path: string
  version: string
  source: string // "embedded" or "system"
}

function getPythonBridge() {
  return (window as unknown as { go: { main: { PythonBridge: PythonBridgeBinding } } }).go?.main
    ?.PythonBridge
}

interface PythonBridgeBinding {
  GetRuntimeInfo: () => Promise<RuntimeInfo>
  GetRuntimeStatus: () => Promise<Record<string, unknown>>
  GetWorkers: () => Promise<Array<Record<string, unknown>>>
  SpawnWorker: (pluginID: string, configJSON: string) => Promise<void>
  StopWorker: (pluginID: string) => Promise<void>
  Execute: (pluginID: string, action: string, payloadJSON: string) => Promise<string>
  ExecuteStream: (pluginID: string, action: string, payloadJSON: string) => Promise<void>
}

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  try {
    const bridge = getPythonBridge()
    if (!bridge) {
      return { available: false, path: '', version: '', source: '' }
    }
    // Wails may return PascalCase (Go struct) or camelCase (JSON tags) depending on version
    const raw = (await bridge.GetRuntimeInfo()) as unknown as Record<string, unknown>
    return {
      available: (raw.available ?? raw.Available ?? false) as boolean,
      path: (raw.path ?? raw.Path ?? '') as string,
      version: (raw.version ?? raw.Version ?? '') as string,
      source: (raw.source ?? raw.Source ?? '') as string,
    }
  } catch {
    return { available: false, path: '', version: '', source: '' }
  }
}

export async function executePluginAction(
  pluginID: string,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<string> {
  try {
    const bridge = getPythonBridge()
    if (!bridge) return ''
    return await bridge.Execute(pluginID, action, JSON.stringify(payload))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Execution failed'
    throw new Error(message)
  }
}

export async function executePluginActionStream(
  pluginID: string,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    const bridge = getPythonBridge()
    if (!bridge) return
    await bridge.ExecuteStream(pluginID, action, JSON.stringify(payload))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stream execution failed'
    throw new Error(message)
  }
}

export async function spawnWorker(pluginID: string, config: Record<string, string> = {}): Promise<void> {
  try {
    const bridge = getPythonBridge()
    if (!bridge) return
    await bridge.SpawnWorker(pluginID, JSON.stringify(config))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to spawn worker'
    throw new Error(message)
  }
}

export async function stopWorker(pluginID: string): Promise<void> {
  try {
    const bridge = getPythonBridge()
    if (!bridge) return
    await bridge.StopWorker(pluginID)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to stop worker'
    throw new Error(message)
  }
}

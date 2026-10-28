import type { BackendDevLogEntry } from '@/stores/devLogs'
import * as AppBindings from '../../bindings/github.com/Andrea-Cavallo/adOmnia/app'

export interface LogFileInfo {
  name: string
  size: number
  modTime: string
}

function appBinding() {
  return AppBindings
}

export interface BackendDevLogChunk {
  entries: BackendDevLogEntry[]
  /** Offset in byte da passare alla lettura successiva. */
  next: number
}

/** Solo le voci scritte dopo `offset`: il polling periodico non rilegge più l'intero file. */
export async function getBackendDevLogsSince(offset: number): Promise<BackendDevLogChunk> {
  const chunk = await appBinding().GetDevLogsSince(offset)
  return { entries: (chunk?.entries ?? []) as unknown as BackendDevLogEntry[], next: chunk?.next ?? offset }
}

export async function clearBackendDevLogs(): Promise<void> {
  await appBinding()?.ClearDevLogs?.()
}

export async function recordFrontendDevLog(level: string, message: string): Promise<void> {
  await appBinding()?.RecordFrontendLog?.(level, message)
}

export async function listLogFiles(): Promise<LogFileInfo[]> {
  try {
    const binding = appBinding()
    if (!binding) return []
    return await binding.ListLogFiles() ?? []
  } catch {
    return []
  }
}

export async function readLogFile(filename: string): Promise<BackendDevLogEntry[]> {
  try {
    const binding = appBinding()
    if (!binding) return []
    const raw = await binding.ReadLogFile(filename)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

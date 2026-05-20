import type { BackendDevLogEntry } from '@/stores/devLogs'

export interface LogFileInfo {
  name: string
  size: number
  modTime: string
}

function appBinding() {
  return window.go?.main?.App
}

export async function getBackendDevLogs(): Promise<BackendDevLogEntry[]> {
  const raw = await appBinding()?.GetDevLogs?.()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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

import { safeSetItem } from '@/lib/safeLocalStorage'

/** A file opened in Code Studio, remembered locally so the Hub can offer "Continue coding". */
export interface RecentFile {
  name: string
  relativePath: string
  projectName: string
  projectRoot: string
  openedAt: number
}

const KEY = 'adomnia.recentFiles.v1'
const MAX = 20

function isRecentFile(value: unknown): value is RecentFile {
  const item = value as Partial<RecentFile> | null
  return !!item && typeof item.name === 'string' && typeof item.relativePath === 'string'
    && typeof item.projectName === 'string' && typeof item.projectRoot === 'string' && typeof item.openedAt === 'number'
}

export function parseRecentFiles(raw: string | null): RecentFile[] {
  try {
    const data: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(data) ? data.filter(isRecentFile).slice(0, MAX) : []
  } catch {
    return []
  }
}

export function loadRecentFiles(): RecentFile[] {
  try { return parseRecentFiles(localStorage.getItem(KEY)) } catch { return [] }
}

/** Newest first; the same file in the same project appears once. */
export function withRecentFile(list: readonly RecentFile[], file: Omit<RecentFile, 'openedAt'>, now: number): RecentFile[] {
  const same = (item: RecentFile) => item.projectRoot === file.projectRoot && item.relativePath === file.relativePath
  return [{ ...file, openedAt: now }, ...list.filter((item) => !same(item))].slice(0, MAX)
}

export function recordRecentFile(file: Omit<RecentFile, 'openedAt'>): void {
  safeSetItem(KEY, JSON.stringify(withRecentFile(loadRecentFiles(), file, Date.now())))
}

/** Folder shown next to a file: project name plus the file's directory, e.g. `adOmnia/cmd/secscan`. */
export function recentFileFolder(file: RecentFile): string {
  const dir = file.relativePath.split('/').slice(0, -1).join('/')
  return dir ? `${file.projectName}/${dir}` : file.projectName
}

/** Compact age: `now`, `5m ago`, `2h ago`, `3d ago`. */
export function timeAgo(then: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - then) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

import { safeSetItem } from '@/lib/safeLocalStorage'

const RECENT_WORKSPACES_KEY = 'adomnia.recentWorkspaces'
const MAX_RECENT_WORKSPACES = 5

export interface WorkspaceMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  tabs: number
}

export interface RecentWorkspace extends WorkspaceMeta {
  openedAt: string
}

export function loadRecentWorkspaces(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is RecentWorkspace => (
        typeof item === 'object' && item !== null &&
        typeof item.name === 'string' &&
        typeof item.openedAt === 'string' &&
        typeof item.updatedAt === 'string' &&
        typeof item.tabs === 'number'
      ))
      .slice(0, MAX_RECENT_WORKSPACES)
  } catch {
    return []
  }
}

export function rememberRecentWorkspace(workspace: WorkspaceMeta): RecentWorkspace[] {
  const next = [
    { ...workspace, openedAt: new Date().toISOString() },
    ...loadRecentWorkspaces().filter((item) => item.name !== workspace.name),
  ].slice(0, MAX_RECENT_WORKSPACES)
  safeSetItem(RECENT_WORKSPACES_KEY, JSON.stringify(next))
  return next
}

export function removeRecentWorkspace(name: string): void {
  safeSetItem(
    RECENT_WORKSPACES_KEY,
    JSON.stringify(loadRecentWorkspaces().filter((workspace) => workspace.name !== name)),
  )
}

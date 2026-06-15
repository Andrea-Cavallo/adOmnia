// Persistence for Git Sync saved repositories (workspaces).
// Stored locally so users don't have to re-import a repo path every session and
// can switch between known repositories from the Git Sync sidebar.

const STORAGE_KEY = 'adomnia.git.repos'
const LAST_KEY = 'adomnia.git.lastRepo'
const MAX_REPOS = 30

export interface SavedRepo {
  path: string
  name: string
  addedAt: number
}

function repoName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

export function loadRepos(): SavedRepo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is SavedRepo => typeof item === 'object' && item !== null && typeof (item as SavedRepo).path === 'string')
      .map((item) => ({ path: item.path, name: item.name || repoName(item.path), addedAt: item.addedAt || Date.now() }))
  } catch {
    return []
  }
}

function persist(repos: SavedRepo[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(repos))
  } catch {
    // Ignore quota / serialization failures; persistence is best-effort.
  }
}

/** Add or refresh a repo, returning the new immutable list (most recent first). */
export function addRepo(repos: SavedRepo[], path: string): SavedRepo[] {
  const trimmed = path.trim()
  if (!trimmed) return repos
  const existing = repos.find((repo) => repo.path === trimmed)
  const entry: SavedRepo = { path: trimmed, name: existing?.name || repoName(trimmed), addedAt: Date.now() }
  const next = [entry, ...repos.filter((repo) => repo.path !== trimmed)].slice(0, MAX_REPOS)
  persist(next)
  return next
}

export function removeRepo(repos: SavedRepo[], path: string): SavedRepo[] {
  const next = repos.filter((repo) => repo.path !== path)
  persist(next)
  return next
}

export function loadLastRepo(): string {
  try {
    return localStorage.getItem(LAST_KEY) || ''
  } catch {
    return ''
  }
}

export function saveLastRepo(path: string): void {
  try {
    if (path) localStorage.setItem(LAST_KEY, path)
    else localStorage.removeItem(LAST_KEY)
  } catch {
    // Best-effort persistence.
  }
}

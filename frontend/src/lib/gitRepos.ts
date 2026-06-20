// Persistence for Git Sync saved repositories (workspaces).
// Stored locally so users don't have to re-import a repo path every session and
// can switch between known repositories from the Git Sync sidebar.

const STORAGE_KEY = 'adomnia.git.repos'
const LAST_KEY = 'adomnia.git.lastRepo'
const PINNED_BRANCHES_KEY = 'adomnia.git.pinnedBranches'
const MAX_REPOS = 30

export interface SavedRepo {
  path: string
  name: string
  addedAt: number
  pinned: boolean
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
      .map((item) => ({ path: item.path, name: item.name || repoName(item.path), addedAt: item.addedAt || Date.now(), pinned: item.pinned === true }))
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
  const entry: SavedRepo = { path: trimmed, name: existing?.name || repoName(trimmed), addedAt: Date.now(), pinned: existing?.pinned ?? false }
  const next = [entry, ...repos.filter((repo) => repo.path !== trimmed)]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.addedAt - a.addedAt)
    .slice(0, MAX_REPOS)
  persist(next)
  return next
}

export function toggleRepoPin(repos: SavedRepo[], path: string): SavedRepo[] {
  const next = repos
    .map((repo) => repo.path === path ? { ...repo, pinned: !repo.pinned } : repo)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.addedAt - a.addedAt)
  persist(next)
  return next
}

function loadPinnedBranchMap(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_BRANCHES_KEY) || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const clean: Record<string, string[]> = {}
    for (const [repo, branches] of Object.entries(parsed)) {
      if (Array.isArray(branches)) clean[repo] = branches.filter((branch): branch is string => typeof branch === 'string')
    }
    return clean
  } catch {
    return {}
  }
}

export function loadPinnedBranches(repoPath: string): string[] {
  return loadPinnedBranchMap()[repoPath] ?? []
}

export function toggleBranchPin(repoPath: string, branch: string): string[] {
  if (!repoPath || !branch) return []
  const map = loadPinnedBranchMap()
  const current = map[repoPath] ?? []
  map[repoPath] = current.includes(branch) ? current.filter((item) => item !== branch) : [...current, branch]
  try { localStorage.setItem(PINNED_BRANCHES_KEY, JSON.stringify(map)) } catch { /* best effort */ }
  return map[repoPath]
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

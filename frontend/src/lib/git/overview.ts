// Shared parsing of the `GitSync.Overview` payload. Used by the Hub Git Sync panel
// and by the Go Studio Git tool window so both read the repository the same way.
import type { CommitInfo, FileChange } from './types'

export interface GitStatus {
  branch: string
  dirty: boolean
  aheadCount: number
  behindCount: number
  modified: string[]
  untracked: string[]
}

export interface BranchInfo {
  name: string
  remote: boolean
  current: boolean
  upstream: string
  commitHash: string
  updated: string
}

export interface RemoteInfo {
  name: string
  url: string
}

export interface GitOverview {
  status: GitStatus
  changes: FileChange[]
  conflicts: FileChange[]
  branches: BranchInfo[]
  remotes: RemoteInfo[]
  stashes: string[]
  commits: CommitInfo[]
}

export const emptyGitStatus: GitStatus = { branch: '', dirty: false, aheadCount: 0, behindCount: 0, modified: [], untracked: [] }

export function parseJSON<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function normalizeCommit(commit: Partial<CommitInfo>): CommitInfo {
  return {
    hash: commit.hash ?? '',
    fullHash: commit.fullHash ?? commit.hash ?? '',
    parents: Array.isArray(commit.parents) ? commit.parents : [],
    author: commit.author ?? '',
    date: commit.date ?? '',
    message: commit.message ?? '',
    decorations: Array.isArray(commit.decorations) ? commit.decorations : [],
  }
}

export function normalizeBranch(branch: Partial<BranchInfo>): BranchInfo {
  return {
    name: branch.name ?? '',
    remote: branch.remote ?? false,
    current: branch.current ?? false,
    upstream: branch.upstream ?? '',
    commitHash: branch.commitHash ?? '',
    updated: branch.updated ?? '',
  }
}

export function normalizeChange(change: Partial<FileChange>): FileChange {
  return {
    path: change.path ?? '',
    index: change.index ?? '',
    worktree: change.worktree ?? '',
    status: change.status ?? '',
    conflicted: change.conflicted ?? false,
  }
}

/** Backend nil slices serialize as null: every collection is coerced to an array. */
export function parseGitOverview(raw: string): GitOverview {
  const parsed = parseJSON<Partial<GitOverview>>(raw, {})
  return {
    status: parsed.status
      ? { ...emptyGitStatus, ...parsed.status, modified: parsed.status.modified ?? [], untracked: parsed.status.untracked ?? [] }
      : emptyGitStatus,
    changes: (parsed.changes ?? []).map((change) => normalizeChange(change ?? {})),
    conflicts: (parsed.conflicts ?? []).map((change) => normalizeChange(change ?? {})),
    branches: (parsed.branches ?? []).map((branch) => normalizeBranch(branch ?? {})),
    remotes: (parsed.remotes ?? []).map((remote) => ({ name: remote?.name ?? '', url: remote?.url ?? '' })),
    stashes: parsed.stashes ?? [],
    commits: (parsed.commits ?? []).map((commit) => normalizeCommit(commit ?? {})),
  }
}

/** Git's index model: X (index) set means staged, Y (worktree) set means unstaged; `MM` is both. */
export function isStagedChange(change: FileChange): boolean {
  return !change.conflicted && change.index !== '' && change.index !== ' ' && change.index !== '?'
}

export function isUnstagedChange(change: FileChange): boolean {
  return !change.conflicted && change.worktree !== '' && change.worktree !== ' '
}

export function changeLabel(change: FileChange): string {
  if (change.conflicted) return 'Conflict'
  if (change.status === '??') return 'Untracked'
  if (change.index === 'A' || change.worktree === 'A') return 'Added'
  if (change.index === 'D' || change.worktree === 'D') return 'Deleted'
  if (change.index === 'R' || change.worktree === 'R') return 'Renamed'
  return 'Modified'
}

export function shortBranch(name: string): string {
  return name.replace(/^remotes\//, '').replace(/^origin\//, '')
}

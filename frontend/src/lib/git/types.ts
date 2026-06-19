// Shared Git Sync types. These mirror the Go structs in internal/git exactly
// (JSON field names) so the service layer can parse binding output directly.

export interface RepoState {
  branch: string
  head: string
  detached: boolean
  dirty: boolean
  published: boolean
  protected: boolean
  operation: string // "" | merge | rebase | cherry-pick | revert | bisect
  conflictedFiles: string[]
  aheadCount: number
  behindCount: number
}

export interface FileChange {
  path: string
  index: string
  worktree: string
  status: string
  conflicted: boolean
}

// Result codes mirror the Go constants in internal/git/result.go.
export type OpCode = 'ok' | 'conflict' | 'dirty' | 'protected' | 'published' | 'aborted' | 'error'

export interface OpResult {
  success: boolean
  command: string
  stdout: string
  stderr: string
  state: RepoState
  conflicts: FileChange[]
  error: string
  code: OpCode
}

export interface CommitMeta {
  hash: string
  fullHash: string
  parents: string[]
  isMerge: boolean
  isHead: boolean
  onCurrentBranch: boolean
  published: boolean
  branches: string[]
  tags: string[]
  remoteURL: string
  subject: string
  body: string
  author: string
  authorEmail: string
  date: string
}

export interface ChangedFile {
  status: string
  path: string
  oldPath?: string
}

export interface CompareResult {
  refA: string
  refB: string
  files: ChangedFile[]
  additions: number
  deletions: number
}

export interface CommitInfo {
  hash: string
  fullHash: string
  parents: string[]
  author: string
  date: string
  message: string
  decorations: string[]
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

export interface RebaseTodoItem {
  action: RebaseAction
  hash: string
  message: string
  newMessage?: string
}

export interface RebasePlan {
  branch: string
  baseRef: string
  published: boolean
  items: RebaseTodoItem[]
}

export interface SearchFilters {
  author?: string
  message?: string
  file?: string
  branch?: string
  after?: string
  before?: string
  sha?: string
  isMerge?: boolean
  pickaxe?: string
  pickaxeMode?: 'S' | 'G'
  all?: boolean
  limit?: number
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

// The empty-tree object id — diff base for a commit with no parent (the very
// first commit). Mirrors the constant used in GitSyncPanel.
export const EMPTY_TREE_REF = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

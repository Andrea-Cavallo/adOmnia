import { isDesktopRuntime } from '@/lib/desktopRuntime'
// Git Sync service layer. The single place the UI talks to git: it wraps the
// Wails bindings, parses the typed OpResult contract, and normalizes errors so
// callers never scrape terminal output or handle raw rejections. No React, no
// git commands live in components.

import * as GitSync from '@/wailsjs/go/main/GitSync'
import type {
  ChangedFile,
  CommitInfo,
  CommitMeta,
  CompareResult,
  OpResult,
  RebasePlan,
  RebaseTodoItem,
  RepoState,
  ResetMode,
  SearchFilters,
} from './types'

// Wails 3 has no `window.go` global; services come from generated bindings.
function hasBinding(): boolean {
  return isDesktopRuntime()
}

/** Build a failed OpResult for a transport/parse error so callers stay simple. */
function syntheticFail(message: string): OpResult {
  return {
    success: false,
    command: '',
    stdout: '',
    stderr: message,
    state: {
      branch: '', head: '', detached: false, dirty: false, published: false,
      protected: false, operation: '', conflictedFiles: [], aheadCount: 0, behindCount: 0,
    },
    conflicts: [],
    error: message,
    code: 'error',
  }
}

/** Run an operation binding, always resolving to a typed OpResult. */
async function callOp(run: () => Promise<string>): Promise<OpResult> {
  if (!hasBinding()) return syntheticFail('Git Sync requires the desktop backend.')
  try {
    return JSON.parse(await run()) as OpResult
  } catch (e) {
    return syntheticFail(e instanceof Error ? e.message : String(e))
  }
}

/** Run a query binding returning typed JSON, throwing on failure. */
async function callQuery<T>(run: () => Promise<string>): Promise<T> {
  if (!hasBinding()) throw new Error('Git Sync requires the desktop backend.')
  return JSON.parse(await run()) as T
}

// ── Inspection ───────────────────────────────────────────────────────────────

export const getRepoState = (repo: string): Promise<RepoState> =>
  callQuery<RepoState>(() => GitSync.GetRepoState(repo))

export const getCommitMeta = (repo: string, ref: string): Promise<CommitMeta> =>
  callQuery<CommitMeta>(() => GitSync.GetCommitMeta(repo, ref))

// ── Checkout / branch / tag ──────────────────────────────────────────────────

export const checkoutCommit = (repo: string, ref: string, newBranch = ''): Promise<OpResult> =>
  callOp(() => GitSync.CheckoutCommit(repo, ref, newBranch))

export const createBranchFromCommit = (
  repo: string, branch: string, ref: string, checkout: boolean, push: boolean,
): Promise<OpResult> => callOp(() => GitSync.CreateBranchFromCommit(repo, branch, ref, checkout, push))

export const createTagFromCommit = (
  repo: string, name: string, ref: string, message: string, annotated: boolean, push: boolean,
): Promise<OpResult> => callOp(() => GitSync.CreateTagFromCommit(repo, name, ref, message, annotated, push))

// ── Compare / patch / restore ────────────────────────────────────────────────

export const compareCommits = (repo: string, refA: string, refB: string): Promise<CompareResult> =>
  callQuery<CompareResult>(() => GitSync.CompareCommits(repo, refA, refB))

/** Files changed between two refs (kept for back-compat with the compare tab). */
export const compareRefs = (repo: string, refA: string, refB: string): Promise<ChangedFile[]> =>
  callQuery<ChangedFile[]>(() => GitSync.CompareRefs(repo, refA, refB))

export const getFileDiff = (repo: string, refA: string, refB: string, path: string): Promise<string> =>
  GitSync.GetFileDiff(repo, refA, refB, path)

export const createPatch = (repo: string, refA: string, refB: string): Promise<string> =>
  GitSync.CreatePatch(repo, refA, refB)

export const restoreFileFromCommit = (repo: string, ref: string, path: string): Promise<OpResult> =>
  callOp(() => GitSync.RestoreFileFromCommit(repo, ref, path))

export const fileAtCommit = (repo: string, ref: string, path: string): Promise<string> =>
  GitSync.FileAtCommit(repo, ref, path)

export const fileHistory = (repo: string, path: string, n = 100): Promise<CommitInfo[]> =>
  callQuery<CommitInfo[]>(() => GitSync.FileHistory(repo, path, n))

// ── Cherry-pick / revert / reset / amend / undo / squash / extract ───────────

export const cherryPickCommits = (
  repo: string, shas: string[], noCommit: boolean, newBranch: string, recordOrigin: boolean,
): Promise<OpResult> => callOp(() => GitSync.CherryPick(repo, shas, noCommit, newBranch, recordOrigin))

export const generateRevertMessage = (repo: string, sha: string): Promise<string> =>
  GitSync.GenerateRevertMessage(repo, sha)

export const revertCommit = (repo: string, sha: string, message: string, mainline: number): Promise<OpResult> =>
  callOp(() => GitSync.RevertCommit(repo, sha, message, mainline))

export const resetBranchToCommit = (repo: string, sha: string, mode: ResetMode): Promise<OpResult> =>
  callOp(() => GitSync.ResetBranch(repo, sha, mode))

export const amendCommit = (repo: string, message: string, addAll: boolean): Promise<OpResult> =>
  callOp(() => GitSync.AmendCommit(repo, message, addAll))

export const undoLastCommit = (repo: string, keepStaged: boolean): Promise<OpResult> =>
  callOp(() => GitSync.UndoLastCommit(repo, keepStaged))

export const squashHeadIntoPrevious = (repo: string): Promise<OpResult> =>
  callOp(() => GitSync.SquashHeadIntoPrevious(repo))

export const extractHeadToNewBranch = (repo: string, newBranch: string): Promise<OpResult> =>
  callOp(() => GitSync.ExtractHeadToNewBranch(repo, newBranch))

export const forcePush = (repo: string, branch: string): Promise<OpResult> =>
  callOp(() => GitSync.ForcePush(repo, branch))

// ── Conflict resolver ────────────────────────────────────────────────────────

export const continueOperation = (repo: string): Promise<OpResult> =>
  callOp(() => GitSync.ContinueOperation(repo))
export const skipOperation = (repo: string): Promise<OpResult> =>
  callOp(() => GitSync.SkipOperation(repo))
export const abortOperation = (repo: string): Promise<OpResult> =>
  callOp(() => GitSync.AbortOperation(repo))

// ── Interactive rebase / bisect / search ─────────────────────────────────────

export const getRebaseTodo = (repo: string, baseRef: string): Promise<RebasePlan> =>
  callQuery<RebasePlan>(() => GitSync.GetRebaseTodo(repo, baseRef))

export const startInteractiveRebase = (repo: string, baseRef: string, items: RebaseTodoItem[]): Promise<OpResult> =>
  callOp(() => GitSync.StartInteractiveRebase(repo, baseRef, JSON.stringify(items)))

export const rebaseOnto = (repo: string, targetRef: string): Promise<OpResult> =>
  callOp(() => GitSync.RebaseOnto(repo, targetRef))

export const startBisect = (repo: string, bad: string, good: string): Promise<OpResult> =>
  callOp(() => GitSync.BisectStart(repo, bad, good))
export const bisectMark = (repo: string, verdict: 'good' | 'bad' | 'skip'): Promise<OpResult> =>
  callOp(() => GitSync.BisectMark(repo, verdict))
export const bisectRun = (repo: string, command: string): Promise<OpResult> =>
  callOp(() => GitSync.BisectRun(repo, command))
export const bisectReset = (repo: string): Promise<OpResult> =>
  callOp(() => GitSync.BisectReset(repo))

export const searchHistory = (repo: string, filters: SearchFilters): Promise<CommitInfo[]> =>
  callQuery<CommitInfo[]>(() => GitSync.SearchHistory(repo, JSON.stringify(filters)))

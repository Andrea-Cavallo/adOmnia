export function IsGitInstalled(): Promise<boolean> {
  return window['go']['main']['GitSync']['IsGitInstalled']()
}

export function InitRepo(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['InitRepo'](repoPath)
}

export function Clone(remoteURL: string, destination: string): Promise<void> {
  return window['go']['main']['GitSync']['Clone'](remoteURL, destination)
}

export function ConfigureUser(repoPath: string, name: string, email: string): Promise<void> {
  return window['go']['main']['GitSync']['ConfigureUser'](repoPath, name, email)
}

export function AddIgnorePattern(repoPath: string, pattern: string): Promise<void> {
  return window['go']['main']['GitSync']['AddIgnorePattern'](repoPath, pattern)
}

export function GetStatus(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['GetStatus'](repoPath)
}

export function Overview(repoPath: string, limit: number): Promise<string> {
  return window['go']['main']['GitSync']['Overview'](repoPath, limit)
}

export function CommitAll(repoPath: string, message: string): Promise<string> {
  return window['go']['main']['GitSync']['CommitAll'](repoPath, message)
}

export function CommitPaths(repoPath: string, message: string, paths: string[]): Promise<string> {
  return window['go']['main']['GitSync']['CommitPaths'](repoPath, message, paths)
}

export function Commit(repoPath: string, message: string): Promise<string> {
  return window['go']['main']['GitSync']['Commit'](repoPath, message)
}

export function StageAll(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['StageAll'](repoPath)
}

export function UnstageAll(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['UnstageAll'](repoPath)
}

export function FileDiff(repoPath: string, path: string, staged: boolean): Promise<string> {
  return window['go']['main']['GitSync']['FileDiff'](repoPath, path, staged)
}

export function ApplyHunk(repoPath: string, patch: string, reverse: boolean): Promise<void> {
  return window['go']['main']['GitSync']['ApplyHunk'](repoPath, patch, reverse)
}

export function Fetch(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['Fetch'](repoPath)
}

export function AddRemote(repoPath: string, name: string, remoteURL: string): Promise<void> {
  return window['go']['main']['GitSync']['AddRemote'](repoPath, name, remoteURL)
}

export function RemoveRemote(repoPath: string, name: string): Promise<void> {
  return window['go']['main']['GitSync']['RemoveRemote'](repoPath, name)
}

export function Push(repoPath: string, remote: string): Promise<void> {
  return window['go']['main']['GitSync']['Push'](repoPath, remote)
}

export function Pull(repoPath: string, remote: string): Promise<void> {
  return window['go']['main']['GitSync']['Pull'](repoPath, remote)
}

export function Stash(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['Stash'](repoPath)
}

export function StashPaths(repoPath: string, paths: string[]): Promise<void> {
  return window['go']['main']['GitSync']['StashPaths'](repoPath, paths)
}

export function StashPop(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['StashPop'](repoPath)
}

export function StashDrop(repoPath: string, stashRef: string): Promise<void> {
  return window['go']['main']['GitSync']['StashDrop'](repoPath, stashRef)
}

export function StashApply(repoPath: string, stashRef: string): Promise<void> {
  return window['go']['main']['GitSync']['StashApply'](repoPath, stashRef)
}

export function StashShow(repoPath: string, stashRef: string): Promise<string> {
  return window['go']['main']['GitSync']['StashShow'](repoPath, stashRef)
}

export function GetConflictFileVersions(repoPath: string, path: string): Promise<string> {
  return window['go']['main']['GitSync']['GetConflictFileVersions'](repoPath, path)
}

export function SaveConflictResolution(repoPath: string, path: string, content: string): Promise<void> {
  return window['go']['main']['GitSync']['SaveConflictResolution'](repoPath, path, content)
}

export function Reflog(repoPath: string, limit: number): Promise<string> {
  return window['go']['main']['GitSync']['Reflog'](repoPath, limit)
}

export function BlameLines(repoPath: string, path: string): Promise<string> {
  return window['go']['main']['GitSync']['BlameLines'](repoPath, path)
}

export function ChangesDiff(repoPath: string, scope: string, baseRef: string): Promise<string> {
  return window['go']['main']['GitSync']['ChangesDiff'](repoPath, scope, baseRef)
}

export function ListSubmodules(repoPath: string): Promise<string> { return window['go']['main']['GitSync']['ListSubmodules'](repoPath) }
export function AddSubmodule(repoPath: string, remoteURL: string, path: string, branch: string): Promise<void> { return window['go']['main']['GitSync']['AddSubmodule'](repoPath, remoteURL, path, branch) }
export function UpdateSubmodules(repoPath: string, path: string): Promise<void> { return window['go']['main']['GitSync']['UpdateSubmodules'](repoPath, path) }
export function RemoveSubmodule(repoPath: string, path: string): Promise<void> { return window['go']['main']['GitSync']['RemoveSubmodule'](repoPath, path) }
export function ListWorktrees(repoPath: string): Promise<string> { return window['go']['main']['GitSync']['ListWorktrees'](repoPath) }
export function AddWorktree(repoPath: string, path: string, branch: string, createBranch: boolean): Promise<void> { return window['go']['main']['GitSync']['AddWorktree'](repoPath, path, branch, createBranch) }
export function RemoveWorktree(repoPath: string, path: string, force: boolean): Promise<void> { return window['go']['main']['GitSync']['RemoveWorktree'](repoPath, path, force) }
export function SparseCheckoutList(repoPath: string): Promise<string> { return window['go']['main']['GitSync']['SparseCheckoutList'](repoPath) }
export function SetSparseCheckout(repoPath: string, paths: string[], cone: boolean): Promise<void> { return window['go']['main']['GitSync']['SetSparseCheckout'](repoPath, paths, cone) }
export function DisableSparseCheckout(repoPath: string): Promise<void> { return window['go']['main']['GitSync']['DisableSparseCheckout'](repoPath) }

export function UndoToReflog(repoPath: string, selector: string, mode: string): Promise<string> {
  return window['go']['main']['GitSync']['UndoToReflog'](repoPath, selector, mode)
}

export function CheckoutRemoteBranch(repoPath: string, remoteRef: string): Promise<void> {
  return window['go']['main']['GitSync']['CheckoutRemoteBranch'](repoPath, remoteRef)
}

export function DeleteLocalBranch(repoPath: string, branch: string, force: boolean): Promise<void> {
  return window['go']['main']['GitSync']['DeleteLocalBranch'](repoPath, branch, force)
}

export function DeleteRemoteBranch(repoPath: string, remote: string, branch: string): Promise<void> {
  return window['go']['main']['GitSync']['DeleteRemoteBranch'](repoPath, remote, branch)
}

export function SetUpstream(repoPath: string, branch: string, upstream: string): Promise<void> {
  return window['go']['main']['GitSync']['SetUpstream'](repoPath, branch, upstream)
}

export function Log(repoPath: string, limit: number): Promise<string> {
  return window['go']['main']['GitSync']['Log'](repoPath, limit)
}

export function Show(repoPath: string, ref: string): Promise<string> {
  return window['go']['main']['GitSync']['Show'](repoPath, ref)
}

export function StageFile(repoPath: string, path: string): Promise<void> {
  return window['go']['main']['GitSync']['StageFile'](repoPath, path)
}

export function UnstageFile(repoPath: string, path: string): Promise<void> {
  return window['go']['main']['GitSync']['UnstageFile'](repoPath, path)
}

export function RestoreFile(repoPath: string, path: string): Promise<void> {
  return window['go']['main']['GitSync']['RestoreFile'](repoPath, path)
}

export function RemoveFile(repoPath: string, path: string): Promise<void> {
  return window['go']['main']['GitSync']['RemoveFile'](repoPath, path)
}

export function MoveFile(repoPath: string, oldPath: string, newPath: string): Promise<void> {
  return window['go']['main']['GitSync']['MoveFile'](repoPath, oldPath, newPath)
}

export function CreateBranch(repoPath: string, branch: string): Promise<void> {
  return window['go']['main']['GitSync']['CreateBranch'](repoPath, branch)
}

export function CheckoutBranch(repoPath: string, branch: string): Promise<void> {
  return window['go']['main']['GitSync']['CheckoutBranch'](repoPath, branch)
}

export function CreateAndCheckoutBranch(repoPath: string, branch: string): Promise<void> {
  return window['go']['main']['GitSync']['CreateAndCheckoutBranch'](repoPath, branch)
}

export function MergeBranch(repoPath: string, branch: string): Promise<void> {
  return window['go']['main']['GitSync']['MergeBranch'](repoPath, branch)
}

export function RebaseBranch(repoPath: string, branch: string): Promise<void> {
  return window['go']['main']['GitSync']['RebaseBranch'](repoPath, branch)
}

export function ResetHard(repoPath: string, ref: string): Promise<void> {
  return window['go']['main']['GitSync']['ResetHard'](repoPath, ref)
}

export function CheckoutConflictSide(repoPath: string, path: string, side: string): Promise<void> {
  return window['go']['main']['GitSync']['CheckoutConflictSide'](repoPath, path, side)
}

export function AbortIntegration(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['AbortIntegration'](repoPath)
}

export function CompareRefs(repoPath: string, refA: string, refB: string): Promise<string> {
  return window['go']['main']['GitSync']['CompareRefs'](repoPath, refA, refB)
}

export function GetFileDiff(repoPath: string, refA: string, refB: string, filePath: string): Promise<string> {
  return window['go']['main']['GitSync']['GetFileDiff'](repoPath, refA, refB, filePath)
}

export function GetWorkingTreeFileSnapshot(repoPath: string, filePath: string, oldPath: string): Promise<string> {
  return window['go']['main']['GitSync']['GetWorkingTreeFileSnapshot'](repoPath, filePath, oldPath)
}

export function CreateTag(repoPath: string, name: string, ref: string): Promise<void> {
  return window['go']['main']['GitSync']['CreateTag'](repoPath, name, ref)
}

export function DeleteTag(repoPath: string, name: string): Promise<void> {
  return window['go']['main']['GitSync']['DeleteTag'](repoPath, name)
}

// ── Professional commit-graph operations (hand-written; wails CLI unavailable) ──

export function GetRepoState(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['GetRepoState'](repoPath)
}

export function GetCommitMeta(repoPath: string, ref: string): Promise<string> {
  return window['go']['main']['GitSync']['GetCommitMeta'](repoPath, ref)
}

export function RemoteWebURL(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['RemoteWebURL'](repoPath)
}

export function CompareWebURL(repoPath: string, refA: string, refB: string): Promise<string> {
  return window['go']['main']['GitSync']['CompareWebURL'](repoPath, refA, refB)
}

export function CheckoutCommit(repoPath: string, ref: string, newBranch: string): Promise<string> {
  return window['go']['main']['GitSync']['CheckoutCommit'](repoPath, ref, newBranch)
}

export function CreateBranchFromCommit(repoPath: string, branch: string, ref: string, checkout: boolean, push: boolean): Promise<string> {
  return window['go']['main']['GitSync']['CreateBranchFromCommit'](repoPath, branch, ref, checkout, push)
}

export function CreateTagFromCommit(repoPath: string, name: string, ref: string, message: string, annotated: boolean, push: boolean): Promise<string> {
  return window['go']['main']['GitSync']['CreateTagFromCommit'](repoPath, name, ref, message, annotated, push)
}

export function CompareCommits(repoPath: string, refA: string, refB: string): Promise<string> {
  return window['go']['main']['GitSync']['CompareCommits'](repoPath, refA, refB)
}

export function CreatePatch(repoPath: string, refA: string, refB: string): Promise<string> {
  return window['go']['main']['GitSync']['CreatePatch'](repoPath, refA, refB)
}

export function ApplyPatch(repoPath: string, patch: string, threeWay: boolean, index: boolean): Promise<string> {
  return window['go']['main']['GitSync']['ApplyPatch'](repoPath, patch, threeWay, index)
}

export function RestoreFileFromCommit(repoPath: string, ref: string, path: string): Promise<string> {
  return window['go']['main']['GitSync']['RestoreFileFromCommit'](repoPath, ref, path)
}

export function FileAtCommit(repoPath: string, ref: string, path: string): Promise<string> {
  return window['go']['main']['GitSync']['FileAtCommit'](repoPath, ref, path)
}

export function FileHistory(repoPath: string, path: string, n: number): Promise<string> {
  return window['go']['main']['GitSync']['FileHistory'](repoPath, path, n)
}

export function BlameFile(repoPath: string, path: string): Promise<string> {
  return window['go']['main']['GitSync']['BlameFile'](repoPath, path)
}

export function CherryPick(repoPath: string, shas: string[], noCommit: boolean, newBranch: string, recordOrigin: boolean): Promise<string> {
  return window['go']['main']['GitSync']['CherryPick'](repoPath, shas, noCommit, newBranch, recordOrigin)
}

export function GenerateRevertMessage(repoPath: string, sha: string): Promise<string> {
  return window['go']['main']['GitSync']['GenerateRevertMessage'](repoPath, sha)
}

export function RevertCommit(repoPath: string, sha: string, message: string, mainline: number): Promise<string> {
  return window['go']['main']['GitSync']['RevertCommit'](repoPath, sha, message, mainline)
}

export function ResetBranch(repoPath: string, sha: string, mode: string): Promise<string> {
  return window['go']['main']['GitSync']['ResetBranch'](repoPath, sha, mode)
}

export function AmendCommit(repoPath: string, message: string, addAll: boolean): Promise<string> {
  return window['go']['main']['GitSync']['AmendCommit'](repoPath, message, addAll)
}

export function UndoLastCommit(repoPath: string, keepStaged: boolean): Promise<string> {
  return window['go']['main']['GitSync']['UndoLastCommit'](repoPath, keepStaged)
}

export function SquashHeadIntoPrevious(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['SquashHeadIntoPrevious'](repoPath)
}

export function ExtractHeadToNewBranch(repoPath: string, newBranch: string): Promise<string> {
  return window['go']['main']['GitSync']['ExtractHeadToNewBranch'](repoPath, newBranch)
}

export function ForcePush(repoPath: string, branch: string): Promise<string> {
  return window['go']['main']['GitSync']['ForcePush'](repoPath, branch)
}

export function ContinueOperation(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['ContinueOperation'](repoPath)
}

export function SkipOperation(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['SkipOperation'](repoPath)
}

export function AbortOperation(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['AbortOperation'](repoPath)
}

export function GetRebaseTodo(repoPath: string, baseRef: string): Promise<string> {
  return window['go']['main']['GitSync']['GetRebaseTodo'](repoPath, baseRef)
}

export function StartInteractiveRebase(repoPath: string, baseRef: string, itemsJSON: string): Promise<string> {
  return window['go']['main']['GitSync']['StartInteractiveRebase'](repoPath, baseRef, itemsJSON)
}

export function RebaseOnto(repoPath: string, targetRef: string): Promise<string> {
  return window['go']['main']['GitSync']['RebaseOnto'](repoPath, targetRef)
}

export function BisectStart(repoPath: string, bad: string, good: string): Promise<string> {
  return window['go']['main']['GitSync']['BisectStart'](repoPath, bad, good)
}

export function BisectMark(repoPath: string, verdict: string): Promise<string> {
  return window['go']['main']['GitSync']['BisectMark'](repoPath, verdict)
}

export function BisectRun(repoPath: string, command: string): Promise<string> {
  return window['go']['main']['GitSync']['BisectRun'](repoPath, command)
}

export function BisectReset(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['BisectReset'](repoPath)
}

export function SearchHistory(repoPath: string, filtersJSON: string): Promise<string> {
  return window['go']['main']['GitSync']['SearchHistory'](repoPath, filtersJSON)
}

export interface GitHubPR {
  number: number
  title: string
  state: string
  author: string
  head: string
  base: string
  url: string
  draft: boolean
}

export function GitHubValidateToken(token: string): Promise<string> {
  return window['go']['main']['GitSync']['GitHubValidateToken'](token)
}

export function GitHubListPRs(repoPath: string, token: string): Promise<GitHubPR[]> {
  return window['go']['main']['GitSync']['GitHubListPRs'](repoPath, token) as Promise<GitHubPR[]>
}

export function GitHubCreatePR(repoPath: string, token: string, title: string, head: string, base: string, body: string): Promise<GitHubPR> {
  return window['go']['main']['GitSync']['GitHubCreatePR'](repoPath, token, title, head, base, body) as Promise<GitHubPR>
}

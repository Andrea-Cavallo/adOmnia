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

export function StashPop(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['StashPop'](repoPath)
}

export function StashDrop(repoPath: string, stashRef: string): Promise<void> {
  return window['go']['main']['GitSync']['StashDrop'](repoPath, stashRef)
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

export function CreateTag(repoPath: string, name: string, ref: string): Promise<void> {
  return window['go']['main']['GitSync']['CreateTag'](repoPath, name, ref)
}

export function DeleteTag(repoPath: string, name: string): Promise<void> {
  return window['go']['main']['GitSync']['DeleteTag'](repoPath, name)
}

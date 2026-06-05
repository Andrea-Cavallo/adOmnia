export function IsGitInstalled(): Promise<boolean> {
  return window['go']['main']['GitSync']['IsGitInstalled']()
}

export function InitRepo(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['InitRepo'](repoPath)
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

export function Push(repoPath: string, remote: string): Promise<void> {
  return window['go']['main']['GitSync']['Push'](repoPath, remote)
}

export function Pull(repoPath: string, remote: string): Promise<void> {
  return window['go']['main']['GitSync']['Pull'](repoPath, remote)
}

export function Log(repoPath: string, limit: number): Promise<string> {
  return window['go']['main']['GitSync']['Log'](repoPath, limit)
}

export function StageFile(repoPath: string, path: string): Promise<void> {
  return window['go']['main']['GitSync']['StageFile'](repoPath, path)
}

export function CheckoutConflictSide(repoPath: string, path: string, side: string): Promise<void> {
  return window['go']['main']['GitSync']['CheckoutConflictSide'](repoPath, path, side)
}

export function AbortIntegration(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['AbortIntegration'](repoPath)
}

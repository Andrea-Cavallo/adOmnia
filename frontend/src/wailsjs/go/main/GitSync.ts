export function IsGitInstalled(): Promise<boolean> {
  return window['go']['main']['GitSync']['IsGitInstalled']()
}

export function InitRepo(repoPath: string): Promise<void> {
  return window['go']['main']['GitSync']['InitRepo'](repoPath)
}

export function GetStatus(repoPath: string): Promise<string> {
  return window['go']['main']['GitSync']['GetStatus'](repoPath)
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

import * as binding from '../../../../bindings/adomnia/gitsync'

export * from '../../../../bindings/adomnia/gitsync'

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

export interface HostAccount {
  provider: 'github' | 'gitlab' | 'bitbucket' | 'azure'
  baseURL: string
  username: string
}

export interface TerminalResult {
  command: string
  output: string
  exitCode: number
}

export function HostValidateToken(repoPath: string, account: HostAccount, token: string): Promise<string> {
  return binding.HostValidateToken(repoPath, JSON.stringify(account), token)
}

export async function HostListPRs(repoPath: string, account: HostAccount, token: string): Promise<GitHubPR[]> {
  return await binding.HostListPRs(repoPath, JSON.stringify(account), token) as unknown as GitHubPR[]
}

export async function HostCreatePR(repoPath: string, account: HostAccount, token: string, title: string, head: string, base: string, body: string): Promise<GitHubPR> {
  return await binding.HostCreatePR(repoPath, JSON.stringify(account), token, title, head, base, body) as unknown as GitHubPR
}

export function HostPush(repoPath: string, account: HostAccount, token: string, branch: string): Promise<void> {
  return binding.HostPush(repoPath, JSON.stringify(account), token, branch)
}

export async function RunTerminalCommand(repoPath: string, command: string): Promise<TerminalResult> {
  return JSON.parse(await binding.RunTerminalCommand(repoPath, command)) as TerminalResult
}

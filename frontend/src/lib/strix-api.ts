import * as SecurityIntelBindings from '../../bindings/github.com/Andrea-Cavallo/adOmnia/securityintel'

// Strix (pentest con agenti AI) nel Security Center. Il backend parla JSON: qui il contratto è tipizzato una volta sola.

export type StrixMode = 'quick' | 'standard' | 'deep'
export type StrixState = 'preparing' | 'running' | 'finished' | 'found' | 'failed' | 'cancelled'

export interface StrixInfo {
  installed: boolean
  binary?: string
  version?: string
  dockerReady: boolean
  dockerNote?: string
}

export interface StrixInstallPlan {
  command: string
  note: string
}

export interface StrixOptions {
  root: string
  mode: StrixMode
  maxBudget?: number
  instruction?: string
}

export interface StrixRun {
  id: string
  root: string
  mode: string
  state: StrixState
  error?: string
  startedAt: string
  finishedAt?: string
  exitCode: number
  files: number
  offset: number
  output: string[]
}

export type StrixSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface StrixFinding {
  id: string
  title: string
  severity: StrixSeverity
  message?: string
  file?: string
  line?: number
}

export interface StrixReport {
  runName: string
  markdown: string
  findings: StrixFinding[]
  details: Array<{ name: string; markdown: string }>
  status?: string
  costUsd?: number
}

const parse = <T,>(payload: string): T => JSON.parse(payload) as T

export const isStrixActive = (state: StrixState | undefined): boolean => state === 'preparing' || state === 'running'

export async function strixInfo(): Promise<StrixInfo> {
  return parse(await SecurityIntelBindings.StrixInfo())
}

export async function strixInstallPlan(): Promise<StrixInstallPlan> {
  return parse(await SecurityIntelBindings.StrixInstallPlan())
}

export async function strixInstall(): Promise<StrixRun> {
  return parse(await SecurityIntelBindings.StrixInstall(true))
}

/** `aiConfig` è la configurazione AI di adOmnia (buildAIConfig); `customModel` un id LiteLLM scritto dall'utente. */
export async function strixStart(options: StrixOptions, aiConfig: string, customModel: string): Promise<StrixRun> {
  return parse(await SecurityIntelBindings.StrixStart(JSON.stringify(options), aiConfig, customModel, true))
}

export async function strixStatus(runId: string, since: number): Promise<StrixRun> {
  return parse(await SecurityIntelBindings.StrixStatus(runId, since))
}

export async function strixCancel(runId: string): Promise<void> {
  await SecurityIntelBindings.StrixCancel(runId)
}

export async function strixReport(runId: string): Promise<StrixReport> {
  return parse(await SecurityIntelBindings.StrixReport(runId))
}

export async function strixExportMarkdown(runId: string): Promise<string> {
  return SecurityIntelBindings.StrixExport(runId)
}

/** Ricompilazione di govulncheck (reachability Go): stesso meccanismo di installazione e stesso polling di Strix. */
export async function govulncheckInstallPlan(): Promise<StrixInstallPlan> {
  return parse(await SecurityIntelBindings.GovulncheckInstallPlan())
}

export async function installGovulncheck(): Promise<StrixRun> {
  return parse(await SecurityIntelBindings.InstallGovulncheck(true))
}

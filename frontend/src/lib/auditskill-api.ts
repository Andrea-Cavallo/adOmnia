import * as SecurityIntelBindings from '../../bindings/github.com/Andrea-Cavallo/adOmnia/securityintel'

// Skill security-audit di Cloudflare nel Security Center: contratto tipizzato dei binding JSON.

export type AuditProfile = 'quick' | 'standard' | 'deep'
export type AuditVerdict = 'confirmed' | 'needs_validation' | 'rejected'

export interface AuditSkillInfo {
  installed: boolean
  managed: boolean
  commit?: string
  current: boolean
  dir: string
  skillFile: string
  nodeFound: boolean
}

export interface AuditSkillInstallPlan {
  command: string
  note: string
  dir: string
}

export interface AuditRun {
  number: number
  dir: string
  status?: string
  profile?: string
  hasFindings: boolean
  hasReport: boolean
}

export interface AuditPrepared {
  run: AuditRun
  prompt: string
}

export interface AuditFinding {
  verdict: AuditVerdict
  fingerprint: string
  title: string
  description: string
  severity?: string
  confidence?: string
  file?: string
  line?: number
  remediation?: string
  blockers?: string[]
}

export interface AuditReport {
  run: AuditRun
  findings: AuditFinding[]
  markdown?: string
  missing?: string[]
}

const parse = <T>(json: string): T => JSON.parse(json) as T

export const auditSkillInfo = async (): Promise<AuditSkillInfo> => parse(await SecurityIntelBindings.AuditSkillInfo())
export const auditSkillInstallPlan = async (): Promise<AuditSkillInstallPlan> => parse(await SecurityIntelBindings.AuditSkillInstallPlan())
export const auditSkillInstall = async (): Promise<AuditSkillInfo> => parse(await SecurityIntelBindings.AuditSkillInstall(true))
export const auditSkillPrepare = async (root: string, profile: AuditProfile, focus: string): Promise<AuditPrepared> =>
  parse(await SecurityIntelBindings.AuditSkillPrepare(root, profile, focus))
export const auditSkillRuns = async (root: string): Promise<AuditRun[]> => parse(await SecurityIntelBindings.AuditSkillRuns(root))
export const auditSkillReport = async (root: string, run: number): Promise<AuditReport> => parse(await SecurityIntelBindings.AuditSkillReport(root, run))

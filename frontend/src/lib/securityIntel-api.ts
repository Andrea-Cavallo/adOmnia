import * as SecurityIntelBindings from '../../bindings/adomnia/securityintel'

// Tipi di adOmnia Security Intelligence. Il backend parla JSON per non generare
// centinaia di modelli Wails: qui il contratto è tipizzato una volta sola.

export type SecurityEcosystem = 'Maven' | 'Go' | 'PyPI'
export type SecurityReachability =
  | 'called'
  | 'imported'
  | 'required'
  | 'potentiallyReachable'
  | 'notReachable'
  | 'unknown'
export type SecurityExposure = 'runtime' | 'build' | 'test' | 'unknown'
export type SecurityBand = 'critical' | 'high' | 'medium' | 'low' | 'informational'
export type SecurityOrigin =
  | 'declared'
  | 'inherited'
  | 'managed'
  | 'transitive'
  | 'plugin'
  | 'toolchain'

/** Gravità ed exploitability tenute separate: EPSS e KEV non sono gravità. */
export interface SecuritySeverity {
  cvss31Vector?: string
  cvss31Score?: number
  cvss40Vector?: string
  cvss40Score?: number
  scoreSource?: string
  baseSeverity?: string
  /** Probabilità stimata di sfruttamento entro 30 giorni, in [0,1]. */
  epss?: number
  epssPercentile?: number
  /** Nel catalogo CISA Known Exploited Vulnerabilities. */
  kev?: boolean
  kevDueDate?: string
  kevRansomwareCampaign?: boolean
}

export interface SecurityVersionRange {
  introduced?: string
  fixed?: string
  lastAffected?: string
}

export interface SecurityAdvisory {
  id: string
  aliases?: string[]
  summary?: string
  details?: string
  published?: string
  modified?: string
  references?: string[]
  severity: SecuritySeverity
  vulnerableRanges?: string[]
  ranges?: SecurityVersionRange[]
  fixedVersions?: string[]
  withdrawn?: string
  sources?: string[]
}

export interface SecurityComponent {
  ecosystem: SecurityEcosystem
  name: string
  version: string
  scope?: string
  origin: SecurityOrigin
  exposure: SecurityExposure
  manifest?: string
  module?: string
  dependencyPath?: string[]
  replace?: string
  direct: boolean
}

export interface SecurityCallFrame {
  module?: string
  version?: string
  package?: string
  function?: string
  receiver?: string
  file?: string
  relative?: string
  line?: number
  column?: number
  inProject: boolean
}

export interface SecurityEvidence {
  method?: string
  confirmed: boolean
  note?: string
  why?: string
  callPaths?: SecurityCallFrame[][]
  symbols?: string[]
  packages?: string[]
}

export interface SecurityRiskSignals {
  cvssScore: number
  cvssClass: string
  epss: number
  kev: boolean
  reachability: SecurityReachability
  exposure: SecurityExposure
  fixAvailable: boolean
  direct: boolean
}

export interface SecurityRisk {
  priority: string
  band: SecurityBand
  score: number
  reasons?: string[]
  signals: SecurityRiskSignals
}

export interface SecurityRemediation {
  strategy: string
  currentVersion: string
  fixedVersion?: string
  direct: boolean
  indirectVia?: string
  compatibility?: string
  commands?: string[]
  note?: string
  resolves?: string[]
  introduces?: string[]
  blocked?: boolean
  blockedReason?: string
}

export interface SecuritySuppression {
  reason: string
  author?: string
  createdAt?: string
  expiresAt?: string
  advisoryIds?: string[]
  component?: string
}

export interface SecurityFinding {
  id: string
  advisory: SecurityAdvisory
  component: SecurityComponent
  reachability: SecurityReachability
  evidence: SecurityEvidence
  risk: SecurityRisk
  remediation: SecurityRemediation
  ignored?: SecuritySuppression | null
}

export interface SecurityUnitReport {
  ecosystem: SecurityEcosystem
  manifest: string
  name: string
  components: SecurityComponent[]
  findings: SecurityFinding[]
  errors?: string[]
  analyzed: boolean
}

export interface SecuritySourceStatus {
  name: string
  endpoint?: string
  lastUpdated?: string
  offline: boolean
  error?: string
}

export interface SecuritySummary {
  findings: number
  critical: number
  high: number
  medium: number
  low: number
  other: number
  activelyExploited: number
  fixAvailable: number
  reachable: number
  ignored: number
}

export interface SecurityScanReport {
  workspace: string
  scannedAt: string
  sources?: SecuritySourceStatus[]
  units: SecurityUnitReport[]
  findings: SecurityFinding[]
  summary: SecuritySummary
  tool?: string
}

export interface SecurityScanOptions {
  ecosystems?: SecurityEcosystem[]
  offline?: boolean
  allowProcesses?: boolean
  includePluginDependencies?: boolean
  includeOptional?: boolean
  sourceEndpoints?: Record<string, string>
}

export interface SecurityWorkspaceSettings {
  version: string
  suppressions?: SecuritySuppression[]
  ecosystems?: SecurityEcosystem[]
  includePluginDependencies?: boolean
  includeOptional?: boolean
  offline?: boolean
  sourceEndpoints?: Record<string, string>
}

export interface SecurityExportFormat {
  id: string
  name: string
  extension: string
}

export type SecurityExportFormatId = 'json' | 'sarif' | 'html' | 'cyclonedx' | 'spdx' | 'vex' | 'markdown'

/** Riga d'impatto di un advisory nell'anteprima di un aggiornamento. */
export interface SecurityAdvisoryImpact {
  id: string
  aliases?: string[]
  summary?: string
  /** Classe normalizzata: CRITICAL, HIGH, MEDIUM, LOW, NONE. */
  severity: string
  cvss?: number
  /** Probabilità di sfruttamento entro 30 giorni, in [0,1]. Non è una gravità. */
  epss?: number
  kev?: boolean
  fixedVersion?: string
}

/** Security Impact Before Update: cosa elimina, cosa resta, cosa introduce un upgrade. */
export interface SecurityUpgradePreview {
  component: SecurityComponent
  currentVersion: string
  targetVersion: string
  /** Classe di compatibilità: patch, minor, major, unknown. */
  compatibility: string
  resolves?: SecurityAdvisoryImpact[]
  remaining?: SecurityAdvisoryImpact[]
  introduces?: SecurityAdvisoryImpact[]
  advice: string
  sources?: SecuritySourceStatus[]
}

export type SecurityUpgradeStepStatus = 'idle' | 'running' | 'ok' | 'failed' | 'skipped'

export interface SecurityUpgradeStep {
  id: string
  label: string
  command?: string
  program?: string
  args?: string[]
  dir?: string
  env?: string[]
  /** Un passo che avvia un processo parte solo con allowProcesses. */
  requiresProcess: boolean
  status: SecurityUpgradeStepStatus
  output?: string
}

export type SecurityUpgradePlanState = 'proposed' | 'applied' | 'committed' | 'reverted'

export interface SecurityUpgradePlan {
  id: string
  target: { ecosystem: SecurityEcosystem; root: string; manifest: string; name?: string }
  component: SecurityComponent
  targetVersion: string
  manifest: string
  diff: string
  preview: SecurityUpgradePreview
  steps: SecurityUpgradeStep[]
  state: SecurityUpgradePlanState
  backup?: string
  note?: string
  createdAt: string
}

export interface SecurityUpgradeRequest {
  component: SecurityComponent
  targetVersion: string
  report: SecurityScanReport
  options?: SecurityScanOptions
}

/** Scansiona il workspace e restituisce il report completo. */
export async function scanWorkspaceSecurity(
  root: string,
  options: SecurityScanOptions = {},
): Promise<SecurityScanReport> {
  const payload = await SecurityIntelBindings.ScanWorkspace(root, JSON.stringify(options))
  return JSON.parse(payload) as SecurityScanReport
}

/** Serializza un report già ottenuto nel formato richiesto. */
export async function exportSecurityReport(
  report: SecurityScanReport,
  format: SecurityExportFormatId,
): Promise<string> {
  return SecurityIntelBindings.ExportReport(JSON.stringify(report), format)
}

/** Elenca i formati di esportazione disponibili. */
export async function listSecurityExportFormats(): Promise<SecurityExportFormat[]> {
  const payload = await SecurityIntelBindings.ExportFormats()
  return JSON.parse(payload) as SecurityExportFormat[]
}

/** Legge la configurazione di sicurezza del progetto. */
export async function getSecurityWorkspaceSettings(root: string): Promise<SecurityWorkspaceSettings> {
  const payload = await SecurityIntelBindings.SecuritySettings(root)
  return JSON.parse(payload) as SecurityWorkspaceSettings
}

/** Aggiunge o aggiorna una soppressione. Richiede una motivazione scritta. */
export async function putSecuritySuppression(
  root: string,
  suppression: SecuritySuppression,
): Promise<SecurityWorkspaceSettings> {
  const payload = await SecurityIntelBindings.PutSuppression(root, JSON.stringify(suppression))
  return JSON.parse(payload) as SecurityWorkspaceSettings
}

/** Toglie una soppressione per identificativo advisory. */
export async function removeSecuritySuppression(
  root: string,
  advisoryId: string,
): Promise<SecurityWorkspaceSettings> {
  const payload = await SecurityIntelBindings.RemoveSuppression(root, advisoryId)
  return JSON.parse(payload) as SecurityWorkspaceSettings
}

/** Simula l'aggiornamento di un componente: quali vulnerabilità elimina, quali restano, quali introduce. */
export async function previewSecurityUpgrade(
  root: string,
  request: SecurityUpgradeRequest,
): Promise<SecurityUpgradePreview> {
  const payload = await SecurityIntelBindings.PreviewUpgrade(root, JSON.stringify(request))
  return JSON.parse(payload) as SecurityUpgradePreview
}

/** Prepara la modifica al manifest: diff da rivedere, impatto atteso e passi di verifica. Non scrive nulla. */
export async function planSecurityUpgrade(
  root: string,
  request: SecurityUpgradeRequest,
): Promise<SecurityUpgradePlan> {
  const payload = await SecurityIntelBindings.PlanUpgrade(root, JSON.stringify(request))
  return JSON.parse(payload) as SecurityUpgradePlan
}

/** Esegue un passo di verifica del piano e restituisce il piano aggiornato, con stato e output del passo. */
export async function runSecurityUpgradeStep(
  root: string,
  planId: string,
  stepId: string,
  options: SecurityScanOptions = {},
): Promise<SecurityUpgradePlan> {
  const payload = await SecurityIntelBindings.RunUpgradeStep(root, planId, stepId, JSON.stringify(options))
  return JSON.parse(payload) as SecurityUpgradePlan
}

/** Chiude il piano: apply rende definitiva la modifica, altrimenti il manifest torna com'era. */
export async function finishSecurityUpgrade(
  root: string,
  planId: string,
  apply: boolean,
): Promise<SecurityUpgradePlan> {
  const payload = await SecurityIntelBindings.FinishUpgrade(root, planId, apply)
  return JSON.parse(payload) as SecurityUpgradePlan
}

/** Scarica un testo come file locale, senza passare da una rete. */
export function downloadTextFile(fileName: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

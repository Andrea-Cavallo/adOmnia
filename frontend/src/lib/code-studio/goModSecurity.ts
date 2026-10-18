import type { SecurityBand, SecurityFinding } from '../securityIntel-api'
import { compareVersions } from './pomInsights'
import type { GoModRequirement } from '@/components/code-studio/codeStudioGoMod'

const BAND_RANK: Record<SecurityBand, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 }

export interface GoModVulnerability {
  id: string
  band: SecurityBand
  summary: string
}

export interface GoModRequirementStatus {
  requirement: GoModRequirement
  vulnerabilities: GoModVulnerability[]
  worst: SecurityBand | null
  /** Versione che chiude tutti gli advisory della riga ("" se nessuna correzione è nota). */
  fixVersion: string
}

export interface GoModTextEdit {
  startColumn: number
  endColumn: number
  text: string
}

const withoutV = (version: string) => version.replace(/^v/, '')

/** Unisce i require del go.mod e i finding del report: una riga di stato per dipendenza, la peggiore in testa. */
export function goModStatuses(requirements: GoModRequirement[], findings: SecurityFinding[]): GoModRequirementStatus[] {
  return requirements.map((requirement) => {
    const matching = findings.filter((finding) => !finding.ignored && finding.component.name === requirement.path && finding.component.version === requirement.version)
    const vulnerabilities = matching
      .map((finding) => ({ id: finding.advisory.id, band: finding.risk.band, summary: finding.advisory.summary ?? '' }))
      .sort((left, right) => BAND_RANK[right.band] - BAND_RANK[left.band])
    const fixes = matching.map((finding) => finding.remediation.fixedVersion ?? '').filter(Boolean).sort((a, b) => compareVersions(withoutV(a), withoutV(b)))
    return { requirement, vulnerabilities, worst: vulnerabilities[0]?.band ?? null, fixVersion: fixes[fixes.length - 1] ?? '' }
  })
}

/** Gli advisory di OSV scrivono la versione corretta senza `v`; il go.mod la vuole con `v`. */
export function goVersion(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

/**
 * La modifica che porta il require alla versione indicata: sostituisce solo il token della versione sulla riga,
 * lasciando commenti e `// indirect`. null se la riga non contiene più quel modulo e quella versione (testo cambiato).
 */
export function goModVersionEdit(lineText: string, requirement: GoModRequirement, version: string): GoModTextEdit | null {
  const pathAt = lineText.indexOf(requirement.path)
  if (pathAt < 0) return null
  const versionAt = lineText.indexOf(requirement.version, pathAt + requirement.path.length)
  if (versionAt < 0) return null
  return { startColumn: versionAt + 1, endColumn: versionAt + 1 + requirement.version.length, text: goVersion(version) }
}

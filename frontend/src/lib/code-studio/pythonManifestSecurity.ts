import type { SecurityBand, SecurityFinding } from '../securityIntel-api'
import { compareVersions } from './pomInsights'

/**
 * CVE dei manifest Python nell'editor, come per `go.mod` e `pom.xml`.
 *
 * Le versioni si leggono solo dove sono **fissate** (`==`/`===`): un intervallo non è una versione
 * risolta e la riga non produce marker, esattamente come l'adapter PyPI non lo interroga. Il nome
 * viene normalizzato PEP 503, la forma con cui l'adapter e OSV identificano il pacchetto.
 */

export interface PythonRequirementLine {
  /** Nome normalizzato PEP 503 (minuscolo, `-` come separatore). */
  name: string
  version: string
  /** Riga 1-based. */
  line: number
  /** Colonne 1-based del token della versione, per la correzione. */
  versionStart: number
  versionEnd: number
}

export interface PythonRequirementStatus {
  requirement: PythonRequirementLine
  vulnerabilities: Array<{ id: string; band: SecurityBand; summary: string }>
  worst: SecurityBand | null
  /** Versione che chiude tutti gli advisory della riga ("" se nessuna correzione è nota). */
  fixVersion: string
}

export interface PythonTextEdit {
  startColumn: number
  endColumn: number
  text: string
}

const BAND_RANK: Record<SecurityBand, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 }

/** Normalizzazione PEP 503: minuscolo e `.`/`_` come `-`. */
export function normalizePythonName(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, '-').replace(/\./g, '-')
}

const REQUIREMENT = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*===?\s*([^\s;,#]+)/
const QUOTED_REQUIREMENT = /["']([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*===?\s*([^"'\s,]+)["']/g

function fileName(relativePath: string): string {
  return relativePath.split(String.fromCharCode(92)).join('/').split('/').pop() ?? relativePath
}

/** Vero per i manifest che l'adapter PyPI analizza: `requirements*.txt` e `pyproject.toml`. */
export function isPythonManifest(relativePath: string): boolean {
  const base = fileName(relativePath).toLowerCase()
  return (base.startsWith('requirements') && base.endsWith('.txt')) || base === 'pyproject.toml'
}

/** Dipendenze con versione fissata, con la riga e le colonne della versione. */
export function parsePythonManifest(relativePath: string, text: string): PythonRequirementLine[] {
  if (!isPythonManifest(relativePath)) return []
  const isRequirements = fileName(relativePath).toLowerCase().endsWith('.txt')
  const lines: PythonRequirementLine[] = []
  text.split('\n').forEach((raw, index) => {
    const line = index + 1
    const content = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (isRequirements) {
      const parsed = parseRequirementText(content, line)
      if (parsed) lines.push(parsed)
      return
    }
    for (const match of content.matchAll(QUOTED_REQUIREMENT)) {
      const name = normalizePythonName(match[1])
      const version = match[3]
      if (!name || !version) continue
      const versionAt = (match.index ?? 0) + (match[0]?.lastIndexOf(version) ?? 0)
      lines.push({ name, version, line, versionStart: versionAt + 1, versionEnd: versionAt + version.length + 1 })
    }
  })
  return lines
}

/** Una riga di requirements.txt, con commento e opzioni pip già esclusi. */
function parseRequirementText(content: string, line: number): PythonRequirementLine | null {
  const trimmed = content.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.includes('://') || trimmed.includes(' @ ')) return null
  const code = trimmed.split(' #')[0]
  const match = REQUIREMENT.exec(code)
  if (!match) return null
  const name = normalizePythonName(match[1])
  const version = match[3]
  if (!name || !version) return null
  const versionAt = content.indexOf(version)
  if (versionAt < 0) return null
  return { name, version, line, versionStart: versionAt + 1, versionEnd: versionAt + version.length + 1 }
}

/** Unisce righe del manifest e finding: una voce per riga, la banda peggiore in testa. */
export function pythonRequirementStatuses(lines: PythonRequirementLine[], findings: SecurityFinding[]): PythonRequirementStatus[] {
  return lines.map((requirement) => {
    const matching = findings.filter((finding) => !finding.ignored && normalizePythonName(finding.component.name) === requirement.name && finding.component.version === requirement.version)
    const vulnerabilities = matching
      .map((finding) => ({ id: finding.advisory.id, band: finding.risk.band, summary: finding.advisory.summary ?? '' }))
      .sort((left, right) => BAND_RANK[right.band] - BAND_RANK[left.band])
    const fixes = matching.map((finding) => finding.remediation.fixedVersion ?? '').filter(Boolean).sort(compareVersions)
    return { requirement, vulnerabilities, worst: vulnerabilities[0]?.band ?? null, fixVersion: fixes[fixes.length - 1] ?? '' }
  })
}

/**
 * La modifica che porta la riga alla versione indicata: sostituisce solo il token della versione.
 * null se il testo è cambiato e la versione non è più dove era stata letta.
 */
export function pythonVersionEdit(lineText: string, requirement: PythonRequirementLine, version: string): PythonTextEdit | null {
  if (!version) return null
  const current = lineText.slice(requirement.versionStart - 1, requirement.versionEnd - 1)
  if (current !== requirement.version) return null
  return { startColumn: requirement.versionStart, endColumn: requirement.versionEnd, text: version }
}

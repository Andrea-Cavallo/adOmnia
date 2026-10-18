import type { PomDependency, VersionInfo } from '../../../bindings/adomnia/internal/languages/java/models'
import type { SecurityBand, SecurityFinding } from '../securityIntel-api'

/** Rischio massimo per ordinare: la riga di una dipendenza mostra il peggiore. */
const BAND_RANK: Record<SecurityBand, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 }

export interface PomVulnerability {
  id: string
  band: SecurityBand
  fixedVersion: string
  summary: string
}

export interface PomDependencyStatus {
  dependency: PomDependency
  key: string
  vulnerabilities: PomVulnerability[]
  worst: SecurityBand | null
  /** Versione che chiude i CVE senza saltare più del necessario ("" se nessuna correzione nota). */
  fixVersion: string
  version: VersionInfo | null
}

/** Versione di una dipendenza senza `<version>`: gestita da un parent o da un BOM, non modificabile da questo file. */
export function mergeManagedVersions(dependencies: PomDependency[], managed: Record<string, { version: string; owner: string } | undefined>): PomDependency[] {
  return dependencies.map((dependency) => {
    const entry = dependency.resolved || dependency.version ? undefined : managed[`${dependency.groupId}:${dependency.artifactId}`]
    return entry ? { ...dependency, resolved: entry.version, managedBy: entry.owner } as PomDependency : dependency
  })
}

export interface PomTextEdit {
  line: number
  startColumn: number
  endColumn: number
  text: string
}

/** Versione effettiva usata da Maven in questo pom: vuota se è gestita da un parent o da un BOM. */
export function effectiveVersion(dependency: PomDependency): string {
  return dependency.resolved
}

/**
 * Dove scrivere un aggiornamento: la `<version>` se è letterale, il testo della property se la versione è
 * `${…}`. null quando la versione non è in questo file (parent/BOM): lì si aggiorna dove è definita.
 */
export function updateEdit(dependency: PomDependency, version: string): PomTextEdit | null {
  if (!version) return null
  if (dependency.property) {
    if (!dependency.propertyLine) return null
    return { line: dependency.propertyLine, startColumn: dependency.propertyStartColumn ?? 0, endColumn: dependency.propertyEndColumn ?? 0, text: version }
  }
  if (!dependency.version) return null
  return { line: dependency.line, startColumn: dependency.startColumn, endColumn: dependency.endColumn, text: version }
}

function pickFix(findings: SecurityFinding[]): string {
  const fixes = findings.map((finding) => finding.remediation.fixedVersion ?? '').filter(Boolean)
  const sorted = fixes.sort(compareVersions)
  return sorted[sorted.length - 1] ?? ''
}

/** Confronto numerico per componenti (1.10 > 1.9); i qualificatori testuali pesano come il testo. */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split(/[.\-_]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

/** Unisce dipendenze del pom, versioni pubblicate e CVE del report in una riga per dipendenza. */
export function dependencyStatuses(dependencies: PomDependency[], versions: VersionInfo[], findings: SecurityFinding[]): PomDependencyStatus[] {
  const byKey = new Map(versions.map((item) => [item.key, item]))
  return dependencies.map((dependency) => {
    const key = `${dependency.groupId}:${dependency.artifactId}`
    const matching = findings.filter((finding) => !finding.ignored && finding.component.name === key && (!dependency.resolved || finding.component.version === dependency.resolved))
    const vulnerabilities = matching
      .map((finding) => ({ id: finding.advisory.id, band: finding.risk.band, fixedVersion: finding.remediation.fixedVersion ?? '', summary: finding.advisory.summary ?? '' }))
      .sort((left, right) => BAND_RANK[right.band] - BAND_RANK[left.band])
    return { dependency, key, vulnerabilities, worst: vulnerabilities[0]?.band ?? null, fixVersion: pickFix(matching), version: byKey.get(key) ?? null }
  })
}

/** Coordinate da chiedere a Maven Central: solo quelle con una versione scritta in questo pom. */
export function versionRequest(dependencies: PomDependency[]): Record<string, string> {
  const request: Record<string, string> = {}
  for (const dependency of dependencies) {
    // I plugin Gradle (`….gradle.plugin`) stanno sul Plugin Portal, non su Maven Central.
    if (dependency.resolved && dependency.section !== 'plugins') request[`${dependency.groupId}:${dependency.artifactId}`] = dependency.resolved
  }
  return request
}

/** La cartella del progetto dal percorso assoluto del documento e dal suo percorso relativo. */
export function projectRootOf(absolutePath: string, relativePath: string): string {
  const absolute = absolutePath.replace(/\\/g, '/')
  const relative = relativePath.replace(/\\/g, '/')
  return absolute.endsWith(relative) ? absolute.slice(0, absolute.length - relative.length).replace(/\/$/, '') : absolute
}

export function isPomFile(relativePath: string): boolean {
  return relativePath.replace(/\\/g, '/').split('/').pop() === 'pom.xml'
}

/** build.gradle / build.gradle.kts: stesse lens, aggiornamenti e scansione CVE del pom (lettura statica delle dipendenze con versione). */
export function isGradleFile(relativePath: string): boolean {
  const name = relativePath.replace(/\\/g, '/').split('/').pop()
  return name === 'build.gradle' || name === 'build.gradle.kts'
}

export function isBuildFile(relativePath: string): boolean {
  return isPomFile(relativePath) || isGradleFile(relativePath)
}

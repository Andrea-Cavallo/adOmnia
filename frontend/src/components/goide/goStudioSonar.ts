import type { GoIDESonarIssue } from '@/lib/goide-api'
import type { AIFixProblem } from './goStudioAIFix'
import type { AIFixTarget } from './goStudioAIFixRunner'

export type SonarIssue = GoIDESonarIssue

// Severità classiche e quelle MQR di SonarQube 10.x (HIGH/MEDIUM/LOW).
const SEVERITY_RANK: Record<string, number> = { BLOCKER: 0, CRITICAL: 1, HIGH: 1, MAJOR: 2, MEDIUM: 2, MINOR: 3, LOW: 3, INFO: 4 }

export function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[(severity ?? '').toUpperCase()] ?? 5
}

export function sonarSeverityTone(severity: string | undefined): string {
  switch ((severity ?? '').toUpperCase()) {
    case 'BLOCKER': return 'bg-danger/15 text-danger'
    case 'CRITICAL': case 'HIGH': return 'bg-danger/12 text-danger'
    case 'MAJOR': case 'MEDIUM': return 'bg-warning/15 text-warning'
    case 'MINOR': case 'LOW': return 'bg-accent/12 text-accent'
    default: return 'bg-surface-3 text-text-3'
  }
}

export function isSecurityIssue(issue: SonarIssue): boolean {
  const type = (issue.type ?? '').toUpperCase()
  return type === 'VULNERABILITY' || type === 'SECURITY_HOTSPOT' || type === 'SECURITY'
}

/** Riga di testo stabile per il copia-incolla: `file:line [SEVERITY rule] message`. */
export function formatSonarIssue(issue: SonarIssue): string {
  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file
  const severity = (issue.severity ?? '').toUpperCase()
  const tags = [severity, issue.rule].filter(Boolean).join(' ')
  return `${location}${tags ? ` [${tags}]` : ''} ${issue.message}`.trim()
}

export function sortSonarIssues(issues: readonly SonarIssue[]): SonarIssue[] {
  return [...issues].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity)
    if (bySeverity !== 0) return bySeverity
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    return (a.line ?? 0) - (b.line ?? 0)
  })
}

/** Testo completo per il pulsante "Copy problems", ordinato dal più grave. */
export function formatSonarIssues(issues: readonly SonarIssue[]): string {
  return sortSonarIssues(issues).map(formatSonarIssue).join('\n')
}

export function filterSonarIssues(issues: readonly SonarIssue[], options: { query?: string; severity?: string; securityOnly?: boolean }): SonarIssue[] {
  const query = (options.query ?? '').toLowerCase()
  return issues.filter((issue) => {
    if (options.severity && (issue.severity ?? '').toUpperCase() !== options.severity.toUpperCase()) return false
    if (options.securityOnly && !isSecurityIssue(issue)) return false
    if (!query) return true
    return `${issue.file} ${issue.rule} ${issue.message} ${(issue.tags ?? []).join(' ')}`.toLowerCase().includes(query)
  })
}

/** Un target AI per file, con i problemi dal più grave: è il formato di "Resolve all with AI". */
export function sonarIssuesToAIFixTargets(issues: readonly SonarIssue[], limit = 10): AIFixTarget[] {
  const byFile = new Map<string, AIFixProblem[]>()
  for (const issue of sortSonarIssues(issues)) {
    const problems = byFile.get(issue.file) ?? []
    problems.push({ message: issue.message, line: issue.line && issue.line > 0 ? issue.line : 1, source: `SonarQube ${issue.rule}${issue.severity ? ` (${issue.severity})` : ''}` })
    byFile.set(issue.file, problems)
  }
  return [...byFile.entries()].slice(0, limit).map(([relativePath, problems]) => ({ relativePath, problems }))
}

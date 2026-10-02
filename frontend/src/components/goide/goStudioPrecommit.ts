import type { GoIDEDiagnosticsReport } from '@/lib/goide-lsp-api'

export interface GoStudioPrecommitSummary {
  errors: number
  warnings: number
  files: string[]
}

/** Errori e avvisi (gopls + linter) nei soli file che si stanno per registrare. */
export function precommitProblems(reports: GoIDEDiagnosticsReport[], selected: ReadonlySet<string>): GoStudioPrecommitSummary {
  const summary: GoStudioPrecommitSummary = { errors: 0, warnings: 0, files: [] }
  for (const report of reports) {
    if (!report.relativePath || !selected.has(report.relativePath)) continue
    const errors = report.diagnostics.filter((item) => item.severity === 1).length
    const warnings = report.diagnostics.filter((item) => item.severity === 2).length
    summary.errors += errors
    summary.warnings += warnings
    if (errors + warnings > 0) summary.files.push(report.relativePath)
  }
  summary.files.sort()
  return summary
}

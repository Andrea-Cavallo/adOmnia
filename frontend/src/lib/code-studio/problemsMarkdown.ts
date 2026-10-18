import type { GoIDEDiagnosticsReport } from '@/lib/code-studio-lsp-api'

export interface ProblemsMarkdownBuildProblem {
  path: string
  line: number
  column: number
  text: string
}

const SEVERITY = ['', 'error', 'warning', 'information', 'hint']

/** Il pannello Problems come Markdown: un file per sezione, un problema per riga (`severità · sorgente · riga:colonna`). */
export function problemsToMarkdown(reports: GoIDEDiagnosticsReport[], buildProblems: ProblemsMarkdownBuildProblem[] = [], title = 'Problems'): string {
  const files = reports.filter((report) => report.diagnostics.length > 0)
  const total = files.reduce((sum, report) => sum + report.diagnostics.length, 0) + buildProblems.length
  const lines = [`# ${title}`, '', `${total} problem${total === 1 ? '' : 's'}${files.length ? ` in ${files.length} file${files.length === 1 ? '' : 's'}` : ''}`, '']
  for (const report of files) {
    lines.push(`## ${report.relativePath || report.path}`, '')
    const sorted = [...report.diagnostics].sort((left, right) => left.severity - right.severity || left.range.startLine - right.range.startLine)
    for (const item of sorted) {
      const origin = [SEVERITY[item.severity] ?? 'information', item.source].filter(Boolean).join(' · ')
      const message = item.message.trim().replace(/\r?\n\s*/g, ' ')
      lines.push(`- [ ] **${origin}** ${item.range.startLine}:${item.range.startColumn} — ${message}`)
    }
    lines.push('')
  }
  if (buildProblems.length > 0) {
    lines.push('## Last build output', '')
    for (const item of buildProblems) lines.push(`- [ ] ${item.path}:${item.line}:${item.column} — ${item.text.trim().replace(/\r?\n\s*/g, ' ')}`)
    lines.push('')
  }
  return lines.join('\n')
}

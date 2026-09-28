import type { GoIDEDiagnostic, GoIDEEditorTextEdit } from '@/lib/goide-lsp-api'

export interface GoStudioLintAction {
  title: string
  edits: GoIDEEditorTextEdit[]
  preferred: boolean
  diagnostic: GoIDEDiagnostic
}

const NOLINT = '//nolint'

function linterName(diagnostic: GoIDEDiagnostic): string {
  return diagnostic.source?.split('·').pop()?.trim() || 'linter'
}

/** Direttiva sulla riga (golangci-lint) o sopra la riga con la stessa indentazione (staticcheck). */
function suppressionEdit(diagnostic: GoIDEDiagnostic, lineText: string): GoIDEEditorTextEdit | null {
  const directive = diagnostic.suppression
  if (!directive) return null
  const line = diagnostic.range.startLine
  if (directive.startsWith(NOLINT)) {
    if (lineText.includes(NOLINT)) return null
    const end = lineText.length + 1
    return { range: { startLine: line, startColumn: end, endLine: line, endColumn: end }, text: ` ${directive}` }
  }
  const indent = /^\s*/.exec(lineText)?.[0] ?? ''
  return { range: { startLine: line, startColumn: 1, endLine: line, endColumn: 1 }, text: `${indent}${directive}\n` }
}

/**
 * Azioni Alt+Enter dei linter sulle righe selezionate: prima le correzioni proposte dal linter,
 * poi la soppressione esplicita. Le correzioni valgono solo sul file non modificato dopo l'analisi.
 */
export function lintActionsFor(diagnostics: GoIDEDiagnostic[], firstLine: number, lastLine: number, lineText: (line: number) => string, bufferMatchesDisk: boolean): GoStudioLintAction[] {
  const actions: GoStudioLintAction[] = []
  for (const diagnostic of diagnostics) {
    const line = diagnostic.range.startLine
    if (line < firstLine || line > lastLine) continue
    if (bufferMatchesDisk) {
      for (const fix of diagnostic.fixes ?? []) actions.push({ title: `${fix.title} (${linterName(diagnostic)})`, edits: fix.edits, preferred: true, diagnostic })
    }
    const suppression = bufferMatchesDisk ? suppressionEdit(diagnostic, lineText(line)) : null
    if (suppression) actions.push({ title: `Suppress ${linterName(diagnostic)} for this line`, edits: [suppression], preferred: false, diagnostic })
  }
  return actions
}

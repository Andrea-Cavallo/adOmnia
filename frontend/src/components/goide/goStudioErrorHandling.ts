import type { GoIDEErrorFinding, GoIDEErrorFix, GoIDEErrorReport } from '@/lib/goide-api'
import type { GoIDEWorkspaceChange } from '@/lib/goide-lsp-api'
import { applyTextEdits } from './goStudioChangePreview'

/** Titolo e spiegazione di ogni regola, nell'ordine in cui il pannello le raggruppa. */
export const ERROR_RULES: Record<string, { title: string; hint: string }> = {
  'wrap-nonerror': { title: '%w without an error', hint: 'fmt.Errorf only wraps error operands.' },
  'as-target': { title: 'Invalid errors.As target', hint: 'errors.As needs a pointer to a variable whose type implements error.' },
  ignored: { title: 'Returned error ignored', hint: 'The call returns an error that is never looked at.' },
  unhandled: { title: 'Unhandled error', hint: 'The error is assigned and then overwritten or forgotten before any check.' },
  shadow: { title: 'Error shadowing', hint: ':= declares a new err that hides an outer one read later.' },
  'wrap-verb': { title: 'Formatted, not wrapped (%v/%s)', hint: 'Only %w keeps the cause visible to errors.Is and errors.As.' },
  'lost-chain': { title: 'err.Error() breaks the chain', hint: 'Only the text survives: wrap the error itself with %w.' },
  compare: { title: '== with a sentinel instead of errors.Is', hint: 'A direct comparison misses wrapped sentinel errors.' },
  'recover-noop': { title: 'recover() without effect', hint: 'recover only works when called directly by a deferred function.' },
  'recover-swallow': { title: 'Panic swallowed by recover()', hint: 'The recovered value is discarded.' },
  'type-assert': { title: 'Type assertion instead of errors.As', hint: 'Assertions and type switches do not look inside wrapped errors.' },
  'lost-context': { title: 'Error returned without context', hint: 'Wrapping with fmt.Errorf("operation: %w", err) tells callers what failed.' },
  'nil-nil': { title: 'Suspicious return nil, nil', hint: 'Callers cannot tell a missing value from success.' },
  panic: { title: 'panic in library code', hint: 'Callers cannot handle a panic: prefer returning an error.' },
  discarded: { title: 'Error discarded with _', hint: 'Explicitly ignored: keep it only when the failure truly does not matter.' },
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 }

export interface GoStudioErrorRuleGroup {
  kind: string
  title: string
  hint: string
  severity: string
  findings: GoIDEErrorFinding[]
}

/** Raggruppa i problemi per regola: prima i più gravi, poi i più numerosi. */
export function groupErrorFindings(findings: readonly GoIDEErrorFinding[], query = ''): GoStudioErrorRuleGroup[] {
  const needle = query.trim().toLowerCase()
  const groups = new Map<string, GoStudioErrorRuleGroup>()
  for (const finding of findings) {
    if (needle && !`${finding.message} ${finding.function ?? ''} ${finding.location.relativePath}`.toLowerCase().includes(needle)) continue
    const rule = ERROR_RULES[finding.kind] ?? { title: finding.kind, hint: '' }
    const group = groups.get(finding.kind) ?? { kind: finding.kind, ...rule, severity: finding.severity, findings: [] }
    group.findings.push(finding)
    groups.set(finding.kind, group)
  }
  return [...groups.values()].sort((left, right) => (SEVERITY_ORDER[left.severity] ?? 3) - (SEVERITY_ORDER[right.severity] ?? 3) || right.findings.length - left.findings.length)
}

/** Offset nel testo di una posizione Monaco (riga 1-based, colonna UTF-16 1-based). */
export function offsetAt(text: string, line: number, column: number): number {
  let offset = 0
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset)
    if (next < 0) return text.length
    offset = next + 1
  }
  return Math.min(text.length, offset + column - 1)
}

/**
 * Trasforma un fix in una modifica di un solo file, ma solo se il buffer contiene ancora il testo
 * analizzato: un fix calcolato su una versione precedente non viene mai applicato a metà.
 */
export function errorFixChange(fix: GoIDEErrorFix, relativePath: string, buffer: string): GoIDEWorkspaceChange | null {
  const text = buffer.replace(/\r\n/g, '\n')
  for (const edit of fix.edits) {
    const start = offsetAt(text, edit.range.startLine, edit.range.startColumn)
    const end = offsetAt(text, edit.range.endLine, edit.range.endColumn)
    if (text.slice(start, end) !== edit.original) return null
  }
  const edits = fix.edits.map((edit) => ({ range: edit.range, text: edit.text }))
  return { label: fix.label, files: [{ uri: '', path: '', relativePath, edits, newContent: applyTextEdits(text, edits) }] } as GoIDEWorkspaceChange
}

export interface GoStudioErrorPathFile {
  relativePath: string
  paths: GoIDEErrorReport['paths']
}

/** Percorsi d'errore di un file, nell'ordine del sorgente. */
export function errorPathsForFile(report: GoIDEErrorReport, relativePath: string): GoIDEErrorReport['paths'] {
  return report.paths.filter((path) => path.location.relativePath === relativePath).sort((left, right) => left.location.line - right.location.line)
}

/** Riepilogo dei ritorni di una funzione: quanti nil, wrap, propagati, nuovi… */
export function returnKindCounts(path: GoIDEErrorReport['paths'][number]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const ret of path.returns) counts.set(ret.kind, (counts.get(ret.kind) ?? 0) + 1)
  return [...counts.entries()]
}

import type { GoIDECoverageReport } from '@/lib/goide-tests-api'

export type GoStudioCoverageLine = 'covered' | 'uncovered' | 'partial'

type CoverageFile = GoIDECoverageReport['files'][number]

/** Stato di ogni riga: una riga con blocchi eseguiti e non eseguiti è parziale. */
export function coverageLineStates(file: CoverageFile): Map<number, GoStudioCoverageLine> {
  const states = new Map<number, GoStudioCoverageLine>()
  for (const block of file.blocks ?? []) {
    for (let line = block.startLine; line <= block.endLine; line++) {
      const previous = states.get(line)
      const next: GoStudioCoverageLine = block.covered ? 'covered' : 'uncovered'
      states.set(line, previous && previous !== next ? 'partial' : next)
    }
  }
  return states
}

export type GoStudioCoverageMatch =
  | { state: 'none' }
  | { state: 'current'; file: CoverageFile }
  | { state: 'stale'; file: CoverageFile }

/** Il profilo vale solo per il contenuto analizzato: file modificato su disco o nel buffer = coverage superata. */
export function coverageForDocument(report: GoIDECoverageReport | null | undefined, relativePath: string, diskToken: string, dirty: boolean): GoStudioCoverageMatch {
  const file = report?.files.find((item) => item.relativePath === relativePath)
  if (!file) return { state: 'none' }
  return file.diskToken === diskToken && !dirty ? { state: 'current', file } : { state: 'stale', file }
}

export interface GoStudioFunctionCoverage {
  relativePath: string
  name: string
  line: number
  statements: number
  covered: number
  percent: number
}

/** Funzioni con istruzioni, dalla meno coperta; a pari copertura prima quelle con più istruzioni scoperte. */
export function functionsByCoverage(report: GoIDECoverageReport): GoStudioFunctionCoverage[] {
  return report.files
    .flatMap((file) => (file.functions ?? []).filter((fn) => fn.statements > 0).map((fn) => ({ relativePath: file.relativePath, ...fn })))
    .sort((left, right) => left.percent - right.percent || (right.statements - right.covered) - (left.statements - left.covered) || left.relativePath.localeCompare(right.relativePath) || left.line - right.line)
}

export interface GoStudioPatchCoverageFile {
  relativePath: string
  statements: number
  covered: number
  /** Righe cambiate che contengono istruzioni mai eseguite. */
  uncoveredLines: number[]
}

export interface GoStudioPatchCoverage {
  statements: number
  covered: number
  percent: number
  files: GoStudioPatchCoverageFile[]
}

/**
 * Patch coverage: solo le istruzioni dei blocchi che toccano righe cambiate rispetto al branch base.
 * I file cambiati senza coverage (non compilati nei test) non entrano nel conteggio.
 */
export function patchCoverage(report: GoIDECoverageReport, changed: Record<string, { start: number; end: number }[]>): GoStudioPatchCoverage {
  const files: GoStudioPatchCoverageFile[] = []
  for (const file of report.files) {
    const ranges = changed[file.relativePath]
    if (!ranges?.length) continue
    const result: GoStudioPatchCoverageFile = { relativePath: file.relativePath, statements: 0, covered: 0, uncoveredLines: [] }
    const uncovered = new Set<number>()
    for (const block of file.blocks ?? []) {
      const touched = ranges.filter((range) => block.startLine <= range.end && block.endLine >= range.start)
      if (touched.length === 0) continue
      const statements = block.statements ?? 0
      result.statements += statements
      if (block.covered) result.covered += statements
      else for (const range of touched) for (let line = Math.max(range.start, block.startLine); line <= Math.min(range.end, block.endLine); line++) uncovered.add(line)
    }
    if (result.statements === 0) continue
    result.uncoveredLines = [...uncovered].sort((left, right) => left - right)
    files.push(result)
  }
  files.sort((left, right) => (left.covered / left.statements) - (right.covered / right.statements) || left.relativePath.localeCompare(right.relativePath))
  const statements = files.reduce((sum, file) => sum + file.statements, 0)
  const covered = files.reduce((sum, file) => sum + file.covered, 0)
  return { statements, covered, percent: statements ? (covered * 100) / statements : 0, files }
}

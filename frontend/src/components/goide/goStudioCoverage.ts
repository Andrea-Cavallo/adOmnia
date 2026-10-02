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

/**
 * Decorazioni dell'albero Project: stato Git, errori/avvisi di gopls e test falliti.
 * Una cartella eredita il segno più grave dei suoi file, così un problema si trova
 * anche con le cartelle chiuse.
 */

export type GoStudioVcsMark = 'modified' | 'added' | 'untracked' | 'deleted' | 'conflicted'

export interface GoStudioTreeMark {
  vcs?: GoStudioVcsMark
  problem?: 'error' | 'warning'
  /** Numero di errori (o di avvisi se non ci sono errori) nel file o nella cartella. */
  problems?: number
  testFailed?: boolean
}

export interface TreeMarkInput {
  changes: Array<{ relativePath: string; status: string; untracked: boolean; conflicted: boolean }>
  diagnostics: Array<{ relativePath?: string; diagnostics: Array<{ severity: number }> }>
  failedTestFiles: string[]
}

/** Codice porcelain di Git (" M", "A ", "??", "UU"…) → segno dell'albero. */
export function vcsMark(change: TreeMarkInput['changes'][number]): GoStudioVcsMark {
  if (change.conflicted) return 'conflicted'
  if (change.untracked || change.status === '??') return 'untracked'
  if (change.status.includes('A')) return 'added'
  if (change.status.includes('D')) return 'deleted'
  return 'modified'
}

function ancestors(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

const VCS_WEIGHT: Record<GoStudioVcsMark, number> = { conflicted: 4, modified: 1, added: 1, deleted: 1, untracked: 0 }

export function buildTreeMarks(input: TreeMarkInput): Map<string, GoStudioTreeMark> {
  const marks = new Map<string, GoStudioTreeMark>()
  const update = (path: string, change: (mark: GoStudioTreeMark) => GoStudioTreeMark) => marks.set(path, change(marks.get(path) ?? {}))
  const spread = (path: string, change: (mark: GoStudioTreeMark) => GoStudioTreeMark) => {
    update(path, change)
    for (const folder of ancestors(path)) update(folder, change)
  }

  for (const change of input.changes) {
    const mark = vcsMark(change)
    update(change.relativePath, (current) => ({ ...current, vcs: mark }))
    // Le cartelle mostrano solo "contiene modifiche", o il conflitto che va risolto.
    const folderMark: GoStudioVcsMark = mark === 'conflicted' ? 'conflicted' : 'modified'
    for (const folder of ancestors(change.relativePath)) {
      update(folder, (current) => ({ ...current, vcs: current.vcs && VCS_WEIGHT[current.vcs] >= VCS_WEIGHT[folderMark] ? current.vcs : folderMark }))
    }
  }

  for (const report of input.diagnostics) {
    if (!report.relativePath) continue
    const errors = report.diagnostics.filter((item) => item.severity === 1).length
    const warnings = report.diagnostics.filter((item) => item.severity === 2).length
    if (errors === 0 && warnings === 0) continue
    spread(report.relativePath, (current) => {
      if (errors > 0) return { ...current, problem: 'error', problems: (current.problem === 'error' ? current.problems ?? 0 : 0) + errors }
      if (current.problem === 'error') return current
      return { ...current, problem: 'warning', problems: (current.problems ?? 0) + warnings }
    })
  }

  for (const file of new Set(input.failedTestFiles)) spread(file, (current) => ({ ...current, testFailed: true }))
  return marks
}

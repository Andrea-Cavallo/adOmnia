import { lineDiff } from '@/lib/goide/goStudioLineDiff'

export interface GoStudioRecoveryDiffLine {
  kind: 'added' | 'removed'
  /** Riga nel file su disco (rimosse) o nella versione recuperata (aggiunte), 1-based. */
  line: number
  text: string
  hunkStart: boolean
}

export interface GoStudioRecoverySummary {
  added: number
  removed: number
  lines: GoStudioRecoveryDiffLine[]
}

const MAX_DIFF_LINES = 400

/** Diff Disk Version → Recovered Version: righe aggiunte e rimosse, per il riepilogo e la Review. */
export function recoverySummary(disk: string, recovered: string): GoStudioRecoverySummary {
  const diskLines = disk.split(/\r?\n/)
  const recoveredLines = recovered.split(/\r?\n/)
  let added = 0
  let removed = 0
  const lines: GoStudioRecoveryDiffLine[] = []
  for (const hunk of lineDiff(disk, recovered)) {
    const oldCount = hunk.oldEnd - hunk.oldStart + 1
    const newCount = hunk.newEnd - hunk.newStart + 1
    removed += Math.max(0, oldCount)
    added += Math.max(0, newCount)
    let first = true
    for (let line = hunk.oldStart; line <= hunk.oldEnd && lines.length < MAX_DIFF_LINES; line++) {
      lines.push({ kind: 'removed', line, text: diskLines[line - 1] ?? '', hunkStart: first })
      first = false
    }
    for (let line = hunk.newStart; line <= hunk.newEnd && lines.length < MAX_DIFF_LINES; line++) {
      lines.push({ kind: 'added', line, text: recoveredLines[line - 1] ?? '', hunkStart: first })
      first = false
    }
  }
  return { added, removed, lines }
}

export type GoStudioRecoveryStatus = 'safe' | 'already-applied' | 'conflict' | 'missing'

export const RECOVERY_STATUS_LABEL: Record<GoStudioRecoveryStatus, string> = {
  safe: 'Safe to restore',
  'already-applied': 'Already on disk',
  conflict: 'Conflict: file changed on disk',
  missing: 'File no longer exists',
}

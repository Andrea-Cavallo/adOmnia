import type { HunkRange } from '@/lib/git/hunks'

/** Blocco di differenze come lo calcola Monaco (`getLineChanges`); la fine 0 indica un lato senza righe. */
export interface DiffLineChange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

/** Stessa convenzione di `lineDiff`: un lato vuoto parte dalla riga successiva al vuoto e finisce prima di essa. */
export function lineChangeRange(change: DiffLineChange): HunkRange {
  const added = change.originalEndLineNumber === 0
  const deleted = change.modifiedEndLineNumber === 0
  return {
    oldStart: added ? change.originalStartLineNumber + 1 : change.originalStartLineNumber,
    oldEnd: added ? change.originalStartLineNumber : change.originalEndLineNumber,
    newStart: deleted ? change.modifiedStartLineNumber + 1 : change.modifiedStartLineNumber,
    newEnd: deleted ? change.modifiedStartLineNumber : change.modifiedEndLineNumber,
  }
}

/** Il testo di lavoro con il solo blocco ripristinato come in HEAD; fine riga e newline finale restano quelli del file. */
export function revertLineChange(modified: string, original: string, change: DiffLineChange): string {
  const eol = modified.includes('\r\n') ? '\r\n' : '\n'
  const modifiedLines = modified.split(/\r?\n/)
  const originalLines = original.split(/\r?\n/)
  const restored = change.originalEndLineNumber === 0 ? [] : originalLines.slice(change.originalStartLineNumber - 1, change.originalEndLineNumber)
  const deleted = change.modifiedEndLineNumber === 0 ? 0 : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
  const start = change.modifiedEndLineNumber === 0 ? change.modifiedStartLineNumber : change.modifiedStartLineNumber - 1
  modifiedLines.splice(start, deleted, ...restored)
  return modifiedLines.join(eol)
}

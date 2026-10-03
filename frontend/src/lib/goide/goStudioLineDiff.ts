/** Blocco di differenze fra la revisione di riferimento (HEAD) e il buffer, righe 1-based. */
export interface GoStudioLineHunk {
  kind: 'added' | 'modified' | 'deleted'
  /** Righe del buffer attuale; per "deleted" newStart è la riga dopo cui mancano righe e newEnd = newStart - 1. */
  newStart: number
  newEnd: number
  /** Righe corrispondenti nella revisione di riferimento. */
  oldStart: number
  oldEnd: number
}

/** Oltre questa dimensione della parte centrale diversa si evita la LCS quadratica: un solo blocco. */
const MAX_LCS_CELLS = 4_000_000

/** Stessa euristica di Git: un byte NUL nei primi 8000 caratteri indica un contenuto binario, senza diff per riga. */
export function isBinaryText(text: string): boolean {
  return text.slice(0, 8000).includes('\u0000')
}

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Coppie di righe uguali (indici 0-based) della sottosequenza comune più lunga. */
function commonPairs(oldLines: string[], newLines: string[]): Array<[number, number]> {
  const rows = oldLines.length
  const columns = newLines.length
  const table: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1))
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row][column] = oldLines[row] === newLines[column] ? table[row + 1][column + 1] + 1 : Math.max(table[row + 1][column], table[row][column + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (oldLines[row] === newLines[column]) { pairs.push([row, column]); row++; column++ }
    else if (table[row + 1][column] >= table[row][column + 1]) row++
    else column++
  }
  return pairs
}

function hunk(oldStart: number, oldEnd: number, newStart: number, newEnd: number): GoStudioLineHunk {
  const kind = newEnd < newStart ? 'deleted' : oldEnd < oldStart ? 'added' : 'modified'
  return { kind, oldStart, oldEnd, newStart, newEnd }
}

/** Differenze a livello di riga, come il gutter di GoLand: aggiunte, modifiche e cancellazioni. */
export function lineDiff(oldText: string, newText: string): GoStudioLineHunk[] {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix)
  const newMiddle = newLines.slice(prefix, newLines.length - suffix)
  if (oldMiddle.length === 0 && newMiddle.length === 0) return []
  if (oldMiddle.length * newMiddle.length > MAX_LCS_CELLS) {
    return [hunk(prefix + 1, prefix + oldMiddle.length, prefix + 1, prefix + newMiddle.length)]
  }
  const hunks: GoStudioLineHunk[] = []
  let oldIndex = 0
  let newIndex = 0
  for (const [oldMatch, newMatch] of [...commonPairs(oldMiddle, newMiddle), [oldMiddle.length, newMiddle.length] as [number, number]]) {
    if (oldMatch > oldIndex || newMatch > newIndex) {
      hunks.push(hunk(prefix + oldIndex + 1, prefix + oldMatch, prefix + newIndex + 1, prefix + newMatch))
    }
    oldIndex = oldMatch + 1
    newIndex = newMatch + 1
  }
  return hunks
}

/** Righe della revisione di riferimento coperte dal blocco (per il popup e il revert). */
export function hunkOldLines(oldText: string, target: GoStudioLineHunk): string[] {
  return splitLines(oldText).slice(target.oldStart - 1, target.oldEnd)
}

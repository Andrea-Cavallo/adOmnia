import type { GoIDEFileChange } from '@/lib/goide-lsp-api'

export interface GoStudioPreviewLine {
  line: number
  text: string
  /** Vero sulla prima riga di un blocco non contiguo al precedente. */
  hunkStart: boolean
  /** Riga tolta dal file originale o presente nel file risultante. */
  kind: 'added' | 'removed'
}

type Edit = GoIDEFileChange['edits'][number]

interface Hunk {
  originalStart: number
  originalEnd: number
  newStart: number
  newEnd: number
}

function insertedLineCount(edit: Edit): number {
  return edit.text.split('\n').length - 1
}

/** Raggruppa edit che toccano righe contigue o sovrapposte, calcolando le righe corrispondenti nel file nuovo. */
function hunksFor(edits: Edit[]): Hunk[] {
  const ordered = [...edits].sort((left, right) => left.range.startLine - right.range.startLine || left.range.startColumn - right.range.startColumn)
  const hunks: Hunk[] = []
  let shift = 0
  for (const edit of ordered) {
    const delta = insertedLineCount(edit) - (edit.range.endLine - edit.range.startLine)
    const last = hunks[hunks.length - 1]
    if (last && edit.range.startLine <= last.originalEnd) {
      last.originalEnd = Math.max(last.originalEnd, edit.range.endLine)
      last.newEnd = last.originalEnd + shift + delta
    } else {
      hunks.push({ originalStart: edit.range.startLine, originalEnd: edit.range.endLine, newStart: edit.range.startLine + shift, newEnd: edit.range.endLine + shift + delta })
    }
    shift += delta
  }
  return hunks
}

function rows(lines: string[], from: number, to: number, kind: GoStudioPreviewLine['kind']): GoStudioPreviewLine[] {
  const result: GoStudioPreviewLine[] = []
  for (let line = Math.max(1, from); line <= Math.min(to, lines.length); line++) result.push({ line, text: lines[line - 1], hunkStart: false, kind })
  return result
}

/** Toglie dal blocco le righe identiche in testa e in coda: restano solo quelle davvero cambiate. */
function trimUnchanged(removed: GoStudioPreviewLine[], added: GoStudioPreviewLine[]): [GoStudioPreviewLine[], GoStudioPreviewLine[]] {
  let head = 0
  while (head < removed.length && head < added.length && removed[head].text === added[head].text) head++
  let tail = 0
  while (tail < removed.length - head && tail < added.length - head && removed[removed.length - 1 - tail].text === added[added.length - 1 - tail].text) tail++
  return [removed.slice(head, removed.length - tail), added.slice(head, added.length - tail)]
}

/**
 * Diff leggibile di un file toccato da una modifica: per ogni blocco le righe originali tolte
 * e le righe risultanti. Senza testo originale (file nuovo) mostra solo le righe aggiunte.
 */
export function changedLines(file: GoIDEFileChange): GoStudioPreviewLine[] {
  const newLines = file.newContent.split(/\r?\n/)
  if (file.created || file.originalContent === undefined) {
    const hunks = file.created ? [{ newStart: 1, newEnd: newLines.length }] : hunksFor(file.edits)
    return hunks.flatMap((hunk, index) => rows(newLines, hunk.newStart, hunk.newEnd, 'added').map((row, position) => ({ ...row, hunkStart: index > 0 && position === 0 })))
  }
  const originalLines = file.originalContent.split(/\r?\n/)
  return hunksFor(file.edits).flatMap((hunk, index) => {
    const [removed, added] = trimUnchanged(rows(originalLines, hunk.originalStart, hunk.originalEnd, 'removed'), rows(newLines, hunk.newStart, hunk.newEnd, 'added'))
    return [...removed, ...added].map((row, position) => ({ ...row, hunkStart: index > 0 && position === 0 }))
  })
}

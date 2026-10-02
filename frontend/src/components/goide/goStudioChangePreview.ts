import type { GoIDEEditorTextEdit, GoIDEFileChange } from '@/lib/goide-lsp-api'

export interface GoStudioPreviewLine {
  line: number
  text: string
  /** Vero sulla prima riga di un blocco non contiguo al precedente. */
  hunkStart: boolean
  /** Riga tolta dal file originale o presente nel file risultante. */
  kind: 'added' | 'removed'
  /** Blocco di appartenenza: si applica o si scarta un blocco intero. */
  hunk: number
}

type Edit = GoIDEFileChange['edits'][number]

interface Hunk {
  originalStart: number
  originalEnd: number
  newStart: number
  newEnd: number
  /** Indici in `edits` degli edit che compongono il blocco. */
  edits: number[]
}

/** Applica edit LSP (righe e colonne 1-based, colonne UTF-16) a un testo, dall'ultimo al primo. */
export function applyTextEdits(text: string, edits: GoIDEEditorTextEdit[]): string {
  const lineStarts = [0]
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') lineStarts.push(index + 1)
  const offset = (line: number, column: number) => {
    const start = lineStarts[Math.min(Math.max(line, 1), lineStarts.length) - 1]
    return Math.min(start + Math.max(column, 1) - 1, text.length)
  }
  const ordered = [...edits].sort((left, right) => offset(right.range.startLine, right.range.startColumn) - offset(left.range.startLine, left.range.startColumn))
  let result = text
  for (const edit of ordered) {
    result = result.slice(0, offset(edit.range.startLine, edit.range.startColumn)) + edit.text + result.slice(offset(edit.range.endLine, edit.range.endColumn))
  }
  return result
}

function insertedLineCount(edit: Edit): number {
  return edit.text.split('\n').length - 1
}

/** Raggruppa edit che toccano righe contigue o sovrapposte, calcolando le righe corrispondenti nel file nuovo. */
function hunksFor(edits: Edit[]): Hunk[] {
  const ordered = edits.map((edit, index) => ({ edit, index })).sort((left, right) => left.edit.range.startLine - right.edit.range.startLine || left.edit.range.startColumn - right.edit.range.startColumn)
  const hunks: Hunk[] = []
  let shift = 0
  for (const { edit, index } of ordered) {
    const delta = insertedLineCount(edit) - (edit.range.endLine - edit.range.startLine)
    const last = hunks[hunks.length - 1]
    if (last && edit.range.startLine <= last.originalEnd) {
      last.originalEnd = Math.max(last.originalEnd, edit.range.endLine)
      last.newEnd = last.originalEnd + shift + delta
      last.edits.push(index)
    } else {
      hunks.push({ originalStart: edit.range.startLine, originalEnd: edit.range.endLine, newStart: edit.range.startLine + shift, newEnd: edit.range.endLine + shift + delta, edits: [index] })
    }
    shift += delta
  }
  return hunks
}

function rows(lines: string[], from: number, to: number, kind: GoStudioPreviewLine['kind']): GoStudioPreviewLine[] {
  const result: GoStudioPreviewLine[] = []
  for (let line = Math.max(1, from); line <= Math.min(to, lines.length); line++) result.push({ line, text: lines[line - 1], hunkStart: false, kind, hunk: 0 })
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
    return hunks.flatMap((hunk, index) => rows(newLines, hunk.newStart, hunk.newEnd, 'added').map((row, position) => ({ ...row, hunk: index, hunkStart: index > 0 && position === 0 })))
  }
  const originalLines = file.originalContent.split(/\r?\n/)
  return hunksFor(file.edits).flatMap((hunk, index) => {
    const [removed, added] = trimUnchanged(rows(originalLines, hunk.originalStart, hunk.originalEnd, 'removed'), rows(newLines, hunk.newStart, hunk.newEnd, 'added'))
    return [...removed, ...added].map((row, position) => ({ ...row, hunk: index, hunkStart: index > 0 && position === 0 }))
  })
}

/** Numero di blocchi selezionabili: un file nuovo o senza testo originale si applica solo per intero. */
export function selectableHunks(file: GoIDEFileChange): number {
  return file.created || file.originalContent === undefined ? 0 : hunksFor(file.edits).length
}

/**
 * Tiene solo i blocchi scelti: gli edit restano quelli di gopls/AI, il contenuto risultante si ricalcola
 * dal testo originale. null se non resta nessun blocco (il file non va toccato).
 */
export function selectHunks(file: GoIDEFileChange, keep: ReadonlySet<number>): GoIDEFileChange | null {
  if (selectableHunks(file) === 0) return file
  const kept = new Set(hunksFor(file.edits).flatMap((hunk, index) => (keep.has(index) ? hunk.edits : [])))
  if (kept.size === 0) return null
  if (kept.size === file.edits.length) return file
  const edits = file.edits.filter((_edit, index) => kept.has(index))
  return { ...file, edits, newContent: applyTextEdits(file.originalContent!.replace(/\r\n/g, '\n'), edits) }
}

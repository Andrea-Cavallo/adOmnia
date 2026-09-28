import type { GoIDEFileChange } from '@/lib/goide-lsp-api'

export interface GoStudioPreviewLine {
  line: number
  text: string
  /** Vero sulla prima riga di un blocco non contiguo al precedente. */
  hunkStart: boolean
}

/**
 * Righe del file risultante toccate dalle modifiche, incluse tutte le righe inserite:
 * un rename mostra la riga finale, una generazione di metodi mostra l'intero codice aggiunto.
 */
export function changedLines(file: GoIDEFileChange): GoStudioPreviewLine[] {
  const lines = file.newContent.split(/\r?\n/)
  const touched = new Set<number>()
  let shift = 0
  const edits = [...file.edits].sort((left, right) => left.range.startLine - right.range.startLine || left.range.startColumn - right.range.startColumn)
  for (const edit of edits) {
    const start = edit.range.startLine + shift
    const inserted = edit.text.split('\n').length - 1
    for (let line = start; line <= start + inserted; line++) touched.add(line)
    shift += inserted - (edit.range.endLine - edit.range.startLine)
  }
  const ordered = [...touched].filter((line) => line >= 1 && line <= lines.length).sort((left, right) => left - right)
  return ordered.map((line, index) => ({ line, text: lines[line - 1], hunkStart: index > 0 && ordered[index - 1] !== line - 1 }))
}

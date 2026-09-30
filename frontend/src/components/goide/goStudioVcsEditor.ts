import { useEffect, useRef, type MutableRefObject } from 'react'
import { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { headKey, useGoIDEVCSStore } from '@/stores/goideVcs'
import type { GoIDEVCSBlameLine } from '@/lib/goide-vcs-api'
import { documentForModel } from './goStudioLanguageFeatures'
import { hunkOldLines, lineDiff, type GoStudioLineHunk } from './goStudioLineDiff'

const DIFF_DEBOUNCE_MS = 300
const BLAME_AUTHOR_CHARS = 12
const BLAME_LINE_NUMBER_CHARS = 36

/** Blocchi calcolati per ciascun editor, per il clic sul gutter. */
const hunksByEditor = new WeakMap<monaco.editor.ICodeEditor, GoStudioLineHunk[]>()

export interface GoStudioRevertEdit {
  range: monaco.IRange
  text: string
}

/**
 * Edit che rimette nel buffer le righe di HEAD al posto del blocco: rimuove le righe aggiunte,
 * sostituisce quelle modificate, reinserisce quelle cancellate.
 */
export function revertEdit(hunk: GoStudioLineHunk, oldLines: string[], lineCount: number, lineMaxColumn: (line: number) => number): GoStudioRevertEdit {
  const text = oldLines.join('\n')
  if (hunk.newEnd < hunk.newStart) {
    const after = hunk.newStart - 1
    return after >= 1
      ? { range: { startLineNumber: after, startColumn: lineMaxColumn(after), endLineNumber: after, endColumn: lineMaxColumn(after) }, text: `\n${text}` }
      : { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: `${text}\n` }
  }
  if (oldLines.length > 0) {
    return { range: { startLineNumber: hunk.newStart, startColumn: 1, endLineNumber: hunk.newEnd, endColumn: lineMaxColumn(hunk.newEnd) }, text }
  }
  if (hunk.newEnd < lineCount) {
    return { range: { startLineNumber: hunk.newStart, startColumn: 1, endLineNumber: hunk.newEnd + 1, endColumn: 1 }, text: '' }
  }
  if (hunk.newStart > 1) {
    return { range: { startLineNumber: hunk.newStart - 1, startColumn: lineMaxColumn(hunk.newStart - 1), endLineNumber: hunk.newEnd, endColumn: lineMaxColumn(hunk.newEnd) }, text: '' }
  }
  return { range: { startLineNumber: 1, startColumn: 1, endLineNumber: hunk.newEnd, endColumn: lineMaxColumn(hunk.newEnd) }, text: '' }
}

/** Riga del gutter su cui si disegna il blocco: le cancellazioni si segnano sulla riga precedente. */
export function hunkAnchorLine(hunk: GoStudioLineHunk): number {
  return hunk.newEnd < hunk.newStart ? Math.max(hunk.newStart - 1, 1) : hunk.newStart
}

/** Tacche nella scrollbar: tinte smorzate come in IntelliJ, segnalano senza competere con il codice. */
const OVERVIEW_RULER_COLORS: Record<GoStudioLineHunk['kind'], string> = {
  added: 'rgba(84, 145, 89, 0.55)',
  modified: 'rgba(67, 105, 141, 0.65)',
  deleted: 'rgba(148, 163, 184, 0.45)',
}

function vcsDecorations(hunks: GoStudioLineHunk[]): monaco.editor.IModelDeltaDecoration[] {
  return hunks.map((hunk) => {
    const deleted = hunk.newEnd < hunk.newStart
    const start = hunkAnchorLine(hunk)
    return {
      range: { startLineNumber: start, startColumn: 1, endLineNumber: deleted ? start : hunk.newEnd, endColumn: 1 },
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `go-studio-vcs go-studio-vcs-${hunk.kind}`,
        linesDecorationsTooltip: hunk.kind === 'added' ? 'Added since HEAD · click to revert' : hunk.kind === 'modified' ? 'Changed since HEAD · click to see or revert' : 'Lines deleted since HEAD · click to restore',
        overviewRuler: { color: OVERVIEW_RULER_COLORS[hunk.kind], position: monaco.editor.OverviewRulerLane.Left },
      },
    }
  })
}

/** Clic sulla barra VCS: apre il popup del blocco con il testo di HEAD e il pulsante Revert. */
export function openVcsHunk(editor: monaco.editor.ICodeEditor, line: number, anchor: { x: number; y: number }): boolean {
  const model = editor.getModel()
  const document = model ? documentForModel(model) : null
  const hunk = hunksByEditor.get(editor)?.find((item) => {
    const start = hunkAnchorLine(item)
    const end = item.newEnd < item.newStart ? start : item.newEnd
    return line >= start && line <= end
  })
  if (!document || !hunk) return false
  useGoIDEVCSStore.getState().showHunk({ documentId: document.document.id, hunk, anchor })
  return true
}

/** Revert di un blocco nell'editor attivo: un'unica modifica annullabile con Ctrl+Z. */
export function revertHunk(editor: monaco.editor.ICodeEditor, hunk: GoStudioLineHunk, headText: string): void {
  const model = editor.getModel()
  if (!model) return
  const edit = revertEdit(hunk, hunkOldLines(headText, hunk), model.getLineCount(), (line) => model.getLineMaxColumn(line))
  editor.pushUndoStop()
  editor.executeEdits('go-studio-vcs-revert', [edit])
  editor.pushUndoStop()
  editor.focus()
}

function blameLabel(line: GoIDEVCSBlameLine | undefined): string {
  if (!line) return ''
  const author = line.author.length > BLAME_AUTHOR_CHARS ? `${line.author.slice(0, BLAME_AUTHOR_CHARS - 1)}…` : line.author.padEnd(BLAME_AUTHOR_CHARS)
  return `${line.hash.slice(0, 7)} ${author} ${line.date.slice(0, 10)}`
}

/** Gutter diff rispetto a HEAD (anche per le modifiche non salvate) e annotazione blame sui numeri di riga. */
export function useGoStudioVcsGutter(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const { sessionId, relativePath, id, external } = document.document
  const available = useGoIDEVCSStore((state) => !!state.status[sessionId]?.available)
  const head = useGoIDEVCSStore((state) => state.head[headKey(sessionId, relativePath)])
  const blame = useGoIDEVCSStore((state) => state.blame[id])
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)

  useEffect(() => {
    const editor = editorRef.current
    if (editor) collectionRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => {
    if (available && !external && head === undefined) void useGoIDEVCSStore.getState().loadHead(sessionId, relativePath)
  }, [available, external, head, relativePath, sessionId])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    // File non versionato o fuori dal repository: nessun marcatore (un file nuovo sarebbe tutto "aggiunto").
    if (!available || external || head === undefined || head === null) {
      collectionRef.current?.clear()
      hunksByEditor.delete(editor)
      return
    }
    const timer = window.setTimeout(() => {
      const hunks = lineDiff(head, document.buffer)
      hunksByEditor.set(editor, hunks)
      collectionRef.current?.set(vcsDecorations(hunks))
    }, DIFF_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [available, document.buffer, editorRef, external, head, id, mountCount])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!blame) {
      editor.updateOptions({ lineNumbers: 'on', lineNumbersMinChars: 5 })
      return
    }
    const byLine = new Map(blame.map((line) => [line.line, line]))
    editor.updateOptions({ lineNumbers: (line: number) => `${blameLabel(byLine.get(line))}  ${line}`, lineNumbersMinChars: BLAME_LINE_NUMBER_CHARS })
  }, [blame, editorRef, id, mountCount])
}

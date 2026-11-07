import { useEffect, useRef, type MutableRefObject } from 'react'
import type { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'

const REFRESH_DEBOUNCE_MS = 200
// ponytail: file enormi saltati, come per i comment tag.
const MAX_SCANNED_LINES = 20_000
const LEVEL_COLORS = 4

/** Solo i linguaggi dove l'indentazione È la sintassi. */
const RAINBOW_FILES = /\.(py|pyi|ya?ml)$/i

export function indentRainbowEnabled(relativePath: string): boolean {
  return RAINBOW_FILES.test(relativePath)
}

export interface IndentRainbowRange {
  line: number
  /** Colonne Monaco (1-based), fine esclusa. */
  startColumn: number
  endColumn: number
  level: number
}

/** Un blocco per livello di indentazione: un tab = un livello, `tabSize` spazi = un livello. */
export function indentRainbowRanges(text: string, tabSize: number): IndentRainbowRange[] {
  const lines = text.split('\n')
  if (lines.length > MAX_SCANNED_LINES || tabSize < 1) return []
  const ranges: IndentRainbowRange[] = []
  lines.forEach((line, index) => {
    if (line.trim() === '') return
    let level = 0
    let start = 0
    let spaces = 0
    for (let column = 0; column < line.length; column++) {
      const char = line[column]
      if (char === '\t') {
        ranges.push({ line: index + 1, startColumn: column + 1, endColumn: column + 2, level: level++ })
        start = column + 1
        spaces = 0
      } else if (char === ' ') {
        if (++spaces < tabSize) continue
        ranges.push({ line: index + 1, startColumn: start + 1, endColumn: column + 2, level: level++ })
        start = column + 1
        spaces = 0
      } else break
    }
  })
  return ranges
}

export function indentRainbowDecorations(ranges: readonly IndentRainbowRange[]): monaco.editor.IModelDeltaDecoration[] {
  return ranges.map((range) => ({
    range: { startLineNumber: range.line, startColumn: range.startColumn, endLineNumber: range.line, endColumn: range.endColumn },
    options: { inlineClassName: `code-studio-indent-rainbow-${range.level % LEVEL_COLORS}`, stickiness: 1 },
  }))
}

/** Indent rainbow per Python e YAML: fasce colorate per livello, ricalcolate con debounce sul buffer. */
export function useCodeStudioIndentRainbow(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const { relativePath } = document.document

  useEffect(() => {
    const editor = editorRef.current
    if (editor) collectionRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => {
    if (!indentRainbowEnabled(relativePath)) {
      collectionRef.current?.clear()
      return
    }
    const timer = window.setTimeout(() => {
      const tabSize = editorRef.current?.getModel()?.getOptions().indentSize ?? 4
      collectionRef.current?.set(indentRainbowDecorations(indentRainbowRanges(document.buffer, tabSize)))
    }, REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [document.buffer, editorRef, relativePath, mountCount])
}

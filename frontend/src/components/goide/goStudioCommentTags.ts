import { useEffect, useRef, type MutableRefObject } from 'react'
import type { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorDocument } from '@/stores/goide'

const REFRESH_DEBOUNCE_MS = 300
// ponytail: file enormi saltati, il colore dei commenti non vale una scansione da migliaia di righe a ogni tasto.
const MAX_SCANNED_LINES = 20_000

export type CommentTag = 'todo' | 'fixme' | 'note' | 'important'

export interface CommentTagRange {
  line: number
  /** Colonne Monaco (1-based), fine esclusa. */
  startColumn: number
  endColumn: number
  tag: CommentTag
}

/** Better Comments: TODO arancio, FIXME/BUG/! rosso, NOTE/? blu, * importante in grassetto. */
const TAG_PATTERN = /^\s*(?:(TODO|HACK|XXX)\b|(FIXME|BUG)\b|(NOTE|INFO)\b|(!)|(\?)|(\*)(?=\s))/

function tagOf(match: RegExpExecArray): CommentTag {
  if (match[1]) return 'todo'
  if (match[2] || match[4]) return 'fixme'
  if (match[3] || match[5]) return 'note'
  return 'important'
}

const HASH_COMMENT_FILES = /\.(ya?ml|toml|sh|bash|zsh|py|rb|ps1|conf|ini|env|mk|tf|dockerfile)$|(^|\/)(Makefile|Dockerfile|\.env[^/]*|\.gitignore)$/i

/** Il marcatore di commento di riga del file: `#` per YAML, shell e affini, `//` per il resto. */
export function lineCommentToken(relativePath: string): '//' | '#' {
  return HASH_COMMENT_FILES.test(relativePath) ? '#' : '//'
}

/**
 * Inizio del commento di riga, ignorando il marcatore dentro le stringhe ("http://…", `…`, '…').
 * Le raw string Go su più righe non sono tracciate: al peggio un tag resta senza colore.
 */
function lineCommentStart(line: string, token: '//' | '#'): number {
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === '\\' && quote !== '`') index++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '`' || char === "'") quote = char
    else if (line.startsWith(token, index)) return index
  }
  return -1
}

export function commentTagRanges(text: string, token: '//' | '#' = '//'): CommentTagRange[] {
  const lines = text.split('\n')
  if (lines.length > MAX_SCANNED_LINES) return []
  const ranges: CommentTagRange[] = []
  lines.forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const start = lineCommentStart(line, token)
    if (start < 0) return
    const body = line.slice(start + token.length)
    // `///` o `//go:` non sono commenti per persone: niente colore.
    if (token === '//' && (body.startsWith('/') || body.startsWith('go:'))) return
    const match = TAG_PATTERN.exec(body)
    if (!match) return
    ranges.push({ line: index + 1, startColumn: start + 1, endColumn: line.length + 1, tag: tagOf(match) })
  })
  return ranges
}

const TAG_CLASS: Record<CommentTag, string> = {
  todo: 'go-studio-comment-todo',
  fixme: 'go-studio-comment-fixme',
  note: 'go-studio-comment-note',
  important: 'go-studio-comment-important',
}

export function commentTagDecorations(ranges: readonly CommentTagRange[]): monaco.editor.IModelDeltaDecoration[] {
  return ranges.map((range) => ({
    range: { startLineNumber: range.line, startColumn: range.startColumn, endLineNumber: range.line, endColumn: range.endColumn },
    options: { inlineClassName: TAG_CLASS[range.tag], stickiness: 1 },
  }))
}

/** Colora i commenti TODO/FIXME/NOTE/* nel file aperto, ricalcolati con debounce sul buffer. */
export function useGoStudioCommentTags(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const { relativePath } = document.document

  useEffect(() => {
    const editor = editorRef.current
    if (editor) collectionRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      collectionRef.current?.set(commentTagDecorations(commentTagRanges(document.buffer, lineCommentToken(relativePath))))
    }, REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [document.buffer, relativePath, mountCount])
}

import { useEffect, useRef, type MutableRefObject } from 'react'
import type { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'

const REFRESH_DEBOUNCE_MS = 300
// ponytail: file enormi saltati, il colore dei commenti non vale una scansione da migliaia di righe a ogni tasto.
const MAX_SCANNED_LINES = 20_000

/**
 * Better Comments: TODO arancio con sfondo, ALERT/FIXME/! rosso, QUESTION/? blu, IMPORTANT/* verde con sfondo,
 * NOTE ciano, codice commentato (`////`) barrato.
 */
export type CommentTag = 'todo' | 'alert' | 'question' | 'important' | 'note' | 'strike'

export interface CommentTagRange {
  line: number
  /** Colonne Monaco (1-based), fine esclusa. */
  startColumn: number
  endColumn: number
  tag: CommentTag
}

/** How a file writes comments: line markers and block delimiters. */
export interface CommentSyntax {
  line: readonly string[]
  block: ReadonlyArray<readonly [open: string, close: string]>
}

const TAG_PATTERN = /^\s*(?:(TODO|HACK|XXX)\b|(FIXME|BUG|ALERT|WARNING)\b|(QUESTION)\b|(IMPORTANT)\b|(NOTE|INFO)\b|(!)|(\?)|(\*)(?=\s))/

function tagOf(match: RegExpExecArray): CommentTag {
  if (match[1]) return 'todo'
  if (match[2] || match[6]) return 'alert'
  if (match[3] || match[7]) return 'question'
  if (match[4] || match[8]) return 'important'
  return 'note'
}

const HASH_COMMENT_FILES = /\.(ya?ml|toml|sh|bash|zsh|py|rb|ps1|conf|ini|env|mk|tf|dockerfile|properties|r|pl|ex|exs|nix|cmake)$|(^|\/)(Makefile|Dockerfile|\.env[^/]*|\.gitignore|CMakeLists\.txt)$/i
const DASH_COMMENT_FILES = /\.(sql|lua|hs|ada|adb|ads|elm|psql)$/i
const MARKUP_FILES = /\.(html?|xml|xsd|wsdl|svg|vue|svelte|md|markdown|jsp|jspx|xhtml|pom|plist)$|(^|\/)pom\.xml$/i
const C_BLOCK = ['/*', '*/'] as const

/** Il marcatore di commento di riga del file: `#` per YAML, shell e affini, `//` per il resto. */
export function lineCommentToken(relativePath: string): '//' | '#' {
  return HASH_COMMENT_FILES.test(relativePath) ? '#' : '//'
}

/** The comment syntax of a file, from its name: C-like by default. */
export function commentSyntax(relativePath: string): CommentSyntax {
  if (MARKUP_FILES.test(relativePath)) return { line: [], block: [['<!--', '-->']] }
  if (DASH_COMMENT_FILES.test(relativePath)) return { line: ['--'], block: [C_BLOCK] }
  if (HASH_COMMENT_FILES.test(relativePath)) return { line: ['#'], block: [] }
  return { line: ['//'], block: [C_BLOCK] }
}

/**
 * Inizio del commento di riga, ignorando il marcatore dentro le stringhe ("http://…", `…`, '…').
 * Le raw string Go su più righe non sono tracciate: al peggio un tag resta senza colore.
 */
export function lineCommentStart(line: string, token: string): number {
  return commentStart(line, [token], []).index
}

/** The first comment opener of the line outside strings: a line marker or a block opener. */
function commentStart(line: string, lineTokens: readonly string[], blocks: CommentSyntax['block']): { index: number; token: string; close?: string } {
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === '\\' && quote !== '`') index++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '`' || char === "'") {
      quote = char
      continue
    }
    const lineToken = lineTokens.find((token) => line.startsWith(token, index))
    if (lineToken) return { index, token: lineToken }
    const block = blocks.find(([open]) => line.startsWith(open, index))
    if (block) return { index, token: block[0], close: block[1] }
  }
  return { index: -1, token: '' }
}

/** The tag of a comment's text (after its marker), or null for a plain comment. */
function tagOfBody(body: string, marker: string): CommentTag | null {
  if (marker === '//') {
    if (body.startsWith('//')) return 'strike' // `////` comments out code, Better Comments style
    if (body.startsWith('/') || body.startsWith('go:')) return null // `///` doc, `//go:` directives
  }
  if (marker === '/*' && body.startsWith('*')) body = body.slice(1) // `/** TODO` Javadoc opener
  const match = TAG_PATTERN.exec(body)
  return match ? tagOf(match) : null
}

/** Colours every tagged comment of the text: line comments and each line of block comments. */
export function commentTagRanges(text: string, syntax: CommentSyntax = commentSyntax('file.go')): CommentTagRange[] {
  const lines = text.split('\n')
  if (lines.length > MAX_SCANNED_LINES) return []
  const ranges: CommentTagRange[] = []
  let openBlock: string | null = null // the closer we are waiting for
  lines.forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    let from = 0
    if (openBlock) {
      const close = line.indexOf(openBlock)
      const end = close < 0 ? line.length : close
      // Inside a block: the text, without the ` * ` of Javadoc-style continuation lines.
      const continuation = /^\s*\*(?!\/)/.exec(line)
      const bodyStart = continuation ? continuation[0].length : 0
      const tag = tagOfBody(line.slice(bodyStart, end), '')
      if (tag) ranges.push({ line: index + 1, startColumn: 1 + (line.length - line.trimStart().length), endColumn: end + 1, tag })
      if (close < 0) return
      from = close + openBlock.length
      openBlock = null
    }
    const rest = line.slice(from)
    const found = commentStart(rest, syntax.line, syntax.block)
    if (found.index < 0) return
    const start = from + found.index
    const bodyStart = start + found.token.length
    let end = line.length
    if (found.close) {
      const close = line.indexOf(found.close, bodyStart)
      if (close < 0) openBlock = found.close
      else end = close + found.close.length
    }
    const tag = tagOfBody(line.slice(bodyStart, end), found.token)
    if (tag) ranges.push({ line: index + 1, startColumn: start + 1, endColumn: end + 1, tag })
  })
  return ranges
}

export function commentTagDecorations(ranges: readonly CommentTagRange[]): monaco.editor.IModelDeltaDecoration[] {
  return ranges.map((range) => ({
    range: { startLineNumber: range.line, startColumn: range.startColumn, endLineNumber: range.line, endColumn: range.endColumn },
    options: { inlineClassName: `code-studio-comment-${range.tag}`, stickiness: 1 },
  }))
}

/** Colora i commenti TODO/ALERT/QUESTION/IMPORTANT/NOTE e il codice commentato nel file aperto, con debounce sul buffer. */
export function useCodeStudioCommentTags(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const { relativePath } = document.document

  useEffect(() => {
    const editor = editorRef.current
    if (editor) collectionRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      collectionRef.current?.set(commentTagDecorations(commentTagRanges(document.buffer, commentSyntax(relativePath))))
    }, REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [document.buffer, relativePath, mountCount])
}

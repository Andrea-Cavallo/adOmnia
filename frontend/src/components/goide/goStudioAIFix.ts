import type { GoIDEEditorTextEdit } from '@/lib/goide-lsp-api'
import { applyTextEdits } from './goStudioWorkspaceEdits'
import { lineDiff } from '@/lib/goide/goStudioLineDiff'

/** File inviato all'AI come contesto, con percorso relativo al progetto. */
export interface AIFixFile {
  relativePath: string
  content: string
}

export interface AIFixProblem {
  message: string
  line: number
  source?: string
}

/** Oltre questa dimensione un file non viene inviato: la risposta deve riscriverlo per intero. */
export const MAX_AI_FIX_FILE_CHARS = 60_000
/** File del package importato inviati come contesto, oltre al file con l'errore. */
export const MAX_AI_FIX_RELATED_FILES = 3

const FILE_OPEN = /^=== FILE: (.+?) ===\s*$/
const FILE_CLOSE = /^=== END FILE ===\s*$/

/**
 * Package locale citato da un errore come `undefined: logger.GetLoggerInstance`: restituisce la
 * cartella del package nel progetto, così l'AI vede cosa esporta davvero (e può aggiungere ciò che
 * manca). Null per package esterni al modulo, SDK o errori di altro tipo.
 */
export function localPackageDirForProblem(message: string, source: string, modules: ReadonlyArray<{ path: string; modulePath?: string }>): string | null {
  const alias = message.match(/undefined: (\w+)\.\w+/)?.[1]
  if (!alias) return null
  for (const [, explicitAlias, importPath] of source.matchAll(/^\s*(?:import\s+)?(\w+|\.)?\s*"([^"]+)"/gm)) {
    const name = explicitAlias ?? importPath.split('/').pop()
    if (name !== alias) continue
    for (const module of modules) {
      const modulePath = module.modulePath ?? ''
      if (!modulePath || (importPath !== modulePath && !importPath.startsWith(`${modulePath}/`))) continue
      const base = module.path === '.' ? '' : module.path.replace(/\\/g, '/').replace(/\/$/, '')
      const rest = importPath.slice(modulePath.length).replace(/^\//, '')
      return [base, rest].filter(Boolean).join('/')
    }
  }
  return null
}

export function buildAIFixPrompt(target: AIFixFile, problem: AIFixProblem, otherProblems: AIFixProblem[], related: AIFixFile[]): { system: string; user: string } {
  const system = [
    'You are a senior Go engineer fixing compiler and linter errors inside an IDE.',
    'Make the smallest correct change that fixes the reported problem, keep the existing style, and never remove unrelated code.',
    'You may edit only the files you are given. Prefer fixing the caller; add a missing function or method to a provided package file only when that is clearly the intent.',
    'Reply ONLY with the complete new content of each file you change, each wrapped exactly like this:',
    '=== FILE: <relative path> ===',
    '<full file content>',
    '=== END FILE ===',
    'Do not include explanations, markdown fences or files you did not change.',
  ].join('\n')
  const describe = (item: AIFixProblem) => `line ${item.line}: ${item.message}${item.source ? ` (${item.source})` : ''}`
  const block = (file: AIFixFile) => `=== FILE: ${file.relativePath} ===\n${file.content}\n=== END FILE ===`
  const user = [
    `Fix this problem in ${target.relativePath}, ${describe(problem)}.`,
    otherProblems.length > 0 ? `Other problems currently reported in the same file:\n${otherProblems.map(describe).join('\n')}` : '',
    `File with the problem:\n${block(target)}`,
    related.length > 0 ? `Files of the package the error refers to:\n${related.map(block).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

/**
 * Legge i file restituiti dall'AI. Accetta solo percorsi fra quelli inviati: una risposta non può
 * toccare altri file del progetto. Tollera recinti markdown attorno al contenuto.
 */
export function parseAIFixResponse(response: string, allowedPaths: readonly string[]): AIFixFile[] {
  const allowed = new Set(allowedPaths)
  const files: AIFixFile[] = []
  let current: { relativePath: string; lines: string[] } | null = null
  for (const line of response.replace(/\r\n/g, '\n').split('\n')) {
    const open = line.match(FILE_OPEN)
    if (open && !current) {
      current = { relativePath: open[1].trim(), lines: [] }
      continue
    }
    if (current && FILE_CLOSE.test(line)) {
      const lines = current.lines
      if (/^```/.test(lines[0] ?? '')) lines.shift()
      if (/^```\s*$/.test(lines[lines.length - 1] ?? '')) lines.pop()
      const content = `${lines.join('\n').replace(/\n+$/, '')}\n`
      if (allowed.has(current.relativePath) && /^\s*(\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*\s*package\s+\w+/m.test(content)) {
        files.push({ relativePath: current.relativePath, content })
      }
      current = null
      continue
    }
    current?.lines.push(line)
  }
  return files
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1)
  return starts
}

function offsetOfLine(starts: number[], text: string, line: number): number {
  return line - 1 < starts.length ? starts[line - 1] : text.length
}

function position(starts: number[], offset: number): { line: number; column: number } {
  let line = starts.length - 1
  while (line > 0 && starts[line] > offset) line--
  return { line: line + 1, column: offset - starts[line] + 1 }
}

/**
 * Trasforma il file proposto in edit minimi, uno per blocco di righe cambiate: l'anteprima mostra
 * solo ciò che cambia e l'editor lo applica come un'unica modifica annullabile. newContent è il
 * risultato esatto degli edit sul testo attuale.
 */
export function lineEditsFor(current: string, proposed: string): { edits: GoIDEEditorTextEdit[]; newContent: string } {
  const oldText = current.replace(/\r\n/g, '\n')
  const newText = proposed.replace(/\r\n/g, '\n')
  const oldStarts = lineStarts(oldText)
  const newStarts = lineStarts(newText)
  const edits = lineDiff(oldText, newText).map((hunk) => {
    const startOffset = offsetOfLine(oldStarts, oldText, hunk.oldStart)
    const endOffset = offsetOfLine(oldStarts, oldText, hunk.oldEnd + 1)
    const text = newText.slice(offsetOfLine(newStarts, newText, hunk.newStart), offsetOfLine(newStarts, newText, hunk.newEnd + 1))
    const start = position(oldStarts, startOffset)
    const end = position(oldStarts, endOffset)
    return { range: { startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column }, text }
  })
  return { edits, newContent: applyTextEdits(oldText, edits) }
}

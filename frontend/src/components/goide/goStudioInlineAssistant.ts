import type { GoIDEEditorTextEdit } from '@/lib/goide-lsp-api'
import { lineDiff } from '@/lib/goide/goStudioLineDiff'
import { lineEditsFor } from './goStudioAIFix'

export const INLINE_ASSISTANT_MAX_TOKENS = 8192
/** Oltre questa dimensione il frammento non viene inviato: la proposta deve restare leggibile. */
export const INLINE_ASSISTANT_MAX_FRAGMENT_CHARS = 24_000

export const INLINE_ASSISTANT_MAX_CONTEXT_LINES = 15
const MAX_CONTEXT_CHARS = 4_000
const MAX_PROBLEMS = 8

/** Frammento selezionato inviato all'AI, con il poco di contesto che lo circonda. */
export interface InlineAssistantTarget {
  relativePath: string
  language: string
  /** Prima riga (1-based) e colonna di inizio del frammento nel file. */
  startLine: number
  startColumn: number
  oldText: string
  /** Testo delle righe e delle colonne prima del frammento (solo contesto, non si modifica). */
  contextBefore: string
  /** Testo che segue il frammento fino a MAX_CONTEXT_LINES righe. */
  contextAfter: string
  /** Problemi del compilatore e del linter dentro il frammento, con righe relative al frammento. */
  problems: Array<{ line: number; message: string }>
}

/** Un blocco di differenze fra frammento attuale e proposto, in coordinate di file. */
export interface InlineEditHunk {
  /** Edit LSP (righe e colonne 1-based, colonne UTF-16) da applicare al file. */
  edit: GoIDEEditorTextEdit
  /** Righe del frammento che l'edit toglie (vuoto per un inserto). */
  removedLines: string[]
  /** Righe che l'edit mette al loro posto (vuoto per una cancellazione). */
  addedLines: string[]
  /** Ultima riga del file coperta dalle righe tolte; per un inserto è la riga sopra il punto di inserimento. */
  anchorLine: number
}

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… [truncated]`
}

/** Prompt di editing: il modello deve restituire solo il testo sostitutivo del frammento. */
export function buildInlineEditPrompt(target: InlineAssistantTarget, instruction: string): { system: string; user: string } {
  const system = [
    'You are a code editing engine inside an IDE. You rewrite a selected fragment of a file according to the developer instruction.',
    'Reply ONLY with the complete replacement text for the fragment: no explanations, no markdown fences, no diff markers.',
    'Keep the language, indentation and style of the surrounding code, follow its error-handling conventions, and make the smallest change that satisfies the instruction.',
    'The replacement may have more or fewer lines than the original fragment.',
  ].join('\n')
  const lines = splitLines(target.oldText)
  const endLine = target.startLine + lines.length - 1
  const problems = target.problems.slice(0, MAX_PROBLEMS).map((problem) => `- line ${problem.line}: ${problem.message}`).join('\n')
  const user = [
    `File: ${target.relativePath} (language: ${target.language || 'plaintext'}), fragment at line${lines.length === 1 ? '' : 's'} ${target.startLine}${lines.length === 1 ? '' : `-${endLine}`}.`,
    `Instruction: ${instruction.trim()}`,
    target.contextBefore ? `Context before the fragment (reference only, do not edit):\n\`\`\`\n${clip(target.contextBefore, MAX_CONTEXT_CHARS)}\n\`\`\`` : '',
    `Fragment to replace (rewrite exactly this):\n\`\`\`\n${clip(target.oldText, INLINE_ASSISTANT_MAX_FRAGMENT_CHARS)}\n\`\`\``,
    target.contextAfter ? `Context after the fragment (reference only, do not edit):\n\`\`\`\n${clip(target.contextAfter, MAX_CONTEXT_CHARS)}\n\`\`\`` : '',
    problems ? `Compiler and linter problems reported in the fragment:\n${problems}` : '',
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

/** Apertura tipica di una risposta chiacchierona invece di codice ("Sure! Here is…"). */
const CHAT_OPENERS = /^(sure|here'?s|here is|okay|ok|certainly|of course|unfortunately|i (can|cannot|can't|will|am|apolog)|sorry|note that|below is|the (updated|new|fixed)|let'?s)\b/i

function looksLikeChatReply(text: string): boolean {
  const [first] = text.split('\n', 1)
  const opener = first.trim()
  if (!CHAT_OPENERS.test(opener) && !/^.+\s.+[.:!?]$/.test(opener)) return false
  // Righe indentate o con caratteri di codice: è codice, non chiacchiere.
  return !text.split('\n').some((line) => /^\s/.test(line) || /[;{}()=<>[\]]/.test(line))
}

/**
 * Testo sostitutivo del frammento da una risposta del modello. Tollerante ai recinti markdown
 * (li estrae se ci sono); null se la risposta non contiene un frammento utilizzabile: una
 * proposta dell'AI non deve mai sostituire codice con una spiegazione.
 */
export function parseInlineEditResponse(response: string): string | null {
  const text = response.replace(/\r\n/g, '\n')
  const fenced = text.match(/```[^\n]*\n([\s\S]*?)\n?```/)
  const body = (fenced ? fenced[1] : text).replace(/^\n+/, '').replace(/\s+$/, '')
  if (!body) return null
  return fenced || !looksLikeChatReply(body) ? body : null
}

/**
 * Allinea la forma finale della proposta a quella del frammento: la selezione spesso include (o
 * non include) il ritorno a capo finale e il diff non deve sporcarsi per quello.
 */
export function matchFragmentShape(oldText: string, proposed: string): string {
  const oldEnds = /\n$/.test(oldText.replace(/\r\n/g, '\n'))
  const proposedEnds = /\n$/.test(proposed)
  if (oldEnds === proposedEnds) return proposed
  return oldEnds ? `${proposed}\n` : proposed.replace(/\n$/, '')
}

function mapPosition(line: number, column: number, startLine: number, startColumn: number): { line: number; column: number } {
  // Il frammento inizia a startColumn: solo la sua prima riga è allineata a quella colonna.
  return { line: line + startLine - 1, column: column + (line === 1 ? startColumn - 1 : 0) }
}

function mapEdit(edit: GoIDEEditorTextEdit, startLine: number, startColumn: number): GoIDEEditorTextEdit {
  const start = mapPosition(edit.range.startLine, edit.range.startColumn, startLine, startColumn)
  const end = mapPosition(edit.range.endLine, edit.range.endColumn, startLine, startColumn)
  return { range: { startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column }, text: edit.text }
}

/**
 * Blocchi minimi fra frammento attuale e proposto, in coordinate di file: uno per blocco di righe
 * cambiate, con le righe tolte e quelle messe al loro posto per l'anteprima inline.
 */
export function inlineEditHunks(oldText: string, proposed: string, startLine: number, startColumn: number): InlineEditHunk[] {
  const oldFragment = oldText.replace(/\r\n/g, '\n')
  const newFragment = matchFragmentShape(oldFragment, proposed.replace(/\r\n/g, '\n'))
  const { edits } = lineEditsFor(oldFragment, newFragment)
  const oldLines = splitLines(oldFragment)
  const newLines = splitLines(newFragment)
  return lineDiff(oldFragment, newFragment).map((hunk, index) => ({
    edit: mapEdit(edits[index], startLine, startColumn),
    removedLines: hunk.kind === 'added' ? [] : oldLines.slice(hunk.oldStart - 1, hunk.oldEnd),
    addedLines: hunk.kind === 'deleted' ? [] : newLines.slice(hunk.newStart - 1, hunk.newEnd),
    anchorLine: hunk.oldEnd + startLine - 1,
  }))
}

/** Righe che l'hunk aggiunge (o toglie, se negative) al file. */
export function hunkDelta(hunk: InlineEditHunk): number {
  return hunk.addedLines.length - hunk.removedLines.length
}

/**
 * Riallinea i blocchi ancora da decidere dopo averne applicato uno: le righe successive al punto
 * di applicazione si spostano del delta dell'edit. I blocchi non si sovrappongono mai, quindi
 * quelli sopra restano fermi.
 */
export function shiftInlineHunks(hunks: readonly InlineEditHunk[], applied: InlineEditHunk): InlineEditHunk[] {
  const delta = hunkDelta(applied)
  if (delta === 0) return [...hunks]
  return hunks.map((hunk) => {
    if (hunk.edit.range.startLine < applied.edit.range.endLine) return hunk
    return {
      ...hunk,
      anchorLine: hunk.anchorLine + delta,
      edit: {
        ...hunk.edit,
        range: { ...hunk.edit.range, startLine: hunk.edit.range.startLine + delta, endLine: hunk.edit.range.endLine + delta },
      },
    }
  })
}

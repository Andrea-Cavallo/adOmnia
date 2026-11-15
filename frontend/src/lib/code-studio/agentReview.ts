import { lineDiff, type CodeStudioLineHunk } from './codeStudioLineDiff'

/** Righe di contesto mostrate prima e dopo ogni blocco. */
export const AGENT_REVIEW_CONTEXT_LINES = 3

export type AgentReviewLineKind = 'context' | 'removed' | 'added'

export interface AgentReviewLine {
  kind: AgentReviewLineKind
  text: string
  /** Numero di riga nella versione prima dell'agente (removed/context) o in quella attuale (added). */
  oldNumber?: number
  newNumber?: number
}

export interface AgentReviewHunk {
  hunk: CodeStudioLineHunk
  lines: AgentReviewLine[]
}

interface SplitText {
  lines: string[]
  eol: string
  finalNewline: boolean
}

/** Stesse righe di lineDiff (CRLF normalizzato, newline finale ignorata), più quanto serve per ricomporre il testo. */
function split(text: string): SplitText {
  if (text === '') return { lines: [], eol: '\n', finalNewline: false }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const finalNewline = lines.length > 1 && lines[lines.length - 1] === ''
  if (finalNewline) lines.pop()
  return { lines, eol, finalNewline }
}

function join({ lines, eol, finalNewline }: SplitText): string {
  if (lines.length === 0) return ''
  return lines.join(eol) + (finalNewline ? eol : '')
}

/** Sostituisce le righe start..end (1-based, inclusive; end = start - 1 per un inserimento) mantenendo i fine riga del testo. */
function replaceLines(text: string, start: number, end: number, replacement: string[]): string {
  const target = split(text)
  const lines = [...target.lines]
  lines.splice(start - 1, end - start + 1, ...replacement)
  return join({ ...target, lines })
}

function slice(text: string, start: number, end: number): string[] {
  return split(text).lines.slice(start - 1, end)
}

/** Blocchi di differenze fra la versione prima dell'agente e quella attuale, con il contesto da mostrare. */
export function agentReviewHunks(baseline: string, current: string): AgentReviewHunk[] {
  const oldLines = split(baseline).lines
  const newLines = split(current).lines
  return lineDiff(baseline, current).map((hunk) => {
    const lines: AgentReviewLine[] = []
    const contextStart = Math.max(1, hunk.newStart - AGENT_REVIEW_CONTEXT_LINES)
    for (let line = contextStart; line < hunk.newStart; line++) {
      lines.push({ kind: 'context', text: newLines[line - 1], oldNumber: hunk.oldStart - (hunk.newStart - line), newNumber: line })
    }
    for (let line = hunk.oldStart; line <= hunk.oldEnd; line++) lines.push({ kind: 'removed', text: oldLines[line - 1], oldNumber: line })
    for (let line = hunk.newStart; line <= hunk.newEnd; line++) lines.push({ kind: 'added', text: newLines[line - 1], newNumber: line })
    const contextEnd = Math.min(newLines.length, hunk.newEnd + AGENT_REVIEW_CONTEXT_LINES)
    for (let line = hunk.newEnd + 1; line <= contextEnd; line++) {
      lines.push({ kind: 'context', text: newLines[line - 1], oldNumber: hunk.oldEnd + (line - hunk.newEnd), newNumber: line })
    }
    return { hunk, lines }
  })
}

/** Nuova versione di partenza che include il blocco accettato. */
export function acceptHunk(baseline: string, current: string, hunk: CodeStudioLineHunk): string {
  return replaceLines(baseline, hunk.oldStart, hunk.oldEnd, slice(current, hunk.newStart, hunk.newEnd))
}

/** Testo attuale con il blocco rifiutato riportato com'era prima dell'agente. */
export function rejectHunk(baseline: string, current: string, hunk: CodeStudioLineHunk): string {
  return replaceLines(current, hunk.newStart, hunk.newEnd, slice(baseline, hunk.oldStart, hunk.oldEnd))
}

/** Righe aggiunte e tolte, per il riepilogo accanto a ogni file. */
export function agentReviewStats(baseline: string, current: string): { added: number; removed: number } {
  return lineDiff(baseline, current).reduce((total, hunk) => ({
    added: total.added + Math.max(0, hunk.newEnd - hunk.newStart + 1),
    removed: total.removed + Math.max(0, hunk.oldEnd - hunk.oldStart + 1),
  }), { added: 0, removed: 0 })
}

/** A row of the side-by-side diff: the version before the agent on the left, the agent version on the right. */
export interface AgentReviewSplitRow {
  left?: AgentReviewLine
  right?: AgentReviewLine
}

/** Pairs each block of removed lines with the added lines that follow it; context lines sit on both sides. */
export function agentReviewSplitRows(lines: AgentReviewLine[]): AgentReviewSplitRow[] {
  const rows: AgentReviewSplitRow[] = []
  let removed: AgentReviewLine[] = []
  let added: AgentReviewLine[] = []
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) rows.push({ left: removed[index], right: added[index] })
    removed = []
    added = []
  }
  for (const line of lines) {
    if (line.kind === 'removed') {
      if (added.length) flush()
      removed.push(line)
    } else if (line.kind === 'added') {
      added.push(line)
    } else {
      flush()
      rows.push({ left: line, right: line })
    }
  }
  flush()
  return rows
}

export interface AgentReviewSelection { side: 'old' | 'new'; start: number; end: number }

/** Select the same paired replacement rows shown by the side-by-side diff. */
export function selectedReviewHunks(baseline: string, current: string, selection: AgentReviewSelection): CodeStudioLineHunk[] {
  if (selection.start < 1 || selection.end < selection.start) return []
  const selected: CodeStudioLineHunk[] = []
  for (const hunk of lineDiff(baseline, current)) {
    const oldCount = hunk.oldEnd - hunk.oldStart + 1
    const newCount = hunk.newEnd - hunk.newStart + 1
    let first = -1
    const flush = (last: number) => {
      if (first < 0) return
      const oldStart = hunk.oldStart + Math.min(first, oldCount)
      const newStart = hunk.newStart + Math.min(first, newCount)
      const oldEnd = hunk.oldStart + Math.min(last + 1, oldCount) - 1
      const newEnd = hunk.newStart + Math.min(last + 1, newCount) - 1
      selected.push({ kind: oldEnd < oldStart ? 'added' : newEnd < newStart ? 'deleted' : 'modified', oldStart, oldEnd, newStart, newEnd })
      first = -1
    }
    for (let index = 0; index < Math.max(oldCount, newCount); index++) {
      const count = selection.side === 'old' ? oldCount : newCount
      const start = selection.side === 'old' ? hunk.oldStart : hunk.newStart
      // Missing-side rows are selectable at their insertion/deletion anchor.
      const line = start + Math.min(index, count)
      if (line >= selection.start && line <= selection.end) {
        if (first < 0) first = index
      } else flush(index - 1)
    }
    flush(Math.max(oldCount, newCount) - 1)
  }
  return selected
}

export function applyReviewSelection(baseline: string, current: string, selection: AgentReviewSelection, accept: boolean): string {
  const hunks = selectedReviewHunks(baseline, current, selection).reverse()
  const result = hunks.reduce((text, hunk) => accept ? acceptHunk(text, current, hunk) : rejectHunk(baseline, text, hunk), accept ? baseline : current)
  if (result === '') return ''
  if ((accept ? baseline : current) === '') {
    const format = split(accept ? current : baseline)
    return join({ ...split(result), eol: format.eol, finalNewline: format.finalNewline })
  }
  return result
}

export interface ReviewFunctionSymbol {
  name: string
  kind: number
  range: { startLine: number; endLine: number }
  children?: ReviewFunctionSymbol[]
}
export function reviewFunctions(symbols: readonly ReviewFunctionSymbol[]): ReviewFunctionSymbol[] {
  return symbols.flatMap((symbol) => [
    ...([6, 9, 12].includes(symbol.kind) ? [symbol] : []),
    ...reviewFunctions(symbol.children ?? []),
  ])
}

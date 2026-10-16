import { lineDiff, type GoStudioLineHunk } from './goStudioLineDiff'

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
  hunk: GoStudioLineHunk
  lines: AgentReviewLine[]
}

interface SplitText {
  lines: string[]
  eol: string
  finalNewline: boolean
}

/** Stesse righe di lineDiff (CRLF normalizzato, newline finale ignorata), più quanto serve per ricomporre il testo. */
function split(text: string): SplitText {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const finalNewline = lines.length > 1 && lines[lines.length - 1] === ''
  if (finalNewline) lines.pop()
  return { lines, eol, finalNewline }
}

function join({ lines, eol, finalNewline }: SplitText): string {
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
export function acceptHunk(baseline: string, current: string, hunk: GoStudioLineHunk): string {
  return replaceLines(baseline, hunk.oldStart, hunk.oldEnd, slice(current, hunk.newStart, hunk.newEnd))
}

/** Testo attuale con il blocco rifiutato riportato com'era prima dell'agente. */
export function rejectHunk(baseline: string, current: string, hunk: GoStudioLineHunk): string {
  return replaceLines(current, hunk.newStart, hunk.newEnd, slice(baseline, hunk.oldStart, hunk.oldEnd))
}

/** Righe aggiunte e tolte, per il riepilogo accanto a ogni file. */
export function agentReviewStats(baseline: string, current: string): { added: number; removed: number } {
  return lineDiff(baseline, current).reduce((total, hunk) => ({
    added: total.added + Math.max(0, hunk.newEnd - hunk.newStart + 1),
    removed: total.removed + Math.max(0, hunk.oldEnd - hunk.oldStart + 1),
  }), { added: 0, removed: 0 })
}

// Unified-diff hunk parsing for partial (per-hunk) staging. A file diff from
// `git diff [--cached] -- <path>` is split into a file header (the `diff --git`
// / `index` / `---` / `+++` lines) and a list of `@@` hunks. Selecting a subset
// of hunks and re-joining them with the file header yields a valid patch that
// `git apply --cached` stages exactly that subset.

export interface Hunk {
  /** The `@@ -a,b +c,d @@ …` line. */
  header: string
  /** Body lines (context ' ', addition '+', deletion '-'), without the header. */
  lines: string[]
  /** Full hunk text (header + body), apply-able when prefixed with the file header. */
  text: string
}

export interface ParsedFileDiff {
  fileHeader: string
  hunks: Hunk[]
}

/** Parti dell'header `@@ -a,b +c,d @@ …`; i conteggi omessi valgono 1, `-0,0` è un inserto. */
function headerParts(header: string): { oldStart: number; oldCount: number; newStart: number; newCount: number; rest: string } | null {
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
  if (!match) return null
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
    rest: match[5],
  }
}

/** Righe 1-based coperte da un hunk sui due lati; end < start = nessuna riga (inserto o cancellazione). */
export interface HunkRange {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

export function hunkRange(hunk: Hunk): HunkRange | null {
  const parts = headerParts(hunk.header)
  if (!parts) return null
  return {
    oldStart: parts.oldStart,
    oldEnd: parts.oldStart + parts.oldCount - 1,
    newStart: parts.newStart,
    newEnd: parts.newStart + parts.newCount - 1,
  }
}

/** Un lato senza righe è ancorato alla sua riga start: conta come quella riga. */
function span(start: number, end: number): [number, number] {
  return [Math.min(start, end + 1), Math.max(start, end)]
}

function intersects(left: [number, number], right: [number, number]): boolean {
  return left[0] <= right[1] && right[0] <= left[1]
}

/**
 * Hunks che toccano le righe indicate su uno dei due lati. Serve per allineare un blocco
 * dell'editor (righe contro HEAD) agli hunks di `git diff` (index → worktree o HEAD → index).
 */
export function hunksOverlapping(hunks: readonly Hunk[], target: HunkRange): Hunk[] {
  const oldTarget = span(target.oldStart, target.oldEnd)
  const newTarget = span(target.newStart, target.newEnd)
  return hunks.filter((hunk) => {
    const range = hunkRange(hunk)
    if (!range) return false
    return intersects(oldTarget, span(range.oldStart, range.oldEnd)) || intersects(newTarget, span(range.newStart, range.newEnd))
  })
}

export function parseFileDiff(diff: string): ParsedFileDiff {
  const lines = diff.split('\n')
  // git output ends with a trailing newline → drop the final empty element so
  // it does not leak into the last hunk's body and corrupt the rebuilt patch.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const headerLines: string[] = []
  let i = 0
  while (i < lines.length && !lines[i].startsWith('@@')) {
    headerLines.push(lines[i])
    i++
  }

  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('@@')) {
      if (current) hunks.push(current)
      current = { header: line, lines: [], text: '' }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) hunks.push(current)
  for (const h of hunks) h.text = [h.header, ...h.lines].join('\n')

  return { fileHeader: headerLines.join('\n'), hunks }
}

/** Rebuild an apply-able patch from the file header and the chosen hunks. */
export function buildPatch(fileHeader: string, hunks: Hunk[]): string {
  if (!fileHeader.trim() || hunks.length === 0) return ''
  const body = hunks.map((h) => h.text).join('\n')
  return `${fileHeader}\n${body}\n`
}

/** Build a valid hunk containing only selected +/- body lines. Unselected
 * deletions become context; unselected additions disappear. Header counts are
 * recalculated so git apply can stage one changed line at a time. */
export function selectHunkLines(hunk: Hunk, selected: Set<number>): Hunk | null {
  const parts = headerParts(hunk.header)
  if (!parts) return null
  const transformed: string[] = []
  let keptChange = false
  for (let index = 0; index < hunk.lines.length; index++) {
    const line = hunk.lines[index]
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (selected.has(index)) { transformed.push(line); keptChange = true }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      if (selected.has(index)) { transformed.push(line); keptChange = true }
      else transformed.push(` ${line.slice(1)}`)
    } else {
      transformed.push(line)
    }
  }
  if (!keptChange) return null
  const oldCount = transformed.filter((line) => !line.startsWith('+') && !line.startsWith('\\')).length
  const newCount = transformed.filter((line) => !line.startsWith('-') && !line.startsWith('\\')).length
  const header = `@@ -${parts.oldStart},${oldCount} +${parts.newStart},${newCount} @@${parts.rest}`
  return { header, lines: transformed, text: [header, ...transformed].join('\n') }
}

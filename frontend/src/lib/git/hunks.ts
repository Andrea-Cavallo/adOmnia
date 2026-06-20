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
  const match = hunk.header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
  if (!match) return null
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
  const header = `@@ -${match[1]},${oldCount} +${match[3]},${newCount} @@${match[5]}`
  return { header, lines: transformed, text: [header, ...transformed].join('\n') }
}

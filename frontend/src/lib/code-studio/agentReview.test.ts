import { describe, expect, it } from 'vitest'
import { acceptHunk, agentReviewHunks, agentReviewStats, rejectHunk, agentReviewSplitRows } from './agentReview'

const before = 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n'
const after = 'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tfmt.Println("hi")\n\tos.Exit(0)\n}\n'

describe('agent review hunks', () => {
  it('splits the agent edit into independent hunks with context', () => {
    const hunks = agentReviewHunks(before, after)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].lines.filter((line) => line.kind === 'removed').map((line) => line.text)).toEqual(['import "fmt"'])
    expect(hunks[1].lines.filter((line) => line.kind === 'added').map((line) => line.text)).toEqual(['\tos.Exit(0)'])
    expect(hunks[1].lines[0]).toMatchObject({ kind: 'context', newNumber: 7 })
  })

  it('accepting one hunk and rejecting the other leaves a consistent file', () => {
    const [imports, exit] = agentReviewHunks(before, after).map((item) => item.hunk)
    const baseline = acceptHunk(before, after, imports)
    const current = rejectHunk(baseline, after, exit)
    expect(current).toBe('package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tfmt.Println("hi")\n}\n')
    expect(agentReviewHunks(baseline, current)).toEqual([])
  })

  it('rejecting every hunk restores the original text exactly, CRLF included', () => {
    const crlfBefore = before.replace(/\n/g, '\r\n')
    const crlfAfter = after.replace(/\n/g, '\r\n')
    let current = crlfAfter
    // Dal basso verso l'alto: i numeri di riga dei blocchi precedenti restano validi.
    for (const { hunk } of agentReviewHunks(crlfBefore, crlfAfter).reverse()) current = rejectHunk(crlfBefore, current, hunk)
    expect(current).toBe(crlfBefore)
  })

  it('handles pure insertions and deletions at the end of the file', () => {
    expect(rejectHunk('a\nb\n', 'a\nb\nc\n', agentReviewHunks('a\nb\n', 'a\nb\nc\n')[0].hunk)).toBe('a\nb\n')
    expect(rejectHunk('a\nb\nc\n', 'a\n', agentReviewHunks('a\nb\nc\n', 'a\n')[0].hunk)).toBe('a\nb\nc\n')
    expect(acceptHunk('a\nb\nc\n', 'a\n', agentReviewHunks('a\nb\nc\n', 'a\n')[0].hunk)).toBe('a\n')
  })

  it('counts added and removed lines', () => {
    expect(agentReviewStats(before, after)).toEqual({ added: 5, removed: 1 })
  })
})

describe('agentReviewSplitRows', () => {
  it('pairs removed and added blocks and keeps context on both sides', () => {
    const rows = agentReviewSplitRows([
      { kind: 'context', text: 'a', oldNumber: 1, newNumber: 1 },
      { kind: 'removed', text: 'b', oldNumber: 2 },
      { kind: 'removed', text: 'c', oldNumber: 3 },
      { kind: 'added', text: 'B', newNumber: 2 },
      { kind: 'context', text: 'd', oldNumber: 4, newNumber: 3 },
      { kind: 'added', text: 'e', newNumber: 4 },
    ])
    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ['a', 'a'], ['b', 'B'], ['c', null], ['d', 'd'], [null, 'e'],
    ])
  })
})
import { applyReviewSelection, selectedReviewHunks, reviewFunctions } from './agentReview'

describe('selective agent review', () => {
  const oldText = 'head\nold one\nold two\ntail\n'
  const newText = 'head\nnew one\nnew two\ntail\n'
  it('accepts or rejects one replacement line without touching its neighbor', () => {
    const selection = { side: 'new' as const, start: 2, end: 2 }
    expect(applyReviewSelection(oldText, newText, selection, true)).toBe('head\nnew one\nold two\ntail\n')
    expect(applyReviewSelection(oldText, newText, selection, false)).toBe('head\nold one\nnew two\ntail\n')
  })
  it('handles a selection on the baseline side and CRLF', () => {
    expect(applyReviewSelection(oldText.replace(/\n/g, '\r\n'), newText, { side: 'old', start: 3, end: 3 }, true)).toBe('head\r\nold one\r\nnew two\r\ntail\r\n')
  })
  it('applies several changes in a function from bottom to top', () => {
    const before = 'func a() {\n old\n keep\n old2\n}\nfunc b() {\n old3\n}\n'
    const after = 'func a() {\n new\n keep\n new2\n}\nfunc b() {\n new3\n}\n'
    const selection = { side: 'new' as const, start: 1, end: 5 }
    expect(applyReviewSelection(before, after, selection, false)).toBe(before.replace('old3', 'new3'))
    expect(applyReviewSelection(before, after, selection, true)).toBe(after.replace('new3', 'old3'))
  })
  it('handles insertion, deletion and unequal replacement lengths', () => {
    expect(applyReviewSelection('a\nc\n', 'a\nb\nc\n', { side: 'new', start: 2, end: 2 }, false)).toBe('a\nc\n')
    expect(applyReviewSelection('a\nb\nc\n', 'a\nc\n', { side: 'old', start: 2, end: 2 }, false)).toBe('a\nb\nc\n')
    expect(applyReviewSelection('a\nold\nz\n', 'a\nx\ny\nz\n', { side: 'new', start: 3, end: 3 }, true)).toBe('a\nold\ny\nz\n')
    expect(selectedReviewHunks(oldText, newText, { side: 'new', start: 4, end: 4 })).toEqual([])
  })
  it('uses language server methods, constructors and functions, including nested symbols', () => {
    expect(reviewFunctions([{ name: 'Class', kind: 5, range: { startLine: 1, endLine: 9 }, children: [{ name: 'method', kind: 6, range: { startLine: 2, endLine: 8 } }] }]).map(item => item.name)).toEqual(['method'])
  })
})

it('partially reviews new and deleted files with their original line endings', () => {
  expect(applyReviewSelection('', 'a\r\nb\r\n', { side: 'new', start: 2, end: 2 }, true)).toBe('b\r\n')
  expect(applyReviewSelection('', 'a\nb\n', { side: 'new', start: 1, end: 2 }, false)).toBe('')
  expect(applyReviewSelection('a\nb\n', '', { side: 'old', start: 2, end: 2 }, false)).toBe('b\n')
  expect(applyReviewSelection('a\nb\n', '', { side: 'old', start: 1, end: 2 }, true)).toBe('')
})

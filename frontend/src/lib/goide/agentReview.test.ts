import { describe, expect, it } from 'vitest'
import { acceptHunk, agentReviewHunks, agentReviewStats, rejectHunk } from './agentReview'

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

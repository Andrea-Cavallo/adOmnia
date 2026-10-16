import { describe, expect, it } from 'vitest'
import { hunkRange, hunksOverlapping, selectHunkLines, type Hunk } from './hunks'

const hunk = (header: string): Hunk => ({ header, lines: [], text: '' })

describe('hunkRange', () => {
  it('reads both sides of the @@ header, with omitted counts as one line', () => {
    expect(hunkRange(hunk('@@ -1,2 +1,4 @@'))).toEqual({ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 4 })
    expect(hunkRange(hunk('@@ -5 +5 @@ func a()'))).toEqual({ oldStart: 5, oldEnd: 5, newStart: 5, newEnd: 5 })
    expect(hunkRange(hunk('@@ -0,0 +3,2 @@'))).toEqual({ oldStart: 0, oldEnd: -1, newStart: 3, newEnd: 4 })
    expect(hunkRange(hunk('@@ -7,2 +6,0 @@'))).toEqual({ oldStart: 7, oldEnd: 8, newStart: 6, newEnd: 5 })
    expect(hunkRange(hunk('not a header'))).toBeNull()
  })
})

describe('hunksOverlapping', () => {
  it('matches on the new side (worktree lines)', () => {
    const first = hunk('@@ -1,3 +1,4 @@')
    const second = hunk('@@ -20,2 +21,2 @@')
    expect(hunksOverlapping([first, second], { oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 4 })).toEqual([first])
  })

  it('matches a deletion on its old side even when the new side has no lines', () => {
    const deletion = hunk('@@ -7,2 +6,0 @@')
    expect(hunksOverlapping([deletion], { oldStart: 7, oldEnd: 8, newStart: 6, newEnd: 5 })).toEqual([deletion])
  })

  it('treats an empty side as anchored on its start line', () => {
    const insertion = hunk('@@ -4,0 +5,2 @@')
    expect(hunksOverlapping([insertion], { oldStart: 5, oldEnd: 4, newStart: 5, newEnd: 6 })).toEqual([insertion])
    expect(hunksOverlapping([insertion], { oldStart: 9, oldEnd: 8, newStart: 9, newEnd: 10 })).toEqual([])
  })

  it('keeps disjoint hunks out', () => {
    expect(hunksOverlapping([hunk('@@ -30,2 +30,2 @@')], { oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 4 })).toEqual([])
    expect(hunksOverlapping([hunk('garbage')], { oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 4 })).toEqual([])
  })
})

describe('selectHunkLines', () => {
  it('keeps only selected additions and recalculates the new count', () => {
    const hunk: Hunk = {
      header: '@@ -1,2 +1,4 @@',
      lines: [' context', '+first', '+second', ' tail'],
      text: '',
    }
    const selected = selectHunkLines(hunk, new Set([2]))
    expect(selected?.header).toBe('@@ -1,2 +1,3 @@')
    expect(selected?.lines).toEqual([' context', '+second', ' tail'])
  })

  it('turns unselected deletions into context', () => {
    const hunk: Hunk = {
      header: '@@ -1,3 +1,2 @@',
      lines: [' one', '-remove-a', '-remove-b', '+replacement'],
      text: '',
    }
    const selected = selectHunkLines(hunk, new Set([1]))
    expect(selected?.header).toBe('@@ -1,3 +1,2 @@')
    expect(selected?.lines).toEqual([' one', '-remove-a', ' remove-b'])
  })
})

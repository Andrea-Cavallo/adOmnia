import { describe, expect, it } from 'vitest'
import { selectHunkLines, type Hunk } from './hunks'

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

import { describe, expect, it } from 'vitest'
import type { AgentReviewFile } from '@/lib/code-studio-api'
import { nextSelection, selectionExcerpt } from './CodeStudioAgentReviewComments'

describe('review comment selection', () => {
  it('extends on the same side and file, restarts otherwise', () => {
    const first = nextSelection(null, 'a.go', 'new', 5, false)
    expect(nextSelection(first, 'a.go', 'new', 2, true)).toEqual({ path: 'a.go', side: 'new', start: 2, end: 5 })
    expect(nextSelection(first, 'a.go', 'old', 7, true)).toEqual({ path: 'a.go', side: 'old', start: 7, end: 7 })
    expect(nextSelection(first, 'b.go', 'new', 7, true)).toEqual({ path: 'b.go', side: 'new', start: 7, end: 7 })
  })

  it('takes the excerpt from the side the user commented', () => {
    const file = { path: 'a.go', baseline: 'one\r\ntwo\r\nthree', current: 'one\nTWO\nthree\nfour' } as AgentReviewFile
    expect(selectionExcerpt(file, { path: 'a.go', side: 'new', start: 2, end: 4 })).toBe('TWO\nthree\nfour')
    expect(selectionExcerpt(file, { path: 'a.go', side: 'old', start: 2, end: 2 })).toBe('two')
  })
})

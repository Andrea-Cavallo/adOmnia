import { describe, expect, it } from 'vitest'
import { lineChangeRange, revertLineChange } from './lineChange'

const head = 'a\nb\nc\nd\n'

describe('line change', () => {
  it('reverts a modified, an added and a deleted block', () => {
    expect(revertLineChange('a\nB\nc\nd\n', head, { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 })).toBe(head)
    expect(revertLineChange('a\nb\nx\ny\nc\nd\n', head, { originalStartLineNumber: 2, originalEndLineNumber: 0, modifiedStartLineNumber: 3, modifiedEndLineNumber: 4 })).toBe(head)
    expect(revertLineChange('a\nc\nd\n', head, { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 1, modifiedEndLineNumber: 0 })).toBe(head)
  })

  it('keeps CRLF endings and untouched blocks', () => {
    const working = 'a\r\nB\r\nc\r\nD\r\n'
    expect(revertLineChange(working, 'a\r\nb\r\nc\r\nd\r\n', { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 4 })).toBe('a\r\nB\r\nc\r\nd\r\n')
  })

  it('uses the empty-side convention of the editor gutter for staging', () => {
    expect(lineChangeRange({ originalStartLineNumber: 2, originalEndLineNumber: 0, modifiedStartLineNumber: 3, modifiedEndLineNumber: 4 })).toEqual({ oldStart: 3, oldEnd: 2, newStart: 3, newEnd: 4 })
    expect(lineChangeRange({ originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 1, modifiedEndLineNumber: 0 })).toEqual({ oldStart: 2, oldEnd: 2, newStart: 2, newEnd: 1 })
  })
})

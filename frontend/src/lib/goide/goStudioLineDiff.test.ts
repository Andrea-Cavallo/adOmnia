import { describe, expect, it } from 'vitest'
import { hunkOldLines, lineDiff } from './goStudioLineDiff'

describe('line diff for the VCS gutter', () => {
  it('finds added, modified and deleted blocks', () => {
    const head = 'a\nb\nc\nd\ne\n'
    expect(lineDiff(head, head)).toEqual([])
    expect(lineDiff(head, 'a\nb\nX\nc\nd\ne\n')).toEqual([{ kind: 'added', oldStart: 3, oldEnd: 2, newStart: 3, newEnd: 3 }])
    expect(lineDiff(head, 'a\nB\nc\nd\ne\n')).toEqual([{ kind: 'modified', oldStart: 2, oldEnd: 2, newStart: 2, newEnd: 2 }])
    expect(lineDiff(head, 'a\nb\ne\n')).toEqual([{ kind: 'deleted', oldStart: 3, oldEnd: 4, newStart: 3, newEnd: 2 }])
  })

  it('keeps separate hunks apart and returns the original lines for revert', () => {
    const head = 'one\ntwo\nthree\nfour\nfive\nsix\n'
    const hunks = lineDiff(head, 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n')
    expect(hunks.map((item) => item.kind)).toEqual(['modified', 'added'])
    expect(hunkOldLines(head, hunks[0])).toEqual(['one'])
  })

  it('ignores CRLF differences', () => {
    expect(lineDiff('a\r\nb\r\n', 'a\nb\n')).toEqual([])
  })
})

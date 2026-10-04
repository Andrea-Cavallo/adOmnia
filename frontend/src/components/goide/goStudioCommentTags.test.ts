import { describe, expect, it } from 'vitest'
import { commentTagRanges, lineCommentToken } from './goStudioCommentTags'

describe('commentTagRanges', () => {
  it('colours TODO, FIXME, NOTE and important comments from the marker to the end of the line', () => {
    const source = [
      'x := 1 // TODO: rename',
      '// FIXME broken on Windows',
      '// NOTE: keep in sync',
      '// * Important',
      '// ! alert',
      '// ? why',
      '// plain comment',
    ].join('\n')
    expect(commentTagRanges(source).map((range) => [range.line, range.tag, range.startColumn])).toEqual([
      [1, 'todo', 8], [2, 'fixme', 1], [3, 'note', 1], [4, 'important', 1], [5, 'fixme', 1], [6, 'note', 1],
    ])
    expect(commentTagRanges(source)[0].endColumn).toBe('x := 1 // TODO: rename'.length + 1)
  })

  it('ignores markers inside strings, directives and words that only start with a tag', () => {
    const source = [
      'url := "http://x" // TODO real',
      's := `// TODO not a comment`',
      '//go:generate stringer',
      '// TODOS are fine',
      '// *bold without space',
    ].join('\n')
    expect(commentTagRanges(source).map((range) => [range.line, range.startColumn])).toEqual([[1, 19]])
  })

  it('uses # comments for YAML and shell files', () => {
    expect(lineCommentToken('deploy/app.yaml')).toBe('#')
    expect(lineCommentToken('Makefile')).toBe('#')
    expect(lineCommentToken('main.go')).toBe('//')
    expect(commentTagRanges("name: 'a#b' # FIXME pin version", '#')).toEqual([{ line: 1, startColumn: 13, endColumn: 32, tag: 'fixme' }])
  })
})

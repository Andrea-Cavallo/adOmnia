import { describe, expect, it } from 'vitest'
import { commentSyntax, commentTagRanges, lineCommentToken } from './codeStudioCommentTags'

const tags = (source: string, path = 'main.go') => commentTagRanges(source, commentSyntax(path)).map((range) => [range.line, range.tag, range.startColumn])

describe('commentTagRanges', () => {
  it('colours TODO, alerts, questions, important and note comments from the marker to the end of the line', () => {
    const source = [
      'x := 1 // TODO: rename',
      '// FIXME broken on Windows',
      '// NOTE: keep in sync',
      '// * Important',
      '// ! alert',
      '// ? why',
      '// plain comment',
      '// ALERT: no items provided',
      '// QUESTION: should we filter?',
      '// IMPORTANT: transform and return',
    ].join('\n')
    expect(tags(source)).toEqual([
      [1, 'todo', 8], [2, 'alert', 1], [3, 'note', 1], [4, 'important', 1], [5, 'alert', 1], [6, 'question', 1],
      [8, 'alert', 1], [9, 'question', 1], [10, 'important', 1],
    ])
    expect(commentTagRanges(source)[0].endColumn).toBe('x := 1 // TODO: rename'.length + 1)
  })

  it('ignores markers inside strings, directives, doc comments and words that only start with a tag', () => {
    const source = [
      'url := "http://x" // TODO real',
      's := `// TODO not a comment`',
      '//go:generate stringer',
      '// TODOS are fine',
      '// *bold without space',
      '/// TODO doc comment',
    ].join('\n')
    expect(commentTagRanges(source).map((range) => [range.line, range.startColumn])).toEqual([[1, 19]])
  })

  it('strikes through commented-out code written with four slashes', () => {
    expect(tags('//// oldCall()\nnewCall()')).toEqual([[1, 'strike', 1]])
  })

  it('colours each line of a block comment, Javadoc continuation lines included', () => {
    const source = [
      'int x; /* TODO: one line */ int y;',
      '/**',
      ' * Loads the orders.',
      ' * ! fails without a connection',
      ' * ? cache them',
      ' */',
      '/* IMPORTANT',
      '   keep the order */',
    ].join('\n')
    const ranges = commentTagRanges(source, commentSyntax('Orders.java'))
    expect(ranges.map((range) => [range.line, range.tag])).toEqual([[1, 'todo'], [4, 'alert'], [5, 'question'], [7, 'important']])
    expect(ranges[0].endColumn).toBe('int x; /* TODO: one line */'.length + 1)
  })

  it('knows the comments of SQL, markup and hash files', () => {
    expect(tags('SELECT 1; -- TODO index this', 'schema.sql')).toEqual([[1, 'todo', 11]])
    expect(tags('<div><!-- ! remove before release --></div>', 'index.html')).toEqual([[1, 'alert', 6]])
    expect(lineCommentToken('deploy/app.yaml')).toBe('#')
    expect(lineCommentToken('Makefile')).toBe('#')
    expect(lineCommentToken('main.go')).toBe('//')
    expect(commentTagRanges("name: 'a#b' # FIXME pin version", commentSyntax('app.yaml'))).toEqual([{ line: 1, startColumn: 13, endColumn: 32, tag: 'alert' }])
  })
})

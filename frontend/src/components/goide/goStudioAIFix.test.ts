import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({}))

import { applyTextEdits } from './goStudioWorkspaceEdits'
import { buildAIFixPrompt, lineEditsFor, localPackageDirForProblem, parseAIFixResponse } from './goStudioAIFix'

const source = `package files

import (
\t"Example/logger"
\t"fmt"
\tstore "Example/internal/persistence"
)

var loggerInstance = logger.GetLoggerInstance()
`

describe('AI fix context', () => {
  const modules = [{ path: '.', modulePath: 'Example' }]

  it('finds the local package behind an undefined selector, with or without an explicit alias', () => {
    expect(localPackageDirForProblem('undefined: logger.GetLoggerInstance', source, modules)).toBe('logger')
    expect(localPackageDirForProblem('undefined: store.Open', source, modules)).toBe('internal/persistence')
    expect(localPackageDirForProblem('undefined: logger.X', source, [{ path: 'svc', modulePath: 'Example' }])).toBe('svc/logger')
  })

  it('ignores standard library, foreign modules and other errors', () => {
    expect(localPackageDirForProblem('undefined: fmt.Nope', source, modules)).toBeNull()
    expect(localPackageDirForProblem('declared and not used: x', source, modules)).toBeNull()
    expect(localPackageDirForProblem('undefined: logger.X', source, [{ path: '.', modulePath: 'other.com/x' }])).toBeNull()
  })

  it('builds a prompt with the problem, the file and the related package', () => {
    const prompt = buildAIFixPrompt({ relativePath: 'files/FilesExamples.go', content: source }, { line: 9, message: 'undefined: logger.GetLoggerInstance', source: 'compiler' }, [], [{ relativePath: 'logger/Logger.go', content: 'package logger\n' }])
    expect(prompt.system).toContain('=== FILE: <relative path> ===')
    expect(prompt.user).toContain('line 9: undefined: logger.GetLoggerInstance (compiler)')
    expect(prompt.user).toContain('=== FILE: logger/Logger.go ===')
  })
})

describe('AI fix response', () => {
  it('accepts only files that were sent, with Go content, tolerating markdown fences', () => {
    const response = [
      'Sure! Here is the fix:',
      '=== FILE: logger/Logger.go ===',
      '```go',
      'package logger',
      '',
      'func GetLoggerInstance() *Logger { return defaultLogger }',
      '```',
      '=== END FILE ===',
      '=== FILE: ../../etc/passwd ===',
      'package evil',
      '=== END FILE ===',
      '=== FILE: files/FilesExamples.go ===',
      'not go at all',
      '=== END FILE ===',
    ].join('\n')
    expect(parseAIFixResponse(response, ['files/FilesExamples.go', 'logger/Logger.go'])).toEqual([
      { relativePath: 'logger/Logger.go', content: 'package logger\n\nfunc GetLoggerInstance() *Logger { return defaultLogger }\n' },
    ])
  })

  it('returns nothing for an unstructured answer', () => {
    expect(parseAIFixResponse('I cannot help with that.', ['a.go'])).toEqual([])
  })
})

describe('minimal edits from a proposed file', () => {
  const cases: Array<[string, string, string]> = [
    ['one line changed', 'a\nb\nc\n', 'a\nB\nc\n'],
    ['lines appended at the end', 'a\nb\n', 'a\nb\nc\nd\n'],
    ['lines inserted at the top', 'b\nc\n', 'a\nb\nc\n'],
    ['lines removed', 'a\nb\nc\nd\n', 'a\nd\n'],
    ['no trailing newline', 'a\nb', 'a\nB'],
    ['several separate hunks', 'package x\n\nfunc a() {}\n\nfunc b() {}\n\nfunc c() {}\n', 'package x\n\nfunc a() { return }\n\nfunc b() {}\n\nfunc c() { panic(1) }\nfunc d() {}\n'],
    ['unicode columns', 'var s = "è"\nx := 1\n', 'var s = "è"\nx := 2\n'],
  ]
  it.each(cases)('%s', (_name, current, proposed) => {
    const { edits, newContent } = lineEditsFor(current, proposed)
    expect(newContent).toBe(proposed)
    expect(applyTextEdits(current, edits)).toBe(proposed)
  })

  it('produces one edit per changed block, not a whole-file replacement', () => {
    const { edits } = lineEditsFor('package x\n\nfunc a() {}\n\nfunc b() {}\n\nfunc c() {}\n', 'package x\n\nfunc a() { return }\n\nfunc b() {}\n\nfunc c() { panic(1) }\n')
    expect(edits).toHaveLength(2)
  })

  it('works on a CRLF buffer', () => {
    const { newContent } = lineEditsFor('a\r\nb\r\n', 'a\nB\n')
    expect(newContent).toBe('a\nB\n')
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({}))

import { applyTextEdits } from './goStudioChangePreview'
import {
  buildInlineEditPrompt, hunkDelta, inlineEditHunks, matchFragmentShape, parseInlineEditResponse,
  shiftInlineHunks, type InlineAssistantTarget,
} from './goStudioInlineAssistant'

const target = (oldText: string, startLine = 1, startColumn = 1): InlineAssistantTarget => ({
  relativePath: 'svc/handler.go',
  language: 'go',
  startLine,
  startColumn,
  oldText,
  contextBefore: 'func outer() {\n\tsetup()',
  contextAfter: '\tcleanup()\n}',
  problems: [{ line: 2, message: 'errcheck: error is not checked' }],
})

describe('inline edit prompt', () => {
  it('asks for a bare replacement and carries instruction, fragment, context and problems', () => {
    const prompt = buildInlineEditPrompt(target('func a() error {\n\treturn nil\n}', 12), 'aggiungi gestione errori')
    expect(prompt.system).toContain('Reply ONLY with the complete replacement text')
    expect(prompt.system).toContain('no markdown fences')
    expect(prompt.user).toContain('Instruction: aggiungi gestione errori')
    expect(prompt.user).toContain('svc/handler.go (language: go)')
    expect(prompt.user).toContain('lines 12-14')
    expect(prompt.user).toContain('func a() error {')
    expect(prompt.user).toContain('Context before the fragment')
    expect(prompt.user).toContain('Context after the fragment')
    expect(prompt.user).toContain('line 2: errcheck: error is not checked')
  })

  it('never hard-codes a language fence', () => {
    const prompt = buildInlineEditPrompt(target('plain text'), 'rewrite')
    expect(prompt.user).not.toContain('```go')
  })
})

describe('inline edit response', () => {
  it('extracts the fenced block even when the model talks first', () => {
    expect(parseInlineEditResponse('Sure! Here is the change:\n```go\nx := 1\n```\nDone.')).toBe('x := 1')
  })

  it('accepts plain replacement code', () => {
    expect(parseInlineEditResponse('func a() error {\n\treturn err\n}')).toBe('func a() error {\n\treturn err\n}')
  })

  it('refuses a chat reply instead of replacing code with prose', () => {
    expect(parseInlineEditResponse('Sure! Here is the updated fragment.')).toBeNull()
    expect(parseInlineEditResponse('I cannot help with that.')).toBeNull()
    expect(parseInlineEditResponse('The fragment wraps the error with %w now.')).toBeNull()
    expect(parseInlineEditResponse('   ')).toBeNull()
  })
})

describe('fragment shape', () => {
  it('keeps the trailing newline shape of the original fragment', () => {
    expect(matchFragmentShape('a\nb\n', 'a\nB')).toBe('a\nB\n')
    expect(matchFragmentShape('a\nb', 'a\nB\n')).toBe('a\nB')
    expect(matchFragmentShape('a\nb\n', 'a\nB\n')).toBe('a\nB\n')
    expect(matchFragmentShape('a\nb', 'a\nB')).toBe('a\nB')
  })
})

describe('inline hunks', () => {
  const cases: Array<[string, string, string]> = [
    ['one line changed', 'a\nb\nc\n', 'a\nB\nc\n'],
    ['lines inserted', 'a\nb\n', 'a\nx\ny\nb\n'],
    ['lines removed', 'a\nb\nc\nd\n', 'a\nd\n'],
    ['separate hunks', 'a\nb\nc\nd\ne\n', 'a\nB\nc\nd\nE\ne\n'],
  ]
  it.each(cases)('applying its edits reproduces the proposal (%s)', (_name, oldText, proposed) => {
    const hunks = inlineEditHunks(oldText, proposed, 1, 1)
    expect(hunks.length).toBeGreaterThan(0)
    expect(applyTextEdits(oldText, hunks.map((hunk) => hunk.edit))).toBe(proposed)
  })

  it('maps fragment coordinates onto the file, first line included', () => {
    const [hunk] = inlineEditHunks('x := 1\ny := 2', 'x := 1\ny := 3', 3, 5)
    expect(hunk.edit.range).toEqual({ startLine: 4, startColumn: 1, endLine: 4, endColumn: 7 })
    expect(hunk.removedLines).toEqual(['y := 2'])
    expect(hunk.addedLines).toEqual(['y := 3'])
    expect(hunk.anchorLine).toBe(4)

    const [first] = inlineEditHunks('a\nb', 'A\nb', 3, 5)
    expect(first.edit.range.startLine).toBe(3)
    expect(first.edit.range.startColumn).toBe(5)
  })

  it('describes an insertion as an empty edit anchored on the line above', () => {
    const hunks = inlineEditHunks('func a() error {\n\treturn nil\n}\n', 'func a() error {\n\tif err := b(); err != nil {\n\t\treturn err\n\t}\n\treturn nil\n}\n', 10, 1)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].removedLines).toEqual([])
    expect(hunks[0].addedLines).toHaveLength(3)
    expect(hunks[0].edit.range).toEqual({ startLine: 11, startColumn: 1, endLine: 11, endColumn: 1 })
    expect(hunks[0].anchorLine).toBe(10)
    expect(hunkDelta(hunks[0])).toBe(3)
  })
})

describe('hunk shifting after an accept', () => {
  const hunks = inlineEditHunks('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\nE\ne\n', 1, 1)
  const [first, second] = hunks

  it('moves only the hunks below the applied one, by its line delta', () => {
    const modifiedFirst = { ...first, addedLines: ['B', 'extra'] }
    const rest = shiftInlineHunks([second], modifiedFirst)
    expect(rest[0].edit.range.startLine).toBe(second.edit.range.startLine + 1)
    expect(rest[0].anchorLine).toBe(second.anchorLine + 1)
  })

  it('leaves the hunks above untouched', () => {
    const rest = shiftInlineHunks([first], { ...second, addedLines: ['E', 'F'] })
    expect(rest[0].edit.range).toEqual(first.edit.range)
    expect(rest[0].anchorLine).toBe(first.anchorLine)
  })

  it('shifts an insertion anchored exactly on the applied edit end', () => {
    const insertion = { ...second, removedLines: [], addedLines: ['E'], edit: { ...second.edit, range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 } }, anchorLine: 2 }
    const applied = { ...first, addedLines: ['B', 'extra'] }
    const rest = shiftInlineHunks([insertion], applied)
    expect(rest[0].edit.range.startLine).toBe(4)
    expect(rest[0].anchorLine).toBe(3)
  })
})

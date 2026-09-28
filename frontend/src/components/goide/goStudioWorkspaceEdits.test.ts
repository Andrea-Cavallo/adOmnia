import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({}))

import { applyTextEdits, changeMatchesBuffer } from './goStudioWorkspaceEdits'

const edit = (startLine: number, startColumn: number, endLine: number, endColumn: number, text: string) => ({ range: { startLine, startColumn, endLine, endColumn }, text })

describe('Go Studio workspace edits', () => {
  it('applies LSP edits from last to first, including multi-line and UTF-16 columns', () => {
    const text = 'package main\n\nfunc main() {\n\tprintln("ü", 1+2)\n}\n'
    const edits = [edit(4, 15, 4, 18, 'sum'), edit(3, 1, 3, 1, 'var sum = 1 + 2\n\n')]
    expect(applyTextEdits(text, edits)).toBe('package main\n\nvar sum = 1 + 2\n\nfunc main() {\n\tprintln("ü", sum)\n}\n')
  })

  it('accepts a change only if it still matches the current buffer, ignoring CRLF', () => {
    const buffer = 'a := 1\r\nb := a\r\n'
    const edits = [edit(2, 6, 2, 7, '2')]
    expect(changeMatchesBuffer(buffer, edits, 'a := 1\nb := 2\n')).toBe(true)
    expect(changeMatchesBuffer('a := 1\nb := a // typed meanwhile\n', edits, 'a := 1\nb := 2\n')).toBe(false)
  })
})

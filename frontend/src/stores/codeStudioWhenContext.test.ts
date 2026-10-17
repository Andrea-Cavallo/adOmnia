import { describe, expect, it } from 'vitest'
import { parseVimMode, whenContextFor } from './codeStudioWhenContext'

const target = (matches: readonly string[]) => ({
  closest: (selector: string) => (matches.some((part) => selector.includes(part)) ? {} : null),
})

describe('vim status parsing', () => {
  it('reads the monaco-vim status text', () => {
    expect(parseVimMode('-- INSERT --')).toBe('insert')
    expect(parseVimMode('-- VISUAL --')).toBe('visual')
    expect(parseVimMode('-- NORMAL --')).toBe('normal')
    expect(parseVimMode('-- REPLACE --')).toBe('insert')
    expect(parseVimMode('   ')).toBe('normal')
    expect(parseVimMode('mystery')).toBeNull()
  })
})

describe('when context', () => {
  it('marks the focus surface', () => {
    const editor = whenContextFor(target(['monaco-editor']), 'default', null)
    expect(editor.editor).toBe(true)
    expect(editor.input).toBe(false)
    expect(editor.terminal).toBe(false)

    const input = whenContextFor(target(['monaco-editor', 'textarea']), 'default', null)
    expect(input.input).toBe(true)
    expect(input.editor).toBe(false)

    expect(whenContextFor(target(['xterm']), 'default', null).terminal).toBe(true)
    expect(whenContextFor(null, 'default', null).editor).toBe(false)
  })

  it('exposes vim sub-modes only in vim mode', () => {
    const normal = whenContextFor(target(['monaco-editor']), 'vim', 'normal')
    expect(normal.vim).toBe(true)
    expect(normal['vim.normal']).toBe(true)
    expect(normal['vim.insert']).toBe(false)

    const insert = whenContextFor(target(['monaco-editor']), 'vim', 'insert')
    expect(insert['vim.insert']).toBe(true)
    expect(insert['vim.normal']).toBe(false)

    // In vim, senza tracciamento, si parte da normal (come all'ingresso della modalità).
    expect(whenContextFor(target(['monaco-editor']), 'vim', null)['vim.normal']).toBe(true)

    const plain = whenContextFor(target(['monaco-editor']), 'default', 'insert')
    expect(plain.vim).toBe(false)
    expect(plain['vim.insert']).toBe(false)
    expect(whenContextFor(target(['monaco-editor']), 'emacs', null).emacs).toBe(true)
  })
})

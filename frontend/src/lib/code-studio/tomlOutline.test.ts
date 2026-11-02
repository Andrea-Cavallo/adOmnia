import { describe, expect, it } from 'vitest'
import { tomlOutline } from './tomlOutline'

describe('local TOML navigation', () => {
  it('groups keys under tables and preserves array tables and quoted paths', () => {
    const symbols = tomlOutline('title = "app"\n[package]\nname = "demo"\n[dependencies."my.lib"]\nversion = "1"\n[[bin]]\nname = "cli"\n[[bin]]\nname = "worker"')
    expect(symbols.map(node => node.name)).toEqual(['title', 'package', 'dependencies."my.lib"', '[[bin]]', '[[bin]]'])
    expect(symbols[1].children?.map(node => node.name)).toEqual(['name'])
    expect(symbols[1].range.endLine).toBe(3)
    expect(symbols[4].range.endLine).toBe(9)
  })
  it('ignores comments, multiline strings and inline structures containing fake sections', () => {
    const symbols = tomlOutline(`# [comment]\ntext = """\n[fake]\nx = 1\n"""\nitems = [\n { value = 1 },\n "[also-fake]"\n]\n[real] # comment\nkey = true`)
    expect(symbols.map(node => node.name)).toEqual(['text', 'items', 'real'])
    expect(symbols[2].children?.map(node => node.name)).toEqual(['key'])
  })
  it('preserves quoted keys with punctuation and UTF-16 columns on CRLF buffers', () => {
    const symbols = tomlOutline('["table]#name"]\r\n"😀=key" = 12\r\n')
    expect(symbols[0].name).toBe('"table]#name"')
    expect(symbols[0].children?.[0].name).toBe('"😀=key"')
    expect(symbols[0].children?.[0].selectionRange).toEqual({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 10 })
  })
  it('keeps unfinished content navigable without inventing parse diagnostics', () => {
    expect(tomlOutline('[package]\nname = "unfinished\n# next\n')).toHaveLength(1)
  })
})

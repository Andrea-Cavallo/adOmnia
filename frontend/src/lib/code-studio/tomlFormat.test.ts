import { describe, expect, it } from 'vitest'
import { formatToml } from './tomlFormat'
import { Taplo } from '@taplo/lib'

const options = { tabSize: 2, insertSpaces: true }
describe('bundled TOML formatter', () => {
  it('formats real Cargo syntax, preserving comments, values and key order', async () => {
    const source = '# keep this comment\n[package]\nname="demo"\nversion="0.1.0" # release\n[dependencies]\nserde={version="1",features=["derive"]}\n'
    const formatted = await formatToml(source, options)
    expect(formatted).toContain('name = "demo"')
    expect(formatted).toContain('# keep this comment')
    expect(formatted).toContain('# release')
    const taplo = await Taplo.initialize()
    expect(taplo.decode(formatted)).toEqual(taplo.decode(source))
    expect(formatted.indexOf('name')).toBeLessThan(formatted.indexOf('version'))
    expect(await formatToml(formatted, options)).toBe(formatted)
  })
  it('keeps whitespace inside multiline strings and CRLF line endings', async () => {
    const source = '[project]\r\ntext="""first  \r\nsecond  \r\n"""\r\n'
    const formatted = await formatToml(source, options)
    const taplo = await Taplo.initialize()
    expect(taplo.decode(formatted)).toEqual(taplo.decode(source))
    expect(formatted).toContain('first  \r\nsecond  \r\n')
    expect(formatted.replace(/\r\n/g, '')).not.toContain('\n')
  })
  it('rejects invalid syntax and duplicate keys without returning replacement text', async () => {
    await expect(formatToml('[package\nname="bad"', options)).rejects.toThrow('TOML:')
    await expect(formatToml('name = "first"\nname = "second"', options)).rejects.toThrow('TOML:')
  })
  it('accepts TOML-specific scalar values without reserializing them through JSON', async () => {
    const source = 'maximum=9223372036854775807\ncreated=2026-11-01T10:00:00Z\nnot_number=nan\npositive=+inf\nnegative_zero=-0.0\n'
    const formatted = await formatToml(source, options)
    for (const value of ['9223372036854775807', '2026-11-01T10:00:00Z', 'nan', '+inf', '-0.0']) expect(formatted).toContain(value)
  })
  it('preserves final-newline choices and bounds input size', async () => {
    expect(await formatToml('name="demo"', options)).not.toMatch(/\n$/)
    expect(await formatToml('name="demo"', { ...options, trailingNewline: true })).toMatch(/\n$/)
    await expect(formatToml('x'.repeat(2_000_001), options)).rejects.toThrow('limited')
  })
})

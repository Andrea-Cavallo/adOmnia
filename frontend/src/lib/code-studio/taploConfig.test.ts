import { describe, expect, it } from 'vitest'
import { parseTaploFormatting, taploFormatOptions } from './taploConfig'

describe('.taplo.toml formatting', () => {
  it('reads indentation and trailing newline from [formatting]', () => {
    const config = '[formatting]\nindent_string = "    "\ntrailing_newline = false\n\n[[rule]]\nschema = "https://example.test/schema.json"\n'
    expect(parseTaploFormatting(config)).toEqual({ indentString: '    ', trailingNewline: false })
  })

  it('overrides editor defaults with the project options', () => {
    const options = taploFormatOptions({ tabSize: 2, insertSpaces: true, trailingNewline: true }, '[formatting]\nindent_string = "\\t"\ntrailing_newline = false\n')
    expect(options).toMatchObject({ tabSize: 1, insertSpaces: false, trailingNewline: false })
  })

  it('ignores unknown keys and sections instead of guessing', () => {
    expect(parseTaploFormatting('[schema]\nenabled = false\n[formatting]\nreorder_keys = true\n')).toEqual({})
  })
})

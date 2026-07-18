import { describe, expect, it } from 'vitest'
import { prettyJson } from './prettyJson'

describe('prettyJson', () => {
  it('preserves integers beyond JavaScript safe integer and signed int64 limits', () => {
    const source = '{"safe":9007199254740993,"long":9223372036854775807,"unsigned":18446744073709551615,"negative":-9223372036854775808}'
    const formatted = prettyJson(source)

    expect(formatted).toContain('9007199254740993')
    expect(formatted).toContain('9223372036854775807')
    expect(formatted).toContain('18446744073709551615')
    expect(formatted).toContain('-9223372036854775808')
    expect(formatted).not.toContain('9223372036854776000')
  })

  it('preserves exponent and decimal spellings verbatim', () => {
    expect(prettyJson('{"small":1.2300e-10}')).toContain('1.2300e-10')
  })

  it('rejects malformed JSON', () => {
    expect(() => prettyJson('{"id":}')).toThrow()
  })
})

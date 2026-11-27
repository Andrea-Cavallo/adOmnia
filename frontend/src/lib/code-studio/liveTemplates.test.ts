import { describe, expect, it } from 'vitest'
import { parseUserTemplates, templateSnippet, templatesFor } from './liveTemplates'

describe('live templates', () => {
  it('links repeated fields and places the final caret', () => {
    expect(templateSnippet('const $NAME$ = $VALUE$; use($NAME$);$END$')).toBe('const ${1:name} = ${2:value}; use($1);$0')
  })
  it('escapes selected code instead of interpreting it as snippet fields', () => {
    expect(templateSnippet('if ($CONDITION$) {\n$SELECTION$\n$END$\n}', 'const x = "$1";\\path')).toBe('if (${1:condition}) {\nconst x = "\\$1";\\\\path\n$0\n\\}')
  })
  it('keeps literal dollars, Unicode and CRLF', () => {
    expect(templateSnippet('€ $$5\r\n$NAME$')).toBe('€ \\$5\r\n${1:name}$0')
  })
  it('separates insertion and surround templates by editor language', () => {
    const templates = parseUserTemplates(JSON.stringify([
      { id: 'log', abbreviation: 'log', description: 'Log', body: 'log($VALUE$)', languages: ['typescript'] },
      { id: 'if', abbreviation: 'if', description: 'If', body: 'if ($CONDITION$) {$SELECTION$}', languages: ['typescript'] },
    ]))
    expect(templatesFor(templates, 'typescript', true).map(item => item.id)).toEqual(['if'])
    expect(templatesFor(templates, 'python', false)).toEqual([])
  })
  it('rejects duplicate ids and malformed imports without partial acceptance', () => {
    const item = { id: 'x', abbreviation: 'x', description: 'X', body: '$END$', languages: ['go'] }
    expect(() => parseUserTemplates(JSON.stringify([item, item]))).toThrow('Duplicate')
    expect(() => parseUserTemplates(JSON.stringify([{ ...item, languages: [''] }]))).toThrow('language')
    expect(() => parseUserTemplates('{}')).toThrow('array')
  })
})

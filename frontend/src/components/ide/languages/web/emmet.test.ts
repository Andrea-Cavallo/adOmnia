import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: { languages: {} } }))

import expand from 'emmet'
import { fieldRenderer, isMarkupPosition, toSnippet } from './emmet'

describe('Emmet integration', () => {
  it('expands an abbreviation into a Monaco snippet with tabstops', () => {
    const snippet = toSnippet(expand('a[href]', { options: { 'output.field': fieldRenderer } }))
    expect(snippet).toBe('<a href="${1}">${2}</a>$0')
  })

  it('keeps default text as the placeholder', () => {
    const snippet = toSnippet(expand('input:text', { options: { 'output.field': fieldRenderer } }))
    expect(snippet).toContain('type="text"')
    expect(snippet).toMatch(/\$\{\d/)
  })

  it('escapes characters that mean something in snippets', () => {
    expect(toSnippet(String.raw`cost $5 } \ end`)).toBe(String.raw`cost \$5 \} \\ end$0`)
  })

  it('expands JSX with className', () => {
    expect(expand('div.card>img', { type: 'markup', syntax: 'jsx', options: { 'jsx.enabled': true } })).toContain('className="card"')
  })
})

describe('isMarkupPosition', () => {
  it('is false inside an open tag, style and script', () => {
    expect(isMarkupPosition('<div class="a')).toBe(false)
    expect(isMarkupPosition('<style>\n.a { color: red; }\n')).toBe(false)
    expect(isMarkupPosition('<script>\nconst x = 1\n')).toBe(false)
  })
  it('is true in the body, also after style and script blocks', () => {
    expect(isMarkupPosition('<body>\n')).toBe(true)
    expect(isMarkupPosition('<style>a{}</style>\n<script>1</script>\n<div>')).toBe(true)
  })
})

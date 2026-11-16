// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { extractTextContent } from './vendor/apps/web/preload/script/api/elements/text-content'

describe('visual editor text extraction', () => {
  it('preserves decoded text, angle brackets, ampersands and Unicode', () => {
    const el = document.createElement('div')
    el.textContent = '<script>alert("x")</script> & <scr<script>ipt> è 😀'
    expect(extractTextContent(el)).toBe(el.textContent)
    expect(el.children).toHaveLength(0)
  })

  it('preserves consecutive and trailing breaks and nested text, ignoring comments', () => {
    const el = document.createElement('div')
    const span = document.createElement('span')
    span.textContent = 'nested & text'
    el.append('first', document.createElement('br'), document.createElement('br'), span,
      document.createComment('hidden'), document.createElement('br'))
    expect(extractTextContent(el)).toBe('first\n\nnested & text\n')
  })

  it('reads an empty element without accessing or parsing HTML', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'innerHTML', {
      get() { throw new Error('HTML serialization is forbidden') },
      set() { throw new Error('HTML parsing is forbidden') },
    })
    expect(extractTextContent(el)).toBe('')
    el.append('<script', document.createElement('br'), '&lt;')
    expect(extractTextContent(el)).toBe('<script\n&lt;')
  })
})

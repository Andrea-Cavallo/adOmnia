import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdownDoc'
import { renderSafeHtml } from './markdownHtml'

const keep = { url: (value: string) => value }
const NL = String.fromCharCode(10)

function headingId(markdown: string): string {
  const html = renderMarkdown(markdown + NL)
  const match = html.match(/<h1 id="([^"]*)"/)
  expect(match, html).not.toBeNull()
  return match![1]
}

describe('repeated sanitization', () => {
  it('removes nested comments completely instead of leaving a new one behind', () => {
    expect(renderSafeHtml('<!<!-- x -->-- y --><b>ok</b>', keep)).toBe('<b>ok</b>')
  })

  it('builds heading ids without tags: only letters, digits, spaces turned into dashes', () => {
    expect(headingId('# Hello <b>World</b>')).toBe('hello-world')
    const hostile = headingId('# a"onmouseover=x<scr<b>ipt>y <<i>b>z')
    expect(hostile.replace(/[a-z0-9-]/g, '')).toBe('')
    expect(hostile).not.toContain('script')
  })

  it('strips tags in linear time even with many "<" and no closing ">"', () => {
    const started = performance.now()
    const id = headingId('# ' + '<'.repeat(50_000))
    expect(performance.now() - started).toBeLessThan(500)
    expect(id).toBe('section') // no usable characters left: the slug falls back to its default
    expect(headingId('# a<b>c<i>d' + '<'.repeat(50_000) + 'e')).toBe('acde')
  })
})

import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdownDoc'
import { renderSafeHtml } from './markdownHtml'

const readme = `<p align="center">

<img src="docs/screenshots/banner.png" alt="adOmnia" width="100%">

</p>

<p align="center">

<strong>Un IDE de Go.</strong><br>

Escribe el servicio.

</p>

## Título
`

describe('raw HTML in Markdown', () => {
  it('renders a GitHub-style centered header instead of showing its tags', () => {
    const html = renderMarkdown(readme, 'README.es-ES.md')
    expect(html).not.toContain('&lt;p')
    expect(html).not.toContain('&lt;img')
    expect(html).toContain('text-align:center')
    expect(html).toContain('<img src="file://')
    expect(html).toContain('alt="adOmnia"')
    expect(html).toContain('<strong>Un IDE de Go.</strong><br />')
    expect(html).toContain('Título')
  })

  it('drops scripts, event handlers and javascript: URLs but keeps their text readable', () => {
    const html = renderSafeHtml('<p onclick="x()"><script>alert(1)</script><a href="javascript:alert(1)">go</a><iframe src="//evil"></iframe></p>', { url: (value) => (value.startsWith('javascript:') ? '#' : value) })
    expect(html).not.toMatch(/<script|<iframe|onclick/i)
    expect(html).toContain('href="#"')
    expect(html).toContain('alert(1)')
  })

  it('closes what it opens and ignores stray closing tags', () => {
    expect(renderSafeHtml('<div><p>hi</div></span>', { url: (value) => value })).toMatch(/^<div><p[^>]*>hi<\/p><\/div>$/)
  })

  it('leaves code fences alone', () => {
    const html = renderMarkdown('```html\n<p align="center">x</p>\n```\n', 'a.md')
    expect(html).toContain('&lt;p align=&quot;center&quot;&gt;')
  })
})

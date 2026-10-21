import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdownDoc'

/**
 * Corpus di accettazione per le sintassi Yuque richieste (MULTILANGUAGE-IDE 7.6). Ogni voce dice
 * cosa deve restare vero nel renderer: le sintassi supportate producono il markup atteso, quelle
 * non supportate restano testo leggibile (mai HTML eseguito) e sono elencate in
 * `docs/CODE-STUDIO.md` come differenze dichiarate.
 */
describe('Yuque markdown corpus', () => {
  it('renders callout containers with sanitized inline content', () => {
    const html = renderMarkdown(':::info\nServer **ready** in 2s\n:::\n\n:::warning\nCheck `PORT` and <script>alert(1)</script>\n:::')
    expect(html).toContain('rounded-md border border-accent/40')
    expect(html).toContain('<strong')
    expect(html).toContain('border-warning/40')
    expect(html).toContain('Check <code')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps an unknown or unclosed container readable', () => {
    expect(renderMarkdown(':::custom\nhello\n:::')).toContain('Custom')
    const unclosed = renderMarkdown(':::danger\nstill open')
    expect(unclosed).toContain('border-danger/40')
    expect(unclosed).toContain('still open')
  })

  it('renders ==highlight== as a mark, not as HTML', () => {
    const html = renderMarkdown('This is ==important== and <b>bold</b>')
    expect(html).toContain('<mark class="rounded bg-warning/25')
    expect(html).toContain('important')
    expect(html).toContain('&lt;b&gt;bold')
  })

  it('gives headings stable ids for internal links and TOC', () => {
    const html = renderMarkdown('# Installazione rapida\n\n## Città e Paesi\n\n## Città e Paesi')
    expect(html).toContain('id="installazione-rapida"')
    expect(html).toContain('id="citta-e-paesi"')
    expect(html).toContain('id="citta-e-paesi-1"')
  })

  it('keeps the syntaxes it does not support as visible text', () => {
    const html = renderMarkdown('[TOC]\n\nInline math $a+b$ stays text.\n\nNote[^1]\n\n[^1]: footnote')
    expect(html).toContain('[TOC]')
    expect(html).toContain('$a+b$')
    expect(html).toContain('[^1]')
    expect(html).not.toContain('<math')
  })

  it('keeps sanitization and safe links in every supported extension', () => {
    const html = renderMarkdown(':::note\n[click](javascript:alert(1))\n:::\n\n==<img src=x onerror=alert(1)>==')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})

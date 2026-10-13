import { describe, expect, it } from 'vitest'
import { htmlPreviewDocument } from './GoStudioHtmlView'

describe('htmlPreviewDocument', () => {
  it('blocks network resources by default while keeping inline HTML runnable', () => {
    const preview = htmlPreviewDocument('<html><head><title>x</title></head><body><script>window.ok=true</script></body></html>', false)
    expect(preview).toContain("connect-src 'none'")
    expect(preview).toContain("script-src 'unsafe-inline'")
    expect(preview.indexOf('Content-Security-Policy')).toBeLessThan(preview.indexOf('<title>'))
  })

  it('allows web requests only in the explicit network mode', () => {
    const preview = htmlPreviewDocument('<h1>Hello</h1>', true)
    expect(preview).toContain('connect-src http: https: ws: wss:')
    expect(preview).toContain('<body><h1>Hello</h1></body>')
  })
})

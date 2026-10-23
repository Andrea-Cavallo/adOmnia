import { describe, expect, it } from 'vitest'
import { decodeEntities } from './XmlToolsPanel'

describe('XML entity decoding', () => {
  it('decodes in a single pass: &amp;lt; is the text "&lt;", not "<"', () => {
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;')
    expect(decodeEntities('&amp;amp;')).toBe('&amp;')
  })

  it('decodes the five named entities and numeric references', () => {
    expect(decodeEntities('&lt;a href=&quot;x&quot;&gt;it&apos;s &amp; ok&lt;/a&gt;')).toBe('<a href="x">it\'s & ok</a>')
    expect(decodeEntities('&#65;&#x42;&#x1F600;')).toBe('AB\u{1F600}')
  })

  it('keeps references that are not valid code points as they are', () => {
    expect(decodeEntities('&#99999999;&#xFFFFFFF;')).toBe('&#99999999;&#xFFFFFFF;')
  })
})

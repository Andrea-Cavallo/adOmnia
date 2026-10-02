import { describe, expect, it } from 'vitest'
import { isExternalMarkdownAsset, localMarkdownAssets, resolveMarkdownAssetPath, substituteMarkdownAssets } from './goStudioMarkdownAssets'

describe('goStudioMarkdownAssets', () => {
  it('classifies external and local sources', () => {
    expect(isExternalMarkdownAsset('https://x/y.png')).toBe(true)
    expect(isExternalMarkdownAsset('data:image/png;base64,AAAA')).toBe(true)
    expect(isExternalMarkdownAsset('images/a.png')).toBe(false)
  })

  it('resolves relative paths against the markdown file', () => {
    expect(resolveMarkdownAssetPath('docs/readme.md', 'img/a.png')).toBe('docs/img/a.png')
    expect(resolveMarkdownAssetPath('docs/readme.md', '../assets/a.png')).toBe('assets/a.png')
    expect(resolveMarkdownAssetPath('readme.md', '../../outside.png')).toBeNull()
    expect(resolveMarkdownAssetPath('readme.md', 'https://x/a.png')).toBeNull()
    expect(resolveMarkdownAssetPath('readme.md', 'img/a%20b.png')).toBe('img/a b.png')
  })

  it('lists local images without duplicates', () => {
    const markdown = '![a](img/a.png)\n![b](img/a.png)\n![c](https://x/c.png)\n![d](img/d.png "title")'
    expect(localMarkdownAssets(markdown, 'docs/readme.md')).toEqual([
      { raw: 'img/a.png', relative: 'docs/img/a.png' },
      { raw: 'img/d.png', relative: 'docs/img/d.png' },
    ])
  })

  it('substitutes only known assets', () => {
    const assets = new Map([['img/a.png', 'data:image/png;base64,AAAA']])
    const result = substituteMarkdownAssets('![a](img/a.png) and ![b](img/b.png)', assets)
    expect(result).toContain('![a](data:image/png;base64,AAAA)')
    expect(result).toContain('![b](img/b.png)')
  })
})

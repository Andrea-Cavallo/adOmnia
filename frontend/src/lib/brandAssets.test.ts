import { describe, expect, it } from 'vitest'
import { getAppIconForTheme } from './brandAssets'

describe('getAppIconForTheme', () => {
  it('keeps the default aO mark when no theme has been selected yet', () => {
    expect(getAppIconForTheme('')).toBe('/icon.png')
    expect(getAppIconForTheme()).toBe('/icon.png')
  })

  it('uses the themed marks only for skins that provide one', () => {
    expect(getAppIconForTheme('builtin-win95')).toBe('/icon95.png')
    expect(getAppIconForTheme('builtin-sketch')).toBe('/icon-sketch.png')
    expect(getAppIconForTheme('custom-theme')).toBe('/icon.png')
  })
  it('keeps the mark visible on light and dark surfaces, including custom themes', () => {
    expect(getAppIconForTheme('builtin-light')).toBe('/icon-black.png')
    expect(getAppIconForTheme('builtin-dark')).toBe('/icon-white.png')
    expect(getAppIconForTheme('custom-theme', 'light')).toBe('/icon-black.png')
    expect(getAppIconForTheme('custom-theme', 'dark')).toBe('/icon-white.png')
    expect(getAppIconForTheme('builtin-win95', 'light')).toBe('/icon95.png')
  })
})

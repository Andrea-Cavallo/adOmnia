import { describe, expect, it } from 'vitest'
import { accentTokens, contrast, validAccent } from './accentPalette'
describe('custom accent palette', () => {
  it.each(['#000000','#ffffff','#a78bfa','#facc15','#fb923c','#0891b2','#888888'])('keeps %s readable across modes', color => {
    for (const mode of ['dark','light'] as const) {
      const tokens = accentTokens(color, mode)
      expect(contrast(tokens.accent, mode === 'dark' ? '#11171D' : '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(tokens.accent, tokens['on-accent'])).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('ignores malformed persisted values', () => {
    for (const value of ['', 'red', '#fff', '#gggggg', 'var(--accent)']) {
      expect(validAccent(value)).toBe(false)
      expect(accentTokens(value, 'dark')).toEqual({})
    }
    expect(validAccent(undefined)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { personalColors, normalizeProfiles } from './personalAppearance'
import { contrast, validAccent } from './accentPalette'
import { BUILTIN_THEME_FALLBACKS } from './builtinThemeFallbacks'

describe('personal appearance', () => {
  it.each([
    '#000000',
    '#FFFFFF',
    '#101827',
    '#FACC15',
    '#777777',
    '#888888',
    '#663399',
  ])('keeps text and actions readable on base %s', (baseColor) => {
    for (const accentColor of [
      '#FFFFFF',
      '#000000',
      '#FACC15',
      '#888888',
      '#EF4444',
    ]) {
      const theme = BUILTIN_THEME_FALLBACKS[0]
      const tokens = personalColors(
        theme.colors,
        { baseColor, accentColor },
        'dark',
      )
      expect(tokens['surface-0'].toUpperCase()).toBe(baseColor)
      for (let i = 0; i <= 4; i++) {
        const surface = tokens[`surface-${i}`]
        for (let text = 1; text <= 4; text++)
          expect(
            contrast(tokens[`text-${text}`], surface),
          ).toBeGreaterThanOrEqual(4.5)
        expect(contrast(tokens.accent, surface)).toBeGreaterThanOrEqual(4.5)
      }
      expect(
        contrast(tokens.accent, tokens['on-accent']),
      ).toBeGreaterThanOrEqual(4.5)
      expect(validAccent(tokens['accent-dark'])).toBe(true)
      expect(tokens.error).toBe(theme.colors.error)
    }
  })
  it('preserves theme tokens without overrides and handles non-hex theme accents', () => {
    const theme = BUILTIN_THEME_FALLBACKS[0]
    expect(personalColors(theme.colors, {}, 'dark')).toEqual(theme.colors)
    const derived = personalColors(
      { ...theme.colors, accent: 'oklch(70% .2 155)' },
      { baseColor: '#FFFFFF' },
      'dark',
    )
    expect(
      contrast(derived.accent, derived['surface-4']),
    ).toBeGreaterThanOrEqual(4.5)
  })
  it('rejects malformed profiles and duplicate ids without losing valid profiles', () => {
    const profile = {
      id: 'one',
      name: '  Yellow  ',
      themeId: 'builtin-dark',
      accentColor: '#FACC15',
      baseColor: 'bad',
    }
    expect(
      normalizeProfiles([
        null,
        {},
        profile,
        profile,
        { ...profile, id: 'two', name: '' },
      ]),
    ).toEqual([{ ...profile, name: 'Yellow', baseColor: undefined }])
    expect(normalizeProfiles(undefined)).toEqual([])
    expect(normalizeProfiles({ profiles: [] })).toEqual([])
    expect(
      normalizeProfiles(
        Array.from({ length: 60 }, (_, i) => ({ ...profile, id: String(i) })),
      ),
    ).toHaveLength(50)
  })
})

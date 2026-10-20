import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_HUB_LAYOUT, moveTile, parseHubLayout, loadHubLayout, saveHubLayout } from './hubLayout'

describe('hubLayout', () => {
  it('defaults older layouts and unknown logo styles to the classic logo', () => {
    expect(parseHubLayout('{"tiles":[],"todaySide":"left"}')).toEqual({ tiles: [], todaySide: 'left', logo: 'classic' })
    expect(parseHubLayout('{"tiles":[],"logo":"unknown"}').logo).toBe('classic')
  })
  it('restores the chosen logo with the rest of the saved layout', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    try {
      const layout = { ...DEFAULT_HUB_LAYOUT, logo: 'pixel' as const }
      saveHubLayout(layout)
      expect(loadHubLayout()).toEqual(layout)
      saveHubLayout({ ...layout, logo: 'classic' })
      expect(loadHubLayout().logo).toBe('classic')
    } finally { vi.unstubAllGlobals() }
  })
  it('moves tiles immutably and clamps the target', () => {
    const list = ['a', 'b', 'c']
    expect(moveTile(list, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveTile(list, 2, -5)).toEqual(['c', 'a', 'b'])
    expect(list).toEqual(['a', 'b', 'c'])
  })

  it('parses saved layouts, dropping unknown, excluded and duplicate tiles', () => {
    expect(parseHubLayout(JSON.stringify({ tiles: ['kafka', 'mock', 'nope', 'welcome', 'mock'], todaySide: 'left' })))
      .toEqual({ tiles: ['broker', 'mock'], todaySide: 'left', logo: 'classic' })
    expect(parseHubLayout('{bad')).toBe(DEFAULT_HUB_LAYOUT)
    expect(parseHubLayout(null)).toBe(DEFAULT_HUB_LAYOUT)
  })
})

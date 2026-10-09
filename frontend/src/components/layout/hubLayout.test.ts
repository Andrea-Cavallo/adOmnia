import { describe, expect, it } from 'vitest'
import { DEFAULT_HUB_LAYOUT, moveTile, parseHubLayout } from './hubLayout'

describe('hubLayout', () => {
  it('moves tiles immutably and clamps the target', () => {
    const list = ['a', 'b', 'c']
    expect(moveTile(list, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveTile(list, 2, -5)).toEqual(['c', 'a', 'b'])
    expect(list).toEqual(['a', 'b', 'c'])
  })

  it('parses saved layouts, dropping unknown, excluded and duplicate tiles', () => {
    expect(parseHubLayout(JSON.stringify({ tiles: ['kafka', 'mock', 'nope', 'welcome', 'mock'], todaySide: 'left' })))
      .toEqual({ tiles: ['broker', 'mock'], todaySide: 'left' })
    expect(parseHubLayout('{bad')).toBe(DEFAULT_HUB_LAYOUT)
    expect(parseHubLayout(null)).toBe(DEFAULT_HUB_LAYOUT)
  })
})

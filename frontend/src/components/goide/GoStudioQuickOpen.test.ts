import { describe, expect, it } from 'vitest'
import { quickOpenIndex } from './GoStudioQuickOpen'

describe('Quick Open keyboard', () => {
  it('moves the highlight with the arrows and wraps', () => {
    expect(quickOpenIndex(0, 'ArrowDown', 3)).toBe(1)
    expect(quickOpenIndex(2, 'ArrowDown', 3)).toBe(0)
    expect(quickOpenIndex(0, 'ArrowUp', 3)).toBe(2)
    expect(quickOpenIndex(1, 'Home', 3)).toBe(0)
    expect(quickOpenIndex(0, 'End', 3)).toBe(2)
  })

  it('stays in range when the results shrink or are empty', () => {
    expect(quickOpenIndex(5, 'x', 2)).toBe(1)
    expect(quickOpenIndex(3, 'ArrowDown', 0)).toBe(0)
  })
})

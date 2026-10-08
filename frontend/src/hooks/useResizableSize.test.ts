import { describe, expect, it } from 'vitest'
import { clampSize } from './useResizableSize'

describe('clampSize', () => {
  it('keeps the size between min and the window share', () => {
    expect(clampSize(100, 240, 0.4, 1000)).toBe(240)
    expect(clampSize(900, 240, 0.4, 1000)).toBe(400)
    expect(clampSize(320.4, 240, 0.4, 1000)).toBe(320)
  })

  it('never goes below min on a tiny window', () => {
    expect(clampSize(500, 240, 0.4, 300)).toBe(240)
  })
})

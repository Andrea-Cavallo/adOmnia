import { describe, expect, it } from 'vitest'
import { shareRect } from './hubSpriteSheet'

describe('animation frame normalization', () => {
  it('shares local body bounds while preserving each source cell', () => {
    const rects = [{ x: 10, y: 15, w: 65, h: 75 }, { x: 108, y: 17, w: 70, h: 72 }]
    shareRect(rects, [0, 1], 100, 100)
    expect(rects[0]).toEqual({ x: 8, y: 15, w: 70, h: 75 })
    expect(rects[1]).toEqual({ x: 108, y: 15, w: 70, h: 75 })
    expect(rects[0].x).not.toBe(rects[1].x)
  })
})

import { describe, expect, it } from 'vitest'
import { keyMagenta } from './deskAssets'

describe('desk sprite transparency', () => {
  it('removes the key while preserving white paper, cyan eyes and amber armour', () => {
    const pixels = new Uint8ClampedArray([255, 0, 255, 255, 238, 242, 255, 255, 30, 220, 255, 255, 230, 160, 40, 255])
    keyMagenta(pixels)
    expect(pixels[3]).toBe(0)
    expect(Array.from(pixels.slice(4))).toEqual([238, 242, 255, 255, 30, 220, 255, 255, 230, 160, 40, 255])
  })
  it('despills partially transparent edges instead of leaving pink fringes', () => {
    const pixels = new Uint8ClampedArray([180, 90, 180, 255])
    keyMagenta(pixels)
    expect(pixels[3]).toBeGreaterThan(0)
    expect(pixels[3]).toBeLessThan(255)
    expect(pixels[0] - pixels[1]).toBeLessThanOrEqual(35)
  })
})

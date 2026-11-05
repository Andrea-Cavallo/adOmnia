import { describe, expect, it } from 'vitest'
import { laserTint } from './HubLaser'

const blue = laserTint('#3f52ff')

describe('laserTint', () => {
  it('keeps an accent with a hue of its own', () => {
    expect(laserTint('#ff0000')).toEqual([1, 0, 0])
  })
  it('falls back to blue on a white or silver accent, or a missing one', () => {
    for (const accent of ['#ffffff', '#e6e8ec', undefined, 'oklch(70% .2 155)']) expect(laserTint(accent)).toEqual(blue)
  })
})

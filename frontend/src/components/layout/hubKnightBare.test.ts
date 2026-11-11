import { describe, expect, it } from 'vitest'
import { bareColor } from './hubKnightBare'

describe('knight without armor', () => {
  it('turns grey steel into linen and keeps its shading', () => {
    const light = bareColor(180, 185, 190)
    const dark = bareColor(90, 92, 96)
    expect(light[0]).toBeGreaterThan(light[2])
    expect(light[0]).toBeGreaterThan(dark[0])
  })

  it('gives the head a skin tone instead of linen', () => {
    const head = bareColor(180, 185, 190, true)
    expect(head[0] - head[2]).toBeGreaterThan(80)
  })

  it('keeps the red cape (even its dark folds), the gold trim and the dark outline', () => {
    expect(bareColor(70, 48, 52)).toEqual([70, 48, 52])
    expect(bareColor(170, 30, 30)).toEqual([170, 30, 30])
    expect(bareColor(220, 170, 60)).toEqual([220, 170, 60])
    expect(bareColor(20, 18, 22)).toEqual([20, 18, 22])
  })
})

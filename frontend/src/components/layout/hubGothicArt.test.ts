import { describe, expect, it } from 'vitest'
import { gothicKnightFrame } from './hubGothicArt'
import { newRun } from './hubRunRules'

describe('gothic knight animation', () => {
  const state = newRun(360, 180, () => 0.5)

  it('uses the standing pose when the knight is grounded and stationary', () => {
    expect(gothicKnightFrame(state, 1)).toBe(0)
  })

  it('cycles running frames in both directions', () => {
    for (const vx of [-90, 90]) {
      const running = { knight: { ...state.knight, vx } }
      expect([0, 0.1, 0.2, 0.3].map((time) => gothicKnightFrame(running, time))).toEqual([1, 2, 3, 1])
    }
  })

  it('distinguishes jumping from falling', () => {
    expect(gothicKnightFrame({ knight: { ...state.knight, grounded: false, vy: -10 } }, 1)).toBe(4)
    expect(gothicKnightFrame({ knight: { ...state.knight, grounded: false, vy: 10 } }, 1)).toBe(5)
  })

  it('uses the extended-hand pose for a throw instead of a melee slash', () => {
    expect(gothicKnightFrame({ knight: { ...state.knight, throwing: 0.2 } }, 1)).toBe(6)
  })

  it('keeps the blade attached to the knight throughout a melee attack', () => {
    expect(gothicKnightFrame({ knight: { ...state.knight, attack: 0.02 } }, 1)).toBe(7)
    expect(gothicKnightFrame({ knight: { ...state.knight, attack: 0.15 } }, 1)).toBe(7)
  })
})

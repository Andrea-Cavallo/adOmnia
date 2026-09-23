import { expect, it } from 'vitest'
import { heroPose, stepHeroAnimation } from './heroAnimation'
import type { PlayerVisual } from './visuals'
const player = (): PlayerVisual => ({ x: 10, y: 412, w: 34, h: 48, vx: 0, vy: 0, grounded: true, facing: 1, invulnerable: 0, squash: 0 })
it('advances footsteps with speed without changing collision or movement', () => {
  const p = player(); p.vx = 310
  stepHeroAnimation(p, .1)
  expect(p.stride).toBeCloseTo(1.5)
  expect([p.x, p.y, p.w, p.h, p.vx]).toEqual([10, 412, 34, 48, 310])
  p.vx = 0; stepHeroAnimation(p, .1); expect(p.stride).toBeCloseTo(1.5)
})
it('becomes curious only after a safe idle and stops when danger arrives', () => {
  const p = player()
  for (let i = 0; i < 240; i++) stepHeroAnimation(p, 1 / 60)
  expect(heroPose(p, false).curious).toBe(true)
  p.danger = true; stepHeroAnimation(p, 1 / 60)
  expect(p.idleTime).toBe(0)
  expect(heroPose(p, false).curious).toBe(false)
})
it('suppresses decorative motion with gentle effects while preserving action poses', () => {
  const p = player(); Object.assign(p, { recoil: 1, squash: .28, celebrate: 1, lean: .06 })
  expect(heroPose(p, true)).toMatchObject({ cell: 3, xScale: 1, yScale: 1, rotation: 0, lift: 0, recoil: 0, curious: false })
  stepHeroAnimation(p, .2); expect(p.recoil).toBe(0)
})

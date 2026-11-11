import { describe, expect, it } from 'vitest'
import { stepBones, BONE_WINDUP } from './hubRunBones'
import { blankEnemy } from './hubRunEnemies'
import { startCemeteryRun, stepCemeteryRun } from './hubRunCemetery'
import { groundHeightAt, type RunInput } from './hubRunRules'

const dt = 1 / 60
const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }
const setup = () => {
  const state = startCemeteryRun(464, 218), floor = groundHeightAt(state, 200)!
  state.knight = { ...state.knight, x: 200, y: floor, grounded: true }
  state.enemies = [{ ...blankEnemy(100, 'bonecaster', 350, floor - 16), awake: true, age: 2 }]
  return state
}

describe('bone throwing zombies', () => {
  it('raises its arm before throwing toward the knight and pauses between throws', () => {
    let state = stepBones(setup(), dt)
    expect(state.enemies[0]).toMatchObject({ bossPhase: 'warn', timer: BONE_WINDUP, facing: -1 })
    expect(state.hazards).toHaveLength(0)
    for (let i = 0; i < 38; i++) state = stepBones(state, dt)
    expect(state.hazards).toHaveLength(1)
    expect(state.hazards![0]).toMatchObject({ kind: 'bone', vx: -135 })
    expect(state.enemies[0].timer).toBeGreaterThan(1)
  })

  it('does not throw from off screen or directly against the knight', () => {
    for (const x of [225, 600]) {
      let state = setup(); state.enemies[0].x = x
      for (let i = 0; i < 180; i++) state = stepBones(state, dt)
      expect(state.hazards).toHaveLength(0)
    }
  })

  it('hits a standing knight, while a real jump or crouch avoids the same bone', () => {
    for (const dodge of ['stand', 'jump', 'crouch']) {
      let state = setup(); state.enemies = []
      state.hazards = [{ id: 90, kind: 'bone', x: 160, y: state.knight.y - 29, vx: 135, vy: 0, life: 2 }]
      for (let i = 0; i < 28; i++) state = stepCemeteryRun(state, { ...idle, jump: dodge === 'jump' && i === 0, jumpHeld: dodge === 'jump', crouch: dodge === 'crouch' }, dt)
      expect(state.stage!.armor, dodge).toBe(dodge === 'stand' ? 0 : 1)
    }
  })
})

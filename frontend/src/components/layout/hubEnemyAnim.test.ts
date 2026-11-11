import { describe, expect, it } from 'vitest'
import { ENEMY_ANIM, enemyAnimState, enemyPose } from './hubEnemyAnim'
import { blankEnemy, stepEnemy } from './hubRunEnemies'
import { startRun, groundY, type Enemy, type RunState } from './hubRunRules'

const W = 562
const H = 120
const TOP = groundY(H)
const seeded = (seed: number) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const flat = (extra: Partial<RunState> = {}): RunState => ({
  ...startRun(W, H, seeded(1)), ground: [{ x0: -500, x1: 100000 }], platforms: [], coins: [], enemies: [], builtTo: 100000, ...extra,
})
const walker = (extra: Partial<Enemy> = {}): Enemy => ({ ...blankEnemy(1, 'zombie', 200, TOP - 16), awake: true, vx: 18, stride: 0, ...extra })

describe('walk cycles', () => {
  it('is driven by distance walked, not by the clock', () => {
    const state = flat()
    const enemy = walker()
    const start = enemyPose(state, enemy, 0)
    const later = enemyPose(state, enemy, 5)
    expect(start.state).toBe('walk')
    expect(later).toMatchObject({ frame: start.frame, bob: start.bob, cycle: start.cycle })
    const stepped = enemyPose(state, { ...enemy, stride: ENEMY_ANIM.zombie.cyclePx / 2 }, 0)
    expect(stepped.cycle).toBeCloseTo(0.5, 5)
    expect(stepped.frame).not.toBe(start.frame)
  })

  it('advances the cycle with the ground covered, whatever the speed', () => {
    const state = flat()
    const slow = stepEnemy(state, walker({ vx: 10 }), 0.5)
    const fast = stepEnemy(state, walker({ vx: 40 }), 0.5)
    expect(fast.stride ?? 0).toBeGreaterThan(slow.stride ?? 0)
    expect(enemyPose(state, fast, 0).cycle).not.toBeCloseTo(enemyPose(state, slow, 0).cycle, 3)
  })

  it('rides high while the legs pass and sinks as the feet plant wide', () => {
    const state = flat()
    const cyclePx = ENEMY_ANIM.armored.cyclePx
    const crossing = enemyPose(state, walker({ kind: 'armored', stride: 0 }), 0)
    const planted = enemyPose(state, walker({ kind: 'armored', stride: cyclePx / 4 }), 0)
    expect(crossing.bob).toBeLessThan(-1)
    expect(planted.bob).toBeCloseTo(0, 5)
    expect(enemyPose(state, walker({ kind: 'armored', stride: cyclePx / 4, facing: -1 }), 0).rock)
      .toBeCloseTo(-planted.rock, 5)
  })

  it('holds the neutral frame when it stands still', () => {
    const state = flat()
    const standing = walker({ vx: 0, stride: 17 })
    expect(enemyAnimState(state, standing)).toBe('idle')
    expect(enemyPose(state, standing, 1).cycle).toBe(0)
  })

  it('flaps a flyer on the clock, because the air gives no ground to step on', () => {
    const state = flat()
    const bat = { ...blankEnemy(2, 'bat', 200, TOP - 40), awake: true, vx: 30, stride: 0 }
    const first = enemyPose(state, bat, 0)
    const later = enemyPose(state, bat, 0.2)
    expect(first.state).toBe('walk')
    expect(later.cycle).not.toBeCloseTo(first.cycle, 5)
  })
})

describe('the stride the renderer reads', () => {
  it('adds the ground an awake enemy covers, and nothing while it sleeps', () => {
    const state = flat()
    const sleeping = blankEnemy(3, 'zombie', 200, TOP - 16)
    expect(stepEnemy(state, sleeping, 1 / 60).stride).toBe(0)

    const moving = walker()
    const stepped = stepEnemy(state, moving, 0.5)
    expect(stepped.x).toBeGreaterThan(moving.x)
    expect(stepped.stride).toBeCloseTo(stepped.x - moving.x, 5)
  })
})

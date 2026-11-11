import { describe, expect, it } from 'vitest'
import { blankEnemy } from './hubRunEnemies'
import { enemyRadius } from './hubRunModel'
import { LEVEL_REGION_LENGTH, levelElevationAt, levelRegionAt } from './hubRunLevel'
import { groundHeightAt, groundY, resizeRun, startRun, stepRun, type RunInput, type RunState } from './hubRunRules'

const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }
const flat = (): RunState => ({ ...startRun(360, 180, () => 0.5), ground: [{ x0: -100, x1: 10000 }], builtTo: 10000, platforms: [], coins: [], enemies: [], bossIn: 10000 })

describe('gothic level progression', () => {
  it('changes region with world distance and blends before each boundary', () => {
    expect(levelRegionAt(0)).toMatchObject({ id: 'cemetery', blend: 0 })
    expect(levelRegionAt(LEVEL_REGION_LENGTH - 70)).toMatchObject({ id: 'cemetery', next: 1, blend: 0.5 })
    expect(levelRegionAt(LEVEL_REGION_LENGTH)).toMatchObject({ id: 'forest', blend: 0 })
    expect(levelRegionAt(LEVEL_REGION_LENGTH * 2).id).toBe('abbey')
  })

  it('has connected uphill and downhill ground instead of a single flat floor', () => {
    const heights = Array.from({ length: 12 }, (_, index) => levelElevationAt(260 + index * 150))
    expect(heights.some((height, i) => i > 0 && height < heights[i - 1])).toBe(true)
    expect(heights.some((height, i) => i > 0 && height > heights[i - 1])).toBe(true)
    expect(levelElevationAt(260)).toBe(0)
  })

  it('keeps the knight grounded while walking uphill and downhill', () => {
    let state = flat()
    const top = groundY(state.height)
    state = { ...state, ground: [{ x0: -100, x1: 50 }, { x0: 50, x1: 200, y0: top, y1: top - 32 }, { x0: 200, x1: 400, y0: top - 32, y1: top + 12 }, { x0: 400, x1: 10000, y0: top + 12, y1: top + 12 }] }
    for (let index = 0; index < 240; index++) {
      state = stepRun(state, { ...idle, right: true }, 1 / 60)
      expect(state.knight.grounded).toBe(true)
      expect(state.knight.y).toBeCloseTo(groundHeightAt(state, state.knight.x)!)
    }
    expect(state.knight.x).toBeGreaterThan(400)
  })

  it('moves shaped ground and its residents together when resized', () => {
    const state = { ...flat(), ground: [{ x0: 0, x1: 200, y0: 120, y1: 150 }] }
    expect(resizeRun(state, 500, 220).ground[0]).toMatchObject({ y0: 160, y1: 190 })
  })

  it('sends a varied cast past the safe opening, with never two ghosts or reapers at once', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const state = startRun(6000, 180, random)
    const kinds = new Set(state.enemies.map((enemy) => enemy.kind))
    for (const kind of ['zombie', 'bat'] as const) expect(kinds.has(kind)).toBe(true)
    expect(state.enemies.filter((enemy) => enemy.kind === 'zombie').every((enemy) => enemy.x > 260)).toBe(true)
    expect(state.enemies.filter((enemy) => enemy.kind === 'ghost' || enemy.kind === 'reaper').length).toBeLessThanOrEqual(1)
  })

  it('lets a melee sword kill a nearby zombie and leaves distant enemies alive', () => {
    const state = flat()
    state.enemies = [{ ...blankEnemy(800, 'zombie', 65, groundY(180) - 16), awake: true }, { ...blankEnemy(801, 'zombie', 180, groundY(180) - 16), awake: true }]
    let next = stepRun(state, { ...idle, attack: true }, 0.02)
    next = stepRun(next, idle, 0.04)
    expect(next.enemies.some((enemy) => enemy.id === 800)).toBe(false)
    expect(next.enemies.some((enemy) => enemy.id === 801)).toBe(true)
  })

  it('spawns walkers on ground, flyers above it, and never two enemies on one spot', () => {
    for (const seedStart of [3, 7, 11, 42, 99]) {
      let seed = seedStart
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
      const state = startRun(8000, 180, random)
      for (const enemy of state.enemies) {
        const r = enemyRadius(enemy)
        if (['slime', 'frog', 'zombie'].includes(enemy.kind)) {
          for (const x of [enemy.x - r, enemy.x, enemy.x + r]) expect(groundHeightAt(state, x, 0)).not.toBeNull()
        } else {
          const floor = groundHeightAt(state, enemy.x, 0)
          if (floor !== null) expect(enemy.y + r).toBeLessThanOrEqual(floor - 2)
        }
        for (const other of state.enemies) {
          if (other.id !== enemy.id) expect(Math.abs(other.x - enemy.x) >= 30 || Math.abs(other.y - enemy.y) >= 30).toBe(true)
        }
      }
    }
  })

  it('treats the far side of a pit as a wall, not something to walk through', () => {
    const top = groundY(180)
    let state: RunState = { ...flat(), ground: [{ x0: -100, x1: 100 }, { x0: 140, x1: 10000 }], knight: { ...flat().knight, x: 136, y: top + 20, vx: 95, vy: 0, grounded: false } }
    state = stepRun(state, { ...idle, right: true }, 1 / 60)
    expect(state.knight.x).toBe(136)
  })

  it('drops a fallen knight back on solid ground', () => {
    const top = groundY(180)
    const state: RunState = { ...flat(), ground: [{ x0: -100, x1: 100 }, { x0: 160, x1: 10000 }], knight: { ...flat().knight, x: 130, y: 210, vx: 0, vy: 100, grounded: false, safeX: 162 } }
    const next = stepRun(state, idle, 1 / 60)
    expect(next.hearts).toBe(state.hearts - 1)
    expect(groundHeightAt(next, next.knight.x, 0)).toBe(top)
  })
})

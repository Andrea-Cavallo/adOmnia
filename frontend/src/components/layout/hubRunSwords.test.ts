import { describe, expect, it } from 'vitest'
import { blankEnemy, bossAt } from './hubRunEnemies'
import { groundY, startRun, stepRun, type RunInput, type RunState } from './hubRunRules'

const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }
const flat = (): RunState => ({ ...startRun(360, 180, () => 0.5), ground: [{ x0: -100, x1: 10000 }], builtTo: 10000, platforms: [], coins: [], enemies: [], bossIn: 10000 })

describe('thrown swords', () => {
  it('travels beyond melee range and damages a zombie', () => {
    let state = flat()
    state.enemies = [{ ...blankEnemy(800, 'zombie', 150, groundY(180) - 16), awake: true }]
    state = stepRun(state, { ...idle, throwSword: true }, 1 / 60)
    expect(state.swords).toHaveLength(1)
    expect(state.knight.attack).toBe(-1)
    expect(state.knight.throwing).toBeGreaterThan(0)
    for (let index = 0; index < 30; index++) state = stepRun(state, idle, 1 / 60)
    expect(state.enemies).toHaveLength(0)
    expect(state.swords).toHaveLength(0)
    expect(state.stats.kills).toBe(1)
  })

  it('throws to the left and rate-limits repeated throws', () => {
    let state = flat()
    state.knight.facing = -1
    state = stepRun(state, { ...idle, throwSword: true }, 1 / 60)
    expect(state.swords[0].vx).toBeLessThan(0)
    state = stepRun(state, { ...idle, throwSword: true }, 1 / 60)
    expect(state.swords).toHaveLength(1)
  })

  it('expires missed swords and freezes them when paused', () => {
    let state = stepRun(flat(), { ...idle, throwSword: true }, 1 / 60)
    const paused = { ...state, phase: 'paused' as const }
    expect(stepRun(paused, idle, 0.5)).toBe(paused)
    for (let index = 0; index < 100; index++) state = stepRun(state, idle, 1 / 60)
    expect(state.swords).toHaveLength(0)
  })

  it('takes one hit point from a boss without damaging it repeatedly', () => {
    let state = flat()
    state.enemies = [{ ...bossAt(900, 'skull', 150, groundY(180) - 23), bossPhase: 'warn', timer: 10 }]
    const hp = state.enemies[0].hp
    state = stepRun(state, { ...idle, throwSword: true }, 1 / 60)
    for (let index = 0; index < 40; index++) state = stepRun(state, idle, 1 / 60)
    expect(state.enemies[0].hp).toBe(hp - 1)
    expect(state.swords).toHaveLength(0)
  })
})

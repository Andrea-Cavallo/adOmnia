import { describe, expect, it } from 'vitest'
import {
  ATTACK_REACH, CHAIN_SECONDS, CHAIN_STEP, CHARGE_MAX, COIN_POINTS, GRAVITY, INVULNERABLE_SECONDS, JUMP_SPEED, KILL_POINTS, MAX_HEARTS, PIT_MAX, RUN_SPEED,
  chainMultiplier, groundY, medalFor, meters, newRun, pauseRun, resizeRun, runScore, startRun, stepRun,
  type Enemy, type RunInput, type RunState,
} from './hubRunRules'

const W = 562
const H = 120
const TOP = groundY(H)
const DT = 1 / 30
const idle: RunInput = { left: false, right: false, jumpHeld: false, jump: false, attack: false, special: false }
const seeded = (seed: number) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
/** A run on flat ground with nothing in it but what the test adds. */
const flat = (extra: Partial<RunState> = {}): RunState => ({
  ...startRun(W, H, seeded(1)), ground: [{ x0: -500, x1: 100000 }], platforms: [], coins: [], enemies: [], builtTo: 100000, ...extra,
})
const steps = (state: RunState, seconds: number, input: Partial<RunInput> = {}, each?: (s: RunState) => void) => {
  let current = state
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    current = stepRun(current, { ...idle, ...input }, DT)
    each?.(current)
  }
  return current
}
const enemy = (kind: Enemy['kind'], x: number, y: number, extra: Partial<Enemy> = {}): Enemy =>
  ({ id: 900, kind, x, y, vx: 0, vy: 0, age: 0, awake: true, baseY: y, hop: 99, ...extra })

describe('hub run: the knight', () => {
  it('stands still until a run starts, and pauses and resumes', () => {
    const waiting = newRun(W, H, seeded(1))
    expect(waiting.phase).toBe('idle')
    expect(stepRun(waiting, { ...idle, right: true }, DT)).toBe(waiting)
    const paused = pauseRun(startRun(W, H), true)
    expect(paused.phase).toBe('paused')
    expect(stepRun(paused, { ...idle, right: true }, DT)).toBe(paused)
    expect(pauseRun(paused, false).phase).toBe('playing')
  })
  it('builds the world ahead before the first step, starting on safe ground', () => {
    const run = newRun(W, H, seeded(2))
    expect(run.builtTo).toBeGreaterThanOrEqual(W)
    expect(run.enemies.every((e) => e.x > 260)).toBe(true)
  })
  it('runs with the arrows, up to his top speed, and faces where he goes', () => {
    const right = steps(flat(), 1, { right: true })
    expect(right.knight.x).toBeGreaterThan(40 + RUN_SPEED * 0.7)
    expect(right.knight.vx).toBeCloseTo(RUN_SPEED)
    const left = steps({ ...right, cameraX: 0 }, 0.5, { left: true })
    expect(left.knight.facing).toBe(-1)
  })
  it('never walks back off the left of the screen', () => {
    const run = steps(flat({ cameraX: 100, knight: { ...flat().knight, x: 120 } }), 1, { left: true })
    expect(run.knight.x).toBeGreaterThanOrEqual(108)
  })
  it('jumps higher when the key is held, lower when it is tapped', () => {
    let held = 0
    steps(stepRun(flat(), { ...idle, jump: true, jumpHeld: true }, DT), 1, { jumpHeld: true }, (s) => { held = Math.max(held, TOP - s.knight.y) })
    let tapped = 0
    steps(stepRun(flat(), { ...idle, jump: true, jumpHeld: true }, DT), 1, {}, (s) => { tapped = Math.max(tapped, TOP - s.knight.y) })
    expect(held).toBeGreaterThan(40)
    expect(held).toBeLessThanOrEqual((JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY) + 1)
    expect(tapped).toBeLessThan(held * 0.6)
  })
  it('lands back on the ground and can jump again', () => {
    const landed = steps(stepRun(flat(), { ...idle, jump: true, jumpHeld: true }, DT), 1.2, { jumpHeld: true })
    expect(landed.knight).toMatchObject({ grounded: true, y: TOP })
  })
  it('still jumps just after running off an edge, and remembers a jump pressed just before landing', () => {
    const edge = flat({ ground: [{ x0: -500, x1: 100 }, { x0: 200, x1: 9000 }], knight: { ...flat().knight, x: 104, vx: RUN_SPEED } })
    const offEdge = stepRun(edge, { ...idle, right: true }, DT)
    expect(offEdge.knight.grounded).toBe(false)
    expect(stepRun(offEdge, { ...idle, right: true, jump: true, jumpHeld: true }, DT).knight.vy).toBeLessThan(-JUMP_SPEED * 0.9)
    const falling = flat({ knight: { ...flat().knight, y: TOP - 3, vy: 100, grounded: false } })
    const early = stepRun(falling, { ...idle, jump: true, jumpHeld: true }, DT)
    expect(steps(early, 2 * DT, { jumpHeld: true }).knight.vy).toBeLessThan(0)
  })
  it('lands on a platform from above and walks through it from below', () => {
    const platform = { x0: 20, x1: 80, y: TOP - 30 }
    const above = flat({ platforms: [platform], knight: { ...flat().knight, y: TOP - 40, vy: 50, grounded: false } })
    expect(steps(above, 0.5).knight).toMatchObject({ grounded: true, y: platform.y })
    const below = stepRun(flat({ platforms: [platform] }), { ...idle, jump: true, jumpHeld: true }, DT)
    let highest = TOP
    steps(below, 0.5, { jumpHeld: true }, (s) => { highest = Math.min(highest, s.knight.y) })
    expect(highest).toBeLessThan(platform.y)
  })
  it('can clear the widest pit the world makes at full run', () => {
    const airTime = (2 * JUMP_SPEED) / GRAVITY
    expect(RUN_SPEED * airTime).toBeGreaterThan(PIT_MAX + 12)
    for (let seed = 1; seed <= 30; seed++) {
      let run = startRun(W, H, seeded(seed))
      for (let t = 0; t < 30 && run.phase === 'playing'; t += DT) {
        run = stepRun({ ...run, enemies: [], hearts: MAX_HEARTS }, { ...idle, right: true }, DT, seeded(seed + t))
        for (let i = 0; i + 1 < run.ground.length; i++) expect(run.ground[i + 1].x0 - run.ground[i].x1).toBeLessThanOrEqual(PIT_MAX + 0.01)
      }
    }
  })
})

describe('hub run: falling and getting hurt', () => {
  it('costs a heart to fall into a pit and puts him back on the last ground', () => {
    const pit = flat({ ground: [{ x0: -500, x1: 100 }, { x0: 160, x1: 9000 }], knight: { ...flat().knight, x: 90 } })
    let fell: RunState | null = null
    steps(pit, 3, { right: true }, (s) => { if (!fell && s.events.some((e) => e.type === 'fall')) fell = s })
    expect(fell).not.toBeNull()
    expect(fell!).toMatchObject({ hearts: MAX_HEARTS - 1 })
    expect(fell!.knight).toMatchObject({ grounded: true, y: TOP })
    expect(fell!.knight.x).toBeLessThanOrEqual(100)
    expect(fell!.knight.invulnerable).toBe(INVULNERABLE_SECONDS)
  })
  it('loses a heart on contact, is knocked back, then cannot be hurt for a moment', () => {
    const run = flat({ enemies: [enemy('slime', 46, TOP - 9)], chain: 4, chainLeft: 2, charge: 6 })
    const hit = stepRun(run, idle, DT)
    expect(hit).toMatchObject({ hearts: MAX_HEARTS - 1, chain: 0, charge: 3 })
    expect(hit.knight.vx).toBeLessThan(0)
    expect(stepRun({ ...hit, enemies: [enemy('slime', hit.knight.x, TOP - 9)] }, idle, DT).hearts).toBe(MAX_HEARTS - 1)
  })
  it('ends the run on the last heart', () => {
    const over = stepRun(flat({ hearts: 1, enemies: [enemy('slime', 46, TOP - 9)] }), idle, DT)
    expect(over.phase).toBe('over')
    expect(stepRun(over, idle, DT)).toBe(over)
  })
})

describe('hub run: fighting', () => {
  it('slashes what is in front of him, once per swing', () => {
    const run = flat({ enemies: [enemy('bat', 40 + ATTACK_REACH - 6, TOP - 24)] })
    const swung = steps(stepRun(run, { ...idle, attack: true }, DT), 0.15)
    expect(swung.enemies).toHaveLength(0)
    expect(swung.stats.kills).toBe(1)
    expect(swung.points).toBe(KILL_POINTS)
    expect(swung.hearts).toBe(MAX_HEARTS)
  })
  it('misses what is behind him', () => {
    const run = flat({ enemies: [enemy('bat', 40 - 30, TOP - 60, { vx: 0 })] })
    expect(steps(stepRun(run, { ...idle, attack: true }, DT), 0.1).stats.kills).toBe(0)
  })
  it('stomps an enemy he lands on and bounces off it', () => {
    const run = flat({ knight: { ...flat().knight, y: TOP - 20, vy: 200, grounded: false }, enemies: [enemy('slime', 40, TOP - 9)] })
    const stomped = steps(run, 0.1)
    expect(stomped.stats).toMatchObject({ kills: 1, stomps: 1 })
    expect(stomped.hearts).toBe(MAX_HEARTS)
    expect(stomped.knight.vy).toBeLessThan(0)
  })
  it('chains kills and coins into a multiplier that lapses when he stops', () => {
    expect(chainMultiplier(0)).toBe(1)
    expect(chainMultiplier(CHAIN_STEP)).toBe(2)
    const coins = [0, 1, 2, 3].map((i) => ({ id: 50 + i, x: 44 + i, y: TOP - 20 }))
    const collected = stepRun(flat({ coins }), idle, DT)
    expect(collected.stats.coins).toBe(4)
    // The third in a row reaches the second step of the multiplier.
    expect(collected.points).toBe((1 + 1 + 2 + 2) * COIN_POINTS)
    expect(steps(collected, CHAIN_SECONDS + 0.1).chain).toBe(0)
  })
  it('clears the screen with the lightning once charged', () => {
    const run = flat({ charge: CHARGE_MAX, enemies: [enemy('bat', 200, TOP - 40), enemy('slime', 300, TOP - 9, { id: 901 }), enemy('bird', 5000, TOP - 26, { id: 902 })] })
    const struck = stepRun(run, { ...idle, special: true }, DT)
    expect(struck.enemies.map((e) => e.id)).toEqual([902])
    expect(struck.charge).toBe(0)
    expect(struck.events.find((e) => e.type === 'special')).toBeTruthy()
    expect(stepRun({ ...run, charge: 3 }, { ...idle, special: true }, DT).enemies).toHaveLength(3)
  })
})

describe('hub run: enemies', () => {
  it('sleeps until it nears the screen, then comes for him', () => {
    const far = { ...enemy('slime', 2000, TOP - 9), awake: false }
    expect(stepRun(flat({ enemies: [far] }), idle, DT).enemies[0].x).toBe(2000)
    const near = { ...enemy('slime', 400, TOP - 9), awake: false }
    expect(stepRun(flat({ enemies: [near] }), idle, DT).enemies[0].x).toBeLessThan(400)
  })
  it('turns a slime round at the edge of its ground', () => {
    const run = flat({ ground: [{ x0: -500, x1: 300 }], enemies: [enemy('slime', 296, TOP - 9, { vx: 20 })] })
    expect(steps(run, 0.2).enemies[0].vx).toBeLessThan(0)
  })
  it('makes a frog hop toward him when he is near', () => {
    const frog = enemy('frog', 150, TOP - 9, { hop: 0 })
    const hopped = stepRun(flat({ enemies: [frog] }), idle, DT).enemies[0]
    expect(hopped.vy).toBeLessThan(0)
    expect(hopped.vx).toBeLessThan(0)
  })
})

describe('hub run: score', () => {
  it('scores meters plus points, and awards medals', () => {
    const run = { ...flat(), furthest: 1234, points: 100 }
    expect(meters(run)).toBe(123)
    expect(runScore(run)).toBe(223)
    expect(medalFor(0)).toBeNull()
    expect(medalFor(1500)).toBe('bronze')
    expect(medalFor(3500)).toBe('silver')
    expect(medalFor(7000)).toBe('gold')
  })
  it('keeps the run when the strip changes size, with the ground at the new bottom', () => {
    const run = steps(flat(), 0.5, { right: true })
    const taller = resizeRun(run, W, H + 40)
    expect(taller.knight.y).toBe(groundY(H + 40))
    expect(taller.knight.x).toBe(run.knight.x)
  })
})

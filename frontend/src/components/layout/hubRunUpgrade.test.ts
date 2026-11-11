import { describe, expect, it } from 'vitest'
import { startRun, stepRun, groundY, type Enemy, type RunInput, type RunState } from './hubRunRules'
import { blankEnemy, bossAt, stepEnemy } from './hubRunEnemies'
import { deathSeconds, enemyAnimState, enemyPose } from './hubEnemyAnim'
import { armorBurst, stepDebris, DEBRIS_LIFE } from './hubRunDebris'
import { escapeTarget, freedPrisoner, RESCUE, stepEscapes } from './hubRunRescue'
import { GUARD_STAGGER_SECONDS, guardAfterHit, shieldStops } from './hubRunShield'

const W = 562
const H = 120
const TOP = groundY(H)
const DT = 1 / 60
const idle: RunInput = { left: false, right: false, jumpHeld: false, jump: false, attack: false, special: false }
const seeded = (seed: number) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const flat = (extra: Partial<RunState> = {}): RunState => ({
  ...startRun(W, H, seeded(1)), ground: [{ x0: -500, x1: 100000 }], platforms: [], coins: [], enemies: [], builtTo: 100000, ...extra,
})
const ticks = (state: RunState, seconds: number, input: Partial<RunInput> = {}, each?: (s: RunState) => void) => {
  let current = state
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    current = stepRun(current, { ...idle, ...input }, DT)
    each?.(current)
  }
  return current
}
const armored = (extra: Partial<Enemy> = {}): Enemy => ({
  ...blankEnemy(500, 'armored', 220, TOP - 17), awake: true, guard: 2, hp: 2, maxHp: 2, facing: -1, ...extra,
})
const facingArmor = (enemy: Enemy, x = 200, facing: 1 | -1 = 1): RunState => {
  const base = flat({ enemies: [enemy] })
  return { ...base, knight: { ...base.knight, x, y: TOP, grounded: true, vx: 0, facing } }
}

describe('shields and guards', () => {
  it('only covers the side the body faces, and never covers a stomp', () => {
    const shield = armored()
    expect(shieldStops(shield, shield.x - 10, false)).toBe(true)
    expect(shieldStops(shield, shield.x + 10, false)).toBe(false)
    expect(shieldStops(shield, shield.x - 10, true)).toBe(false)
  })

  it('breaks after two sword hits and staggers the holder in between', () => {
    expect(guardAfterHit(armored(), 'sword')).toMatchObject({ guard: 1, broken: false, stagger: GUARD_STAGGER_SECONDS })
    expect(guardAfterHit(armored({ guard: 1 }), 'sword')).toMatchObject({ guard: 0, broken: true })
    expect(guardAfterHit(armored(), 'lance')).toMatchObject({ guard: 0, broken: true })
  })

  it('blocks a frontal slash, then opens and can be defeated', () => {
    let state = facingArmor(armored())
    const seen = new Set<string>()
    const record = (s: RunState) => { for (const event of s.events) seen.add(event.type) }
    state = ticks(state, 0.15, { attack: true }, record)
    expect(seen.has('shieldBlock')).toBe(true)
    expect(state.enemies[0]).toMatchObject({ guard: 1, hp: 2 })
    state = ticks(state, 0.9)
    state = ticks(state, 0.15, { attack: true }, record)
    expect(seen.has('shieldBreak')).toBe(true)
    expect(state.enemies[0]).toMatchObject({ hp: 1, guard: 0 })
    state = ticks(state, 0.9)
    state = ticks(state, 0.15, { attack: true }, record)
    expect(state.enemies).toHaveLength(0)
    expect(state.corpses?.[0]).toMatchObject({ kind: 'armored' })
    expect(state.corpses?.[0].dyingFor).toBe(deathSeconds('armored'))
    expect(state.corpses?.[0].dying).toBeGreaterThan(0)
    // The death animation ends and the corpse leaves; nothing accumulates.
    state = ticks(state, deathSeconds('armored') + 0.2)
    expect(state.corpses).toHaveLength(0)
  })

  it('does not block a slash from behind', () => {
    let state = facingArmor(armored(), 235, -1)
    state = ticks(state, 0.15, { attack: true })
    expect(state.events.some((event) => event.type === 'shieldBlock')).toBe(false)
    expect(state.enemies[0]?.hp ?? 0).toBe(1)
  })
})

describe('death animations', () => {
  it('plays a death state instead of deleting the enemy', () => {
    const zombie: Enemy = { ...blankEnemy(1, 'zombie', 100, TOP - 16), awake: true, dying: 0.2, dyingFor: 0.9, hp: 0 }
    expect(enemyAnimState(flat(), zombie)).toBe('death')
    const pose = enemyPose(flat(), zombie, 1)
    expect(pose.fade).toBeLessThan(1)
    expect(pose.progress).toBeGreaterThan(0)
  })

  it('animates walk, telegraphs and death differently per archetype', () => {
    const state = flat()
    const walker = { ...blankEnemy(2, 'zombie', 100, TOP - 16), awake: true, vx: 20, stride: 0 }
    const first = enemyPose(state, walker, 0)
    expect(first.state).toBe('walk')
    // Time alone changes nothing: the cycle belongs to the ground the enemy covered.
    const still = enemyPose(state, walker, 0.3)
    expect(still.frame).toBe(first.frame)
    expect(still.bob).toBe(first.bob)
    const stepped = enemyPose(state, { ...walker, stride: 20 }, 0)
    expect(stepped.frame).not.toBe(first.frame)
    expect(stepped.bob).not.toBe(first.bob)
    expect(stepped.cycle).toBeGreaterThan(0)
    const burster = { ...blankEnemy(3, 'burster', 100, TOP - 16), awake: true, bossPhase: 'warn' as const, timer: 0.4 }
    expect(enemyAnimState(state, burster)).toBe('windup')
    expect(enemyPose(state, burster, 0.2).squash).toBeGreaterThan(1)
  })
})

describe('detachable armor', () => {
  it('throws a spinning helmet and plates that fall, bounce and settle', () => {
    const state = facingArmor(armored())
    const pieces = armorBurst(state, 200, TOP)
    expect(pieces.some((piece) => piece.kind === 'helmet')).toBe(true)
    expect(pieces.every((piece) => piece.vy < 0)).toBe(true)
    let debris = pieces
    for (let index = 0; index < 12; index++) debris = stepDebris(debris, DT)
    expect(debris.length).toBe(pieces.length)
    expect(debris.every((piece) => piece.y <= TOP + 0.01)).toBe(true)
    expect(debris.some((piece) => piece.angle !== 0)).toBe(true)
    for (let index = 0; index < DEBRIS_LIFE / DT + 4; index++) debris = stepDebris(debris, DT)
    expect(debris).toHaveLength(0)
  })
})

describe('prisoner rescue', () => {
  it('runs left along its platform and drops onto the ground after its edge', () => {
    const floor = TOP - 40
    const state = { ...flat(), platforms: [{ x0: 50, x1: 300, y: floor }] }
    let escapes = [freedPrisoner(0, 100, floor, -1, -45)]
    let platformSteps = 0, descended = false
    for (let index = 0; index < 130; index++) {
      escapes = stepEscapes({ ...state, escapes }, DT)
      for (const actor of escapes) if (actor.phase === 'run') {
        expect(actor.facing).toBe(-1)
        if (actor.x > 60 && actor.vy === 0) { platformSteps++; expect(actor.y).toBeCloseTo(floor) }
        if (actor.x < 45 && actor.y > floor + 5) descended = true
      }
    }
    expect(platformSteps).toBeGreaterThan(5)
    expect(descended).toBe(true)
  })

  it('reacts, exits and runs all the way beyond the left viewport without fading or celebrating', () => {
    const state = { ...flat(), cameraX: 0, ground: [{ x0: -500, x1: 100000 }] }
    let escapes = [freedPrisoner(0, 200, TOP, -1, -45)]
    const phases = new Set<string>(); let lastX = 200
    for (let index = 0; index < 600 && escapes.length; index++) {
      const previous = escapes[0]
      escapes = stepEscapes({ ...state, escapes }, DT)
      if (!escapes.length) expect(previous.x).toBeLessThan(-40)
      for (const actor of escapes) { phases.add(actor.phase); lastX = actor.x }
    }
    expect(escapes).toHaveLength(0)
    expect([...phases].sort()).toEqual(['climb', 'freed', 'run'])
    expect(lastX).toBeLessThan(-40)
    expect(RESCUE.react).toBeGreaterThan(0)
  })

  it('sets the escape destination outside the left viewport, regardless of the cage surface', () => {
    const state = { cameraX: 100, ground: [{ x0: 0, x1: 300 }], platforms: [{ x0: 400, x1: 480, y: TOP - 40 }] }
    expect(escapeTarget(state, 430, true, 1)).toBe(55)
    expect(escapeTarget(state, 430, true, -1)).toBe(55)
    expect(escapeTarget(state, 20, false, 1)).toBe(55)
  })
})
describe('boss attacks', () => {
  const bossState = (hp: number, phase: 'hover' | 'warn' = 'hover') => {
    const state = flat()
    const boss = { ...bossAt(700, 'warden', 300, TOP - 23, 12), hp, bossPhase: phase, timer: 0.01, age: 1.2 }
    return { ...state, cameraX: 0, knight: { ...state.knight, x: 200 }, enemies: [boss] }
  }

  it('teaches a dive in phase one', () => {
    const state = bossState(12)
    const warned = stepEnemy({ ...state, events: [] }, state.enemies[0], DT)
    expect(warned.bossPhase).toBe('warn')
    expect(warned.bossAttack).toBe('dive')
  })

  it('switches to a telegraphed ground slam below half life, with a shockwave event', () => {
    const state = bossState(4)
    let boss = stepEnemy({ ...state, events: [] }, state.enemies[0], DT)
    expect(boss.bossPhase).toBe('warn')
    expect(boss.bossAttack).toBe('slam')
    // The marker shows where it will land, not where the boss is.
    expect(boss.targetY).toBe(TOP)
    const events: RunState['events'] = []
    for (let index = 0; index < 120 && !events.some((event) => event.type === 'bossSlam'); index++) {
      boss = stepEnemy({ ...state, events }, boss, DT)
    }
    expect(events.some((event) => event.type === 'bossSlam')).toBe(true)
    expect(boss.bossPhase).toBe('return')
  })
})

import { describe, expect, it } from 'vitest'
import { startCemeteryRun, stepCemeteryRun } from './hubRunCemetery'
import { blankEnemy } from './hubRunEnemies'
import { groundY, stepRun, type RunInput, type RunState, type WeaponKind } from './hubRunRules'
import { ARMOR, upgradeArmor, grantCemeteryArmor, projectileHit } from './hubRunEquipment'
import { thrownWeapon } from './hubRunThrow'
import { knightHitFrame } from './hubKnightHitArt'

const dt = 1 / 60
const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }
const flat = (weapon: WeaponKind = 'sword'): RunState => {
  const s = startCemeteryRun(464, 218)
  return { ...s, ground: [{ x0: -500, x1: 10000 }], platforms: [], coins: [], enemies: [], builtTo: 10000, bossIn: 10000, stage: { ...s.stage!, weapon, weapons: ['sword', 'hammer', 'daggers', 'lance'], weaponCharges: 12 } }
}

describe('distinct weapons and armor', () => {
  it('winds up the hammer, deals four damage nearby, and never launches it', () => {
    let s = flat('hammer')
    s.enemies = [70, 130].map((x, i) => ({ ...blankEnemy(100 + i, 'bonecaster', x, groundY(s.height) - 16), awake: true, age: 2, hp: 6, maxHp: 6 }))
    for (let i = 0; i < 12; i++) s = stepRun(s, { ...idle, throwSword: true }, dt)
    expect(s.enemies.map(e => e.hp)).toEqual([6, 6])
    for (let i = 0; i < 10; i++) s = stepRun(s, { ...idle, throwSword: true }, dt)
    expect(s.enemies.map(e => e.hp)).toEqual([2, 6])
    expect(s.swords).toHaveLength(0)
  })

  it('fires daggers in all eight directions at constant speed, much faster than the sword', () => {
    for (const [aimX, aimY] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const s = thrownWeapon(flat('daggers'), { ...idle, throwSword: true, aimX, aimY }, dt)
      const shot = s.swords[0]
      expect(Math.hypot(shot.vx, shot.vy!)).toBeCloseTo(370)
      expect(Math.sign(shot.vx)).toBe(aimX)
      expect(Math.sign(shot.vy!)).toBe(aimY)
      expect(s.swordCooldown).toBeLessThan(0.15)
    }
  })

  it('can hit an enemy above the knight with an upward dagger', () => {
    let s = flat('daggers')
    s.enemies = [{ ...blankEnemy(100, 'bonecaster', 40, groundY(s.height) - 75), awake: true, age: 2 }]
    s = stepRun(s, { ...idle, throwSword: true, aimX: 0, aimY: -1 }, dt)
    for (let i = 0; i < 12; i++) s = stepRun(s, idle, dt)
    expect(s.stats.kills).toBe(1)
  })

  it('uses swept two-dimensional projectile collision without hitting empty diagonal corners', () => {
    const shot = { id: 1, x: 100, previousX: 0, y: 100, previousY: 0, vx: 200, vy: 200, life: 1, weapon: 'daggers' as const }
    expect(projectileHit(shot, 50, 50, 5)).toBe(true)
    expect(projectileHit(shot, 10, 90, 5)).toBe(false)
  })

  it('progresses green, purple and gold with actual protection and ranged bonuses', () => {
    let s = flat('daggers')
    for (const tier of ['verdant', 'arcane', 'royal'] as const) {
      s = upgradeArmor(s)
      expect(s.stage).toMatchObject({ armorTier: tier, armor: ARMOR[tier].hits })
    }
    const gold = thrownWeapon(s, { ...idle, throwSword: true }, dt)
    expect(gold.swords[0].damage).toBe(2)
    s.stage = { ...s.stage!, armorTier: 'arcane', armor: 2 }
    const purple = thrownWeapon(s, { ...idle, throwSword: true }, dt)
    expect(purple.swords[0].pierces).toBe(1)
    expect(purple.swordCooldown).toBeLessThan(0.1)
  })

  it('only allows switching to acquired weapons and does not throw an empty lance', () => {
    let s = startCemeteryRun(464, 218)
    s = stepCemeteryRun(s, { ...idle, selectWeapon: 'hammer' }, dt)
    expect(s.stage!.weapon).toBe('sword')
    s.stage = { ...s.stage!, weapons: ['sword', 'hammer'] }
    s = stepCemeteryRun(s, { ...idle, selectWeapon: 'hammer' }, dt)
    expect(s.stage!.weapon).toBe('hammer')
    s = flat('lance'); s.stage!.weaponCharges = 0
    s = thrownWeapon(s, { ...idle, throwSword: true }, dt)
    expect(s.swords).toHaveLength(0)
    expect(s.stage!.weapon).toBe('sword')
  })

  it('green armor restores life and survives one hit without dropping all equipment', () => {
    let green = grantCemeteryArmor(flat())
    expect(green.hearts).toBe(2)
    expect(grantCemeteryArmor(green).stage!.armorTier).toBe('verdant')
    green = startCemeteryRun(464, 218)
    green.stage = { ...green.stage!, armorTier: 'verdant', armor: 2 }
    green.enemies = [{ ...blankEnemy(900, 'zombie', green.knight.x, green.knight.y - 16), awake: true, age: 2 }]
    green = stepCemeteryRun(green, idle, dt)
    expect(green.stage!.armor).toBe(1)
    expect(green.stage!.armorBreak).toBeUndefined()
  })

  it('an arcane dagger pierces a first victim, while a hammer sends a killed zombie tumbling', () => {
    let s = flat('daggers')
    s.stage = { ...s.stage!, armorTier: 'arcane', armor: 2 }
    s.enemies = [100, 155].map((x, id) => ({ ...blankEnemy(500 + id, 'bonecaster', x, groundY(s.height) - 16), awake: true, age: 2 }))
    s = stepRun(s, { ...idle, throwSword: true }, dt)
    for (let i = 0; i < 25; i++) s = stepRun(s, idle, dt)
    expect(s.stats.kills).toBe(2)
    s = flat('hammer')
    s.enemies = [{ ...blankEnemy(900, 'bonecaster', 70, groundY(s.height) - 16), awake: true, age: 2 }]
    for (let i = 0; i < 17; i++) s = stepRun(s, { ...idle, attack: true }, dt)
    expect(s.corpses?.[0].vx).toBeGreaterThan(0)
    expect(s.corpses?.[0].vy).toBeLessThan(0)
  })

  it('has four real hit poses, then returns to normal animation', () => {
    expect([0, 0.15, 0.35, 0.6].map(knightHitFrame)).toEqual([0, 1, 2, 3])
    expect(knightHitFrame(0.8)).toBeNull()
  })
})

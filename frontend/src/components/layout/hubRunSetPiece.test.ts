import { describe, expect, it } from 'vitest'
import { startCemeteryRun, stepCemeteryRun } from './hubRunCemetery'
import { stepSetPiece } from './hubRunSetPiece'
import { stepGargoyle } from './hubRunGargoyle'
import { grantCemeteryArmor } from './hubRunEquipment'
import { blankEnemy } from './hubRunEnemies'
import { groundHeightAt, stepRun, type RunInput } from './hubRunRules'

const dt = 1 / 60
const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }

describe('opening cemetery sequence', () => {
  it('uses restoring green armor exclusively, refills life, and regenerates after a safe interval', () => {
    let s = startCemeteryRun(464, 218)
    for (let i = 0; i < 5; i++) s = grantCemeteryArmor(s)
    expect(s.stage!.armorTier).toBe('verdant')
    expect(s.hearts).toBe(2)
    s.hearts = 1; s.stage!.elapsed = 6.2; s.stage!.lastDamageAt = 0
    s = stepCemeteryRun(s, idle, dt)
    expect(s.hearts).toBe(2)
    expect(s.events.some(e => e.type === 'reward' && e.text.includes('RECOVERY'))).toBe(true)
  })

  it('announces the gargoyle, locks its target and can crash against scenery', () => {
    const s = startCemeteryRun(464, 218)
    s.knight.x = 600; s.knight.y = groundHeightAt(s, 600)!
    const statue = { ...blankEnemy(100, 'gargoyle', 745, 135), awake: true }
    const warn = stepGargoyle(s, statue, dt)
    expect(warn.bossPhase).toBe('warn')
    expect(s.events.some(e => e.type === 'crowCry')).toBe(true)
    s.knight.x = 650
    expect(stepGargoyle(s, warn, dt).targetX).toBe(600)
    const crashed = stepGargoyle(s, { ...warn, bossPhase: 'dive', x: 550, y: 130, vx: -235, vy: 0, timer: 1 }, 0.1)
    expect(crashed.hp).toBe(0)
    expect(s.events.some(e => e.type === 'gargoyleCrash')).toBe(true)
  })

  it('allows a zombie to lose its arm and collide with a second enemy', () => {
    let s = startCemeteryRun(464, 218)
    s.ground = [{ x0: -500, x1: 10000 }]; s.platforms = []; s.builtTo = 10000; s.bossIn = 10000
    s.knight.x = 70
    s.enemies = [100, 150].map((x, i) => ({ ...blankEnemy(100 + i, 'zombie', x, groundHeightAt(s, x)! - 16), hp: i ? 1 : 2, maxHp: i ? 1 : 2, awake: true, age: 2 }))
    let lostArm = false
    for (let i = 0; i < 65; i++) {
      s = stepRun(s, { ...idle, attack: i < 8 }, dt)
      lostArm ||= s.events.some(e => e.type === 'armLost')
    }
    expect(lostArm).toBe(true)
    expect(s.stats.kills).toBe(2)
  })

  it('drops a gravestone onto nearby enemies only once', () => {
    let s = startCemeteryRun(464, 218)
    s.knight.x = 550; s.knight.y = groundHeightAt(s, 550)!; s.knight.facing = 1
    s.enemies = [{ ...blankEnemy(100, 'zombie', 595, groundHeightAt(s, 595)! - 16), awake: true, age: 2 }]
    s = stepSetPiece(s, { ...idle, interact: true })
    expect(s.stage!.fallenStoneAt).toBeDefined()
    s.stage!.elapsed += 0.4
    s = stepSetPiece(s, idle)
    expect(s.stats.kills).toBe(1)
    expect(stepSetPiece(s, idle).stats.kills).toBe(1)
  })

  it('links rescue, wall discovery and the bell to a new ranged threat', () => {
    let s = startCemeteryRun(464, 218)
    s.knight.x = 940
    s.stage!.rescued = [4]
    s = stepSetPiece(s, idle)
    expect(s.stage!.triggered).toContain('intro-prisoner-hint')
    s.stage!.secrets = [3]
    s = stepSetPiece(s, idle)
    expect(s.events.some(e => e.type === 'distantBell')).toBe(true)
    expect(s.enemies.filter(e => e.kind === 'bonecaster')).toHaveLength(1)
    expect(stepSetPiece(s, idle).enemies.filter(e => e.kind === 'bonecaster')).toHaveLength(1)
  })
})

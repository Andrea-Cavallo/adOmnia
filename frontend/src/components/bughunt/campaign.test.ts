import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BugHuntPrototype, type GameSnapshot } from './prototype'
import { BOSS_BODY, LEVELS, levelExit, levelHotfix, type Bug, type Platform, type Boss } from './level'
import type { PowerState } from './powers'
import type { PlayerVisual, Shot } from './visuals'
import { stepSpecialBug } from './enemies'
import { DESK_ARENAS, type DeskFoe } from './deskCombat'

type Game = {
  player: PlayerVisual & { airJump: boolean }; enemies: Bug[]; shots: Shot[]; powers: PowerState; platforms: Platform[]; boss: Boss
  update: (dt: number) => void; keyDown: (code: string) => void; keyUp: (code: string) => void
  advance: () => void; destroy: () => void; getSnapshot: () => GameSnapshot
  gravitySign: number; worldTime: number; slowRemaining: number
  lesson: { index: number; announce: number; remaining: number; done: Set<number> }
}
function create(stage = 0) {
  const game = new BugHuntPrototype({ getContext: () => ({}) } as unknown as HTMLCanvasElement, () => undefined) as unknown as Game
  const tick = (n = 1) => { for (let i = 0; i < n; i++) game.update(1 / 60) }
  for (let i = 0; i < stage; i++) {
    game.enemies.forEach(b => { b.alive = false })
    game.player.x = levelHotfix(i).x; tick(); game.player.x = levelExit(i); tick(); game.advance()
  }
  return { game, tick }
}
describe('developer world campaign encounters', () => {
  beforeEach(() => { vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps outside enemies and their fire from interrupting an arena entrance', () => {
    const { game, tick } = create()
    game.player.x = DESK_ARENAS.retry.left + 50
    tick()
    const outside = game.enemies.find(b => !b.encounter)!
    outside.x = game.player.x; outside.y = game.player.y
    game.shots.push({ x: game.player.x + 17, y: 436, vx: 0, life: 1, enemy: true })
    tick(10)
    expect(game.getSnapshot().health).toBe(3)
    expect(game.shots.some(s => s.enemy)).toBe(false)
    expect(outside.x).toBe(game.player.x)
    game.destroy()
  })

  it.each(['retry', 'soap', 'legacy'] as DeskFoe[])('%s is beatable without damage using movement and recovery fire in under 25 seconds', (kind) => {
    const { game, tick } = create()
    const foe = game.enemies.find(b => b.encounter === kind)!
    // Isolate the encounter; retain real player physics, platforms, projectiles and damage.
    game.enemies.forEach(b => { if (b !== foe) b.alive = false })
    const a = DESK_ARENAS[kind]
    game.player.x = a.left + 50
    let cycle = -1, target = game.player.x, frames = 0
    let jumped = -1
    for (; frames < 1500 && foe.alive; frames++) {
      const c = foe.combat
      game.keyUp('KeyA'); game.keyUp('KeyD'); game.keyUp('KeyF')
      if (c?.phase === 'tell' && c.cycles !== cycle) {
        cycle = c.cycles
        target = game.player.x < (a.left + a.right) / 2 ? a.right - game.player.w - 25 : a.left + 25
      }
      if (c?.phase === 'tell' || c?.phase === 'attack') {
        if (Math.abs(target - game.player.x) > 6) game.keyDown(target > game.player.x ? 'KeyD' : 'KeyA')
      }
      if (c?.phase === 'tell' && kind !== 'soap' && c.clock >= c.duration - .35 && jumped !== c.cycles) {
        game.keyUp('Space'); game.keyDown('Space'); jumped = c.cycles
      }
      if (c?.phase === 'recover') {
        game.player.facing = foe.x > game.player.x ? 1 : -1
        game.keyDown('KeyF')
      }
      tick()
      expect(game.getSnapshot().health, JSON.stringify({kind, frame: frames, p: game.player.x, py: game.player.y, b: foe.x, by: foe.y, c: foe.combat})).toBe(3)
    }
    expect(foe.alive).toBe(false)
    expect(game.getSnapshot().health).toBe(3)
    expect(game.getSnapshot().deaths).toBe(0)
    expect(frames / 60).toBeLessThan(25)
    expect(game.getSnapshot().dashReady).toBe(true)
    expect(game.getSnapshot().score).toBeGreaterThanOrEqual(350)
    if (kind === 'soap') expect(game.getSnapshot().ammo).toBe(6)
    expect(foe.combat!.locked).toBe(false)
    game.keyUp('KeyF'); game.keyUp('Space')
    const score = game.getSnapshot().score
    tick(60)
    expect(game.getSnapshot().score).toBe(score)
    game.destroy()
  })

  it('blocks the first exit until Legacy Brute has actually been defeated in its recovery windows', () => {
    const { game, tick } = create()
    game.enemies.forEach(b => { if (b.kind !== 'null') b.alive = false })
    game.player.x = levelHotfix(0).x; tick(); game.player.x = levelExit(0); tick()
    expect(game.getSnapshot().levelComplete).toBe(false)
    const boss = game.enemies.find(b => b.kind === 'null')!
    game.player.x = DESK_ARENAS.legacy.left + 40; game.player.facing = 1; game.player.invulnerable = 30
    game.keyDown('KeyF')
    tick(1500)
    expect(boss.alive).toBe(false)
    game.keyUp('KeyF'); game.player.x = levelExit(0); tick()
    expect(game.getSnapshot().levelComplete).toBe(true)
    game.destroy()
  })

  it('telegraphs a flying bug, then commits its dive instead of tracking every dodge', () => {
    const { game } = create()
    const b = game.enemies.find(b => b.kind === 'flyer')!
    game.player.x = b.x + 80; game.player.y = 412
    b.fuse = 0.4
    stepSpecialBug(b, game.player, 0.1, 0, game.shots)
    expect(b.alert).toBe(1); expect(b.dive).toBe(0)
    stepSpecialBug(b, game.player, 0.31, 0.31, game.shots)
    const targetX = b.targetX, targetY = b.targetY
    expect(b.dive).toBeGreaterThan(0)
    game.player.x -= 150
    stepSpecialBug(b, game.player, 0.1, 0.41, game.shots)
    expect(b.targetX).toBe(targetX); expect(b.targetY).toBe(targetY)
    expect(b.y).toBeGreaterThan(b.homeY!)
    game.destroy()
  })

  it('Timeout shoots diagonally, while Breakpoint freezes all new enemies', () => {
    const { game, tick } = create()
    const b = game.enemies.find(b => b.kind === 'timeout')!
    game.player.x = b.x + 150; b.fuse = 0
    stepSpecialBug(b, game.player, 0.1, 0, game.shots)
    expect(game.shots.some(s => s.enemy && (s.vy ?? 0) > 0)).toBe(true)
    game.powers.breakpoint = 2
    const before = game.enemies.map(b => ({ x: b.x, y: b.y, fuse: b.fuse }))
    tick(20)
    expect(game.enemies.map(b => ({ x: b.x, y: b.y, fuse: b.fuse }))).toEqual(before)
    game.destroy()
  })

  it('makes Memory Leak grow and gives Race Condition a readable charge window', () => {
    const { game } = create(1)
    const leak = game.enemies.find(b => b.kind === 'leak')!, race = game.enemies.find(b => b.kind === 'race')!
    const feet = leak.y + leak.h, width = leak.w
    stepSpecialBug(leak, game.player, 2, 2, game.shots)
    expect(leak.w).toBeGreaterThan(width); expect(leak.y + leak.h).toBe(feet)
    race.phase = 0; const x = race.x
    stepSpecialBug(race, game.player, 0.1, 1.8, game.shots)
    expect(race.alert).toBe(1); expect(race.x).toBe(x)
    stepSpecialBug(race, game.player, 0.1, 2.2, game.shots)
    expect(race.x).not.toBe(x)
    game.destroy()
  })

  it('carries a0 vertically on a rack lift and keeps movement responsive during CPU pressure', () => {
    const { game, tick } = create(1)
    game.enemies.forEach(b => { b.alive = false })
    const lift = game.platforms.find(p => p.verticalTravel)!
    game.player.x = lift.x + 20; game.player.y = lift.y - game.player.h; game.player.grounded = true
    tick(20)
    expect(game.player.y + game.player.h).toBeCloseTo(lift.y, 1)
    game.player.x = 1130; game.player.y = 412; game.player.vy = 0; game.player.grounded = true
    tick(); const time = game.worldTime, start = game.player.x
    game.keyDown('KeyD'); tick(30)
    expect(game.slowRemaining).toBeGreaterThan(0)
    expect(game.worldTime - time).toBeCloseTo(0.225, 2)
    expect(game.player.x - start).toBeGreaterThan(110)
    game.destroy()
  })

  it('teaches temporary reverse gravity before the arena and restores it on leaving', () => {
    const { game, tick } = create(2)
    game.enemies.forEach(b => { b.alive = false })
    game.player.x = 350; tick()
    expect(game.lesson.announce).toBeGreaterThan(0.9)
    expect(game.gravitySign).toBe(1)
    game.player.x = 710; tick(61)
    expect(game.gravitySign).toBe(-1)
    tick(90)
    expect(game.player.y).toBeCloseTo(130, 1)
    game.player.x = 1200; tick()
    expect(game.gravitySign).toBe(1)
    expect(game.boss.started).toBe(false)
    game.destroy()
  })

  it('keeps three distinct platform vocabularies and safe boss geometry', () => {
    expect(new Set(LEVELS.map(l => l.name)).size).toBe(3)
    expect(LEVELS[0].platforms.some(p => p.skin === 'key' && p.unstable)).toBe(true)
    expect(LEVELS[1].fans?.length).toBe(2)
    expect(LEVELS[2].lessons?.map(l => l.command)).toEqual(['gravity', 'offline', 'clones'])
    for (const level of LEVELS.slice(1)) expect(level.bugs.filter(b => b.kind === 'flyer' || b.kind === 'timeout').length).toBeGreaterThanOrEqual(5)
    expect(LEVELS[2].platforms.some(p => !p.floating && !p.ceiling && p.x <= BOSS_BODY.x && p.x + p.w >= BOSS_BODY.x + BOSS_BODY.w)).toBe(true)
  })
})

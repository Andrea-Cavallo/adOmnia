import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BugHuntPrototype, type GameSnapshot } from './prototype'
import { LEVELS, firewallPhase, type Bug, type Platform } from './level'
import { GC_RADIUS, REVERT_MAX_CHARGES, type PowerState } from './powers'

type Inspectable = {
  keyDown: (code: string) => void
  keyUp: (code: string) => void
  destroy: () => void
  restart: () => void
  advance: () => void
  update: (dt: number) => void
  getSnapshot: () => GameSnapshot
  player: { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean; invulnerable: number }
  enemies: Bug[]
  platforms: Platform[]
  powers: PowerState
  purgeState: string
  worldTime: number
  health: number
  level: number
  levelComplete: boolean
}

function createGame() {
  const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement
  const game = new BugHuntPrototype(canvas, () => undefined) as unknown as Inspectable
  const tick = (count: number) => { for (let i = 0; i < count; i++) game.update(1 / 60) }
  return { game, tick }
}

/** Drops the player onto the given Localhost power chip. */
function grab(game: Inspectable, tick: (n: number) => void, kind: string, level = 1) {
  if (game.level !== level) { game.levelComplete = true; game.advance() }
  game.purgeState = 'off' // Isolate power behavior from the later-world chase.
  const index = LEVELS[level].powers.findIndex((power) => power.kind === kind)
  const power = LEVELS[level].powers[index]
  game.player.x = power.x - game.player.w / 2
  game.player.y = power.y + 15 - game.player.h
  game.player.vy = 0
  game.player.invulnerable = 1 // Pickup tests do not include an enemy ambush.
  tick(1)
  game.player.invulnerable = 0
  return index
}

describe('Bug Hunt developer power-ups', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('places the desk module family and preserves the later-world tools', () => {
    expect([...new Set(LEVELS[0].powers.map((power) => power.kind))].sort()).toEqual(['boost', 'heal', 'jump', 'shield', 'shuriken'])
    for (const level of LEVELS.slice(1)) {
      expect([...new Set(level.powers.map((power) => power.kind))].sort()).toEqual(['breakpoint', 'gc', 'revert', 'shuriken', 'sudo'])
    }
  })

  it('sudo: bugs are deleted on contact and hazards do no damage', () => {
    const { game, tick } = createGame()
    grab(game, tick, 'sudo')
    expect(game.getSnapshot().sudo).toBeGreaterThan(0)
    const bug = game.enemies[0]
    game.player.x = bug.x; game.player.y = bug.y - 10; game.player.vy = 0
    tick(1)
    expect(bug.alive).toBe(false)
    const spike = LEVELS[1].firewalls[0]
    game.player.x = spike.x; game.player.y = spike.y - 30
    tick(2)
    expect(game.health).toBe(3)
    tick(60 * 7)
    expect(game.getSnapshot().sudo).toBe(0)
    game.destroy()
  })

  it('breakpoint: freezes bugs, firewalls and moving platforms, then resumes', () => {
    const { game, tick } = createGame()
    grab(game, tick, 'breakpoint')
    const walkingBug = game.enemies.find(b => !b.encounter && (b.kind === 'patrol' || b.kind === undefined) && !b.hover)!
    const bugX = walkingBug.x
    const world = game.worldTime
    tick(120)
    expect(walkingBug.x).toBe(bugX)
    expect(game.worldTime).toBe(world)
    expect(firewallPhase(game.worldTime, 0)).toBe(firewallPhase(world, 0))
    tick(60 * 4)
    expect(game.getSnapshot().breakpoint).toBe(0)
    tick(30)
    expect(walkingBug.x).not.toBe(bugX)
    game.destroy()
  })

  it('garbage collector: the wave frees bugs in range and spares distant ones', () => {
    const { game, tick } = createGame()
    grab(game, tick, 'gc', 1)
    const origin = game.powers.gc!
    const inRange = game.enemies.filter((bug) => Math.hypot(bug.x + bug.w / 2 - origin.x, bug.y + bug.h / 2 - origin.y) < GC_RADIUS)
    const outOfRange = game.enemies.filter((bug) => !inRange.includes(bug))
    expect(inRange.length).toBeGreaterThan(0)
    game.player.y = -500 // keep the player clear of the bugs while the wave expands
    tick(40)
    expect(inRange.every((bug) => !bug.alive)).toBe(true)
    expect(outOfRange.every((bug) => bug.alive)).toBe(true)
    expect(game.powers.gc).toBeNull()
    game.destroy()
  })

  it('git revert: R rewinds about three seconds and spends a charge', () => {
    const { game, tick } = createGame()
    grab(game, tick, 'revert')
    expect(game.getSnapshot().revertCharges).toBe(1)
    game.platforms = [{x:0,y:460,w:2000,h:100}]; game.enemies.forEach(b=>{b.alive=false})
    game.player.x = 60; game.player.y = 412; game.player.vy = 0
    tick(10)
    const start = game.player.x
    game.keyDown('KeyD')
    tick(170)
    game.keyUp('KeyD')
    expect(game.player.x - start).toBeGreaterThan(400)
    game.keyDown('KeyR'); game.keyUp('KeyR')
    expect(game.getSnapshot().revertCharges).toBe(0)
    tick(60)
    expect(game.powers.rewind).toBeNull()
    expect(Math.abs(game.player.x - start)).toBeLessThan(40)
    expect(game.player.invulnerable).toBeGreaterThan(0)
    // Without charges R does nothing.
    const x = game.player.x
    game.keyDown('KeyR'); game.keyUp('KeyR'); tick(1)
    expect(game.powers.rewind).toBeNull()
    expect(Math.abs(game.player.x - x)).toBeLessThan(10)
    game.destroy()
  })

  it('caps revert charges and never respawns a picked chip', () => {
    const { game, tick } = createGame()
    game.powers.revertCharges = REVERT_MAX_CHARGES
    grab(game, tick, 'revert')
    expect(game.powers.revertCharges).toBe(REVERT_MAX_CHARGES)
    game.powers.revertCharges = 0
    grab(game, tick, 'revert')
    expect(game.powers.revertCharges).toBe(0)
    game.restart()
    expect(game.getSnapshot()).toMatchObject({ revertCharges: 0, sudo: 0, breakpoint: 0 })
    expect(game.powers.picked.size).toBe(0)
    game.destroy()
  })

  it('a fall clears timed powers and history so a rewind cannot return to the pit', () => {
    const { game, tick } = createGame()
    grab(game, tick, 'sudo')
    game.powers.revertCharges = 1
    tick(30)
    game.player.y = 700
    tick(1)
    expect(game.getSnapshot()).toMatchObject({ sudo: 0, health: 2 })
    expect(game.powers.history.length).toBeLessThan(3)
    game.destroy()
  })
})

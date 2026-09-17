import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BugHuntPrototype, type GameSnapshot } from './prototype'
import { BOSS_BODY, LEVELS, firewallPhase, type Boss, type Platform, BITS, EXIT_X, HOTFIX, PLATFORMS, SPIKES } from './level'

type Inspectable = {
  keyDown: (code: string) => void
  keyUp: (code: string) => void
  destroy: () => void
  restart: () => void
  advance: () => void
  platforms: Platform[]
  boss: Boss
  setPaused: (paused: boolean) => void
  getSnapshot: () => GameSnapshot
  draw: () => void
  update: (dt: number) => void
  player: { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean; coyote: number; buffer: number; invulnerable: number; airJump: boolean; dash: number; dashCooldown: number }
  enemies: { x: number; y: number; alive: boolean }[]
  checkpoint: boolean
}

function createGame() {
  const changes: GameSnapshot[] = []
  const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement
  const game = new BugHuntPrototype(canvas, (snapshot) => changes.push(snapshot)) as unknown as Inspectable
  const tick = (count: number) => { for (let i = 0; i < count; i++) game.update(1 / 60) }
  return { game, changes, tick }
}

describe('Bug Hunt prototype rules', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('moves and jumps with a shorter release jump', () => {
    const { game, tick } = createGame()
    game.keyDown('KeyD')
    tick(20)
    expect(game.player.x).toBeGreaterThan(130)
    game.keyUp('KeyD')
    game.keyDown('Space')
    tick(1)
    expect(game.player.vy).toBeLessThan(-600)
    game.keyUp('Space')
    expect(game.player.vy).toBeGreaterThan(-400)
    game.destroy()
  })

  it('buffers a jump just before landing and permits a brief edge jump', () => {
    const { game, tick } = createGame()
    game.player.x = 240
    game.player.y = 393
    game.player.vy = 250
    game.player.grounded = false
    game.player.coyote = 0
    game.keyDown('Space')
    tick(12)
    expect(game.player.vy).toBeLessThan(0)
    game.keyUp('Space')
    game.player.y = 410
    game.player.vy = 0
    game.player.grounded = false
    game.player.coyote = 0.05
    game.keyDown('Space')
    tick(1)
    expect(game.player.vy).toBeLessThan(0)
    game.destroy()
  })

  it('stomps the bug, activates the checkpoint, and respawns there after a fall', () => {
    const { game, changes, tick } = createGame()
    game.player.x = game.enemies[0].x
    game.player.y = game.enemies[0].y - 55
    game.player.vy = 400
    game.player.grounded = false
    game.player.coyote = 0
    tick(3)
    expect(game.enemies[0].alive).toBe(false)
    expect(game.player.vy).toBeLessThan(0)

    game.player.x = 1095
    game.player.y = 412
    game.player.vy = 0
    tick(1)
    expect(game.checkpoint).toBe(true)
    game.player.y = 650
    tick(1)
    expect(game.player.x).toBe(1090)
    expect(changes[changes.length - 1]?.health).toBe(2)
    game.destroy()
  })

  it('keeps collected bits across falls and deaths without awarding them twice', () => {
    const { game, tick } = createGame()
    game.player.x = BITS[0].x - 15
    tick(1)
    const collected = game.getSnapshot().bits
    expect(collected).toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) { game.player.y = 650; tick(1) }
    expect(game.getSnapshot()).toMatchObject({ health: 3, deaths: 1, bits: collected })
    game.player.x = BITS[0].x - 15
    tick(1)
    expect(game.getSnapshot().bits).toBe(collected)
    game.restart()
    expect(game.getSnapshot()).toMatchObject({ bits: 0, deaths: 0, hotfix: false })
    game.destroy()
  })

  it('requires the Hotfix at the exit and finishes with it', () => {
    const { game, tick } = createGame()
    game.player.x = EXIT_X
    tick(1)
    expect(game.getSnapshot().finished).toBe(false)
    game.player.x = HOTFIX.x
    tick(1)
    expect(game.getSnapshot().hotfix).toBe(true)
    game.player.x = EXIT_X
    tick(1)
    expect(game.getSnapshot()).toMatchObject({ levelComplete: true, finished: false })
    const elapsed = game.getSnapshot().seconds
    tick(60)
    expect(game.getSnapshot().seconds).toBe(elapsed)
    game.destroy()
  })

  it('freezes input and time while paused, and cancels its animation on exit', () => {
    const { game, tick } = createGame()
    vi.spyOn(game, 'draw').mockImplementation(() => undefined)
    game.keyDown('KeyD')
    game.setPaused(true)
    const x = game.player.x
    game.keyDown('Space')
    tick(60)
    expect(game.player.x).toBe(x)
    expect(game.getSnapshot().seconds).toBe(0)
    game.setPaused(false)
    tick(1)
    expect(game.player.vy).toBe(0)
    expect(game.player.x).toBe(x)
    game.destroy()
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('has a physically traversable main route with the Hotfix and checkpoint', () => {
    const { game, tick } = createGame()
    game.keyDown('KeyD')
    const trace: string[] = []
    for (let frame = 0; frame < 3600 && !game.getSnapshot().levelComplete; frame++) {
      const p = game.player
      if (p.grounded) {
        game.keyUp('Space')
        const look = p.x + p.w + 65
        const floorAhead = PLATFORMS.some((platform) => look >= platform.x && look <= platform.x + platform.w && Math.abs(platform.y - (p.y + p.h)) < 12)
        const stepAhead = PLATFORMS.some((platform) => platform.x > p.x + p.w && platform.x < look + 15 && platform.y < p.y + p.h && platform.y >= p.y + p.h - 105)
        const hazard = SPIKES.some((spike) => spike.x > p.x && spike.x < look + 20) || game.enemies.some((bug) => bug.alive && bug.x > p.x && bug.x < look + 35)
        if (!floorAhead || stepAhead || hazard) { game.keyDown('Space'); if (trace.length < 25) trace.push(`jump ${Math.round(p.x)},${Math.round(p.y)}`) }
      }
      tick(1)
    }
    expect(game.getSnapshot(), `${trace.join('; ')}; final ${game.player.x},${game.player.y}`).toMatchObject({ checkpoint: true, hotfix: true, levelComplete: true })
    game.destroy()
  })
  it('carries the player with moving platforms and keeps hazard warnings deterministic', () => {
    const { game, tick } = createGame()
    game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance()
    expect(game.getSnapshot()).toMatchObject({ level: 1, hotfix: false, health: 3, levelComplete: false })
    const platform = game.platforms.find(p => p.travel)!
    game.player.x = platform.x + 35; game.player.y = platform.y - game.player.h
    game.player.vx = 0; game.player.vy = 0; game.player.grounded = true
    const offset = game.player.x - platform.x
    tick(30)
    expect(game.player.x - platform.x).toBeCloseTo(offset, 5)
    expect(game.player.grounded).toBe(true)
    expect(firewallPhase(2.5, 0)).toBe('warning')
    expect(firewallPhase(3.3, 0)).toBe('active')
    expect(firewallPhase(4.9, 0)).toBe('off')
    expect(game.enemies.some(b => b.y < 426)).toBe(true)
    game.player.x = LEVELS[1].firewalls[0].x; game.player.y = 412
    tick(210)
    expect(game.getSnapshot().health).toBeLessThan(3)
    game.destroy()
  })

  it('requires three boss hits to exit Production and resets each attempt', () => {
    const { game, tick } = createGame()
    for (let i = 0; i < 2; i++) {
      game.player.x = HOTFIX.x; game.player.y = 412; tick(1)
      game.player.x = EXIT_X; tick(1); game.advance()
    }
    expect(game.getSnapshot().level).toBe(2)
    game.player.x = 2505; tick(1)
    game.player.x = HOTFIX.x; tick(1)
    expect(game.getSnapshot().hotfix).toBe(true)
    game.player.x = EXIT_X; tick(1)
    expect(game.getSnapshot().finished).toBe(false)
    const hit = () => {
      game.boss.clock = 2.2; game.boss.hit = false
      game.player.x = BOSS_BODY.x + 20; game.player.y = BOSS_BODY.y - game.player.h - 3
      game.player.vy = 220; game.player.grounded = false; game.player.coyote = 0
      tick(1)
    }
    hit(); expect(game.boss.health).toBe(2)
    game.player.y = 650; tick(1)
    expect(game.boss.health).toBe(3)
    expect(game.player.x).toBe(2500)
    expect(game.boss.waves).toHaveLength(0)
    for (let i = 0; i < 3; i++) hit()
    expect(game.boss.health).toBe(0)
    game.player.x = HOTFIX.x; game.player.y = 412; game.player.vy = 0; tick(1)
    expect(game.getSnapshot().hotfix).toBe(true)
    game.player.x = EXIT_X; tick(1)
    expect(game.getSnapshot()).toMatchObject({ finished: true, levelComplete: false, totalBits: 135 })
    game.restart()
    expect(game.getSnapshot()).toMatchObject({ level: 0, finished: false, bits: 0 })
    game.destroy()
  })

  it('restores crumbling platforms after their cooldown', () => {
    const { game, tick } = createGame()
    for (let i = 0; i < 2; i++) {
      game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance()
    }
    const platform = game.platforms.find(p => p.unstable)!
    game.player.x = platform.x + 20; game.player.y = platform.y - game.player.h
    tick(45)
    expect(platform.crumble).toBeGreaterThan(0.7)
    game.player.x = 60; game.player.y = 412
    tick(180)
    expect(platform.crumble).toBe(0)
    game.destroy()
  })

  it('lets a real running jump reach the vulnerable boss core', () => {
    const { game, tick } = createGame()
    for (let i = 0; i < 2; i++) {
      game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance()
    }
    game.boss.clock = 2.1
    game.player.x = 2705; game.player.y = 412
    game.keyDown('KeyD'); tick(6)
    game.keyDown('Space'); tick(34)
    expect(game.boss.health).toBe(2)
    expect(game.getSnapshot().health).toBe(3)
    game.destroy()
  })

  it.each([1, 2])('traverses environment %i with timed firewall crossings', (level) => {
    const { game, tick } = createGame()
    for (let stage = 0; stage < level; stage++) { game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance() }
    for (let frame = 0; frame < 7200 && !game.getSnapshot().levelComplete && (level !== 2 || game.player.x < 2700); frame++) {
      const p = game.player
      const wall = LEVELS[level].firewalls.find(w => w.x > p.x + p.w && w.x - p.x - p.w < 80)
      // Wait for a full safe interval, leaving room for acceleration and crossing.
      const cycle = (game.getSnapshot().seconds + (wall?.phase ?? 0)) % 4.8
      if (wall && cycle > 1.3) game.keyUp('KeyD')
      else game.keyDown('KeyD')
      if (p.grounded) {
        game.keyUp('Space')
        const look = p.x + p.w + 65
        const floor = game.platforms.some(q => look >= q.x && look <= q.x + q.w && Math.abs(q.y - p.y - p.h) < 12)
        const step = game.platforms.some(q => q.x > p.x + p.w && q.x < look + 15 && q.y < p.y + p.h && q.y >= p.y + p.h - 105)
        const bug = game.enemies.some(b => b.alive && b.x > p.x && b.x < look + 35)
        const spike = LEVELS[level].spikes.some(q => q.x > p.x && q.x < look + 20)
        if (!floor || step || bug || spike) game.keyDown('Space')
      }
      tick(1)
    }
    expect(game.getSnapshot(), `final ${game.player.x},${game.player.y}`).toMatchObject({ levelComplete: level === 1, hotfix: true, checkpoint: true })
    game.destroy()
  })

  it('permits one extra jump, then recharges it on landing', () => {
    const { game, tick } = createGame()
    game.keyDown('Space'); tick(12); game.keyUp('Space')
    game.keyDown('Space'); tick(1)
    expect(game.player.vy).toBeLessThan(-600)
    expect(game.player.airJump).toBe(false)
    game.keyUp('Space'); game.keyDown('Space'); tick(1)
    expect(game.player.vy).toBeGreaterThan(-600)
    game.keyUp('Space'); tick(100)
    expect(game.player.grounded).toBe(true)
    expect(game.player.airJump).toBe(true)
    game.destroy()
  })

  it('dashes through a bug once, scores it once, and respects recharge', () => {
    const { game, tick } = createGame()
    game.player.x = game.enemies[0].x - 45
    game.keyDown('KeyX'); tick(3)
    expect(game.enemies[0].alive).toBe(false)
    expect(game.getSnapshot().health).toBe(3)
    const score = game.getSnapshot().score
    expect(score).toBeGreaterThanOrEqual(100)
    expect(game.getSnapshot().dashReady).toBe(true) // a hit refills the dash
    for (const bug of game.enemies.slice(1)) bug.alive = false
    game.keyUp('KeyX'); game.keyDown('KeyX'); tick(15)
    expect(game.player.dash).toBe(0)
    expect(game.getSnapshot().dashReady).toBe(false)
    tick(45)
    expect(game.getSnapshot().dashReady).toBe(true)
    // Death revives enemies but does not award their score a second time.
    for (let i = 0; i < 3; i++) { game.player.y = 650; tick(1) }
    game.player.x = game.enemies[0].x - 45
    game.keyUp('KeyX'); game.keyDown('KeyX'); tick(3)
    expect(game.getSnapshot().score).toBe(score)
    game.destroy()
  })

  it('crosses an active firewall with a dash and launches from springs', () => {
    const { game, tick } = createGame()
    game.player.x = LEVELS[0].springs[0].x - 10; tick(1)
    expect(game.player.vy).toBe(-850)
    expect(game.player.airJump).toBe(true)
    game.restart()
    game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance()
    tick(205)
    game.player.x = 1165; game.player.y = 412
    game.keyDown('KeyX'); tick(8)
    expect(game.player.x).toBeGreaterThan(1235)
    expect(game.getSnapshot().health).toBe(3)
    game.destroy()
  })

  it('rewards pickup chains and freezes their expiry while paused', () => {
    const { game, tick } = createGame()
    for (const bit of BITS.slice(0, 4)) { game.player.x = bit.x - 15; tick(1) }
    expect(game.getSnapshot().combo).toBeGreaterThanOrEqual(4)
    expect(game.getSnapshot().score).toBeGreaterThan(40)
    const score = game.getSnapshot().score
    vi.spyOn(game, 'draw').mockImplementation(() => undefined)
    game.setPaused(true); tick(300)
    expect(game.getSnapshot().combo).toBeGreaterThanOrEqual(4)
    game.setPaused(false); tick(240)
    expect(game.getSnapshot().combo).toBe(0)
    expect(game.getSnapshot().score).toBe(score)
    game.destroy()
  })

  it('awards an optional rush once, without counting already collected bits', () => {
    const { game, tick } = createGame()
    game.player.x = 1540; tick(1)
    expect(game.getSnapshot().rush.state).toBe('active')
    for (const bit of LEVELS[0].bits.filter(b => b.x >= 1530 && b.x <= 2420).slice(0, 6)) {
      game.player.x = bit.x - 15; game.player.y = bit.y - 20; game.player.vy = 0; tick(1)
    }
    expect(game.getSnapshot()).toMatchObject({ rushWins: 1, rush: { state: 'won', collected: 6 } })
    expect(game.getSnapshot().score).toBeGreaterThanOrEqual(560)
    const score = game.getSnapshot().score
    for (let i = 0; i < 3; i++) { game.player.y = 650; tick(1) }
    expect(game.getSnapshot().rushWins).toBe(1)
    expect(game.getSnapshot().score).toBe(score)
    game.restart()
    expect(game.getSnapshot()).toMatchObject({ rushWins: 0, rush: { state: 'waiting' } })
    game.destroy()
  })

  it('pauses the rush timer and lets a missed challenge leave the route open', () => {
    const { game, tick } = createGame()
    game.player.x = 1540; tick(60)
    const remaining = game.getSnapshot().rush.remaining
    vi.spyOn(game, 'draw').mockImplementation(() => undefined)
    game.setPaused(true); tick(600)
    expect(game.getSnapshot().rush.remaining).toBe(remaining)
    game.setPaused(false); tick(480)
    expect(game.getSnapshot().rush.state).toBe('missed')
    expect(game.getSnapshot().health).toBe(3)
    game.player.x = HOTFIX.x; game.player.y = 412; tick(1)
    game.player.x = EXIT_X; tick(1)
    expect(game.getSnapshot().levelComplete).toBe(true)
    game.destroy()
  })

  it('announces a double wave in the final boss phase and never farms boss hit rewards', () => {
    const { game, tick } = createGame()
    for (let i = 0; i < 2; i++) {
      game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance()
    }
    const hit = () => {
      game.boss.clock = 2.2; game.boss.hit = false
      game.player.x = BOSS_BODY.x + 20; game.player.y = BOSS_BODY.y - game.player.h - 3
      game.player.vy = 220; game.player.grounded = false; game.player.coyote = 0
      tick(1)
    }
    hit()
    const firstScore = game.getSnapshot().score
    expect(firstScore).toBeGreaterThanOrEqual(250)
    game.player.y = 650; tick(1); hit()
    expect(game.getSnapshot().score).toBe(firstScore)
    hit(); expect(game.boss.health).toBe(1)
    game.player.x = 2500; game.player.y = 412; game.player.vy = 0
    game.boss.clock = 0; game.boss.waves = []
    tick(104)
    expect(game.boss.waves).toHaveLength(2)
    game.destroy()
  })

})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BugHuntPrototype, type GameSnapshot } from './prototype'
import { ARENA_X, BOSS_ANNOUNCE, BOSS_BODY, LEVELS, firewallPhase, type Boss, type Platform, BITS, EXIT_X, HOTFIX, PLATFORMS, SPIKES } from './level'

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
  player: { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean; coyote: number; buffer: number; invulnerable: number; airJump: boolean; dash: number; dashCooldown: number
    grapple: { x: number; y: number; length: number } | null; facing: number }
  purgeX: number
  gravitySign: number
  shots: { x: number; y: number; vx: number; life: number; enemy: boolean }[]
  enemies: { x: number; y: number; w: number; h: number; alive: boolean; direction: number; kind?: string; hp?: number; alert?: number; fuse?: number; homeY?: number; left: number; right: number }[]
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
    expect(game.boss.envelopes).toHaveLength(0)
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

  it('throws a double SOAP in the final boss phase and never farms boss hit rewards', () => {
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
    game.boss.clock = 0; game.boss.envelopes = []
    tick(120)
    expect(game.boss.envelopes).toHaveLength(2)
    // Thrown from opposite fists, both arcing back toward a0.
    expect(new Set(game.boss.envelopes.map(e => Math.sign(e.vx))).size).toBe(1)
    expect(game.boss.envelopes.every(e => e.vy > -70)).toBe(true)
    game.destroy()
  })

})

describe('magnetic grapple', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('latches on, keeps a0 on the cable through the swing and launches on release', () => {
    const { game, tick } = createGame()
    const anchor = LEVELS[0].anchors[0]
    game.player.x = anchor.x - 150
    game.player.y = anchor.y + 20
    game.player.grounded = false
    game.keyDown('KeyE')
    expect(game.player.grapple).not.toBeNull()
    for (let frame = 0; frame < 120 && game.player.grapple; frame++) {
      tick(1)
      const cable = game.player.grapple
      if (!cable) break
      const distance = Math.hypot(game.player.x + game.player.w / 2 - cable.x, game.player.y + game.player.h / 2 - cable.y)
      expect(distance).toBeLessThanOrEqual(cable.length + 1.5)
    }
    expect(game.player.grapple).not.toBeNull()
    const falling = game.player.vy
    game.keyUp('KeyE')
    expect(game.player.grapple).toBeNull()
    expect(game.player.vy).toBeLessThan(Math.min(0, falling))
    expect(game.player.dashCooldown).toBe(0)
    game.destroy()
  })

  it('chains grapple -> launch -> dash -> bug without ever touching the ground', () => {
    const { game, tick } = createGame()
    const anchor = LEVELS[0].anchors[4]
    const target = game.enemies.find(b => b.y < 400)!
    game.player.x = anchor.x - 120
    game.player.y = anchor.y + 40
    game.player.grounded = false
    game.player.vx = 200
    let touchedGround = false
    const fly = (frames: number) => {
      for (let frame = 0; frame < frames; frame++) { tick(1); touchedGround ||= game.player.grounded }
    }
    game.keyDown('KeyE')
    expect(game.player.grapple).not.toBeNull()
    fly(40)
    expect(game.player.grapple).not.toBeNull()

    game.keyDown('Space')
    expect(game.player.grapple).toBeNull()
    expect(game.player.vy).toBeLessThan(0)
    expect(game.player.dashCooldown).toBe(0)
    game.keyUp('Space')
    fly(2)

    target.x = game.player.x + 80
    target.left = target.x - 10
    target.right = target.x + 10
    target.y = game.player.y + 6
    target.homeY = target.y
    target.alive = true
    game.keyDown('KeyX')
    expect(game.player.dash).toBeGreaterThan(0)
    fly(10)

    expect(target.alive).toBe(false)
    expect(touchedGround).toBe(false)
    game.destroy()
  })

  it('never latches without a node in range and leaves the run untouched', () => {
    const { game, tick } = createGame()
    game.player.x = 60
    game.player.y = 412
    game.keyDown('KeyE')
    expect(game.player.grapple).toBeNull()
    tick(5)
    expect(game.getSnapshot()).toMatchObject({ health: 3, deaths: 0 })
    game.destroy()
  })
})

describe('the floor is being deleted', () => {
  const reachProduction = () => {
    const { game, tick } = createGame()
    for (let stage = 0; stage < 2; stage++) { game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance() }
    return { game, tick }
  }
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('only runs in production and wakes up behind a0', () => {
    const { game, tick } = createGame()
    expect(game.getSnapshot().purge).toBe('off')
    tick(30)
    expect(game.getSnapshot().purge).toBe('off')
    game.destroy()

    const production = reachProduction()
    expect(production.game.getSnapshot()).toMatchObject({ level: 2, purge: 'waiting' })
    production.game.player.x = LEVELS[2].purge!.start + 10
    production.tick(1)
    expect(production.game.getSnapshot().purge).toBe('active')
    expect(production.game.purgeX).toBeLessThan(production.game.player.x)
    production.game.destroy()
  })

  it('deletes the floor behind and costs a life to whoever stops running', () => {
    const { game, tick } = reachProduction()
    for (const bug of game.enemies) bug.alive = false
    game.player.x = LEVELS[2].purge!.start + 10
    tick(126)
    expect(game.platforms.some(p => p.deleted)).toBe(true)
    expect(game.getSnapshot()).toMatchObject({ health: 3, purge: 'active' })
    tick(60)
    expect(game.getSnapshot().health).toBe(2)
    expect(game.getSnapshot().purge).toBe('waiting')
    expect(game.platforms.every(p => !p.deleted)).toBe(true)
    game.destroy()
  })

  it('pays out and stands down once a0 outruns it', () => {
    const { game, tick } = reachProduction()
    game.player.x = LEVELS[2].purge!.start + 10
    tick(1)
    const before = game.getSnapshot().score
    game.player.x = LEVELS[2].purge!.end + 5
    tick(1)
    expect(game.getSnapshot().purge).toBe('cleared')
    expect(game.getSnapshot().score).toBe(before + 400)
    game.destroy()
  })
})

describe('debug gun and reactive bugs', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  const patrol = (game: Inspectable) => game.enemies.find(b => b.alive && !b.kind)!

  it('fires in the facing direction and closes a ticket on impact', () => {
    const { game, tick } = createGame()
    const bug = patrol(game)
    bug.hp = 1
    game.player.x = bug.x - 200
    game.player.y = 412
    game.player.facing = 1
    game.keyDown('KeyF')
    expect(game.shots.length).toBe(1)
    expect(game.shots[0].vx).toBeGreaterThan(0)
    for (let frame = 0; frame < 40 && bug.alive; frame++) tick(1)
    expect(bug.alive).toBe(false)
    expect(game.getSnapshot().bugs).toBeGreaterThan(0)
    game.destroy()
  })

  it('needs two packets for an armoured bug and rate limits the trigger', () => {
    const { game, tick } = createGame()
    const bug = patrol(game)
    bug.hp = 2
    game.player.x = bug.x - 150
    game.player.y = 412
    game.player.facing = 1
    game.keyDown('KeyF')
    tick(1)
    expect(game.shots.filter(s => !s.enemy).length).toBe(1)
    for (let frame = 0; frame < 20 && bug.alive; frame++) tick(1)
    expect(bug.alive).toBe(true)
    expect(bug.hp).toBe(1)
    for (let frame = 0; frame < 60 && bug.alive; frame++) tick(1)
    expect(bug.alive).toBe(false)
    game.destroy()
  })

  it('wakes a chaser that charges a0 and still refuses to leave its band', () => {
    const { game, tick } = createGame()
    const chaser = game.enemies.find(b => b.kind === 'chaser')!
    game.player.x = chaser.x - 260
    game.player.y = 412
    const start = chaser.x
    tick(90)
    expect(chaser.alert).toBeGreaterThan(0.6)
    expect(chaser.x).toBeLessThan(start - 40)
    tick(600)
    expect(chaser.x).toBeGreaterThanOrEqual(chaser.left)
    expect(chaser.x).toBeLessThanOrEqual(chaser.right)
    game.destroy()
  })

  it('lets a turret telegraph a bolt that hurts, and lets a0 shoot it down', () => {
    const { game, tick } = createGame()
    for (const bug of game.enemies) bug.alive = bug.kind === 'turret'
    const turret = game.enemies.find(b => b.kind === 'turret')!
    game.player.x = turret.x - 300
    game.player.y = 412
    tick(1)
    expect(game.shots.some(s => s.enemy)).toBe(false)
    for (let frame = 0; frame < 130 && !game.shots.some(s => s.enemy); frame++) tick(1)
    const bolt = game.shots.find(s => s.enemy)!
    expect(bolt).toBeDefined()
    expect(bolt.vx).toBeLessThan(0)
    const health = game.getSnapshot().health
    for (let frame = 0; frame < 200 && game.getSnapshot().health === health; frame++) tick(1)
    expect(game.getSnapshot().health).toBe(health - 1)
    game.destroy()
  })

  it('cancels an incoming bolt with a debug packet', () => {
    const { game, tick } = createGame()
    for (const bug of game.enemies) bug.alive = false
    game.player.x = 700
    game.player.y = 412
    game.player.facing = 1
    game.shots.push({ x: 900, y: game.player.y + 17, vx: -250, life: 2.6, enemy: true })
    game.keyDown('KeyF')
    for (let frame = 0; frame < 60 && game.shots.length; frame++) tick(1)
    expect(game.shots.length).toBe(0)
    expect(game.getSnapshot().health).toBe(3)
    game.destroy()
  })
})

describe('the Monolith rewrites the rules', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Drops a0 into the arena with the campaign already at Production. */
  const arena = (x = 2600) => {
    const { game, tick } = createGame()
    for (let stage = 0; stage < 2; stage++) { game.player.x = HOTFIX.x; tick(1); game.player.x = EXIT_X; tick(1); game.advance() }
    game.player.x = x
    game.player.y = 412
    // The rule under test is the subject; the ground wave is not.
    const quiet = (frames: number) => { for (let f = 0; f < frames; f++) { game.boss.envelopes.length = 0; tick(1) } }
    return { game, tick, quiet }
  }
  const announce = Math.ceil(BOSS_ANNOUNCE * 60) + 2

  it('announces a command before it can change anything', () => {
    const { game, quiet } = arena()
    quiet(1)
    expect(game.getSnapshot()).toMatchObject({ bossCommand: 'gravity', bossAnnounce: true })
    expect(game.gravitySign).toBe(1)
    quiet(40)
    expect(game.gravitySign).toBe(1)
    quiet(announce)
    expect(game.getSnapshot().bossAnnounce).toBe(false)
    expect(game.gravitySign).toBe(-1)
    game.destroy()
  })

  it('reverse gravity lands a0 on the arena ceiling, and leaving the arena undoes it', () => {
    const { game, quiet } = arena()
    quiet(announce)
    expect(game.gravitySign).toBe(-1)
    quiet(90)
    const ceiling = game.platforms.find(p => p.ceiling)!
    expect(game.player.grounded).toBe(true)
    expect(game.player.y).toBeCloseTo(ceiling.y + ceiling.h, 1)
    expect(game.getSnapshot().health).toBe(3)

    game.player.x = ARENA_X - 60
    quiet(1)
    expect(game.gravitySign).toBe(1)
    game.destroy()
  })

  it('fork() spawns three clones that charge a0', () => {
    const { game, quiet } = arena()
    quiet(1)
    game.boss.health = 2
    quiet(1)
    expect(game.getSnapshot()).toMatchObject({ bossCommand: 'clones', bossAnnounce: true })
    const before = game.enemies.filter(b => b.alive).length
    quiet(announce)
    const clones = game.enemies.filter(b => b.alive && b.kind === 'chaser' && b.x > 2450)
    expect(clones.length).toBe(3)
    expect(game.enemies.filter(b => b.alive).length).toBe(before + 3)
    quiet(60)
    expect(clones.some(c => (c.alert ?? 0) > 0.6)).toBe(true)
    game.destroy()
  })

  it('stop platforms drops the arena slabs one at a time, never all at once', () => {
    const { game, quiet } = arena()
    quiet(1)
    game.boss.health = 1
    quiet(announce)
    const slabs = game.platforms.filter(p => p.arena)
    expect(slabs.length).toBe(3)
    const dropped = new Set<number>()
    let sawFullHouse = false
    for (let frame = 0; frame < 400; frame++) {
      quiet(1)
      const offline = slabs.filter(p => p.deleted)
      expect(offline.length).toBeLessThanOrEqual(1)
      if (!offline.length) sawFullHouse = true
      for (const [index, slab] of slabs.entries()) if (slab.deleted) dropped.add(index)
    }
    expect(dropped.size).toBe(3)
    expect(sawFullHouse).toBe(true)
    game.destroy()
  })

  it('keeps the drop onto the core clear of any platform', () => {
    // A slab above the core catches the fall that damages it, and the boss
    // becomes unbeatable. Nothing solid may sit in the approach band.
    const top = BOSS_BODY.y
    const blocking = LEVELS[2].platforms.filter(p =>
      p.y + p.h > top - 170 && p.y <= top
      && p.x < BOSS_BODY.x + BOSS_BODY.w && p.x + p.w > BOSS_BODY.x)
    expect(blocking.map(p => `${p.x},${p.y}`)).toEqual([])
  })

  it('throws SOAP envelopes from a fist, arcing toward a0', () => {
    const { game, tick } = arena(2600)
    for (let frame = 0; frame < 90 && !game.boss.envelopes.length; frame++) tick(1)
    expect(game.boss.envelopes).toHaveLength(1)
    const envelope = game.boss.envelopes[0]
    // Out of a fist far from the core, heading back toward a0.
    expect(envelope.x).toBeGreaterThan(2900)
    expect(Math.sign(envelope.vx)).toBe(-1)
    const rising = envelope.vy
    const height = envelope.y
    tick(20)
    expect(envelope.vy).toBeGreaterThan(rising)
    expect(envelope.y).not.toBe(height)
    game.destroy()
  })

  it('lets a0 shoot a SOAP envelope out of the air, and stings when it connects', () => {
    const { game, tick } = arena(2600)
    for (const bug of game.enemies) bug.alive = false
    game.player.facing = 1
    game.boss.envelopes.push({ x: game.player.x + 150, y: game.player.y + 8, w: 36, h: 26, vx: -252, vy: -70, spin: 0 })
    const score = game.getSnapshot().score
    for (let frame = 0; frame < 40 && game.boss.envelopes.length; frame++) { game.keyDown('KeyF'); game.keyUp('KeyF'); tick(1) }
    expect(game.boss.envelopes).toHaveLength(0)
    expect(game.getSnapshot().score).toBeGreaterThan(score)
    expect(game.getSnapshot().health).toBe(3)

    // The one a0 does not shoot takes a heart.
    game.boss.envelopes.push({ x: game.player.x + 20, y: game.player.y + 8, w: 36, h: 26, vx: -252, vy: 0, spin: 0 })
    tick(2)
    expect(game.getSnapshot().health).toBe(2)
    game.destroy()
  })

  it('puts the live rule back the moment the phase ends', () => {
    const { game, quiet } = arena()
    quiet(announce + 30)
    expect(game.gravitySign).toBe(-1)

    // A real hit on the open core: jump DOWN onto it, as the hint says.
    game.boss.clock = 3
    game.boss.hit = false
    game.player.x = 2850
    game.player.y = BOSS_BODY.y - game.player.h - 2
    game.player.vy = 300
    game.player.grounded = false
    quiet(1)
    expect(game.boss.health).toBe(2)
    expect(game.gravitySign).toBe(1)
    quiet(1)
    expect(game.getSnapshot()).toMatchObject({ bossCommand: 'clones', bossAnnounce: true })
    game.destroy()
  })
})

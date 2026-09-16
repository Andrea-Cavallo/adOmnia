import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BugHuntPrototype, type GameSnapshot } from './prototype'
import { BITS, EXIT_X, HOTFIX, PLATFORMS, SPIKES } from './level'

type Inspectable = {
  keyDown: (code: string) => void
  keyUp: (code: string) => void
  destroy: () => void
  restart: () => void
  setPaused: (paused: boolean) => void
  getSnapshot: () => GameSnapshot
  draw: () => void
  update: (dt: number) => void
  player: { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean; coyote: number; buffer: number; invulnerable: number }
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
    expect(game.getSnapshot().finished).toBe(true)
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
    for (let frame = 0; frame < 3600 && !game.getSnapshot().finished; frame++) {
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
    expect(game.getSnapshot(), `${trace.join('; ')}; final ${game.player.x},${game.player.y}`).toMatchObject({ checkpoint: true, hotfix: true, finished: true })
    game.destroy()
  })
})

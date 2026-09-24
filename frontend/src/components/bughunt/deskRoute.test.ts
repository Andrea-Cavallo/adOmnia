import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEVELS, levelCheckpoints, type Bug, type Platform } from './level'
import { BugHuntPrototype } from './prototype'
import type { Particle, PlayerVisual } from './visuals'
import type { Difficulty } from './difficulty'

describe('Developer Desk learning beats', () => {
  beforeEach(() => { vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
  afterEach(() => vi.unstubAllGlobals())
  it('keeps the first jumps safe and teaches only one zombie and one flyer before the first arena', () => {
    const map = LEVELS[0]
    for (let x = 0; x < 1540; x += 10) expect(map.platforms.some(p => !p.floating && p.y <= 510 && p.x <= x && p.x + p.w >= x)).toBe(true)
    expect(map.bugs.filter(b => b.x >= 800 && b.x < 1540).map(b => b.kind).sort()).toEqual(['flyer', 'zombie'])
    expect(map.platforms.filter(p => p.x < 1600).every(p => !p.unstable && !p.travel && p.pulse === undefined)).toBe(true)
    expect(map.anchors.every(a => a.x >= 2400)).toBe(true)
    expect(map.bugs.filter(b => b.x >= 2400 && b.x < 3100).map(b=>b.kind)).toEqual(['leak'])
    expect(levelCheckpoints(0)).toEqual([1090, 3130, 4960])
  })

  it.each(([900, 4380] as const).flatMap(start => (['development', 'testing', 'production'] as Difficulty[]).map(difficulty => ({ start, difficulty }))))('book staircase $start is traversable with ordinary jumps on $difficulty', ({ start, difficulty }) => {
    const instance = new BugHuntPrototype({ getContext: () => ({}) } as unknown as HTMLCanvasElement, () => {}, { difficulty })
    const game = instance as unknown as { player: PlayerVisual; enemies: Bug[]; platforms: Platform[]; update(dt: number): void }
    game.enemies.forEach(b => { b.alive = false })
    game.player.x = start === 900 ? 680 : start - 70
    const finish = start === 900 ? 1510 : 4970
    instance.keyDown('KeyD')
    for (let i = 0; i < 600 && game.player.x < finish; i++) {
      const p = game.player
      if (p.grounded) {
        instance.keyUp('Space')
        if (game.platforms.some(s => !s.floating && s.y < p.y + p.h && s.x >= p.x + p.w - 1 && s.x - p.x - p.w < 65)) instance.keyDown('Space')
      }
      game.update(1 / 60)
    }
    expect(game.player.x).toBeGreaterThanOrEqual(finish)
    expect(instance.getSnapshot().deaths).toBe(0)
    expect(instance.getSnapshot().commit).toBe(start === 900 ? 1 : 3)
    expect(instance.getSnapshot().health).toBe(difficulty === 'development' ? Infinity : difficulty === 'testing' ? 4 : 3)
    instance.destroy()
  })

  it('leaves short-lived smoke behind running feet and honours gentle effects', () => {
    const instance = new BugHuntPrototype({ getContext: () => ({}) } as unknown as HTMLCanvasElement, () => {})
    const game = instance as unknown as { player: PlayerVisual; particles: Particle[]; update(dt: number): void }
    instance.keyDown('KeyD')
    for (let i = 0; i < 15; i++) game.update(1 / 60)
    const smoke = game.particles.filter(p => p.smoke)
    expect(smoke.length).toBeGreaterThan(0)
    expect(smoke.every(p => p.x < game.player.x + game.player.w / 2 && p.maxLife <= .5)).toBe(true)
    instance.setReducedMotion(true)
    for (let i = 0; i < 40; i++) game.update(1 / 60)
    expect(game.particles.some(p => p.smoke)).toBe(false)
    instance.destroy()
  })
})

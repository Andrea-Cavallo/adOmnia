import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BugHuntPrototype } from './prototype'
import { livesFor, type Difficulty } from './difficulty'
import { loadPreferences, savePreferences } from './preferences'

type Inspectable = { update(dt: number): void; hurt(fell?: boolean): void; player: { y: number; invulnerable: number }; levelComplete: boolean }
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
afterEach(() => vi.unstubAllGlobals())

it.each(['testing', 'production'] as Difficulty[])('%s consumes exactly its life budget and restores it on restart', difficulty => {
  const game = new BugHuntPrototype({ getContext: () => ({}) } as unknown as HTMLCanvasElement, () => {}, { difficulty })
  const state = game as unknown as Inspectable
  for (let left = livesFor(difficulty) - 1; left >= 0; left--) {
    state.player.y = 650; state.update(1 / 60)
    expect(game.getSnapshot()).toMatchObject({ health: left, gameOver: left === 0, difficulty })
  }
  game.restart()
  expect(game.getSnapshot()).toMatchObject({ health: livesFor(difficulty), gameOver: false, difficulty })
  game.destroy()
})
it('development survives repeated hits and falls, including after restarting', () => {
  const game = new BugHuntPrototype({ getContext: () => ({}) } as unknown as HTMLCanvasElement, () => {})
  game.setDifficulty('development')
  const state = game as unknown as Inspectable
  for (let i = 0; i < 15; i++) {
    state.player.invulnerable = 0; state.hurt()
    state.player.y = 650; state.update(1 / 60)
    expect(state.player.y).toBeLessThan(540)
    expect(game.getSnapshot()).toMatchObject({ health: Infinity, gameOver: false })
  }
  game.restart()
  expect(game.getSnapshot().health).toBe(Infinity)
  game.destroy()
})
it('testing keeps remaining lives across stages and cannot change difficulty mid-run', () => {
  const game = new BugHuntPrototype({ getContext: () => ({}) } as unknown as HTMLCanvasElement, () => {}, { difficulty: 'testing' })
  const state = game as unknown as Inspectable
  state.player.y = 650; state.update(1 / 60)
  game.setDifficulty('development')
  state.levelComplete = true; game.advance()
  expect(game.getSnapshot()).toMatchObject({ level: 1, difficulty: 'testing', health: 3 })
  game.destroy()
})
it('separates difficulty records while preserving existing production records', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  savePreferences({ audio: false, reducedMotion: true, bestScore: 100, bestBits: 30, bestSeconds: 200 })
  expect(loadPreferences('development')).toMatchObject({ audio: false, reducedMotion: true, bestScore: 0, bestSeconds: null })
  savePreferences({ ...loadPreferences('development'), bestScore: 9999 }, 'development')
  expect(loadPreferences('development').bestScore).toBe(9999)
  expect(loadPreferences('production').bestScore).toBe(100)
  expect(loadPreferences('testing').bestScore).toBe(0)
})

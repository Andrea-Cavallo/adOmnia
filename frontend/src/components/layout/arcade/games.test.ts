import { describe, expect, it } from 'vitest'
import { bestMove, tictactoeGame, winner, type Mark } from './tictactoe'
import { advanceBall, pongGame } from './pong'
import { asteroidsGame, collide } from './asteroids'
import { pickGame } from './DotArcade'

describe('tris', () => {
  it('finds the winner and the AI blocks or wins', () => {
    expect(winner([1, 1, 1, 0, 0, 0, 0, 0, 0])?.line).toEqual([0, 1, 2])
    const block: Mark[] = [1, 1, 0, 0, 2, 0, 0, 0, 0]
    expect(bestMove(block)).toBe(2)
    const win: Mark[] = [2, 2, 0, 1, 1, 0, 0, 0, 0]
    expect(bestMove(win)).toBe(2)
  })

  it('places the player mark and hands the turn to the AI', () => {
    const s = tictactoeGame.press(tictactoeGame.init(30, 18), 'action')
    expect(s.cells[4]).toBe(1)
    expect(s.aiWait).toBeGreaterThan(0)
    const after = tictactoeGame.update(s, 1, new Set())
    expect(after.cells.filter(m => m === 2)).toHaveLength(1)
  })
})

describe('pong', () => {
  it('bounces off walls and scores a miss', () => {
    const s = { ...pongGame.init(30, 18), serve: 0 }
    const wall = advanceBall({ ...s, ball: { x: 15, y: 0.1, vx: 0, vy: -10 } }, 0.05)
    expect(wall.ball.vy).toBeGreaterThan(0)
    const miss = advanceBall({ ...s, you: 0, ball: { x: 0, y: 17, vx: -20, vy: 0 } }, 0.1)
    expect(miss.scoreAi).toBe(1)
  })

  it('returns the ball faster off the player paddle', () => {
    const s = { ...pongGame.init(30, 18), serve: 0, you: 7 }
    const hit = advanceBall({ ...s, ball: { x: 1.6, y: 8, vx: -10, vy: 0 } }, 0.02)
    expect(hit.ball.vx).toBeGreaterThan(10)
  })
})

describe('asteroids', () => {
  it('splits a big rock hit by a bullet and ends on a crash', () => {
    const s = asteroidsGame.init(30, 18)
    const rock = { x: 5, y: 5, vx: 1, vy: 0, r: 2 }
    const hit = collide({ ...s, rocks: [rock], bullets: [{ x: 5.5, y: 5, vx: 0, vy: 0, life: 1 }] })
    expect(hit.score).toBe(1)
    expect(hit.rocks).toHaveLength(2)
    expect(hit.bullets).toHaveLength(0)
    const crash = collide({ ...s, shield: 0, rocks: [{ ...rock, x: s.ship.x, y: s.ship.y }], bullets: [] })
    expect(crash.over).toBe(true)
  })
})

describe('arcade', () => {
  it('never picks the same game twice in a row', () => {
    for (const r of [0, 0.5, 0.99]) expect(pickGame('pong', () => r)).not.toBe('pong')
  })
})

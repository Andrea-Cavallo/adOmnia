import { describe, expect, it } from 'vitest'
import { newGame, step, turn, type SnakeState } from './snake'

const base = (over: Partial<SnakeState> = {}): SnakeState => ({
  cols: 10, rows: 10, snake: [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }], dir: 'right', food: { x: 9, y: 9 }, score: 0, over: false, ...over,
})

describe('snake rules', () => {
  it('moves, grows on food and scores', () => {
    const moved = step(base())
    expect(moved.snake.map(c => c.x)).toEqual([4, 3, 2])
    const fed = step(base({ food: { x: 4, y: 5 } }), () => 0)
    expect(fed.snake).toHaveLength(4)
    expect(fed.score).toBe(1)
    expect(fed.snake.some(c => c.x === fed.food.x && c.y === fed.food.y)).toBe(false)
  })

  it('ends on walls and on its own body, and never reverses', () => {
    expect(step(base({ snake: [{ x: 9, y: 5 }, { x: 8, y: 5 }] })).over).toBe(true)
    const loop = base({ dir: 'up', snake: [{ x: 3, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }] })
    expect(step(loop).over).toBe(true)
    expect(turn('right', 'left')).toBe('right')
    expect(turn('right', 'up')).toBe('up')
  })

  it('starts inside the board with food on a free cell', () => {
    const game = newGame(20, 12, () => 0.5)
    expect(game.snake[0].x).toBeLessThan(20)
    expect(game.snake.some(c => c.x === game.food.x && c.y === game.food.y)).toBe(false)
  })
})

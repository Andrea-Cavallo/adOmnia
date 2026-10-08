// Snake: pure rules (newGame/step/turn) plus the DotGame adapter for the Hub arcade.
import type { DotGame } from './types'

export type Dir = 'up' | 'down' | 'left' | 'right'
export interface Cell { x: number; y: number }
export interface SnakeState {
  cols: number
  rows: number
  snake: Cell[] // head first
  dir: Dir
  food: Cell
  score: number
  over: boolean
}

const DELTA: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y

export function placeFood(cols: number, rows: number, snake: Cell[], random: () => number = Math.random): Cell {
  const free: Cell[] = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!snake.some(c => c.x === x && c.y === y)) free.push({ x, y })
  return free.length ? free[Math.floor(random() * free.length)] : snake[0]
}

export function newGame(cols: number, rows: number, random: () => number = Math.random): SnakeState {
  const y = Math.floor(rows / 2), x = Math.floor(cols / 3)
  const snake = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }]
  return { cols, rows, snake, dir: 'right', food: placeFood(cols, rows, snake, random), score: 0, over: false }
}

/** A turn into the opposite direction is ignored: the snake cannot reverse into itself. */
export function turn(dir: Dir, next: Dir): Dir {
  return next === OPPOSITE[dir] ? dir : next
}

/** Advances one tick. Walls and the snake's own body end the game. */
export function step(state: SnakeState, random: () => number = Math.random): SnakeState {
  if (state.over) return state
  const d = DELTA[state.dir]
  const head = { x: state.snake[0].x + d.x, y: state.snake[0].y + d.y }
  const eats = same(head, state.food)
  const body = eats ? state.snake : state.snake.slice(0, -1)
  const hitsWall = head.x < 0 || head.y < 0 || head.x >= state.cols || head.y >= state.rows
  if (hitsWall || body.some(c => same(c, head))) return { ...state, over: true }
  const snake = [head, ...body]
  return eats
    ? { ...state, snake, score: state.score + 1, food: placeFood(state.cols, state.rows, snake, random), over: snake.length === state.cols * state.rows }
    : { ...state, snake }
}

// ---- Arcade adapter ---------------------------------------------------------

interface SnakeGame { board: SnakeState; next: Dir; acc: number; time: number; ateAt: number }

// Faster as the snake grows, never below 55 ms per step.
const stepSeconds = (score: number) => Math.max(0.055, 0.12 - score * 0.003)

export const snakeGame: DotGame<SnakeGame> = {
  id: 'snake',
  title: 'Snake',
  help: 'Arrows to steer · P to pause',
  realtime: true,
  init: (cols, rows) => ({ board: newGame(cols, rows), next: 'right', acc: 0, time: 0, ateAt: -1 }),
  press: (s, key) => (key === 'action' ? s : { ...s, next: key }),
  update(s, dt) {
    let { board, acc } = s
    const time = s.time + dt
    let ateAt = s.ateAt
    acc += dt
    while (acc >= stepSeconds(board.score) && !board.over) {
      acc -= stepSeconds(board.score)
      const before = board.score
      board = step({ ...board, dir: turn(board.dir, s.next) })
      if (board.score > before) ateAt = time
    }
    return { ...s, board, acc, time, ateAt }
  },
  draw(s, paint, time) {
    const { snake, food } = s.board
    snake.forEach((c, i) => {
      if (i === 0) paint.dot(c.x, c.y, 'accent', 1.2)
      else paint.dot(c.x, c.y, 'accent', Math.max(0.7, 1 - i * 0.012))
    })
    paint.dot(food.x, food.y, 'ink', 1.05 + Math.sin(time * 8) * 0.15)
    // A short accent ring around the head when it eats.
    if (s.time - s.ateAt < 0.18) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) paint.dot(snake[0].x + dx, snake[0].y + dy, 'accent', 0.6)
  },
  status: s => ({ score: s.board.score, over: s.board.over, message: s.board.snake.length === s.board.cols * s.board.rows ? 'You win' : 'Game over' }),
}

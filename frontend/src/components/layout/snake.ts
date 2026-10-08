// Pure Snake rules for the Hub's dot-matrix game: no DOM, no timers.

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
    ? { ...state, snake, score: state.score + 1, food: placeFood(state.cols, state.rows, snake, random) }
    : { ...state, snake }
}

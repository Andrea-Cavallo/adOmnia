// Tic-tac-toe (Tris) against a minimax AI that sometimes slips, so it can be beaten.
import type { DotGame } from './types'

export type Mark = 0 | 1 | 2 // empty, player (X), AI (O)
export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
const AI_SLIP = 0.2 // chance the AI plays a random move instead of the best one
const AI_DELAY = 0.45

export function winner(cells: readonly Mark[]): { mark: Mark; line: number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return { mark: cells[a], line }
  }
  return null
}

function minimax(cells: Mark[], turn: Mark): number {
  const win = winner(cells)
  if (win) return win.mark === 2 ? 1 : -1
  if (cells.every(Boolean)) return 0
  let best = turn === 2 ? -2 : 2
  for (let i = 0; i < 9; i++) {
    if (cells[i]) continue
    cells[i] = turn
    const score = minimax(cells, turn === 2 ? 1 : 2)
    cells[i] = 0
    best = turn === 2 ? Math.max(best, score) : Math.min(best, score)
  }
  return best
}

/** The AI's best square (O), or -1 when the board is full. */
export function bestMove(cells: readonly Mark[]): number {
  const work = [...cells]
  let best = -1, bestScore = -2
  for (let i = 0; i < 9; i++) {
    if (work[i]) continue
    work[i] = 2
    const score = minimax(work, 1)
    work[i] = 0
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}

interface Tris {
  cols: number; rows: number
  cells: Mark[]
  cursor: number
  aiWait: number // > 0 while the AI "thinks"
  result: 'win' | 'lose' | 'draw' | null
  line: number[] | null
  wins: number
}

function settle(s: Tris): Tris {
  const win = winner(s.cells)
  if (win) return { ...s, result: win.mark === 1 ? 'win' : 'lose', line: win.line, wins: s.wins + (win.mark === 1 ? 1 : 0), aiWait: 0 }
  if (s.cells.every(Boolean)) return { ...s, result: 'draw', aiWait: 0 }
  return s
}

function place(s: Tris, index: number): Tris {
  if (s.result || s.aiWait > 0 || s.cells[index]) return s
  const cells = [...s.cells]
  cells[index] = 1
  const after = settle({ ...s, cells, cursor: index })
  return after.result ? after : { ...after, aiWait: AI_DELAY }
}

function layout(s: Tris) {
  const size = Math.max(2, Math.floor((Math.min(s.cols, s.rows) - 2) / 3))
  const board = size * 3 + 2
  return { size, ox: Math.floor((s.cols - board) / 2), oy: Math.floor((s.rows - board) / 2) }
}

export const tictactoeGame: DotGame<Tris> = {
  id: 'tictactoe',
  title: 'Tris',
  help: 'Arrows + Enter, or click a square',
  realtime: false,
  init: (cols, rows) => ({ cols, rows, cells: Array<Mark>(9).fill(0), cursor: 4, aiWait: 0, result: null, line: null, wins: 0 }),
  next: s => ({ ...s, cells: Array<Mark>(9).fill(0), cursor: 4, aiWait: 0, result: null, line: null }),
  press(s, key) {
    if (key === 'action') return place(s, s.cursor)
    const row = Math.floor(s.cursor / 3), col = s.cursor % 3
    const r = key === 'up' ? (row + 2) % 3 : key === 'down' ? (row + 1) % 3 : row
    const c = key === 'left' ? (col + 2) % 3 : key === 'right' ? (col + 1) % 3 : col
    return { ...s, cursor: r * 3 + c }
  },
  pointer(s, x, y) {
    const { size, ox, oy } = layout(s)
    const col = Math.floor((x - ox) / (size + 1)), row = Math.floor((y - oy) / (size + 1))
    if (col < 0 || col > 2 || row < 0 || row > 2 || (x - ox) % (size + 1) === size || (y - oy) % (size + 1) === size) return s
    return place({ ...s, cursor: row * 3 + col }, row * 3 + col)
  },
  update(s, dt) {
    if (s.result || s.aiWait <= 0) return s
    const aiWait = s.aiWait - dt
    if (aiWait > 0) return { ...s, aiWait }
    const free = s.cells.map((m, i) => (m ? -1 : i)).filter(i => i >= 0)
    const move = Math.random() < AI_SLIP ? free[Math.floor(Math.random() * free.length)] : bestMove(s.cells)
    const cells = [...s.cells]
    cells[move] = 2
    return settle({ ...s, cells, aiWait: 0 })
  },
  draw(s, paint, time) {
    const { size, ox, oy } = layout(s)
    const span = size * 3 + 2
    for (let i = 0; i < span; i++) for (const k of [size, size * 2 + 1]) { paint.dot(ox + k, oy + i, 'soft', 0.55); paint.dot(ox + i, oy + k, 'soft', 0.55) }

    s.cells.forEach((mark, i) => {
      if (!mark) return
      const sx = ox + (i % 3) * (size + 1), sy = oy + Math.floor(i / 3) * (size + 1)
      if (mark === 1) for (let k = 0; k < size; k++) { paint.dot(sx + k, sy + k, 'accent'); paint.dot(sx + size - 1 - k, sy + k, 'accent') }
      else {
        const c = (size - 1) / 2
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (Math.abs(Math.hypot(x - c, y - c) - c) < 0.6) paint.dot(sx + x, sy + y, 'ink')
      }
    })
    if (!s.result && s.aiWait <= 0 && !s.cells[s.cursor]) {
      const sx = ox + (s.cursor % 3) * (size + 1), sy = oy + Math.floor(s.cursor / 3) * (size + 1)
      const glow = 0.55 + Math.sin(time * 6) * 0.2
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) paint.dot(sx + x, sy + y, 'ink', glow)
    }
  },
  status: s => ({ score: s.wins, over: s.result !== null, message: s.result === 'win' ? 'You win' : s.result === 'lose' ? 'AI wins' : 'Draw' }),
}

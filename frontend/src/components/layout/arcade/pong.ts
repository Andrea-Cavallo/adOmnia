// Pong: you on the left (up/down), a beatable AI on the right, first to 5.
import type { DotGame, Painter } from './types'

const WIN = 5
const PLAYER_SPEED = 16 // cells per second
const AI_SPEED = 8.5 // slower than the ball at speed, so the AI can be beaten
const SERVE_SPEED = 13
const MAX_SPEED = 30

// 3x5 dot digits for the score drawn on the court.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']
function digit(paint: Painter, n: number, x: number, y: number) {
  const g = DIGITS[n % 10]
  for (let i = 0; i < 15; i++) if (g[i] === '1') paint.dot(x + (i % 3), y + Math.floor(i / 3), 'soft', 0.7)
}

interface Ball { x: number; y: number; vx: number; vy: number }
export interface Pong {
  cols: number; rows: number
  paddle: number // paddle height in cells
  you: number; ai: number // paddle top rows
  ball: Ball
  serve: number // seconds before the ball moves
  scoreYou: number; scoreAi: number
}

function serve(cols: number, rows: number, towardAi: boolean): { ball: Ball; serve: number } {
  const angle = (Math.random() - 0.5) * 0.9
  const dir = towardAi ? 1 : -1
  return { ball: { x: cols / 2, y: rows / 2, vx: Math.cos(angle) * SERVE_SPEED * dir, vy: Math.sin(angle) * SERVE_SPEED }, serve: 0.7 }
}

/** Moves the ball one step: walls bounce, paddles return it faster, a miss scores. */
export function advanceBall(s: Pong, dt: number): Pong {
  let { x, y, vx, vy } = s.ball
  x += vx * dt; y += vy * dt
  if (y < 0) { y = -y; vy = Math.abs(vy) }
  if (y > s.rows - 1) { y = 2 * (s.rows - 1) - y; vy = -Math.abs(vy) }
  const hit = (top: number) => y >= top - 0.6 && y <= top + s.paddle - 0.4
  const english = (top: number) => (y - (top + (s.paddle - 1) / 2)) * 3
  if (vx < 0 && x <= 1.5 && s.ball.x >= 1.5 && hit(s.you)) { x = 1.5; vx = Math.min(MAX_SPEED, Math.abs(vx) * 1.07); vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vy + english(s.you))) }
  if (vx > 0 && x >= s.cols - 2.5 && s.ball.x <= s.cols - 2.5 && hit(s.ai)) { x = s.cols - 2.5; vx = -Math.min(MAX_SPEED, Math.abs(vx) * 1.07); vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vy + english(s.ai))) }
  if (x < -1) return { ...s, scoreAi: s.scoreAi + 1, ...serve(s.cols, s.rows, false) }
  if (x > s.cols) return { ...s, scoreYou: s.scoreYou + 1, ...serve(s.cols, s.rows, true) }
  return { ...s, ball: { x, y, vx, vy } }
}

export const pongGame: DotGame<Pong> = {
  id: 'pong',
  title: 'Pong',
  help: 'Up/Down to move · first to 5 · P to pause',
  realtime: true,
  init(cols, rows) {
    const paddle = Math.max(3, Math.round(rows / 5))
    const mid = Math.round((rows - paddle) / 2)
    return { cols, rows, paddle, you: mid, ai: mid, scoreYou: 0, scoreAi: 0, ...serve(cols, rows, true) }
  },
  press: s => s,
  update(s, dt, held) {
    if (s.scoreYou >= WIN || s.scoreAi >= WIN) return s
    const clamp = (v: number) => Math.max(0, Math.min(s.rows - s.paddle, v))
    const dir = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)
    const you = clamp(s.you + dir * PLAYER_SPEED * dt)
    const target = s.ball.vx > 0 ? s.ball.y - (s.paddle - 1) / 2 : (s.rows - s.paddle) / 2
    const ai = clamp(s.ai + Math.max(-AI_SPEED * dt, Math.min(AI_SPEED * dt, target - s.ai)))
    const moved = { ...s, you, ai }
    if (s.serve > 0) return { ...moved, serve: s.serve - dt }
    return advanceBall(moved, dt)
  },
  draw(s, paint) {
    const mid = Math.floor(s.cols / 2)
    for (let y = 0; y < s.rows; y += 2) paint.dot(mid, y, 'soft', 0.5)
    digit(paint, s.scoreYou, mid - 5, 1)
    digit(paint, s.scoreAi, mid + 3, 1)
    for (let i = 0; i < s.paddle; i++) { paint.dot(0, s.you + i, 'accent'); paint.dot(s.cols - 1, s.ai + i, 'ink') }
    paint.dot(s.ball.x, s.ball.y, 'accent', 1.15)
  },
  status: s => ({ score: s.scoreYou, over: s.scoreYou >= WIN || s.scoreAi >= WIN, message: s.scoreYou >= WIN ? 'You win' : 'AI wins' }),
}

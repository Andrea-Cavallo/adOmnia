// Asteroids on a dot matrix: turn, thrust, fire; big rocks split, the screen wraps.
import { wrap, type DotGame } from './types'

const TURN = 3.6 // radians per second
const THRUST = 16 // cells per second squared
const DRAG = 0.55 // fraction of speed kept per second
const BULLET_SPEED = 24
const BULLET_LIFE = 0.85
const FIRE_EVERY = 0.2
const BIG = 2, SMALL = 1

interface Body { x: number; y: number; vx: number; vy: number }
interface Rock extends Body { r: number }
interface Bullet extends Body { life: number }
export interface Asteroids {
  cols: number; rows: number
  ship: Body & { a: number }
  thrusting: boolean
  bullets: Bullet[]
  rocks: Rock[]
  cooldown: number
  shield: number // seconds of spawn protection
  score: number
  wave: number
  over: boolean
}

function spawnRocks(cols: number, rows: number, count: number, avoid: Body): Rock[] {
  const rocks: Rock[] = []
  while (rocks.length < count) {
    const x = Math.random() * cols, y = Math.random() * rows
    if (Math.hypot(x - avoid.x, y - avoid.y) < 6) continue
    const a = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 2.5
    rocks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: BIG })
  }
  return rocks
}

const move = <T extends Body>(b: T, dt: number, cols: number, rows: number): T => ({ ...b, x: wrap(b.x + b.vx * dt, cols), y: wrap(b.y + b.vy * dt, rows) })
// Shortest distance on the wrapping screen.
const distance = (a: Body, b: Body, cols: number, rows: number) => {
  const dx = Math.min(Math.abs(a.x - b.x), cols - Math.abs(a.x - b.x))
  const dy = Math.min(Math.abs(a.y - b.y), rows - Math.abs(a.y - b.y))
  return Math.hypot(dx, dy)
}

/** Bullets break rocks (big ones split in two small ones); a rock touching the ship ends the game. */
export function collide(s: Asteroids): Asteroids {
  let rocks = s.rocks, bullets = s.bullets, score = s.score
  for (const bullet of s.bullets) {
    const hit = rocks.find(r => distance(r, bullet, s.cols, s.rows) < r.r + 0.6)
    if (!hit) continue
    bullets = bullets.filter(b => b !== bullet)
    rocks = rocks.filter(r => r !== hit)
    score += hit.r === BIG ? 1 : 2
    if (hit.r === BIG) for (const turn of [-1, 1]) {
      const a = Math.atan2(hit.vy, hit.vx) + turn * 0.8, speed = Math.hypot(hit.vx, hit.vy) * 1.4
      rocks = [...rocks, { x: hit.x, y: hit.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: SMALL }]
    }
  }
  const crashed = s.shield <= 0 && rocks.some(r => distance(r, s.ship, s.cols, s.rows) < r.r + 0.7)
  return { ...s, rocks, bullets, score, over: s.over || crashed }
}

export const asteroidsGame: DotGame<Asteroids> = {
  id: 'asteroids',
  title: 'Asteroids',
  help: 'Left/Right turn · Up thrust · Space fire',
  realtime: true,
  init(cols, rows) {
    const ship = { x: cols / 2, y: rows / 2, vx: 0, vy: 0, a: -Math.PI / 2 }
    return { cols, rows, ship, thrusting: false, bullets: [], rocks: spawnRocks(cols, rows, 3, ship), cooldown: 0, shield: 1.5, score: 0, wave: 1, over: false }
  },
  press: s => s,
  update(s, dt, held) {
    if (s.over) return s
    const turn = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
    const thrusting = held.has('up')
    const a = s.ship.a + turn * TURN * dt
    const keep = Math.pow(DRAG, dt)
    const vx = (s.ship.vx + (thrusting ? Math.cos(a) * THRUST * dt : 0)) * keep
    const vy = (s.ship.vy + (thrusting ? Math.sin(a) * THRUST * dt : 0)) * keep
    const ship = { ...move({ ...s.ship, vx, vy }, dt, s.cols, s.rows), a }
    let cooldown = Math.max(0, s.cooldown - dt)
    let bullets = s.bullets.map(b => ({ ...move(b, dt, s.cols, s.rows), life: b.life - dt })).filter(b => b.life > 0)
    if (held.has('action') && cooldown === 0) {
      bullets = [...bullets, { x: ship.x + Math.cos(a), y: ship.y + Math.sin(a), vx: Math.cos(a) * BULLET_SPEED + vx, vy: Math.sin(a) * BULLET_SPEED + vy, life: BULLET_LIFE }]
      cooldown = FIRE_EVERY
    }
    const rocks = s.rocks.map(r => move(r, dt, s.cols, s.rows))
    const next = collide({ ...s, ship, thrusting, bullets, rocks, cooldown, shield: Math.max(0, s.shield - dt) })
    // Cleared the field: a new, bigger wave around a protected ship.
    if (!next.rocks.length) return { ...next, wave: next.wave + 1, shield: 1.5, rocks: spawnRocks(s.cols, s.rows, Math.min(8, 3 + next.wave), ship) }
    return next
  },
  draw(s, paint, time) {
    const { x, y, a } = s.ship
    for (const r of s.rocks) {
      if (r.r === SMALL) { paint.dot(r.x, r.y, 'ink'); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) paint.dot(wrap(r.x + dx, s.cols), wrap(r.y + dy, s.rows), 'soft', 0.8) }
      else for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; paint.dot(wrap(r.x + Math.cos(t) * 2, s.cols), wrap(r.y + Math.sin(t) * 2, s.rows), 'ink', 0.9) }
    }
    for (const b of s.bullets) paint.dot(b.x, b.y, 'accent', 0.7)
    if (s.over && Math.floor(time * 5) % 2 === 0) return
    const shipInk = s.shield > 0 && Math.floor(time * 8) % 2 === 0 ? 'soft' : 'accent'
    paint.dot(wrap(x + Math.cos(a) * 1.3, s.cols), wrap(y + Math.sin(a) * 1.3, s.rows), shipInk, 1.1)
    paint.dot(x, y, shipInk)
    for (const side of [-2.5, 2.5]) paint.dot(wrap(x + Math.cos(a + side), s.cols), wrap(y + Math.sin(a + side), s.rows), shipInk, 0.85)
    if (s.thrusting && Math.floor(time * 20) % 2 === 0) paint.dot(wrap(x - Math.cos(a) * 1.6, s.cols), wrap(y - Math.sin(a) * 1.6, s.rows), 'soft', 0.7)
  },
  status: s => ({ score: s.score, over: s.over, message: 'Ship destroyed' }),
}

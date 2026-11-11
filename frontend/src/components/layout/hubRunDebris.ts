/**
 * Detachable equipment, with its own tiny physics: a helmet and steel plates leave the knight with
 * a real trajectory, spin while they fly, bounce once on the ground and fade out. Pure data, so the
 * rules stay testable and any character can reuse it.
 */
import { groundHeightAt, type Debris, type RunState } from './hubRunModel'

const GRAVITY = 900
/** How long the pieces stay on the ground before fading. */
export const DEBRIS_LIFE = 1.9
/** First bounce keeps this much of the fall, then it settles. */
const BOUNCE = 0.38
const MAX_BOUNCES = 2

interface Piece {
  kind: Debris['kind']
  dx: number
  vx: number
  vy: number
  spin: number
  size: number
}

/** The burst: the helmet goes high and spins, the plates scatter lower and wider. */
const PIECES: readonly Piece[] = [
  { kind: 'helmet', dx: 0, vx: 34, vy: -260, spin: -9, size: 11 },
  { kind: 'plate', dx: 4, vx: 78, vy: -180, spin: 12, size: 7 },
  { kind: 'plate', dx: -5, vx: -66, vy: -205, spin: -14, size: 7 },
  { kind: 'plate', dx: 2, vx: 44, vy: -120, spin: 8, size: 6 },
  { kind: 'rivet', dx: -2, vx: -30, vy: -150, spin: 18, size: 2.5 },
  { kind: 'rivet', dx: 6, vx: 58, vy: -96, spin: -20, size: 2.5 },
]

/** Knocks the knight's equipment off at his chest, toward the way he is facing. */
export function armorBurst(state: RunState, x: number, y: number): Debris[] {
  const floor = groundHeightAt(state, x) ?? y
  const facing = state.knight.facing
  return PIECES.map((piece, index) => ({
    id: state.nextId + index,
    kind: piece.kind,
    x: x + piece.dx * facing,
    y: y - 22,
    vx: piece.vx * facing,
    vy: piece.vy,
    angle: 0,
    spin: piece.spin,
    life: DEBRIS_LIFE,
    bounces: 0,
    floor,
    size: piece.size,
  }))
}

/** One physics step for every loose piece. Returns what is still visible. */
export function stepDebris(debris: readonly Debris[], dt: number): Debris[] {
  const alive: Debris[] = []
  for (const piece of debris) {
    const life = piece.life - dt
    if (life <= 0) continue
    const vy = piece.vy + GRAVITY * dt
    let y = piece.y + vy * dt
    let vx = piece.vx
    let bounce = piece.bounces
    let settledVy = vy
    const floor = piece.floor
    if (y >= floor && vy > 0) {
      if (bounce >= MAX_BOUNCES) {
        y = floor
        settledVy = 0
        vx = 0
      } else {
        y = floor
        settledVy = -vy * BOUNCE
        vx = vx * 0.55
        bounce += 1
      }
    }
    alive.push({
      ...piece,
      x: piece.x + vx * dt,
      y,
      vx,
      vy: settledVy,
      angle: piece.angle + piece.spin * dt,
      spin: bounce >= MAX_BOUNCES ? 0 : piece.spin * 0.72,
      bounces: bounce,
      life,
    })
  }
  return alive
}

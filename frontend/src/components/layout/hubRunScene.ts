/**
 * Drawing the Hub run, frame by frame: the parallax hills, the ground and platforms, and the knight
 * in his own poses (stand, run, jump, fall), built on the pixelfx skeleton so he matches the moves
 * the library animates. Colors are 0xAABBGGRR; translucent ones let the Hub theme show through.
 */
import { READY, posed, type PixelFrame } from 'pixelfx'
import { groundY, type Knight, type RunState } from './hubRunRules'

/** A pose for the pixelfx skeleton: numbers for hands, feet and body, plus the weapon's name. */
export type Pose = Record<string, number | string | boolean>

const GUARD: Pose = { ...READY, weapon: 'sword', fx: 12, fy: -21, sa: -0.85 }
/** Four steps of a run, a stride every 7 px. */
const RUN_POSES: Pose[] = [
  { ...GUARD, crouch: 2, lean: 3, ffx: 9, fbx: -7, fx: 13, fy: -22, bx: 6, by: -22 },
  { ...GUARD, crouch: 4, lean: 3, ffx: 3, fbx: -1, ffy: -7, fx: 12, fy: -21, bx: 8, by: -21 },
  { ...GUARD, crouch: 2, lean: 3, ffx: -7, fbx: 9, fx: 11, fy: -20, bx: 10, by: -20 },
  { ...GUARD, crouch: 4, lean: 3, ffx: -1, fbx: 3, fby: -7, fx: 12, fy: -21, bx: 8, by: -21 },
]
const STRIDE = 7
const JUMP_POSE: Pose = { ...GUARD, crouch: 1, lean: -2, ffx: 6, ffy: -9, fbx: -4, fby: -5, fx: 10, fy: -30, sa: -1.6, bx: -6, by: -30 }
const FALL_POSE: Pose = { ...GUARD, crouch: 0, lean: 2, ffx: 4, ffy: -2, fbx: -6, fby: -6, fx: 14, fy: -26, sa: -0.4, bx: -8, by: -27 }

const HILLS_FAR = 0x22a0a0a0
const HILLS_NEAR = 0x30808080
const GROUND_TOP = 0xff7a6e66
const GROUND_EDGE = 0xff4e4844
const GROUND_BODY = 0xff2e2a28
const GROUND_MORTAR = 0xff24201e
const PLATFORM_TOP = 0xff6a8aa0
const PLATFORM_BODY = 0xff3a4a58
const PLATFORM_HEIGHT = 5
const TILE = 12

function put(frame: PixelFrame, x: number, y: number, color: number): void {
  if (x < 0 || y < 0 || x >= frame.w || y >= frame.h) return
  frame.color[y * frame.w + x] = color
}

/** Two bands of hills that scroll slower than the ground: the strip reads as a world in depth. */
export function drawHills(frame: PixelFrame, cameraX: number): void {
  const bottom = frame.h
  for (let x = 0; x < frame.w; x++) {
    const far = cameraX * 0.2 + x
    const near = cameraX * 0.5 + x
    const farTop = Math.round(bottom - 40 - 10 * Math.sin(far * 0.011) - 6 * Math.sin(far * 0.027 + 1))
    const nearTop = Math.round(bottom - 26 - 8 * Math.sin(near * 0.019 + 2) - 4 * Math.sin(near * 0.043))
    for (let y = Math.max(0, farTop); y < bottom; y++) put(frame, x, y, y >= nearTop ? HILLS_NEAR : HILLS_FAR)
  }
}

/** The ground as stone tiles, and the platforms as planks; pits are simply where there is no ground. */
export function drawTerrain(frame: PixelFrame, state: RunState): void {
  const top = groundY(frame.h)
  for (const span of state.ground) {
    const from = Math.max(0, Math.floor(span.x0 - state.cameraX))
    const to = Math.min(frame.w, Math.ceil(span.x1 - state.cameraX))
    for (let x = from; x < to; x++) {
      const world = x + Math.round(state.cameraX)
      const edge = x === from || x === to - 1
      for (let y = top; y < frame.h; y++) {
        const row = y - top
        const offset = Math.floor(row / TILE) % 2 ? TILE / 2 : 0
        const mortar = row % TILE === TILE - 1 || (world + offset) % TILE === 0
        put(frame, x, y, row === 0 ? GROUND_TOP : edge || row === 1 ? GROUND_EDGE : mortar ? GROUND_MORTAR : GROUND_BODY)
      }
    }
  }
  for (const platform of state.platforms) {
    const from = Math.max(0, Math.floor(platform.x0 - state.cameraX))
    const to = Math.min(frame.w, Math.ceil(platform.x1 - state.cameraX))
    for (let x = from; x < to; x++) {
      for (let row = 0; row < PLATFORM_HEIGHT; row++) put(frame, x, Math.round(platform.y) + row, row === 0 ? PLATFORM_TOP : PLATFORM_BODY)
    }
  }
}

/** The pose for what he is doing: running steps follow the distance, so his feet never slide. */
export function knightPose(knight: Knight, clock: number): Pose {
  if (!knight.grounded) return knight.vy < 0 ? JUMP_POSE : FALL_POSE
  if (Math.abs(knight.vx) > 12) return RUN_POSES[Math.floor(Math.abs(knight.x) / STRIDE) % RUN_POSES.length]
  // Standing: he breathes.
  const up = Math.floor(clock * 3) & 1
  return { ...GUARD, crouch: Number(GUARD.crouch ?? 0) + up, fy: Number(GUARD.fy) + up, by: Number(GUARD.by ?? 0) + up }
}

/** The knight in a pose, feet at (x, y) on screen, mirrored when he faces left. */
export function drawKnight(frame: PixelFrame, pose: Pose, x: number, y: number, facing: 1 | -1): void {
  const pixels = posed(pose)
  const baseX = Math.round(x)
  const baseY = Math.round(y)
  for (let index = 0; index < pixels.n; index++) {
    const px = facing < 0 ? baseX - pixels.xs[index] - 1 : baseX + pixels.xs[index]
    put(frame, px, baseY + pixels.ys[index], pixels.color[index])
  }
}

/** Copies a small frame (an attack drawn in its own space) onto the strip at an offset, glow included. */
export function blit(target: PixelFrame, source: PixelFrame, dx: number, dy: number): void {
  const offsetX = Math.round(dx)
  const offsetY = Math.round(dy)
  for (let y = 0; y < source.h; y++) {
    const ty = y + offsetY
    if (ty < 0 || ty >= target.h) continue
    for (let x = 0; x < source.w; x++) {
      const tx = x + offsetX
      if (tx < 0 || tx >= target.w) continue
      const from = y * source.w + x
      const to = ty * target.w + tx
      if (source.color[from] >>> 24) target.color[to] = source.color[from]
      if (source.light[from]) target.light[to] = addLight(target.light[to], source.light[from])
    }
  }
}

function addLight(a: number, b: number): number {
  const channel = (shift: number) => Math.min(255, ((a >>> shift) & 255) + ((b >>> shift) & 255)) << shift
  return (channel(0) | channel(8) | channel(16) | (0xff << 24)) >>> 0
}

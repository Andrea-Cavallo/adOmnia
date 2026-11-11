/**
 * Painted sheets give each monster one pose, so a walking monster cannot be animated by swapping
 * frames: its legs have to be bent. Every monster is baked once at load into a small strip of
 * frames, each one the same sprite row by row, displaced:
 *
 * - `stride`: the two halves of the lower body, split at the crotch, scissor around the hip.
 * - `flap`: rows are narrowed or widened around the middle, which folds a bat's wings.
 * - `ripple`: rows slide sideways with a phase that travels down the body, which moves a cloak.
 *
 * Frames are baked at three times the drawn size and blitted down, so bending the rows does not
 * leave the sprite soft.
 */
import type { EnemyKind } from './hubRunModel'
import type { SpriteRect } from './hubSpriteSheet'

export type WalkMode = 'stride' | 'flap' | 'ripple'

export interface WalkSpec {
  mode: WalkMode
  /** Height the enemy is drawn at, in pixels. */
  height: number
  frames: number
  /** Height fraction where the body meets the legs. */
  hip?: number
  /** How far each leg swings at the feet, in pixels. */
  stride?: number
  /** How much the torso countersways, as a fraction of `stride`. */
  counter?: number
  /** How much a flap changes a row's width, as a fraction. */
  flap?: number
  /** How far a ripple moves a row, in pixels. */
  ripple?: number
}

export interface WalkFrames {
  /** Frames, baked larger than drawn. Draw them at `w` × `h`. */
  frames: HTMLCanvasElement[]
  /** Size the frames are drawn at; the sprite is centred in them and its feet sit on the bottom. */
  w: number
  h: number
}

/** Where a kind's painted pose lives, and how to bend it into a cycle. */
export interface WalkBake {
  sheet: 'stage' | 'atlas'
  index: number
  spec: WalkSpec
}

/**
 * The monsters whose sheet holds a single pose. Heights match what `hubEnemyArt` draws them at, so
 * a baked frame blits 1:1. Zombies and the reaper keep their painted frames instead.
 */
export const ENEMY_WALKS: Partial<Record<EnemyKind, WalkBake>> = {
  burster: { sheet: 'stage', index: 0, spec: { mode: 'stride', height: 36, frames: 6, stride: 3 } },
  armored: { sheet: 'stage', index: 1, spec: { mode: 'stride', height: 36, frames: 6, stride: 3.2 } },
  warden: { sheet: 'stage', index: 2, spec: { mode: 'stride', height: 58, frames: 6, stride: 5, hip: 0.6, counter: 0.25 } },
  bat: { sheet: 'atlas', index: 10, spec: { mode: 'flap', height: 24, frames: 4, flap: 0.2 } },
  ghost: { sheet: 'atlas', index: 11, spec: { mode: 'ripple', height: 32, frames: 6, ripple: 2.2 } },
  skull: { sheet: 'atlas', index: 11, spec: { mode: 'ripple', height: 45, frames: 6, ripple: 2 } },
}

const TAU = Math.PI * 2
/** The bake runs at this multiple of the drawn size, so a bent sprite stays sharp when scaled down. */
const SUPERSAMPLE = 3
/** Extra room around the baked sprite, in drawn pixels, so a swinging leg is never clipped. */
const PAD = 4

const canvasOf = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * Where the legs part, as a width fraction: the average horizontal position of the body in the band
 * just below the hip. Averaging both legs lands on the crotch, which is the pivot a step needs. Props
 * painted beside a monster sit lower than this band, so they cannot drag the split off the body.
 */
function legSplit(canvas: HTMLCanvasElement, spriteLeft: number, spriteWidth: number, hip: number): number {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return 0.5
  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height).data
  const from = Math.floor(height * Math.min(0.8, hip + 0.02))
  const to = Math.floor(height * Math.min(0.85, hip + 0.3))
  let sum = 0
  let count = 0
  for (let y = from; y < to; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3]
    if (alpha < 24) continue
    sum += x * alpha
    count += alpha
  }
  if (!count) return 0.5
  const centre = sum / count
  return Math.max(0.32, Math.min(0.68, (centre - spriteLeft) / spriteWidth))
}

/** One frame of the cycle: every row of the sprite, displaced. */
function bakeFrame(
  image: CanvasImageSource,
  rect: SpriteRect,
  spec: WalkSpec,
  phase: number,
  split: number,
  create: (width: number, height: number) => HTMLCanvasElement,
): HTMLCanvasElement {
  const h = Math.round(spec.height)
  const w = Math.max(2, Math.round(h * rect.w / rect.h))
  const pad = PAD
  const scale = SUPERSAMPLE
  const canvas = create((w + pad * 2) * scale, h * scale)
  const context = canvas.getContext('2d')
  if (!context) return canvas
  context.imageSmoothingEnabled = true
  context.scale(scale, scale)
  const swing = Math.sin(TAU * phase)
  const hip = spec.hip ?? 0.55
  const stride = spec.stride ?? 0
  const counter = spec.counter ?? 0.3
  const flap = spec.flap ?? 0
  const ripple = spec.ripple ?? 0
  const rowHeight = Math.max(1, (rect.h - 1) / h)
  const middle = pad + w / 2
  for (let ty = 0; ty < h; ty++) {
    const t = h === 1 ? 0 : ty / (h - 1)
    const sourceY = rect.y + t * (rect.h - 1)
    if (spec.mode === 'flap') {
      const fold = 1 + flap * swing * (1 - t) ** 1.2
      const rowWidth = w * fold
      context.drawImage(image, rect.x, sourceY, rect.w, rowHeight, middle - rowWidth / 2, ty, rowWidth, 1)
      continue
    }
    if (spec.mode === 'ripple') {
      context.drawImage(image, rect.x, sourceY, rect.w, rowHeight, pad + ripple * Math.sin(TAU * phase + t * 4) * t, ty, w, 1)
      continue
    }
    const body = t < hip ? -counter * stride * swing * ((hip - t) / hip) : 0
    const leg = t <= hip ? 0 : ((t - hip) / (1 - hip)) ** 1.6
    const dx = stride * swing * leg
    const cut = split * w
    // Left of the split and right of it swing opposite ways: that is the step.
    const leftWidth = cut + 1
    const rightWidth = w - cut + 1
    const leftSource = rect.w * (leftWidth / w)
    context.drawImage(image, rect.x, sourceY, leftSource, rowHeight, pad + body + dx, ty, leftWidth, 1)
    context.drawImage(image, rect.x + leftSource, sourceY, rect.w - leftSource, rowHeight, pad + cut + body - dx, ty, rightWidth, 1)
  }
  return canvas
}

/**
 * Bake a monster's walk cycle once. `create` exists so the same bake can run headless (tests, the
 * filmstrip tool) without a DOM.
 */
export function bakeWalk(
  image: CanvasImageSource,
  rect: SpriteRect,
  spec: WalkSpec,
  create: (width: number, height: number) => HTMLCanvasElement = canvasOf,
): WalkFrames {
  const h = Math.max(2, Math.round(spec.height))
  const w = Math.max(2, Math.round(h * rect.w / rect.h))
  const hip = spec.hip ?? 0.55
  const neutral = bakeFrame(image, rect, { ...spec, stride: 0, flap: 0, ripple: 0 }, 0, 0.5, create)
  const split = spec.mode === 'stride' ? legSplit(neutral, PAD * SUPERSAMPLE, w * SUPERSAMPLE, hip) : 0.5
  const frames = Array.from({ length: spec.frames }, (_, index) => bakeFrame(image, rect, spec, index / spec.frames, split, create))
  return { frames, w: w + PAD * 2, h }
}

/** Bake every walk cycle the renderer may need, from the two enemy sheets. */
export function bakeWalks(
  atlas: HTMLImageElement | HTMLCanvasElement,
  sprites: SpriteRect[],
  stageAtlas: HTMLImageElement | HTMLCanvasElement,
  stageSprites: SpriteRect[],
  create: (width: number, height: number) => HTMLCanvasElement = canvasOf,
): Partial<Record<EnemyKind, WalkFrames>> {
  const walks: Partial<Record<EnemyKind, WalkFrames>> = {}
  for (const [kind, bake] of Object.entries(ENEMY_WALKS) as [EnemyKind, WalkBake][]) {
    const sheet = bake.sheet === 'stage' ? stageAtlas : atlas
    const rect = (bake.sheet === 'stage' ? stageSprites : sprites)[bake.index]
    if (rect) walks[kind] = bakeWalk(sheet, rect, bake.spec, create)
  }
  return walks
}

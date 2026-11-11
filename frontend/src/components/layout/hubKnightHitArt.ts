import hitUrl from '@/assets/hub-game/knight-hit-colored.png'
import { shareRect, spriteBounds, trimSpriteRows, type SpriteRect } from './hubSpriteSheet'
import type { RunState } from './hubRunModel'
import { armorTier } from './hubRunEquipment'

export interface KnightHitArt { atlas: HTMLCanvasElement; rects: SpriteRect[] }
export const HIT_SEQUENCE_SECONDS = 0.75
export function knightHitFrame(age: number): number | null {
  return age < 0 || age >= HIT_SEQUENCE_SECONDS ? null : age < 0.12 ? 0 : age < 0.28 ? 1 : age < 0.5 ? 2 : 3
}
export async function loadKnightHitArt(): Promise<KnightHitArt> {
  const image = new Image(); image.src = hitUrl; await image.decode()
  const rects = spriteBounds(image, 4, 4), atlas = trimSpriteRows(image, rects)
  for (let row = 0; row < 4; row++) shareRect(rects, [0, 1, 2, 3].map(i => row * 4 + i), Math.floor(image.naturalWidth / 4), Math.floor(image.naturalHeight / 4))
  return { atlas, rects }
}
export function drawKnightHit(context: CanvasRenderingContext2D, art: KnightHitArt, state: RunState): boolean {
  const hit = state.stage?.armorBreak
  if (!hit) return false
  const age = state.stage!.elapsed - hit.time, frame = knightHitFrame(age)
  if (frame === null) return false
  const tier = armorTier(state), row = tier === 'verdant' ? 1 : tier === 'arcane' ? 2 : tier === 'royal' ? 3 : 0
  const rect = art.rects[row * 4 + frame], scale = 40 / art.rects[row * 4].h
  context.save(); context.translate(state.knight.x - state.cameraX, state.knight.y)
  context.scale(state.knight.facing, 1)
  if (frame === 0) context.filter = 'brightness(1.65)'
  context.drawImage(art.atlas, rect.x, rect.y, rect.w, rect.h, -rect.w * scale / 2, -rect.h * scale, rect.w * scale, rect.h * scale)
  context.restore()
  return true
}

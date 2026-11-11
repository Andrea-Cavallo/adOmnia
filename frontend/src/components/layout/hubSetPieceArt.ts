import sequenceUrl from '@/assets/hub-game/cemetery-sequence.png'
import oneArmUrl from '@/assets/hub-game/one-armed-zombie.png'
import { spriteBounds, trimSpriteRows, shareRect, type SpriteRect } from './hubSpriteSheet'
import { groundHeightAt, enemyRadius, type Enemy, type RunState } from './hubRunModel'
import { CRASH_PILLAR_X } from './hubRunGargoyle'
import { FALLING_GRAVE_X } from './hubRunSetPiece'

interface Sheet { image: HTMLCanvasElement; rects: SpriteRect[] }
export interface SetPieceArt { scene: Sheet; oneArm: Sheet }
export async function loadSetPieceArt(): Promise<SetPieceArt> {
  const sheets = await Promise.all([[sequenceUrl, 4, 2], [oneArmUrl, 2, 2]].map(async ([url, columns, rows]) => {
    const original = new Image(); original.src = url as string; await original.decode()
    const rects = spriteBounds(original, columns as number, rows as number), image = trimSpriteRows(original, rects)
    if (url === oneArmUrl) shareRect(rects, [0, 1, 2, 3], Math.floor(original.naturalWidth / 2), Math.floor(original.naturalHeight / 2), 2)
    return { image, rects }
  }))
  return { scene: sheets[0], oneArm: sheets[1] }
}
export function sequenceSprite(ctx: CanvasRenderingContext2D, sheet: Sheet, frame: number, x: number, feet: number, h: number, facing: 1 | -1 = 1): void {
  const rect = sheet.rects[frame], w = h * rect.w / rect.h
  ctx.save(); ctx.translate(x, feet); ctx.scale(facing, 1)
  ctx.drawImage(sheet.image, rect.x, rect.y, rect.w, rect.h, -w / 2, -h, w, h)
  ctx.restore()
}
export function drawSetPieceEnemy(ctx: CanvasRenderingContext2D, art: SetPieceArt, state: RunState, enemy: Enemy): boolean {
  const x = enemy.x - state.cameraX, feet = enemy.y + enemyRadius(enemy)
  if (enemy.kind === 'gargoyle') {
    const frame = enemy.hp <= 0 ? 3 : enemy.bossPhase === 'enter' ? 0 : enemy.bossPhase === 'warn' ? 1 : 2
    ctx.save(); if (enemy.dying > 0) ctx.globalAlpha = Math.min(1, enemy.dying * 3)
    sequenceSprite(ctx, art.scene, frame, x, feet, frame === 3 ? 26 : 40, enemy.facing === 1 ? -1 : 1); ctx.restore()
    return true
  }
  if (enemy.kind === 'zombie' && enemy.emerging && enemy.age < 0.38) {
    sequenceSprite(ctx, art.scene, 4, x, feet + (1 - enemy.age / 0.38) * 10, 12)
    return true
  }
  if (enemy.kind === 'zombie' && enemy.armLost && enemy.dying <= 0) {
    const frame = (enemy.knockTime ?? 0) > 0 ? 0 : Math.abs((enemy.armX ?? enemy.x) - enemy.x) < 8 ? 3 : 1 + Math.floor((enemy.stride ?? 0) / 7) % 2
    sequenceSprite(ctx, art.oneArm, frame, x, feet, 36, enemy.facing === 1 ? -1 : 1)
    return true
  }
  return false
}

export function drawSetPieceProps(ctx: CanvasRenderingContext2D, art: SetPieceArt, state: RunState): void {
  const stage = state.stage!
  const graveFloor = groundHeightAt(state, 440)
  if (graveFloor !== null && Math.abs(440 - state.knight.x) < 400) {
    const zombie = state.enemies.find(e => e.kind === 'zombie' && e.x < 550)
    ctx.save(); ctx.translate(448 - state.cameraX, graveFloor)
    ctx.rotate(stage.triggered.includes('first-zombie') ? Math.min(0.28, (zombie?.age ?? 1) * 0.4) : 0)
    sequenceSprite(ctx, art.scene, 6, 0, 0, 25); ctx.restore()
  }
  const floor = groundHeightAt(state, FALLING_GRAVE_X)
  if (floor !== null && Math.abs(FALLING_GRAVE_X - state.knight.x) < 400) {
    const age = stage.fallenStoneAt === undefined ? 0 : stage.elapsed - stage.fallenStoneAt
    ctx.save(); ctx.translate(FALLING_GRAVE_X - state.cameraX, floor)
    ctx.rotate(stage.fallenStoneAt === undefined ? 0 : (stage.stoneDirection ?? 1) * Math.min(1.45, age * 4))
    sequenceSprite(ctx, art.scene, 6, 0, 0, 34); ctx.restore()
    if (stage.fallenStoneAt === undefined && Math.abs(state.knight.x - FALLING_GRAVE_X) < 45) {
      ctx.save(); ctx.font = '6px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = '#e7d7b6'
      ctx.fillText('E / S · TOPPLE', FALLING_GRAVE_X - state.cameraX, floor - 40); ctx.restore()
    }
  }
  const wallFloor = groundHeightAt(state, CRASH_PILLAR_X)
  if (wallFloor !== null && Math.abs(CRASH_PILLAR_X - state.knight.x) < 400) {
    ctx.save(); ctx.globalAlpha = 0.65
    sequenceSprite(ctx, art.scene, 6, CRASH_PILLAR_X - state.cameraX, wallFloor, 50); ctx.restore()
  }
}

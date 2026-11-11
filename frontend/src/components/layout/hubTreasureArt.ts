import treasureUrl from '@/assets/hub-game/chest-rewards.png'
import { spriteBounds, type SpriteRect } from './hubSpriteSheet'
import { placeOnSurface } from './hubRunPlacement'
import { CEMETERY } from './hubRunStages'
import type { GothicArt } from './hubGothicArt'
import type { RunState } from './hubRunModel'

export interface TreasureArt { atlas: HTMLImageElement; rects: SpriteRect[] }
export async function loadTreasureArt(): Promise<TreasureArt> {
  const atlas = new Image(); atlas.src = treasureUrl; await atlas.decode()
  return { atlas, rects: spriteBounds(atlas, 2, 2) }
}

export function drawStageChests(context: CanvasRenderingContext2D, art: GothicArt, state: RunState): void {
  const stage = state.stage!
  for (const chest of CEMETERY.chests) {
    const point = placeOnSurface(state, chest.x, 3, chest.upper), x = chest.x - state.cameraX
    if (!point || x < -40 || x > state.width + 40) continue
    const opened = stage.openedChests.includes(chest.id)
    const age = Math.max(0, stage.elapsed - (stage.chestOpenedAt?.[chest.id] ?? -100))
    const rect = opened ? art.treasure.rects[0] : art.stageSprites[7]
    const width = 24, height = width * rect.h / rect.w
    context.save()
    if (opened && age < 2.2) { context.shadowColor = '#ffda83'; context.shadowBlur = 10 }
    const lift = opened ? Math.min(1, 0.7 + age * 1.5) : 1
    context.drawImage(opened ? art.treasure.atlas : art.stageAtlas, rect.x, rect.y, rect.w, rect.h, x - width / 2, point.y - height * lift, width, height * lift)
    context.shadowBlur = 0
    if (opened && age < 2.2) {
      const weaponItem = chest.contents === 'hammer' || chest.contents === 'daggers'
      const item = weaponItem ? art.action.equipment.rects[chest.contents === 'hammer' ? 0 : 1] : art.treasure.rects[chest.contents === 'potion' ? 1 : chest.contents === 'lance' ? 2 : 3]
      const h = chest.contents === 'potion' ? 14 : 10, w = h * item.w / item.h
      context.globalAlpha = Math.min(1, Math.max(0, (2.2 - age) / 0.5))
      context.drawImage(weaponItem ? art.action.equipment.image : art.treasure.atlas, item.x, item.y, item.w, item.h, x - w / 2, point.y - height - 8 - Math.min(15, age * 18), w, h)
    }
    if (!opened && Math.abs(state.knight.x - chest.x) < 34 && Math.abs(state.knight.y - point.y) < 20) {
      context.font = '6px Georgia'; context.textAlign = 'center'
      context.strokeStyle = '#0e1420'; context.lineWidth = 2; context.fillStyle = '#f5dfad'
      context.strokeText('E / S · OPEN', x, point.y - height - 6)
      context.fillText('E / S · OPEN', x, point.y - height - 6)
    }
    context.restore()
  }
}

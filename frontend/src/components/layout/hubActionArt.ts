import cartoonUrl from '@/assets/hub-game/cartoon-action.png'
import armorUrl from '@/assets/hub-game/armor-action.png'
import equipmentUrl from '@/assets/hub-game/equipment-props.png'
import extrasUrl from '@/assets/hub-game/cartoon-extras.png'
import combatUrl from '@/assets/hub-game/armor-combat.png'
import posesUrl from '@/assets/hub-game/armor-poses.png'
import hammerWalkUrl from '@/assets/hub-game/hammer-walk.png'
import { drawEmergingSoil } from './hubCemeteryArt'
import { spriteBounds, shareRect, trimSpriteRows, type SpriteRect } from './hubSpriteSheet'
import { ARMOR, armorTier, equippedWeapon } from './hubRunEquipment'
import { enemyRadius, type Enemy, type RunState } from './hubRunModel'

interface Sheet { image: HTMLImageElement | HTMLCanvasElement; rects: SpriteRect[] }
export interface ActionArt { cartoon: Sheet; armor: Sheet; equipment: Sheet; extras: Sheet; combat: Sheet; poses: Sheet; hammerWalk: Sheet }
export async function loadActionArt(): Promise<ActionArt> {
  const sheets = await Promise.all([[cartoonUrl, 4, 4], [armorUrl, 4, 3], [equipmentUrl, 4, 2], [extrasUrl, 4, 2], [combatUrl, 4, 5], [posesUrl, 4, 4], [hammerWalkUrl, 4, 5]].map(async ([url, columns, rows]) => {
    const image = new Image(); image.src = url as string; await image.decode()
    const rects = spriteBounds(image, columns as number, rows as number)
    const clean = trimSpriteRows(image, rects)
    if (url !== equipmentUrl) for (let row = 0; row < (rows as number); row++)
      shareRect(rects, [0, 1, 2, 3].map(i => row * 4 + i), Math.floor(image.naturalWidth / 4), Math.floor(image.naturalHeight / (rows as number)))
    return { image: clean, rects }
  }))
  return { cartoon: sheets[0], armor: sheets[1], equipment: sheets[2], extras: sheets[3], combat: sheets[4], poses: sheets[5], hammerWalk: sheets[6] }
}

export function actionSprite(context: CanvasRenderingContext2D, sheet: Sheet, frame: number, x: number, feet: number, height: number, facing: 1 | -1 = 1, base = frame): void {
  const rect = sheet.rects[frame], scale = height / sheet.rects[base].h
  context.save(); context.translate(x, feet); context.scale(facing, 1)
  context.drawImage(sheet.image, rect.x, rect.y, rect.w, rect.h, -rect.w * scale / 2, -rect.h * scale, rect.w * scale, rect.h * scale)
  context.restore()
}

export function drawActionEnemy(context: CanvasRenderingContext2D, art: ActionArt, state: RunState, enemy: Enemy, clock: number): boolean {
  if (!['zombie', 'burster', 'bonecaster'].includes(enemy.kind)) return false
  const x = enemy.x - state.cameraX, floor = enemy.y + enemyRadius(enemy)
  const dying = enemy.dying > 0
  const progress = dying ? 1 - enemy.dying / Math.max(0.01, enemy.dyingFor) : 0
  let sheet = art.cartoon, frame = dying ? 8 + Math.min(3, Math.floor(progress * 4)) : enemy.flash > 0 ? 8 : 4 + Math.floor((enemy.stride ?? 0) / 7) % 4
  if (enemy.kind === 'bonecaster' && !dying && enemy.flash <= 0) {
    sheet = art.extras
    frame = enemy.bossPhase === 'warn' ? 1 : enemy.timer > 1.45 ? 2 : enemy.timer > 1.2 ? 3 : 0
  }
  const rising = enemy.emerging && enemy.age < 0.85 ? 1 - enemy.age / 0.85 : 0
  context.save(); context.globalAlpha = dying ? Math.min(1, (1 - progress) * 4) : 1
  context.fillStyle = 'rgba(3,7,12,.35)'; context.beginPath(); context.ellipse(x, floor, 10, 2, 0, 0, Math.PI * 2); context.fill()
  context.beginPath(); context.rect(x - 65, floor - 95, 130, 95); context.clip()
  if (enemy.flash > 0) context.filter = 'brightness(1.45)'
  if (enemy.kind === 'burster' && enemy.bossPhase === 'warn') {
    const pulse = Math.sin(clock * 22) * 0.04
    context.translate(x, floor); context.scale(1.12 + pulse, 0.88 - pulse); context.translate(-x, -floor)
    context.filter = 'sepia(.7) brightness(1.2)'
  }
  const tilt = dying && frame === 10 ? Math.sin(progress * Math.PI) * -5 : 0
  const bob = dying ? tilt : Math.abs(enemy.vx) > 1 ? -Math.abs(Math.sin((enemy.stride ?? 0) / 7 * Math.PI / 2)) * 0.6 : 0
  actionSprite(context, sheet, frame, x, floor + 36 * rising + bob, 36, enemy.facing === 1 ? -1 : 1, sheet === art.extras ? 0 : frame >= 8 ? 8 : 4)
  context.restore()
  if (rising > 0) drawEmergingSoil(context, enemy, state.cameraX)
  return true
}

export function drawActionKnight(context: CanvasRenderingContext2D, art: ActionArt, state: RunState, clock: number): boolean {
  const k = state.knight, tier = armorTier(state), armored = (state.stage?.armor ?? 1) > 0
  const weapon = equippedWeapon(state), x = k.x - state.cameraX
  if (state.phase === 'playing' && k.invulnerable > 0 && Math.floor(clock * 14) % 2 === 0) return true
  if (weapon === 'hammer' || weapon === 'daggers' && ((k.throwing ?? 0) > 0 || k.grounded && Math.abs(k.vx) < 5 && k.attack < 0)) {
    const row = !armored ? 4 : tier === 'verdant' ? 1 : tier === 'arcane' ? 2 : tier === 'royal' ? 3 : 0
    if (weapon === 'hammer' && k.attack < 0 && Math.abs(k.vx) > 5 && !k.crouching) {
      actionSprite(context, art.hammerWalk, row * 4 + Math.floor(Math.abs(k.x) / 8) % 4, x, k.y, 40, k.facing, row * 4)
      return true
    }
    const pose = weapon === 'daggers' ? 3 : k.attack < 0 ? 2 : k.attack < 0.24 ? 0 : k.attack < 0.43 ? 1 : 2
    actionSprite(context, art.combat, row * 4 + pose, x, k.y, k.crouching ? 30 : 48, k.facing, row * 4)
    if (weapon === 'hammer' && k.attack >= 0.24 && k.attack < 0.4) {
      context.save(); context.strokeStyle = tier === 'royal' ? '#f4d98b' : '#cdbfa5'; context.lineWidth = 1.4
      for (let i = 0; i < 5; i++) { const t = (k.attack - 0.24) / 0.16; const angle = Math.PI + i * Math.PI / 4; const at = x + k.facing * 20; context.beginPath(); context.moveTo(at + Math.cos(angle) * (3 + t * 10), k.y + Math.sin(angle) * (3 + t * 10)); context.lineTo(at + Math.cos(angle) * (6 + t * 17), k.y + Math.sin(angle) * (6 + t * 17)); context.stroke() }
      context.restore()
    }
    return true
  }
  if (k.crouching) return false
  const poseRow = tier === 'verdant' ? 1 : tier === 'arcane' ? 2 : tier === 'royal' ? 3 : 0
  if (armored && (k.attack >= 0 || (k.throwing ?? 0) > 0 || !k.grounded || Math.abs(k.vx) <= 5)) {
    const pose = k.attack >= 0 ? 1 : (k.throwing ?? 0) > 0 ? 2 : !k.grounded ? 3 : 0
    actionSprite(context, art.poses, poseRow * 4 + pose, x, k.y, 38, k.facing, poseRow * 4)
    return true
  }
  if (!armored && (k.attack >= 0 || (k.throwing ?? 0) > 0 || !k.grounded)) return false
  const moving = Math.abs(k.vx) > 5
  if (!moving && tier === 'steel' && armored) return false
  if (!armored) actionSprite(context, art.extras, moving ? 5 + Math.floor(Math.abs(k.x) / 8) % 3 : 4, x, k.y, 38, k.facing, 4)
  else if (tier === 'steel') actionSprite(context, art.cartoon, Math.floor(Math.abs(k.x) / 8) % 4, x, k.y, 38, k.facing, 0)
  else {
    const row = tier === 'verdant' ? 0 : tier === 'arcane' ? 1 : 2
    actionSprite(context, art.armor, row * 4 + (moving ? 1 + Math.floor(Math.abs(k.x) / 8) % 3 : 0), x, k.y, 38, k.facing, row * 4)
    if (moving) { context.save(); context.fillStyle = ARMOR[tier].color; context.globalAlpha = 0.35; context.fillRect(x - k.facing * 6, k.y - 4, 1.2, 1.2); context.restore() }
  }
  return true
}

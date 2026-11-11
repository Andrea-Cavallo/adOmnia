import { drawEmergingSoil } from './hubCemeteryArt'
import motionUrl from '@/assets/hub-game/quality-animation.png'
import bareUrl from '@/assets/hub-game/knight-unarmored.png'
import prisonerUrl from '@/assets/hub-game/prisoner-escape.png'
import { shareRect, spriteBounds, type SpriteRect } from './hubSpriteSheet'
import { enemyPose } from './hubEnemyAnim'
import { enemyRadius, type Enemy, type RescueActor, type RunState } from './hubRunModel'

export interface QualityArt { motion: HTMLImageElement; motionRects: SpriteRect[]; bare: HTMLImageElement; bareRects: SpriteRect[]; prisoner: HTMLImageElement; prisonerRects: SpriteRect[] }

export async function loadQualityArt(): Promise<QualityArt> {
  const images = await Promise.all([motionUrl, bareUrl, prisonerUrl].map(async (url) => { const image = new Image(); image.src = url; await image.decode(); return image }))
  const [motion, bare, prisoner] = images
  const motionRects = spriteBounds(motion), bareRects = spriteBounds(bare, 4, 2)
  for (let row = 0; row < 4; row++) shareRect(motionRects, [0, 1, 2, 3].map((column) => row * 4 + column), motion.naturalWidth / 4, motion.naturalHeight / 4)
  shareRect(bareRects, [0, 1, 2], bare.naturalWidth / 4, bare.naturalHeight / 2)
  const prisonerRects = spriteBounds(prisoner, 3, 2)
  shareRect(prisonerRects, [2, 3, 4, 5], Math.floor(prisoner.naturalWidth / 3), Math.floor(prisoner.naturalHeight / 2), 3)
  return { motion, motionRects, bare, bareRects, prisoner, prisonerRects }
}

export function qualityEnemyFrame(enemy: Pick<Enemy, 'kind' | 'stride' | 'vx' | 'timer' | 'bossPhase'>): number {
  if (enemy.kind === 'bonecaster') return enemy.bossPhase === 'warn' ? 5 : enemy.timer > 1.3 ? 6 : enemy.timer > 1 ? 7 : 4
  if (enemy.kind === 'warden') return enemy.bossPhase === 'slam' ? 11 : Math.abs(enemy.vx) > 1 ? 9 + Math.floor((enemy.stride ?? 0) / 12) % 2 : 8
  return Math.abs(enemy.vx) > 1 ? Math.floor((enemy.stride ?? 0) / 7) % 4 : 0
}

function cell(context: CanvasRenderingContext2D, image: HTMLImageElement, rect: SpriteRect, x: number, feet: number, scale: number, facing: 1 | -1, facesLeft: boolean): void {
  const w = rect.w * scale, h = rect.h * scale
  context.save(); context.translate(x, feet)
  if ((facing > 0) === facesLeft) context.scale(-1, 1)
  context.drawImage(image, rect.x, rect.y, rect.w, rect.h, -w / 2, -h, w, h)
  context.restore()
}

export function drawQualityEnemy(context: CanvasRenderingContext2D, art: QualityArt, state: RunState, enemy: Enemy, clock: number): boolean {
  if (!['zombie', 'burster', 'bonecaster', 'warden'].includes(enemy.kind)) return false
  const pose = enemyPose(state, enemy, clock)
  const index = qualityEnemyFrame(enemy), rect = art.motionRects[index]
  const base = art.motionRects[enemy.kind === 'warden' ? 8 : enemy.kind === 'bonecaster' ? 4 : 0]
  const scale = (enemy.kind === 'warden' ? 58 : 36) / base.h
  const x = enemy.x - state.cameraX, floor = enemy.y + enemyRadius(enemy)
  const emergence = enemy.emerging ? Math.max(0, 1 - enemy.age / 0.85) : 0
  if (enemy.dying <= 0 && emergence === 0) {
    context.save()
    context.fillStyle = 'rgba(5,8,13,.38)'
    context.beginPath(); context.ellipse(x, floor, enemy.kind === 'warden' ? 19 : 10, 2, 0, 0, Math.PI * 2); context.fill()
    context.restore()
  }
  context.save(); context.globalAlpha = pose.fade
  if (enemy.flash > 0) context.filter = 'brightness(1.7)'
  if (enemy.bossPhase === 'warn') context.filter = 'sepia(.3) brightness(1.3)'
  context.beginPath(); context.rect(x - 90, -200, 180, floor + 201); context.clip()
  if (enemy.dying > 0) { context.translate(x, floor); context.rotate(pose.rotate); context.translate(-x, -floor) }
  if (enemy.kind === 'burster' && enemy.bossPhase === 'warn') {
    const pulse = Math.sin(clock * 20) * 0.04
    context.translate(x, floor); context.scale(1.1 + pulse, 0.9 - pulse); context.translate(-x, -floor)
    context.filter = 'sepia(.6) brightness(1.2)'
    context.fillStyle = '#db985a'
    for (let i = 0; i < 4; i++) {
      const progress = (clock * 2 + i / 4) % 1
      context.fillRect(x + Math.sin(i * 2 + enemy.id) * (4 + progress * 7), floor - 18 - progress * 20, 0.8, 1.3)
    }
  }
  cell(context, art.motion, rect, x, floor + rect.h * scale * emergence, scale, enemy.facing, true)
  context.restore()
  if (emergence > 0) drawEmergingSoil(context, enemy, state.cameraX)
  return true
}

export function drawUnarmoredKnight(context: CanvasRenderingContext2D, art: QualityArt, state: RunState): void {
  const knight = state.knight
  const index = knight.crouching ? 7 : knight.attack >= 0 ? 5 : (knight.throwing ?? 0) > 0 ? 6 : !knight.grounded ? knight.vy < 0 ? 3 : 4 : Math.abs(knight.vx) > 5 ? 1 + Math.floor(Math.abs(knight.x) / 7) % 2 : 0
  const rect = art.bareRects[index]
  const scale = knight.crouching ? 24 / rect.h : 38 / art.bareRects[0].h
  cell(context, art.bare, rect, knight.x - state.cameraX, knight.y, scale, knight.facing, false)
}

export function drawQualityEscape(context: CanvasRenderingContext2D, art: QualityArt, state: RunState, actor: RescueActor): void {
  const index = actor.phase === 'run' ? 3 + Math.floor(Math.abs(actor.x) / 6) % 3 : 2
  context.save()

  cell(context, art.prisoner, art.prisonerRects[index], actor.x - state.cameraX, actor.y, 38 / art.prisonerRects[2].h, actor.facing, false)
  if (actor.phase === 'freed' || actor.phase === 'climb' || actor.phase === 'run' && Math.sin(actor.x / 25) > -0.5) {
    context.font = 'bold 7px Georgia'
    context.textAlign = 'center'
    context.lineWidth = 2
    context.strokeStyle = '#181b24'
    context.fillStyle = '#eee5d3'
    context.strokeText(actor.prisoner === 4 && actor.phase === 'freed' ? 'THE WALL →' : 'AAAH!', actor.x - state.cameraX, actor.y - 44)
    context.fillText(actor.prisoner === 4 && actor.phase === 'freed' ? 'THE WALL →' : 'AAAH!', actor.x - state.cameraX, actor.y - 44)
  }
  context.restore()
}

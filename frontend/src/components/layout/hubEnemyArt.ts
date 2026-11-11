/**
 * One enemy on screen: pose, sheet slice, ground shadow. Kept apart from `hubGothicArt` so the
 * enemy drawing can be rendered (and looked at) without loading a stage, and so the walk cycle has
 * one place to live.
 *
 * Sheets painted by hand would need a frame per step. These sheets have one pose per monster, so
 * the walk comes from `hubEnemyWalk` (the sprite bent into a cycle) plus the pose numbers from
 * `hubEnemyAnim`: a body that bounces twice per cycle and tips around its feet reads as walking even
 * when the legs only scissor a couple of pixels.
 */
import { drawEmergingSoil } from './hubCemeteryArt'
import { enemyPose, type EnemyPose } from './hubEnemyAnim'
import type { WalkFrames } from './hubEnemyWalk'
import { enemyRadius, type Enemy, type EnemyKind, type RunState } from './hubRunModel'
import type { SpriteRect } from './hubSpriteSheet'

/** The slices of the loaded sheets the enemy drawing reads. `GothicArt` satisfies it. */
export interface EnemyArt {
  atlas: HTMLImageElement | HTMLCanvasElement
  sprites: SpriteRect[]
  undead: HTMLImageElement
  undeadSprites: SpriteRect[]
  stageAtlas: HTMLImageElement
  stageSprites: SpriteRect[]
  /** Baked walk cycles, for the kinds whose sheet has a single pose. */
  walk?: Partial<Record<EnemyKind, WalkFrames>>
}

/** Kinds whose art is drawn facing left, so the sprite has to be mirrored to face forward. */
const SHEET_FACES_LEFT: ReadonlySet<EnemyKind> = new Set(['burster', 'armored', 'warden', 'zombie', 'bonecaster', 'reaper'])
/** Kinds that stand on the ground and therefore cast a contact shadow. */
const GROUNDED: ReadonlySet<EnemyKind> = new Set(['burster', 'armored', 'warden', 'zombie', 'bonecaster', 'slime', 'frog'])

/**
 * One enemy, with its animation state applied: squash, lean, bob, body tip, death topple, and the
 * shield of an armored guard anchored to its own hand (never floating beside it).
 */
export function drawEnemy(context: CanvasRenderingContext2D, art: EnemyArt, state: RunState, enemy: Enemy, x: number, clock: number): void {
  const radius = enemyRadius(enemy)
  const pose = enemyPose(state, enemy, clock)
  if (pose.fade <= 0.02) return
  const floor = enemy.y + radius
  const special = enemy.kind === 'burster' || enemy.kind === 'armored' || enemy.kind === 'warden'
  const rising = special && !!enemy.emerging
  const baked = art.walk?.[enemy.kind]
  context.save()
  context.globalAlpha = pose.fade
  context.translate(x + pose.lean, floor)
  if (GROUNDED.has(enemy.kind)) drawShadow(context, pose, radius)
  context.translate(0, pose.bob)
  const tilt = pose.rotate + pose.rock
  if (tilt) context.rotate(tilt)
  context.scale(enemy.facing < 0 ? -1 : 1, pose.squash)
  if (baked) drawBaked(context, enemy, pose, baked)
  else if (special) drawStageSprite(context, art, enemy, enemy.emerging ? Math.max(0, 1 - enemy.age / 0.85) : 0)
  else drawSheetSprite(context, art, enemy, pose)
  if (enemy.kind === 'armored') drawGuard(context, enemy, radius, clock)
  context.restore()
  // The soil bursts are drawn in plain screen space, not inside the enemy's transform.
  if (rising) drawEmergingSoil(context, enemy, state.cameraX)
}

/** A soft pool of contact under the body: it shrinks and fades when the enemy is lifted. */
function drawShadow(context: CanvasRenderingContext2D, pose: EnemyPose, radius: number): void {
  const lift = Math.max(0, -pose.bob)
  const scale = Math.max(0.55, 1 - lift * 0.08)
  context.save()
  context.globalAlpha *= 0.3 * scale
  context.fillStyle = '#07080b'
  context.beginPath()
  context.ellipse(0, 0.5, radius * 0.85 * scale, 2.6 * scale, 0, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

/** A kind whose sprite was bent into a cycle at load: blit the frame at the same size every time. */
function drawBaked(context: CanvasRenderingContext2D, enemy: Enemy, pose: EnemyPose, walk: WalkFrames): void {
  const count = walk.frames.length
  const index = pose.state === 'walk' ? Math.min(count - 1, Math.floor(pose.cycle * count)) : 0
  const emergence = enemy.emerging ? Math.max(0, 1 - enemy.age / 0.85) : 0
  const airborne = !GROUNDED.has(enemy.kind)
  if (enemy.kind === 'warden') {
    if (enemy.bossPhase === 'warn') context.filter = 'sepia(0.5) brightness(1.5)'
    else if (enemy.bossPhase === 'slam') context.filter = 'brightness(1.35)'
  } else if (enemy.flash > 0) context.filter = 'brightness(1.7)'
  context.save()
  // Only the soil risers clip: they climb out of the ground from the feet up.
  if (enemy.emerging) {
    context.beginPath()
    context.rect(-walk.w, -walk.h * 2, walk.w * 2, walk.h * 2 + 1)
    context.clip()
  }
  if (SHEET_FACES_LEFT.has(enemy.kind)) context.scale(-1, 1)
  // Walkers stand on the frame's bottom edge; flyers hang around the body's middle.
  const top = airborne ? -walk.h / 2 : -walk.h + walk.h * emergence
  context.drawImage(walk.frames[index], -walk.w / 2, top, walk.w, walk.h)
  context.restore()
}

/** The armored, the burster and the Guardian: one painted pose each, on the stage sheet. */
function drawStageSprite(context: CanvasRenderingContext2D, art: EnemyArt, enemy: Enemy, emergence: number): void {
  const index = enemy.kind === 'burster' ? 0 : enemy.kind === 'armored' ? 1 : 2
  const h = enemy.kind === 'warden' ? 58 : 36
  const rect = art.stageSprites[index], w = h * rect.w / rect.h
  if (enemy.kind === 'warden') {
    if (enemy.bossPhase === 'warn') context.filter = 'sepia(0.5) brightness(1.5)'
    else if (enemy.bossPhase === 'slam') context.filter = 'brightness(1.35)'
  } else if (enemy.flash > 0) context.filter = 'brightness(1.7)'
  context.save()
  context.beginPath()
  context.rect(-w, -h * 2, w * 2, h * 2 + 1)
  context.clip()
  // The stage sheet is drawn facing left: mirror it so +x (where the shield goes) is forward.
  context.scale(-1, 1)
  context.drawImage(art.stageAtlas, rect.x, rect.y, rect.w, rect.h, -w / 2, -h + h * emergence, w, h)
  context.restore()
}

/** The undead sheet (walking skeletons, the reaper) and the lone critters of the gothic atlas. */
function drawSheetSprite(context: CanvasRenderingContext2D, art: EnemyArt, enemy: Enemy, pose: EnemyPose): void {
  const radius = enemyRadius(enemy)
  const undeadSprite = enemy.kind === 'zombie' || enemy.kind === 'bonecaster' || enemy.kind === 'reaper' || (enemy.boss && enemy.kind === 'ghost')
  const floor = enemy.y + radius
  if (!undeadSprite) {
    const groundKind = enemy.kind === 'slime' || enemy.kind === 'frog'
    const ghostKind = enemy.kind === 'ghost' || enemy.kind === 'skull'
    const index = groundKind ? (Math.sin(pose.state === 'walk' ? pose.cycle * Math.PI * 2 : enemy.age * 8) > 0.3 ? 9 : 8) : ghostKind ? 11 : 10
    const h = groundKind ? radius * 2 : ghostKind ? radius * 3.2 : radius * 2.4
    const rect = art.sprites[index], w = h * rect.w / rect.h
    if (enemy.big) context.filter = 'hue-rotate(285deg)'
    else if (enemy.kind === 'frog') context.filter = 'hue-rotate(45deg)'
    else if (enemy.boss) context.filter = 'hue-rotate(35deg) drop-shadow(0 0 3px #9e82ed)'
    const y = groundKind ? -h : enemy.y - floor - h / 2 + Math.sin(pose.cycle * Math.PI * 2) * 1.5
    context.drawImage(art.atlas, rect.x, rect.y, rect.w, rect.h, -w / 2, y, w, h)
    return
  }
  const zombie = enemy.kind === 'zombie' || enemy.kind === 'bonecaster'
  const frame = zombie ? (pose.state === 'walk' ? pose.frame : Math.floor(enemy.age * 5) % 4) : Math.floor(enemy.age * 5) % 4
  const index = (zombie ? 0 : 4) + frame
  const rect = art.undeadSprites[index]
  const h = zombie ? 36 : enemy.boss ? 60 : 44
  const w = h * rect.w / rect.h
  if (enemy.boss && enemy.flash > 0) context.filter = 'brightness(1.8)'
  if (enemy.kind === 'bonecaster') context.filter = 'grayscale(0.85) brightness(1.35) contrast(1.1)'
  const emerge = zombie && enemy.emerging ? Math.max(0, 1 - enemy.age / 0.85) : 0
  if (zombie) {
    context.beginPath()
    context.rect(-w, -h * 2, w * 2, h * 2 + 1)
    context.clip()
  }
  // The undead sheet is drawn facing left, like the stage sheet.
  context.scale(-1, 1)
  context.drawImage(art.undead, rect.x, rect.y, rect.w, rect.h, -w / 2, zombie ? -h + h * emerge : -h / 2, w, h)
}

/** The armored guard's shield, raised in front of the body; it sags when its guard is down. */
function drawGuard(context: CanvasRenderingContext2D, enemy: Enemy, radius: number, clock: number): void {
  if (enemy.guard <= 0) return
  const sag = enemy.guardOpen > 0 ? 5 : 0
  context.save()
  context.translate(radius * 0.55, -radius - 2 + sag)
  context.rotate((enemy.guardOpen > 0 ? 0.55 : 0) + (enemy.flash > 0 ? Math.sin(clock * 40) * 0.16 : 0))
  const w = 9, h = 15
  // Wood face, iron rim and the order's cross.
  context.fillStyle = '#6b4a2a'
  context.beginPath()
  context.moveTo(-w / 2, -h / 2)
  context.lineTo(w / 2, -h / 2)
  context.lineTo(w / 2, h * 0.1)
  context.lineTo(0, h / 2)
  context.lineTo(-w / 2, h * 0.1)
  context.closePath()
  context.fill()
  context.strokeStyle = enemy.flash > 0 ? '#fff4c8' : '#b9c1cc'
  context.lineWidth = 1.2
  context.stroke()
  context.fillStyle = '#c8b27c'
  context.fillRect(-0.8, -h / 2 + 2, 1.6, h * 0.55)
  context.fillRect(-w / 2 + 2, -h / 2 + 4.5, w - 4, 1.4)
  // Cracks show how much guard is left.
  context.strokeStyle = '#2a1c12'
  context.lineWidth = 0.6
  if (enemy.guard <= 1) {
    context.beginPath()
    context.moveTo(-1, -2)
    context.lineTo(2, 1)
    context.lineTo(0, 4)
    context.stroke()
  }
  context.restore()
}

import { loadSetPieceArt, drawSetPieceEnemy, drawSetPieceProps, type SetPieceArt } from './hubSetPieceArt'
import { loadActionArt, drawActionEnemy, drawActionKnight, type ActionArt } from './hubActionArt'
import { drawLivingBackdrop, drawLivingProps } from './hubLivingArt'
import { loadKnightHitArt, drawKnightHit, type KnightHitArt } from './hubKnightHitArt'
import { drawCemeteryGate } from './hubGateArt'
import { loadTreasureArt, drawStageChests, type TreasureArt } from './hubTreasureArt'
import { loadBridgeArt, drawBridgeTerrain, type BridgeArt } from './hubBridgeArt'
import foregroundUrl from '@/assets/hub-game/cemetery-foreground.png'
import cryptUrl from '@/assets/hub-game/crypt-interior.png'
import { drawDebris, drawSecrets, drawStageShots } from './hubCemeteryProps'
import { drawCaptives, drawEscapes } from './hubPrisonerArt'
import { drawEnemy, type EnemyArt } from './hubEnemyArt'
import { bakeWalks } from './hubEnemyWalk'
import { shareRect, spriteBounds, type SpriteRect } from './hubSpriteSheet'
import { loadQualityArt, drawQualityEnemy, drawUnarmoredKnight, type QualityArt } from './hubQualityArt'
import { drawCemeteryBackdrop, drawCemeteryForeground } from './hubCemeteryArt'
import chapelUrl from '@/assets/hub-game/chapel-exterior.png'
import stageUrl from '@/assets/hub-game/cemetery-stage.png'
import { CEMETERY } from './hubRunStages'
import { placeOnSurface } from './hubRunPlacement'
import stanceUrl from '@/assets/hub-game/knight-crouch-stone.png'
import backgroundUrl from '@/assets/hub-game/moonlit-cemetery.png'
import forestUrl from '@/assets/hub-game/haunted-forest.png'
import abbeyUrl from '@/assets/hub-game/ruined-abbey.png'
import undeadUrl from '@/assets/hub-game/undead-atlas.png'
import { levelRegionAt } from './hubRunLevel'
import atlasUrl from '@/assets/hub-game/gothic-atlas.png'
import { groundY, spanHeight, type RunState } from './hubRunModel'
import { enemyShown } from './hubRunLook'

export interface GothicArt { background: HTMLImageElement; backgrounds: HTMLImageElement[]; atlas: HTMLImageElement | HTMLCanvasElement; sprites: SpriteRect[]; undead: HTMLImageElement; undeadSprites: SpriteRect[]; stance: HTMLImageElement | HTMLCanvasElement; bareAtlas: HTMLImageElement | HTMLCanvasElement; bareStance: HTMLImageElement | HTMLCanvasElement; stanceSprites: SpriteRect[]; stageAtlas: HTMLImageElement; stageSprites: SpriteRect[]; panorama: HTMLCanvasElement; foreground: HTMLImageElement; foregroundSprites: SpriteRect[]; crypt: HTMLImageElement; walk: EnemyArt['walk']; quality: QualityArt; bridge: BridgeArt; treasure: TreasureArt; hit: KnightHitArt; action: ActionArt; setpiece: SetPieceArt }

const loadImage = async (src: string): Promise<HTMLImageElement> => {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}


function cemeteryPanorama(left: HTMLImageElement, right: HTMLImageElement): HTMLCanvasElement {
  const height = left.naturalHeight
  const rightWidth = Math.round(right.naturalWidth * height / right.naturalHeight)
  const overlap = Math.round(left.naturalWidth * 0.2)
  const canvas = document.createElement('canvas')
  canvas.width = left.naturalWidth + rightWidth - overlap; canvas.height = height
  const layer = document.createElement('canvas')
  layer.width = rightWidth; layer.height = height
  const context = canvas.getContext('2d')!, blend = layer.getContext('2d')!
  context.drawImage(left, 0, 0)
  blend.drawImage(right, 0, 0, rightWidth, height)
  const gradient = blend.createLinearGradient(0, 0, overlap, 0)
  gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, '#fff')
  blend.globalCompositeOperation = 'destination-in'; blend.fillStyle = gradient; blend.fillRect(0, 0, rightWidth, height)
  context.drawImage(layer, left.naturalWidth - overlap, 0)
  return canvas
}

let loaded: Promise<GothicArt> | undefined
export function loadGothicArt(): Promise<GothicArt> {
  loaded ??= Promise.all([loadImage(backgroundUrl), loadImage(atlasUrl), loadImage(forestUrl), loadImage(abbeyUrl), loadImage(undeadUrl), loadImage(stanceUrl), loadImage(stageUrl), loadImage(chapelUrl), loadImage(foregroundUrl), loadImage(cryptUrl), loadQualityArt(), loadBridgeArt(), loadTreasureArt(), loadKnightHitArt(), loadActionArt(), loadSetPieceArt()])
    .then(([background, atlas, forest, abbey, undead, stance, stageAtlas, chapel, foreground, crypt, quality, bridge, treasure, hit, action, setpiece]) => {
      const sprites = spriteBounds(atlas), stanceSprites = spriteBounds(stance, 2, 2), stageSprites = spriteBounds(stageAtlas, 3, 3)
      const undeadSprites = spriteBounds(undead, 4, 2)
      // Cells 0–2 are the ghoul's walk and 4–7 the reaper's: one rect each, or the frames jitter.
      shareRect(undeadSprites, [0, 1, 2], undead.naturalWidth / 4, undead.naturalHeight / 2)
      shareRect(undeadSprites, [4, 5, 6, 7], undead.naturalWidth / 4, undead.naturalHeight / 2)
      // Cells 0–7 are the knight's poses; stance cells 0–2 his crouches (cell 3 is a stone tile).
      return { background, backgrounds: [background, forest, abbey], atlas, sprites, bareAtlas: atlas, bareStance: stance, undead, undeadSprites, stance, stanceSprites, stageAtlas, stageSprites, panorama: cemeteryPanorama(background, chapel), foreground, foregroundSprites: spriteBounds(foreground, 2, 2), crypt, walk: bakeWalks(atlas, sprites, stageAtlas, stageSprites), quality, bridge, treasure, hit, action, setpiece }
    })
    .catch((error: unknown) => { loaded = undefined; throw error })
  return loaded
}

function sprite(context: CanvasRenderingContext2D, art: GothicArt, index: number, x: number, y: number, w: number, h: number, flip = false, undead = false, stage = false) {
  const rect = stage ? art.stageSprites[index] : undead ? art.undeadSprites[index] : art.sprites[index]
  context.save()
  context.translate(x, y)
  if (flip) context.scale(-1, 1)
  context.drawImage(stage ? art.stageAtlas : undead ? art.undead : art.atlas, rect.x, rect.y, rect.w, rect.h, flip ? -w : 0, 0, w, h)
  context.restore()
}

export function gothicKnightFrame(state: Pick<RunState, 'knight'>, clock: number): number {
  const knight = state.knight
  if (knight.attack >= 0) return 7
  if ((knight.throwing ?? 0) > 0) return 6
  if (!knight.grounded) return knight.vy < 0 ? 4 : 5
  return Math.abs(knight.vx) > 12 ? 1 + Math.floor(clock * 10) % 3 : 0
}

/** Draw directly to the display-resolution canvas so painted sprite details survive scaling. */
export function drawGothicWorld(context: CanvasRenderingContext2D, art: GothicArt, state: RunState, width: number, height: number, clock: number): void {
  const region = state.stage ? { index: 0, next: 1, blend: state.stage.bellDestroyed ? 0.2 : 0 } : levelRegionAt(state.cameraX)
  const paintBackground = (background: HTMLImageElement, opacity: number) => {
    const ratio = Math.max(width / background.naturalWidth, height / background.naturalHeight) * 1.035
    const bgW = background.naturalWidth * ratio, bgH = background.naturalHeight * ratio
    const drift = Math.sin(state.cameraX / 1600) * width * 0.012
    context.save()
    context.globalAlpha = opacity
    context.drawImage(background, (width - bgW) / 2 - drift, (height - bgH) / 2, bgW, bgH)
    context.restore()
  }
  if (state.stage) {
    const panorama = art.panorama
    const sourceWidth = Math.min(panorama.width, panorama.height * width / height)
    const progress = Math.max(0, Math.min(1, state.cameraX / Math.max(1, CEMETERY.end - width)))
    context.drawImage(panorama, progress * (panorama.width - sourceWidth), 0, sourceWidth, panorama.height, 0, 0, width, height)
  } else {
    paintBackground(art.backgrounds[region.index], 1)
    if (region.blend > 0) paintBackground(art.backgrounds[region.next], region.blend)
  }

  if (state.stage) drawCemeteryBackdrop(context, art, state, width, height)
  if (state.stage) drawLivingBackdrop(context, state, width, height, clock)
  const terrain = (x0: number, x1: number, y: number, floating: boolean, bridge = false) => {
    const start = x0 - state.cameraX, end = x1 - state.cameraX
    if (end < 0 || start > width) return
    context.save()
    context.beginPath()
    context.rect(Math.max(0, start), y, Math.min(width, end) - Math.max(0, start), floating ? 8 : height - y)
    context.clip()
    if (bridge && !floating) {
      const rect = art.sprites[13], size = 64, h = size * rect.h / rect.w
      for (let wx = Math.floor(x0 / size) * size; wx < x1; wx += size) sprite(context, art, 13, wx - state.cameraX, y, size + 0.2, h)
      context.restore()
      if (state.stage) drawCemeteryForeground(context, art, state, width, height)
      return
    }
    const stone = art.stanceSprites[3]
    const tile = 32
    const tileHeight = tile * stone.h / stone.w
    const bottom = floating ? y + 8 : height
    for (let worldX = Math.floor(x0 / tile) * tile; worldX < x1; worldX += tile) {
      const x = worldX - state.cameraX
      if (x + tile < 0 || x > width) continue
      for (let row = 0; y + row * tileHeight < bottom; row++) context.drawImage(art.stance, stone.x, stone.y, stone.w, stone.h, x, y + row * tileHeight, tile, tileHeight)
    }
    const cap = art.sprites[14]
    const capHeight = cap.h * 0.25
    for (let wx = Math.floor(x0 / tile) * tile; wx < x1; wx += tile) context.drawImage(art.atlas, cap.x, cap.y, cap.w, capHeight, wx - state.cameraX, y, tile, tile * capHeight / cap.w)
    context.fillStyle = '#9b9784'
    context.fillRect(start, y, end - start, 0.65)
    context.fillStyle = '#181d25'
    context.fillRect(start, y + 3, end - start, 0.6)
    context.restore()
  }
  if (state.stage) drawBridgeTerrain(context, art.bridge, state, width, height)
  else for (const span of state.ground) {
    const rising = Math.abs((span.y1 ?? groundY(state.height)) - (span.y0 ?? groundY(state.height))) > 0.5
    if (!rising) terrain(span.x0, span.x1, spanHeight(span, span.x0, state.height), false, true)
    else for (let x = span.x0; x < span.x1; x += 12) {
      terrain(x, Math.min(span.x1, x + 12), spanHeight(span, x + 6, state.height), false)
    }
  }
  if (!state.stage) for (const platform of state.platforms) terrain(platform.x0, platform.x1, platform.y, true)

  if (state.stage) {
    const progress = state.stage
    const prop = (index: number, x: number, h: number, upper = false) => {
      const point = placeOnSurface(state, x, 3, upper)
      if (!point || x < state.cameraX - 80 || x > state.cameraX + width + 80) return
      const rect = art.stageSprites[index], w = h * rect.w / rect.h
      sprite(context, art, index, x - state.cameraX - w / 2, point.y - h, w, h, false, false, true)
    }
    if (!progress.key) prop(3, CEMETERY.key, 12)
    drawCemeteryGate(context, art, state)
    drawStageChests(context, art, state)
    drawCaptives(context, art, state, clock)
    drawEscapes(context, state, art)
    drawSecrets(context, art, state, clock)
    drawLivingProps(context, art, state)
    drawSetPieceProps(context, art.setpiece, state)
    if (!progress.bellDestroyed) prop(4, CEMETERY.bell, 58)
    if (!progress.bellDestroyed) prop(6, CEMETERY.end - 50, 58)
    if (progress.bellDestroyed) {
      context.fillStyle = '#efd18d'
      context.font = '6px Georgia'
      context.fillText('THE WOODS →', CEMETERY.end - state.cameraX - 60, height - 70)
    }
    if (progress.checkpoint) {
      const point = placeOnSurface(state, CEMETERY.checkpoint, 3)
      if (point) {
        context.fillStyle = '#f1c576'; context.shadowColor = '#edaf43'; context.shadowBlur = 8
        context.fillRect(CEMETERY.checkpoint - state.cameraX - 1, point.y - 15, 2, 15)
        context.shadowBlur = 0
      }
    }
  }
  for (const coin of state.coins) {
    const x = coin.x - state.cameraX
    const spin = Math.max(0.2, Math.abs(Math.cos(clock * 4 + coin.id)))
    const w = 7 * spin, h = 13
    context.save()
    context.shadowColor = '#ffd773'; context.shadowBlur = 5
    sprite(context, art, 12, x - w / 2, coin.y - h / 2 + Math.sin(clock * 3 + coin.id) * 0.7, w, h)
    context.restore()
  }
  for (const enemy of state.enemies) {
    if (!enemyShown(enemy, clock)) continue
    const x = enemy.x - state.cameraX
    if (x < -60 || x > width + 60) continue
    if (!drawSetPieceEnemy(context, art.setpiece, state, enemy) && !drawActionEnemy(context, art.action, state, enemy, clock) && !drawQualityEnemy(context, art.quality, state, enemy, clock)) drawEnemy(context, art, state, enemy, x, clock)
  }
  for (const corpse of state.corpses ?? []) {
    const x = corpse.x - state.cameraX
    if (x < -60 || x > width + 60) continue
    if (!drawSetPieceEnemy(context, art.setpiece, state, corpse) && !drawActionEnemy(context, art.action, state, corpse, clock) && !drawQualityEnemy(context, art.quality, state, corpse, clock)) drawEnemy(context, art, state, corpse, x, clock)
  }
  drawBossTelegraph(context, state, clock)
  for (const sword of state.swords) {
    const x = sword.x - state.cameraX
    context.save()
    context.shadowColor = '#ffdf91'
    context.shadowBlur = 3
    if (sword.weapon === 'daggers') {
      context.translate(x, sword.y); context.rotate(Math.atan2(sword.vy ?? 0, sword.vx)); sprite(context, art, 15, -6, -1.5, 12, 3)
    } else if (sword.weapon === 'lance') sprite(context, art, 8, x - 18, sword.y - 3, 36, 9, sword.vx < 0, false, true)
    else sprite(context, art, 15, x - 11, sword.y - 3, 22, 6, sword.vx < 0)
    context.restore()
  }
  drawStageShots(context, state, clock)
  if (drawKnightHit(context, art.hit, state)) {
    drawDebris(context, state, art)
    if (state.stage) drawCemeteryForeground(context, art, state, width, height)
    return
  }
  if (drawActionKnight(context, art.action, state, clock)) {
    drawDebris(context, state, art)
    if (state.stage) drawCemeteryForeground(context, art, state, width, height)
    return
  }
  const knight = state.knight
  // Lost armor shows on the knight: dented and dull at one plate left, down to his linen at none.
  const armor = state.stage?.armor ?? 2
  const worn = armor === 0 ? { ...art, atlas: art.bareAtlas, stance: art.bareStance } : art
  context.save()
  if (state.stage?.curse) context.filter = 'hue-rotate(250deg) saturate(1.6)'
  if (armor === 0) {
    if (state.phase !== 'playing' || knight.invulnerable <= 0 || Math.floor(clock * 14) % 2 !== 0) drawUnarmoredKnight(context, art.quality, state)
    context.restore()
    drawDebris(context, state, art)
    if (state.stage) drawCemeteryForeground(context, art, state, width, height)
    return
  }
  if (state.phase !== 'playing' || knight.invulnerable <= 0 || Math.floor(clock * 14) % 2 !== 0) {
    if (knight.crouching) {
      const index = knight.attack >= 0 ? 1 : (knight.throwing ?? 0) > 0 ? 2 : 0
      const rect = art.stanceSprites[index], scale = 24 / art.stanceSprites[0].h
      const w = rect.w * scale, h = rect.h * scale
      const x = knight.x - state.cameraX - w / 2
      context.save()
      context.translate(x + (knight.facing < 0 ? w : 0), knight.y - h)
      if (knight.facing < 0) context.scale(-1, 1)
      context.drawImage(worn.stance, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h)
      context.restore()
      context.restore()
      drawDebris(context, state, art)
      if (state.stage) drawCemeteryForeground(context, art, state, width, height)
      return
    }
    const index = gothicKnightFrame(state, clock)
    const rect = art.sprites[index], scale = 38 / art.sprites[0].h
    const w = rect.w * scale, h = rect.h * scale
    const x = knight.x - state.cameraX
    // The cape extends behind the body; the forward hand and blade extend ahead during a slash.
    const anchor = index === 7 ? 0.34 : 0.63
    sprite(context, worn, index, x - w * (knight.facing > 0 ? anchor : 1 - anchor), knight.y - h, w, h, knight.facing < 0)
  }
  context.restore()
  drawDebris(context, state, art)
  if (state.stage) drawCemeteryForeground(context, art, state, width, height)
}

/** The Guardian's announced slam: a pulsing ring on the ground where the shockwave will start. */
function drawBossTelegraph(context: CanvasRenderingContext2D, state: RunState, clock: number): void {
  const boss = state.enemies.find((enemy) => enemy.kind === 'warden')
  if (!boss || boss.bossPhase !== 'warn' || boss.bossAttack !== 'slam') return
  const x = boss.targetX - state.cameraX
  const floor = boss.targetY
  const pulse = 0.5 + 0.5 * Math.sin(clock * 18)
  context.save()
  context.globalAlpha = 0.35 + pulse * 0.4
  context.strokeStyle = '#e8563c'
  context.lineWidth = 1.4
  context.beginPath()
  context.ellipse(x, floor - 1, 18 + pulse * 8, 4 + pulse * 2, 0, 0, Math.PI * 2)
  context.stroke()
  context.fillStyle = '#7a2418'
  context.globalAlpha = 0.22 + pulse * 0.2
  context.beginPath()
  context.ellipse(x, floor - 1, 13, 3, 0, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

/**
 * The cemetery's small interactive things that are not enemies: the three secrets, the bones a
 * bone thrower lobs, the holy water flasks, and the armor plates that fly off a hit knight.
 */
import type { GothicArt } from './hubGothicArt'
import type { RunState } from './hubRunModel'
import { placeOnSurface } from './hubRunPlacement'
import { CEMETERY } from './hubRunStages'

function drawAtlasCell(context: CanvasRenderingContext2D, image: HTMLImageElement, rect: { x: number; y: number; w: number; h: number }, x: number, floor: number, h: number): void {
  const w = (h * rect.w) / rect.h
  context.drawImage(image, rect.x, rect.y, rect.w, rect.h, x - w / 2, floor - h, w, h)
}

/**
 * Root cache, cracked grave and a sealed crypt niche share the scenery palette.
 */
export function drawSecrets(context: CanvasRenderingContext2D, art: GothicArt, state: RunState, clock: number): void {
  const found = state.stage?.secrets ?? []
  for (const secret of CEMETERY.secrets) {
    if (found.includes(secret.id)) continue
    const point = placeOnSurface(state, secret.x, 3, secret.upper)
    if (!point) continue
    const x = secret.x - state.cameraX
    context.save()
    if (secret.id === 3) {
      const revealed = state.stage?.revealedSecrets?.includes(3)
      if (revealed) drawAtlasCell(context, art.stageAtlas, art.stageSprites[7], x, point.y, 15)
      else {
        const stone = art.bridge.rects[1]
        context.drawImage(art.bridge.atlas, stone.x + stone.w * 0.2, stone.y + stone.h * 0.2, stone.w * 0.6, stone.h * 0.8, x - 15, point.y - 32, 30, 32)
        context.strokeStyle = state.stage?.rescued.includes(4) ? '#c8b27d' : '#232935'; context.lineWidth = 1.2
        context.beginPath(); context.moveTo(x - 2, point.y - 30); context.lineTo(x + 4, point.y - 22); context.lineTo(x - 2, point.y - 12); context.stroke()
      }
    } else if (secret.id === 1) {
      context.filter = 'brightness(0.9) contrast(1.2)'
      drawAtlasCell(context, art.foreground, art.foregroundSprites[2], x, point.y + 2, 22)
      context.strokeStyle = '#c2b28d'; context.lineWidth = 0.6
      context.beginPath(); context.moveTo(x - 2, point.y - 18); context.lineTo(x + 1, point.y - 12); context.lineTo(x - 2, point.y - 7); context.stroke()
    } else if (secret.id === 2) {
      if (state.stage?.revealedSecrets?.includes(2)) {
        context.shadowColor = '#ffe39a'; context.shadowBlur = 4 + Math.sin(clock * 4) * 2
        drawAtlasCell(context, art.treasure.atlas, art.treasure.rects[3], x, point.y - 2, 17)
      } else {
        const stone = art.bridge.rects[1]
        context.drawImage(art.bridge.atlas, stone.x + stone.w * 0.2, stone.y + stone.h * 0.2, stone.w * 0.6, stone.h * 0.8, x - 13, point.y - 30, 26, 30)
        context.strokeStyle = '#171d24'; context.lineWidth = 1.3
        context.beginPath(); context.moveTo(x + 1, point.y - 29); context.lineTo(x - 3, point.y - 20); context.lineTo(x + 2, point.y - 16); context.lineTo(x - 1, point.y - 5); context.stroke()
      }
    } else {
      drawAtlasCell(context, art.stageAtlas, art.stageSprites[7], x, point.y, 10)
      context.globalAlpha = 0.9
      drawAtlasCell(context, art.foreground, art.foregroundSprites[2], x - 5, point.y + 1, 14)
    }
    context.restore()
  }
}

/** Spinning bones from the bone thrower, ground shockwaves from the Guardian, and holy water flasks. */
export function drawStageShots(context: CanvasRenderingContext2D, state: RunState, clock: number): void {
  context.save()
  for (const bone of state.hazards ?? []) {
    if (bone.kind === 'wave') {
      const x = bone.x - state.cameraX
      const strength = Math.min(1, bone.life / 1.1)
      context.save()
      context.globalAlpha = 0.85 * strength
      context.fillStyle = '#6b3a1e'
      context.beginPath()
      context.moveTo(x - 9, bone.y)
      context.lineTo(x - 2, bone.y - 12 * strength)
      context.lineTo(x + 2, bone.y - 4)
      context.lineTo(x + 8, bone.y)
      context.closePath()
      context.fill()
      context.fillStyle = '#d8894a'
      context.beginPath()
      context.moveTo(x - 4, bone.y)
      context.lineTo(x, bone.y - 7 * strength)
      context.lineTo(x + 4, bone.y)
      context.closePath()
      context.fill()
      context.restore()
      continue
    }
    context.save()
    context.translate(bone.x - state.cameraX, bone.y)
    context.rotate(clock * 14 + bone.id)
    context.fillStyle = '#efe6cf'
    context.fillRect(-3.5, -0.75, 7, 1.5)
    context.fillRect(-4, -1.5, 1.5, 3)
    context.fillRect(2.5, -1.5, 1.5, 3)
    context.restore()
  }
  context.restore()
}

/**
 * Pieces of armor knocked off the knight: each one flies on its own arc, spins, bounces with a
 * little dust and fades. The helmet is drawn with a visor so it reads as the knight's own.
 */
export function drawDebris(context: CanvasRenderingContext2D, state: RunState, art?: GothicArt): void {
  const pieces = state.debris ?? []
  if (!pieces.length) return
  for (const piece of pieces) {
    const x = piece.x - state.cameraX
    const fade = Math.min(1, piece.life / 0.5)
    context.save()
    context.globalAlpha = fade
    context.translate(x, piece.y)
    context.rotate(piece.angle)
    if (piece.kind === 'arm' && art) {
      const r = art.setpiece.scene.rects[5], h = 9, w = h * r.w / r.h
      context.drawImage(art.setpiece.scene.image, r.x, r.y, r.w, r.h, -w / 2, -h / 2, w, h)
    } else if (piece.kind === 'helmet') {
      const r = piece.size
      context.fillStyle = '#aeb6c2'
      context.beginPath()
      context.moveTo(-r, 0)
      context.lineTo(-r * 0.8, -r * 1.1)
      context.lineTo(0, -r * 1.5)
      context.lineTo(r * 0.8, -r * 1.1)
      context.lineTo(r, 0)
      context.lineTo(r * 0.7, r * 0.7)
      context.lineTo(-r * 0.7, r * 0.7)
      context.closePath()
      context.fill()
      context.fillStyle = '#3a2418'
      context.fillRect(-r * 0.7, -r * 0.35, r * 1.4, r * 0.28)
      context.fillStyle = '#e3d9c4'
      context.fillRect(-r * 0.9, -r * 0.9, r * 0.35, r * 0.25)
    } else if (piece.kind === 'plate') {
      const s = piece.size
      context.fillStyle = '#b8bfca'
      context.beginPath()
      context.moveTo(-s, -s * 0.6)
      context.lineTo(s * 0.8, -s)
      context.lineTo(s, s * 0.5)
      context.lineTo(-s * 0.6, s * 0.8)
      context.closePath()
      context.fill()
      context.fillStyle = '#7d8590'
      context.fillRect(-s * 0.5, -s * 0.2, s, s * 0.35)
    } else {
      context.fillStyle = '#d8dde5'
      context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size)
    }
    context.restore()
  }
}

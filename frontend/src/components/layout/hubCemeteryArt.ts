import type { GothicArt } from './hubGothicArt'
import { enemyRadius, groundHeightAt, type Enemy, type RunState } from './hubRunModel'
import { CEMETERY } from './hubRunStages'

function prop(
  context: CanvasRenderingContext2D,
  art: GothicArt,
  index: number,
  x: number,
  floor: number,
  height: number,
): void {
  const rect = art.foregroundSprites[index]
  const width = (height * rect.w) / rect.h
  context.drawImage(art.foreground, rect.x, rect.y, rect.w, rect.h, x - width / 2, floor - height, width, height)
}

const LINTEL_ROWS = 3
/** The crypt fades in and out over this many pixels at each side instead of a hard cut. */
const CRYPT_FADE = 56
let cryptCache: { canvas: HTMLCanvasElement; w: number; h: number } | null = null

/** The crypt interior scaled to the opening, its left and right edges faded to transparent. Cached per size. */
function fadedCrypt(art: GothicArt, w: number, h: number): HTMLCanvasElement {
  if (cryptCache && cryptCache.w === w && cryptCache.h === h) return cryptCache.canvas
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, w)
  canvas.height = Math.max(1, h)
  const paint = canvas.getContext('2d')
  if (paint) {
    const ratio = Math.max(w / art.crypt.naturalWidth, h / art.crypt.naturalHeight)
    const iw = art.crypt.naturalWidth * ratio, ih = art.crypt.naturalHeight * ratio
    paint.drawImage(art.crypt, (w - iw) / 2, (h - ih) / 2, iw, ih)
    const fade = Math.min(CRYPT_FADE, w / 3) / w
    const mask = paint.createLinearGradient(0, 0, w, 0)
    mask.addColorStop(0, 'rgba(0,0,0,0)')
    mask.addColorStop(fade, 'rgba(0,0,0,1)')
    mask.addColorStop(1 - fade, 'rgba(0,0,0,1)')
    mask.addColorStop(1, 'rgba(0,0,0,0)')
    paint.globalCompositeOperation = 'destination-in'
    paint.fillStyle = mask
    paint.fillRect(0, 0, w, h)
  }
  cryptCache = { canvas, w, h }
  return canvas
}

export function drawCemeteryBackdrop(
  context: CanvasRenderingContext2D,
  art: GothicArt,
  state: RunState,
  width: number,
  height: number,
): void {
  const treeFloor = groundHeightAt(state, CEMETERY.tree)
  if (treeFloor !== null) prop(context, art, 0, CEMETERY.tree - state.cameraX, treeFloor + 3, 175)
  const start = CEMETERY.crypt.entrance - state.cameraX
  const end = CEMETERY.crypt.exit - state.cameraX
  if (end < -40 || start > width + 40) return
  context.drawImage(fadedCrypt(art, Math.round(end - start), Math.round(height)), start, 0)
  context.save()
  const stone = art.stanceSprites[3]
  const low = CEMETERY.crypt.lowStart - state.cameraX
  const ceiling = (groundHeightAt(state, CEMETERY.crypt.lowStart) ?? height - 54) - CEMETERY.crypt.clearance
  // A real collapsed lintel, three courses of stone, so the low passage reads as a ceiling.
  for (let wx = CEMETERY.crypt.lowStart; wx < CEMETERY.crypt.lowEnd; wx += 12) {
    const top = (groundHeightAt(state, wx + 6) ?? height - 54) - CEMETERY.crypt.clearance
    const x = wx - state.cameraX
    for (let row = 1; row <= LINTEL_ROWS; row++) {
      context.save()
      context.beginPath()
      context.rect(x, top - 10 * row, 12, 10)
      context.clip()
      context.drawImage(art.stance, stone.x, stone.y, stone.w, stone.h, x - (row % 2) * 6, top - 10 * row, 32, (32 * stone.h) / stone.w)
      context.restore()
    }
  }
  context.fillStyle = '#e6d7ac'
  context.font = '6px Georgia'
  context.fillText('↓ CROUCH', low - 30, ceiling - 5)
  context.restore()
  const entryFloor = groundHeightAt(state, CEMETERY.crypt.entrance)
  const exitFloor = groundHeightAt(state, CEMETERY.crypt.exit)
  if (entryFloor !== null) prop(context, art, 1, start, entryFloor, 95)
  if (exitFloor !== null) prop(context, art, 1, end, exitFloor, 95)
}

export function drawCemeteryForeground(
  context: CanvasRenderingContext2D,
  art: GothicArt,
  state: RunState,
  width: number,
  height: number,
): void {
  context.save()
  for (let x = Math.floor(state.cameraX / 260) * 260 + 170; x < state.cameraX + width + 50; x += 260) {
    const floor = groundHeightAt(state, x)
    if (floor === null) continue
    context.globalAlpha = Math.abs(state.knight.x - x) < 36 ? 0.32 : 0.78
    prop(context, art, 2, x - state.cameraX, Math.min(height + 10, floor + 32), 36)
  }
  context.globalAlpha = 0.24
  const fog = art.foregroundSprites[3]
  context.drawImage(art.foreground, fog.x, fog.y, fog.w, fog.h, -12, height - 53, width + 24, 53)
  context.restore()
}

export function drawEmergingSoil(context: CanvasRenderingContext2D, enemy: Enemy, cameraX: number): void {
  if (!enemy.emerging || !enemy.awake || enemy.age > 1.15) return
  const x = enemy.x - cameraX,
    floor = enemy.y + enemyRadius(enemy)
  context.save()
  context.fillStyle = '#574332'
  context.beginPath()
  context.ellipse(x, floor, 12, 2, 0, 0, Math.PI * 2)
  context.fill()
  for (let index = 0; index < 8; index++) {
    const t = Math.max(0, Math.min(1, enemy.age / 0.9 - index * 0.04))
    const side = index % 2 ? 1 : -1
    const px = x + side * (3 + t * (9 + index))
    const py = floor - Math.sin(t * Math.PI) * (4 + (index % 4) * 2)
    context.fillStyle = index % 3 ? '#68513b' : '#a1845e'
    context.fillRect(px, py, 1.2, 1)
  }
  context.restore()
}

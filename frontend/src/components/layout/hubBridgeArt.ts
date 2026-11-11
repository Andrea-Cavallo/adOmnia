import bridgeUrl from '@/assets/hub-game/adomnia-bridge.png'
import { spriteBounds, type SpriteRect } from './hubSpriteSheet'
import { groundHeightAt, spanHeight, type RunState, type Span } from './hubRunModel'

export interface BridgeArt { atlas: HTMLImageElement; rects: SpriteRect[]; crest: HTMLCanvasElement }

export async function loadBridgeArt(): Promise<BridgeArt> {
  const [atlas, logo] = await Promise.all([bridgeUrl, '/icon-white.png'].map(async src => {
    const image = new Image(); image.src = src; await image.decode(); return image
  }))
  const bounds = spriteBounds(logo, 1, 1)[0]
  const crest = document.createElement('canvas')
  crest.width = bounds.w; crest.height = bounds.h
  const context = crest.getContext('2d')!
  context.drawImage(logo, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = '#ead8ae'; context.fillRect(0, 0, crest.width, crest.height)
  return { atlas, rects: spriteBounds(atlas, 2, 2), crest }
}

function asset(context: CanvasRenderingContext2D, art: BridgeArt, index: number, x: number, y: number, width: number): number {
  const rect = art.rects[index], height = width * rect.h / rect.w
  context.drawImage(art.atlas, rect.x, rect.y, rect.w, rect.h, x, y, width, height)
  return height
}

function emblem(context: CanvasRenderingContext2D, art: BridgeArt, x: number, y: number, width: number): void {
  context.drawImage(art.crest, x - width / 2, y, width, width * art.crest.height / art.crest.width)
}

function heraldry(context: CanvasRenderingContext2D, art: BridgeArt, x: number, y: number, banner: boolean): void {
  const width = banner ? 15 : 18
  const height = asset(context, art, banner ? 2 : 3, x - width / 2, y, width)
  emblem(context, art, x, y + height * (banner ? 0.3 : 0.27), width * 0.52)
}

function arcade(context: CanvasRenderingContext2D, art: BridgeArt, state: RunState, x0: number, x1: number, y: number, width: number, bottom: number): void {
  const count = Math.max(1, Math.round((x1 - x0) / 128)), spanWidth = (x1 - x0) / count
  context.save()
  context.beginPath(); context.rect(x0 - state.cameraX, y, x1 - x0, 500); context.clip()
  for (let i = 0; i < count; i++) {
    const x = x0 + i * spanWidth - state.cameraX
    if (x > width + 20 || x + spanWidth < -20) continue
    const archHeight = spanWidth * art.rects[0].h / art.rects[0].w
    const stone = art.rects[1], pillar = spanWidth * 0.2
    for (const supportX of [x, x + spanWidth - pillar]) {
      for (let top = y + archHeight - 2; top < bottom; top += 12)
        context.drawImage(art.atlas, stone.x + stone.w * 0.3, stone.y + stone.h * 0.5, stone.w * 0.2, stone.h * 0.3, supportX, top, pillar, 12)
    }
    asset(context, art, 0, x, y, spanWidth + 0.2)
  }
  context.restore()
}

function stairs(context: CanvasRenderingContext2D, art: BridgeArt, state: RunState, span: Span, height: number): void {
  const from = span.x0 + Math.max(0, Math.floor((state.cameraX - span.x0) / 12)) * 12
  const to = Math.min(span.x1, state.cameraX + state.width + 12)
  context.save(); context.beginPath()
  context.moveTo(from - state.cameraX, height)
  for (let x = from; x < to; x += 12) {
    const end = Math.min(to, x + 12), y = spanHeight(span, (x + end) / 2, state.height)
    context.lineTo(x - state.cameraX, y); context.lineTo(end - state.cameraX, y)
  }
  context.lineTo(to - state.cameraX, height); context.closePath(); context.clip()
  const tile = 72, rect = art.rects[1], bodyY = rect.y + rect.h * 0.2, bodyHeight = rect.h * 0.75
  const tileHeight = tile * bodyHeight / rect.w
  const top = Math.min(spanHeight(span, span.x0, state.height), spanHeight(span, span.x1, state.height))
  for (let x = Math.floor(from / tile) * tile; x < to; x += tile)
    for (let y = top; y < height; y += tileHeight)
      context.drawImage(art.atlas, rect.x, bodyY, rect.w, bodyHeight, x - state.cameraX, y, tile, tileHeight)
  for (let x = from; x < to; x += 12) {
    const end = Math.min(to, x + 12), y = spanHeight(span, (x + end) / 2, state.height)
    context.drawImage(art.atlas, rect.x, rect.y, rect.w, rect.h * 0.045, x - state.cameraX, y, end - x, 2.5)
    context.fillStyle = '#c1ad87'; context.fillRect(x - state.cameraX, y, end - x, 0.6)
  }
  context.restore()
}

export function drawBridgeTerrain(context: CanvasRenderingContext2D, art: BridgeArt, state: RunState, width: number, height: number): void {
  const stone = art.rects[1]
  for (const platform of state.platforms) {
    const x = platform.x0 - state.cameraX, w = platform.x1 - platform.x0
    if (x + w < 0 || x > width) continue
    for (const edge of [platform.x0 + 2, platform.x1 - 9]) {
      const floor = groundHeightAt(state, edge)
      if (floor === null) continue
      context.save(); context.beginPath(); context.rect(edge - state.cameraX, platform.y, 7, floor - platform.y); context.clip()
      for (let y = platform.y; y < floor; y += 14)
        context.drawImage(art.atlas, stone.x + stone.w * 0.3, stone.y + stone.h * 0.25, stone.w * 0.12, stone.h * 0.5, edge - state.cameraX, y, 7, 14)
      context.restore()
    }
    context.save(); context.beginPath(); context.rect(x, platform.y, w, 8); context.clip()
    for (let at = platform.x0; at < platform.x1; at += 72)
      context.drawImage(art.atlas, stone.x, stone.y, stone.w, stone.h * 0.25, at - state.cameraX, platform.y, 72, 8)
    context.restore()
  }
  for (const span of state.ground) {
    if (span.x1 < state.cameraX || span.x0 > state.cameraX + width) continue
    const y = spanHeight(span, span.x0, state.height)
    if (Math.abs(spanHeight(span, span.x1, state.height) - y) < 0.5) arcade(context, art, state, span.x0, span.x1, y, width, height)
    else stairs(context, art, state, span, height)
  }
  for (const landmark of [360, 2825]) {
    const span = state.ground.find(item => landmark >= item.x0 && landmark <= item.x1)
    const x = landmark - state.cameraX
    if (span && x > -30 && x < width + 30) heraldry(context, art, x, spanHeight(span, landmark, state.height) + 7, true)
  }
}

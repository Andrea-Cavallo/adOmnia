import type { GothicArt } from './hubGothicArt'
import type { RunState } from './hubRunModel'
import { placeOnSurface } from './hubRunPlacement'
import { CEMETERY } from './hubRunStages'

export function drawCemeteryGate(context: CanvasRenderingContext2D, art: GothicArt, state: RunState): void {
  const stage = state.stage!, point = placeOnSurface(state, CEMETERY.gate, 3)
  const x = CEMETERY.gate - state.cameraX
  if (!point || x < -70 || x > state.width + 70) return
  const age = stage.gateOpenedAt === undefined ? 10 : stage.elapsed - stage.gateOpenedAt
  const opening = stage.gate ? Math.min(1, age / 0.75) : 0
  const rect = art.stageSprites[6], height = 54, width = height * rect.w / rect.h
  context.save()
  // Two leaves turn away around their outer hinges; their source halves stay separate.
  const leaf = width / 2 * Math.max(0.09, Math.cos(opening * Math.PI / 2))
  context.drawImage(art.stageAtlas, rect.x, rect.y, rect.w / 2, rect.h, x - width / 2, point.y - height, leaf, height)
  context.drawImage(art.stageAtlas, rect.x + rect.w / 2, rect.y, rect.w / 2, rect.h, x + width / 2 - leaf, point.y - height, leaf, height)
  if (!stage.gate || age < 0.6) {
    context.strokeStyle = '#ac8952'; context.lineWidth = 1.1
    for (const side of [-1, 1]) {
      context.save(); context.translate(x + side * opening * 20, point.y - 22 + opening * opening * 34)
      context.rotate(side * opening)
      context.beginPath(); context.moveTo(0, 0); context.lineTo(side * 15, -7); context.stroke(); context.restore()
    }
    context.fillStyle = '#d1ad68'; context.fillRect(x - 2, point.y - 24 + opening * 25, 4, 5)
  }
  if (!stage.gate && Math.abs(state.knight.x - CEMETERY.gate) < 85) {
    context.font = '6px Georgia'; context.textAlign = 'center'; context.fillStyle = '#ebd8ae'
    context.fillText(stage.key ? 'MAUSOLEUM KEY' : 'LOCKED · FIND THE KEY', x, point.y - 59)
  }
  context.restore()
}

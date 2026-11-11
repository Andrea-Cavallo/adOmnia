import { drawQualityEscape } from './hubQualityArt'
import type { GothicArt } from './hubGothicArt'
import type { RunState } from './hubRunModel'
import { placeOnSurface } from './hubRunPlacement'
import { CEMETERY } from './hubRunStages'

export function drawCaptives(context: CanvasRenderingContext2D, art: GothicArt, state: RunState, _clock: number): void {
  const rescued = state.stage?.rescued ?? []
  for (const prisoner of CEMETERY.prisoners) {
    if (prisoner.id === 3 && (!state.stage?.secrets.includes(1) || state.stage.elapsed - (state.stage.secretFoundAt?.[1] ?? state.stage.elapsed) < 0.6)) continue
    const point = placeOnSurface(state, prisoner.x, 3, prisoner.upper)
    if (!point || prisoner.x < state.cameraX - 80 || prisoner.x > state.cameraX + state.width + 80) continue
    const rect = art.quality.prisonerRects[rescued.includes(prisoner.id) ? 1 : 0]
    const height = 48, width = height * rect.w / rect.h
    context.drawImage(art.quality.prisoner, rect.x, rect.y, rect.w, rect.h, prisoner.x - state.cameraX - width / 2, point.y - height, width, height)
  }
}

export function drawEscapes(context: CanvasRenderingContext2D, state: RunState, art: GothicArt): void {
  for (const actor of state.escapes ?? []) {
    if (actor.x < state.cameraX - 60 || actor.x > state.cameraX + state.width + 60) continue
    drawQualityEscape(context, art.quality, state, actor)
  }
}

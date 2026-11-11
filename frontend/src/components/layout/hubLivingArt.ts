import type { GothicArt } from './hubGothicArt'
import type { RunState } from './hubRunModel'
import { groundHeightAt } from './hubRunModel'
import { actionSprite } from './hubActionArt'

import { CEMETERY_URNS } from './hubRunStages'
export function drawLivingBackdrop(context: CanvasRenderingContext2D, state: RunState, width: number, height: number, time: number): void {
  context.save()
  for (const event of state.stage?.ambientEvents ?? []) {
    const age = state.stage!.elapsed - event.time, floor = groundHeightAt(state, event.x)
    if (age < 0 || age > 3 || floor === null) continue
    context.globalAlpha = Math.min(1, (3 - age) * 2)
    if (event.kind === 'crows') {
      context.strokeStyle = '#121a25'; context.lineWidth = 1.5
      for (let i = 0; i < 5; i++) {
        const x = event.x - state.cameraX - age * 80 + i * 14, y = floor - 12 - age * 40 - i * 6
        const wing = Math.sin(age * 20 + i) * 4
        context.beginPath(); context.moveTo(x - 5, y - wing); context.lineTo(x, y); context.lineTo(x + 5, y - wing); context.stroke()
      }
    } else {
      context.fillStyle = '#9b907b'
      for (let i = 0; i < 7; i++) {
        const y = floor - 65 + age * age * (18 + i * 2)
        if (y < floor) context.fillRect(event.x - state.cameraX + i * 5 - 15, y, 1 + i % 2, 2)
      }
    }
  }
  context.globalAlpha = 1
  for (const at of [600, 1870, 2920, 3530]) {
    const x = at - state.cameraX, floor = groundHeightAt(state, at)
    if (floor === null || x < -30 || x > width + 30) continue
    context.fillStyle = '#514436'; context.fillRect(x - 1.4, floor - 18, 2.8, 18)
    for (let i = 0; i < 3; i++) {
      const flicker = Math.sin(time * 17 + at + i * 2)
      context.fillStyle = ['#8f4926', '#d77e36', '#f7d889'][i]
      context.beginPath(); context.moveTo(x - 3 + i * 0.7, floor - 18); context.quadraticCurveTo(x - 3, floor - 22, x + flicker * 1.3, floor - 28 + i * 2 + flicker); context.quadraticCurveTo(x + 4 - i, floor - 21, x + 3 - i, floor - 18); context.fill()
    }
  }
  const gust = Math.max(0, Math.sin(time / 2.8))
  context.globalAlpha = 0.25 + gust * 0.3; context.fillStyle = '#a18460'
  for (let i = 0; i < 12; i++) {
    const x = ((i * 53 - time * (12 + gust * 12) - state.cameraX * 0.2) % (width + 30) + width + 30) % (width + 30) - 15
    const y = height * 0.45 + ((i * 31 + time * 9) % (height * 0.48))
    context.save(); context.translate(x, y); context.rotate(time * 2 + i)
    context.beginPath(); context.ellipse(0, 0, 1.8, 0.55, 0, 0, Math.PI * 2); context.fill(); context.restore()
  }
  context.restore()
}

export function drawLivingProps(context: CanvasRenderingContext2D, art: GothicArt, state: RunState): void {
  for (let id = 0; id < CEMETERY_URNS.length; id++) {
    const at = CEMETERY_URNS[id], floor = groundHeightAt(state, at)
    const x = at - state.cameraX
    if (floor === null || x < -30 || x > state.width + 30) continue
    const broken = state.stage?.brokenUrns?.includes(id)
    actionSprite(context, art.action.equipment, broken ? 6 : 5, x, floor, broken ? 6 : 16)
    const elapsed = state.stage!.elapsed - (state.stage?.urnBrokenAt?.[id] ?? -100)
    if (broken && elapsed < 0.7) {
      context.save(); context.fillStyle = '#b78357'; context.globalAlpha = 1 - elapsed / 0.7
      for (let i = 0; i < 6; i++) {
        const px = x + (i - 2.5) * elapsed * 22, py = floor - 6 - elapsed * (40 + i * 5) + elapsed * elapsed * 100
        context.fillRect(px, py, 1.5, 2)
      }
      context.restore()
    }
  }
}

import { DESK_ARENAS, arenaImpact } from './deskCombat'
import { box, line, text } from './drawing'
import type { VisualState } from './visuals'

/** Show the encounter and actual impacts, without previewing enemy trajectories. */
export function drawDeskArenas(ctx: CanvasRenderingContext2D, state: VisualState) {
  if (state.level !== 0) return
  for (const b of state.enemies) {
    if (!b.encounter || !b.combat) continue
    const c = b.combat, a = DESK_ARENAS[b.encounter]
    if (c.phase === 'waiting' || (c.phase === 'cleared' && c.gate <= 0)) continue
    ctx.save()
    const color = c.phase === 'cleared' ? '#83ffd4' : c.enraged ? '#ffb985' : '#86d8ff'
    ctx.globalAlpha = c.gate * .75
    for (const x of b.encounter === 'legacy' ? [a.left, a.right] : []) {
      box(ctx, x - 4, 0, 8, 460, 2, '#152e48')
      line(ctx, [x, 460, x, 460 - c.gate * 460], color, 3)
      for (let y = 20; y < 450; y += 30) line(ctx, [x - 6, y, x + 6, y + 10], color, 1)
    }
    ctx.globalAlpha = 1
    // Effects coincide with damage; no target or trajectory is revealed in advance.
    if (c.phase === 'attack' && (b.encounter === 'soap' || c.clock >= (b.encounter === 'legacy' ? .8 : c.duration - .16))) {
      const impact = arenaImpact(b)
      if (impact) box(ctx, impact.x, impact.y, impact.w, impact.h, 6, '#ff876890')
    }
    if (c.phase === 'recover') {
      ctx.strokeStyle = '#8affd5'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * .6, 0, Math.PI * 2); ctx.stroke()
    }
    if (b.encounter !== 'legacy') { ctx.restore(); continue }
    const cx = Math.max(state.camera + 220, Math.min(state.camera + 740, (a.left + a.right) / 2))
    box(ctx, cx - 215, 112, 430, 57, 5, '#061323ec')
    ctx.textAlign = 'center'
    text(ctx, `${a.name}${c.enraged ? ` · ${state.copy.arenaEnraged}` : ''}`, cx, 130, color, 13)
    const hint = c.phase === 'entrance' ? state.copy.arenaEntering : c.phase === 'recover' ? state.copy.arenaRecover
      : c.phase === 'cleared' ? state.copy.arenaReward : ''
    text(ctx, hint, cx, 149, c.phase === 'recover' ? '#8affd5' : '#d9e9f6', 10)
    box(ctx, cx - 170, 159, 340, 3, 1, '#20344b')
    box(ctx, cx - 170, 159, 340 * Math.max(0, (b.hp ?? 0) / a.hp), 3, 1, color)
    ctx.restore()
  }
}

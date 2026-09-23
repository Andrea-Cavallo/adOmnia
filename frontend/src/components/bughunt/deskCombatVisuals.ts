import { DESK_ARENAS, arenaImpact } from './deskCombat'
import { box, line, text } from './drawing'
import type { VisualState } from './visuals'

/** World-space warnings and screen-space instructions use the same combat state. */
export function drawDeskArenas(ctx: CanvasRenderingContext2D, state: VisualState) {
  if (state.level !== 0) return
  for (const b of state.enemies) {
    if (!b.encounter || !b.combat) continue
    const c = b.combat, a = DESK_ARENAS[b.encounter]
    if (c.phase === 'waiting' || (c.phase === 'cleared' && c.gate <= 0)) continue
    ctx.save()
    const color = c.phase === 'cleared' ? '#83ffd4' : c.enraged ? '#ffb985' : '#86d8ff'
    ctx.globalAlpha = c.gate * .75
    for (const x of [a.left, a.right]) {
      box(ctx, x - 4, 0, 8, 460, 2, '#152e48')
      line(ctx, [x, 460, x, 460 - c.gate * 460], color, 3)
      for (let y = 20; y < 450; y += 30) line(ctx, [x - 6, y, x + 6, y + 10], color, 1)
    }
    ctx.globalAlpha = 1
    if (c.phase === 'tell' || c.phase === 'attack') {
      const warning = c.phase === 'tell'
      const impact = arenaImpact(b)
      ctx.strokeStyle = warning ? '#ffdb8e' : '#ff8568'; ctx.lineWidth = 2
      ctx.setLineDash(warning ? [6, 5] : [])
      if (impact) {
        box(ctx, impact.x, impact.y, impact.w, impact.h, 2, warning ? '#ffc46b33' : '#ff876890')
        ctx.strokeRect(impact.x, impact.y, impact.w, impact.h)
        text(ctx, warning ? '!' : '×', impact.x + impact.w / 2 - 4, impact.y - 8, '#ffe5ad', 17)
      }
      if (b.encounter === 'soap' && c.move === 0) {
        const angle = Math.atan2(c.targetY - b.y - b.h / 2, c.targetX - b.x - b.w / 2)
        for (const offset of (c.enraged ? [-.28, 0, .28] : [-.18, 0, .18])) {
          line(ctx, [b.x + b.w / 2, b.y + b.h / 2, b.x + b.w / 2 + Math.cos(angle + offset) * 266, b.y + b.h / 2 + Math.sin(angle + offset) * 266], '#ffe1a5aa', 1.5)
        }
      } else if (c.move === 1 && b.encounter !== 'soap') {
        const x = Math.min(c.startX, c.targetX), w = Math.abs(c.targetX - c.startX) + b.w
        ctx.strokeRect(x, 460 - b.h, w, b.h)
        text(ctx, c.direction > 0 ? '>>>': '<<<', x + w / 2 - 15, 450, '#ffdb8e', 13)
      } else if (b.encounter === 'retry' && c.move === 0) {
        ctx.beginPath(); ctx.moveTo(c.startX + b.w / 2, 450)
        ctx.quadraticCurveTo((c.startX + c.targetX) / 2 + b.w / 2, c.enraged ? 200 : 250, c.targetX + b.w / 2, 450); ctx.stroke()
      }
      ctx.setLineDash([])
    }
    if (c.phase === 'recover') {
      ctx.strokeStyle = '#8affd5'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * .6, 0, Math.PI * 2); ctx.stroke()
    }
    const cx = Math.max(state.camera + 220, Math.min(state.camera + 740, (a.left + a.right) / 2))
    box(ctx, cx - 215, 112, 430, 57, 5, '#061323ec')
    ctx.textAlign = 'center'
    text(ctx, `${a.name}${c.enraged ? ` · ${state.copy.arenaEnraged}` : ''}`, cx, 130, color, 13)
    const moveIndex = (b.encounter === 'retry' ? 0 : b.encounter === 'soap' ? 2 : 4) + c.move
    const hint = c.phase === 'entrance' ? state.copy.arenaEntering : c.phase === 'recover' ? state.copy.arenaRecover
      : c.phase === 'cleared' ? state.copy.arenaReward : (c.phase === 'tell' || c.phase === 'attack') ? state.copy.arenaMoves[moveIndex] : '…'
    text(ctx, hint, cx, 149, c.phase === 'recover' ? '#8affd5' : '#d9e9f6', 10)
    box(ctx, cx - 170, 159, 340, 3, 1, '#20344b')
    box(ctx, cx - 170, 159, 340 * Math.max(0, (b.hp ?? 0) / a.hp), 3, 1, color)
    ctx.restore()
  }
}

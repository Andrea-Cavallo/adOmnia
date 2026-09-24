import { box, glow, line } from './drawing'
import type { Bug } from './level'

/** Small desk pests have their own silhouettes; the three named monsters stay unique. */
export function drawDeskCritter(ctx: CanvasRenderingContext2D, b: Bug, time: number) {
  const flying = b.hover || b.kind === 'flyer' || b.kind === 'timeout'
  const turret = b.kind === 'turret'
  const armored = b.kind === 'zombie'
  const chaser = b.kind === 'chaser'
  const cx = b.x + b.w / 2, feet = b.y + b.h
  const metal = ctx.createLinearGradient(0, b.y, 0, feet)
  metal.addColorStop(0, '#c9d4dc'); metal.addColorStop(.3, '#718798'); metal.addColorStop(.7, '#293948'); metal.addColorStop(1, '#101c2a')
  const accent = turret ? '#ffac78' : armored ? '#d6ac77' : chaser ? '#ffa264' : flying ? '#a8cfff' : '#96e0bf'
  ctx.save()
  ctx.shadowColor = '#0009'; ctx.shadowBlur = 5
  if (flying) {
    // USB dragonfly: horizontal body and rotor wings, never a paper Phantom.
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#9fd4ee55'; ctx.beginPath()
      ctx.ellipse(cx + side * 24, b.y + 7, 17, 3 + Math.abs(Math.sin(time * 24)) * 4, side * .2, 0, Math.PI * 2); ctx.fill()
      line(ctx, [cx + side * 12, b.y + 9, cx + side * 25, b.y + 4], '#bdd8e7', 2)
    }
    box(ctx, cx - 20, b.y + 7, 40, 22, 8, metal)
    box(ctx, cx + b.direction * 15 - 5, b.y + 11, 10, 13, 3, '#0a1422')
    glow(ctx, cx + b.direction * 16, b.y + 17, 8, '#60bfff55')
    box(ctx, cx + b.direction * 16 - 2, b.y + 14, 4, 6, 1, b.kind === 'timeout' ? '#ffad8b' : accent)
    line(ctx, [cx - 6, b.y + 29, cx - 10, feet, cx + 10, feet, cx + 6, b.y + 29], '#637f96', 2)
  } else if (turret) {
    box(ctx, cx - 23, feet - 7, 46, 7, 2, '#111d29')
    box(ctx, cx - 15, feet - 25, 30, 20, 4, metal)
    box(ctx, cx - 10, feet - 34, 20, 19, 5, '#4d6376')
    line(ctx, [cx, feet - 26, cx + b.direction * 28, feet - 26], '#121e2b', 9)
    line(ctx, [cx, feet - 28, cx + b.direction * 27, feet - 28], '#97b4c8', 2)
    glow(ctx, cx + b.direction * 28, feet - 26, 8, '#ff9f6444')
  } else {
    // Beetles: walking legs, compact armoured shells, no Gremlin face or CRT screen.
    for (let i = 0; i < 3; i++) {
      const x = cx - 14 + i * 14, stride = Math.sin(time * (chaser ? 17 : 9) + i * 2) * 4
      line(ctx, [x, feet - 13, x - 5 + stride, feet - 5, x - 8 + stride, feet - 1], '#8594a0', 3)
    }
    ctx.fillStyle = metal; ctx.beginPath(); ctx.ellipse(cx, feet - 19, armored ? 25 : 22, armored ? 18 : 14, 0, 0, Math.PI * 2); ctx.fill()
    line(ctx, [cx - 16, feet - 22, cx + 15, feet - 22], accent, armored ? 5 : 2)
    box(ctx, cx + b.direction * 12 - 9, feet - 22, 18, 10, 4, '#0b1927')
    for (const dx of [-4, 4]) box(ctx, cx + b.direction * 12 + dx - 1, feet - 20, 3, 4, 1, accent)
    if (chaser) {
      line(ctx, [cx - 14, feet - 31, cx - 19, feet - 39, cx - 5, feet - 33], '#dc9470', 3)
    }
  }
  ctx.shadowBlur = 0
  if ((b.alert ?? 0) > .6) { ctx.fillStyle = '#ffcd83'; ctx.font = 'bold 16px monospace'; ctx.fillText('!', cx - 4, b.y - 12) }
  if ((b.hp ?? 1) > 1) for (let i = 0; i < b.hp!; i++) box(ctx, b.x + i * 9, b.y - 5, 6, 2, 1, accent)
  ctx.restore()
}

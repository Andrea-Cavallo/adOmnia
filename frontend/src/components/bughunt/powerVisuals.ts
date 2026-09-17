import type { BugHuntCopy } from './copy'
import { LEVELS, type Bug } from './level'
import { BREAKPOINT_SECONDS, SUDO_SECONDS, pickupKey, type PowerKind, type PowerState } from './powers'
import { box, glow, line, text, type PlayerVisual } from './visuals'

const LOOK: Record<PowerKind, { glyph: string; label: string; color: string; dark: string }> = {
  revert: { glyph: '↺', label: 'git revert', color: '#8fd3ff', dark: '#0e2a3d' },
  breakpoint: { glyph: '⏸', label: 'breakpoint', color: '#ff7d92', dark: '#3a1020' },
  sudo: { glyph: '#', label: 'sudo', color: '#ffd76a', dark: '#3a2c08' },
  gc: { glyph: '♻', label: 'gc()', color: '#7dffb2', dark: '#0b3321' },
}

/** Floating chips with a rotating dashed ring: readable by glyph and label, not only by colour. */
export function drawPowerPickups(ctx: CanvasRenderingContext2D, level: number, powers: PowerState, camera: number, t: number) {
  for (const [index, power] of LEVELS[level].powers.entries()) {
    if (powers.picked.has(pickupKey(level, index)) || power.x < camera - 40 || power.x > camera + 1000) continue
    const look = LOOK[power.kind]
    const y = power.y + Math.sin(t * 2.6 + index) * 4
    glow(ctx, power.x, y, 48, `${look.color}40`)
    ctx.save(); ctx.translate(power.x, y)
    ctx.rotate(t * 1.4)
    ctx.setLineDash([6, 5]); ctx.strokeStyle = `${look.color}aa`; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
    ctx.restore()
    box(ctx, power.x - 15, y - 15, 30, 30, 8, look.dark)
    box(ctx, power.x - 13, y - 13, 26, 26, 7, look.color)
    box(ctx, power.x - 10, y - 10, 20, 20, 5, look.dark)
    ctx.textAlign = 'center'
    text(ctx, look.glyph, power.x, y + 6, look.color, 16)
    text(ctx, look.label, power.x, y - 30, look.color, 10)
    ctx.textAlign = 'left'
  }
}

export function drawSudoAura(ctx: CanvasRenderingContext2D, p: PlayerVisual, t: number, sudo: number) {
  if (sudo <= 0) return
  // Blink during the last 1.5 s so the end of immunity is never a surprise.
  if (sudo < 1.5 && Math.floor(t * 10) % 2 === 0) return
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2
  glow(ctx, cx, cy, 70, '#ffd76a55')
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-t * 2)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    ctx.fillStyle = i % 2 ? '#fff1b8' : '#ffc94a'
    ctx.fillRect(Math.cos(a) * 36 - 2, Math.sin(a) * 36 - 2, 4, 4)
  }
  ctx.restore()
  ctx.textAlign = 'center'
  text(ctx, '#', cx, p.y - 14 + Math.sin(t * 6) * 2, '#ffe08a', 14)
  ctx.textAlign = 'left'
}

export function drawBreakpointMarkers(ctx: CanvasRenderingContext2D, enemies: Bug[], t: number) {
  for (const bug of enemies) {
    if (!bug.alive) continue
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#8fb8ff99'; ctx.lineWidth = 1.5
    ctx.strokeRect(bug.x - 5, bug.y - 6, bug.w + 10, bug.h + 12); ctx.setLineDash([])
    const pulse = 1 + Math.sin(t * 8) * 0.15
    glow(ctx, bug.x - 5, bug.y - 6, 14 * pulse, '#ff4d6d88')
    ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(bug.x - 5, bug.y - 6, 5 * pulse, 0, Math.PI * 2); ctx.fill()
  }
}

export function drawGcWave(ctx: CanvasRenderingContext2D, gc: PowerState['gc']) {
  if (!gc) return
  const fade = Math.max(0, 1 - gc.r / 680)
  ctx.save()
  ctx.globalAlpha = fade
  ctx.strokeStyle = '#7dffb2'; ctx.lineWidth = 6
  ctx.beginPath(); ctx.arc(gc.x, gc.y, gc.r, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = '#e8fff4'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(gc.x, gc.y, Math.max(0, gc.r - 14), 0, Math.PI * 2); ctx.stroke()
  // Hex addresses ride the wave front, like memory being swept.
  ctx.textAlign = 'center'
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + gc.r / 300
    text(ctx, `0x${(0x1a0 + i * 0x2f).toString(16)}`, gc.x + Math.cos(a) * gc.r, gc.y + Math.sin(a) * gc.r, '#b8ffd9', 9)
  }
  ctx.textAlign = 'left'
  ctx.restore()
}

export function drawRewindGhosts(ctx: CanvasRenderingContext2D, powers: PowerState) {
  if (!powers.rewind) return
  const frames = powers.rewind
  for (let i = frames.length - 1; i >= 0; i -= 16) {
    const f = frames[i]
    ctx.globalAlpha = 0.12 + 0.3 * (1 - i / frames.length)
    // a0 silhouette: head plus folded body, so the trail reads as past positions.
    box(ctx, f.x - 2, f.y, 38, 32, 10, '#8fd3ff')
    ctx.fillStyle = '#8fd3ff'; ctx.beginPath(); ctx.moveTo(f.x + 5, f.y + 33); ctx.lineTo(f.x + 29, f.y + 33); ctx.lineTo(f.x + 17, f.y + 50); ctx.closePath(); ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Screen-space feedback: the whole scene tells you which mode you are in. */
export function drawPowerOverlay(ctx: CanvasRenderingContext2D, powers: PowerState, t: number, copy: BugHuntCopy, reducedMotion: boolean) {
  if (powers.breakpoint > 0) {
    ctx.fillStyle = '#3b7bff1c'; ctx.fillRect(0, 0, 960, 540)
    banner(ctx, `⏸  ${copy.breakpointBanner}`, powers.breakpoint / BREAKPOINT_SECONDS, '#ff7d92', 0)
  }
  if (powers.sudo > 0) {
    ctx.strokeStyle = '#ffd76a55'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 954, 534)
    banner(ctx, `${copy.sudoBanner} ▌`, powers.sudo / SUDO_SECONDS, '#ffd76a', powers.breakpoint > 0 ? 1 : 0)
  }
  if (powers.rewind) {
    ctx.fillStyle = '#6fb9ff22'; ctx.fillRect(0, 0, 960, 540)
    if (!reducedMotion) {
      for (let y = (t * 900) % 12; y < 540; y += 12) { ctx.fillStyle = '#ffffff10'; ctx.fillRect(0, y, 960, 2) }
      ctx.fillStyle = '#ff5cc81a'; ctx.fillRect(0, 0, 6, 540); ctx.fillStyle = '#5ce0ff1a'; ctx.fillRect(954, 0, 6, 540)
    }
    ctx.textAlign = 'center'
    text(ctx, `◀◀  ${copy.rewindBanner}`, 480, 270, '#dff2ff', 30)
    ctx.textAlign = 'left'
  }
}

function banner(ctx: CanvasRenderingContext2D, label: string, remaining: number, color: string, row: number) {
  const y = 64 + row * 38
  box(ctx, 330, y, 300, 30, 8, '#070c18e6')
  line(ctx, [330, y + 29, 330 + 300 * Math.max(0, Math.min(1, remaining)), y + 29], color, 3)
  ctx.textAlign = 'center'
  text(ctx, label, 480, y + 19, color, 13)
  ctx.textAlign = 'left'
}

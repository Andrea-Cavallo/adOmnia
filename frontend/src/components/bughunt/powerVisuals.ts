import type { BugHuntCopy } from './copy'
import { LEVELS, type Bug } from './level'
import { BREAKPOINT_SECONDS, SUDO_SECONDS, pickupKey, type PowerKind, type PowerState } from './powers'
import { box, glow, line, text, type PlayerVisual } from './visuals'

const LOOK: Record<PowerKind, { glyph: string; label: string; color: string; dark: string }> = {
  shield: { glyph: '◇', label: 'Debugger Shield', color: '#7ceaff', dark: '#103047' },
  jump: { glyph: '↑', label: 'Branch Jump', color: '#bca1ff', dark: '#251c43' },
  heal: { glyph: '+', label: 'Hotfix', color: '#80ffd0', dark: '#10352d' },
  boost: { glyph: '»', label: 'Merge Boost', color: '#ffb279', dark: '#412416' },
  revert: { glyph: '↺', label: 'git revert', color: '#8fd3ff', dark: '#0e2a3d' },
  breakpoint: { glyph: '⏸', label: 'breakpoint', color: '#ff7d92', dark: '#3a1020' },
  sudo: { glyph: '#', label: 'sudo', color: '#ffd76a', dark: '#3a2c08' },
  gc: { glyph: '♻', label: 'gc()', color: '#7dffb2', dark: '#0b3321' },
  shuriken: { glyph: '{}', label: 'JSON Shuriken', color: '#9fc8ff', dark: '#0d1b3a' },
}

/** Physical modules: common chassis, distinct symbol and accent, resting on the collision top. */
export function drawPowerPickups(ctx: CanvasRenderingContext2D, level: number, powers: PowerState, camera: number, _t: number) {
  for (const [index, power] of LEVELS[level].powers.entries()) {
    if (powers.picked.has(pickupKey(level, index)) || power.x < camera - 40 || power.x > camera + 1000) continue
    const look=LOOK[power.kind], x=power.x, y=power.y
    glow(ctx,x,y,30,look.color+'28')
    ctx.save()
    // Contacts, cast shadow and a bevel make the pickup a desk object rather than HUD.
    box(ctx,x-18,y+13,38,4,2,'#0009')
    box(ctx,x-16,y-16,32,31,4,'#617386')
    box(ctx,x-13,y-13,26,25,3,look.dark)
    line(ctx,[x-14,y-14,x+14,y-14,x+14,y+12],look.color,2)
    for(const dx of [-10,0,10])box(ctx,x+dx-2,y+11,4,5,1,'#c9b590')
    box(ctx,x-12,y-12,24,3,1,look.color+'66')
    ctx.textAlign='center';text(ctx,look.glyph,x,y+6,look.color,20)
    ctx.restore()
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
  if (powers.shield) { ctx.strokeStyle='#7ceaff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(34,102,8,0,Math.PI*2);ctx.stroke() }
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

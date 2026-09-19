import type { BugHuntCopy } from './copy'
import { BOSS_ANNOUNCE, BOSS_FISTS, BOSS_TOWER, LEVELS, BOSS_BODY, firewallPhase, CHECKPOINT_X, EXIT_X, HOTFIX, TURRET_CYCLE, type Envelope, type Platform, type Boss, type Bug } from './level'
import { drawBreakpointMarkers, drawGcWave, drawPowerOverlay, drawPowerPickups, drawRewindGhosts, drawSudoAura } from './powerVisuals'
import type { PowerState } from './powers'

export type PlayerVisual = { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean; facing: number; invulnerable: number; squash: number; dash?: number
  grapple?: { x: number; y: number; length: number } | null }
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; gravity: number }
export type Popup = { x: number; y: number; text: string; color: string; life: number }
export type Shot = { x: number; y: number; vx: number; life: number; enemy: boolean }
export type VisualState = {
  level: number; platforms: Platform[]; boss: Boss; player: PlayerVisual; enemies: Bug[]; camera: number; time: number; collected: Set<number>
  particles: Particle[]; popups: Popup[]; checkpoint: boolean; hotfix: boolean; secret: boolean
  shake: number; reducedMotion: boolean; finished: boolean; copy: BugHuntCopy
  /** Clock that stops on a breakpoint. */
  worldTime: number; powers: PowerState
  /** Leading edge of the DELETE wave and whether it is chasing right now. */
  purgeX: number; purgeState: 'off' | 'waiting' | 'active' | 'cleared'
  /** Debug packets from a0 and bolts from the turrets, in one list. */
  shots: Shot[]
  /** -1 while the Monolith has gravity reversed. */
  gravity: number
}

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill()
}

export function line(ctx: CanvasRenderingContext2D, points: number[], color: string, width = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(points[0], points[1])
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
  ctx.stroke()
}

export function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, size = 12) {
  ctx.fillStyle = color; ctx.font = `600 ${size}px monospace`; ctx.fillText(value, x, y)
}

export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent')
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

function drawBackdrop(ctx: CanvasRenderingContext2D, camera: number, time: number, level: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, 540)
  bg.addColorStop(0, '#070d1c'); bg.addColorStop(0.55, ['#151334', '#092e3c', '#35182a'][level]); bg.addColorStop(1, '#25134b')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 960, 540)
  glow(ctx, 725 - camera * 0.06, 120, 370, '#5739a931')
  glow(ctx, 140, 375, 300, '#13688121')

  ctx.save(); ctx.translate(-camera * 0.15, 0)
  for (let i = 0; i < 18; i++) {
    const x = i * 105 - 25, top = 170 + Math.sin(i * 2.1) * 65
    box(ctx, x, top, 76, 360, 5, i % 2 ? '#101529' : '#11172f')
    line(ctx, [x + 1, top + 330, x + 1, top, x + 74, top], '#35416455')
    for (let j = 0; j < 9; j++) {
      ctx.fillStyle = j % 3 === 0 ? '#203f5355' : '#2b2c4d55'
      ctx.fillRect(x + 9, top + 16 + j * 29, 56, 17)
      ctx.fillStyle = '#43cbc266'; ctx.fillRect(x + 53, top + 21 + j * 29, 3, 3)
    }
  }
  text(ctx, LEVELS[level].name.toLowerCase(), 280, 137, '#7180a320', 72)
  text(ctx, '// ALL SYSTEMS ALMOST OPERATIONAL', 288, 164, '#63719355', 10)
  ctx.restore()

  ctx.save(); ctx.translate(-camera * 0.38, 0)
  for (let i = 0; i < 12; i++) {
    const x = i * 187 - 80, y = 205 + (i % 3) * 45
    line(ctx, [x, 0, x, y - 30, x + 30, y, x + 145, y, x + 165, y + 20, x + 165, 500], '#51416839', 2)
    const signal = ((time * 45 + i * 57) % 400)
    ctx.fillStyle = '#52b6b666'; ctx.fillRect(x - 2, signal - 80, 4, 11)
    box(ctx, x + 65, y - 37, 54, 20, 3, '#162433')
    text(ctx, i % 2 ? 'HTTP' : 'TCP', x + 75, y - 23, '#57909a', 9)
  }
  ctx.restore()
  for (let i = 0; i < 32; i++) {
    const x = (i * 127.3 + time * (3 + i % 4) - camera * 0.08) % 1000
    const y = 55 + (i * 83.7) % 370 + Math.sin(time * 0.5 + i) * 6
    ctx.fillStyle = i % 3 ? '#927bd04d' : '#7ef4ea70'; ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, 2)
  }
  // A low mist separates the readable foreground from the server silhouettes.
  const mist = ctx.createLinearGradient(0, 310, 0, 470)
  mist.addColorStop(0, 'transparent'); mist.addColorStop(1, '#59428b24')
  ctx.fillStyle = mist; ctx.fillRect(0, 310, 960, 170)
}

function drawTerminal(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, subtitle: string, accent = '#67d8cf') {
  box(ctx, x, y, 235, 72, 6, '#0b1423')
  line(ctx, [x, y + 72, x, y, x + 235, y, x + 235, y + 72], '#33445e')
  box(ctx, x + 9, y + 8, 4, 4, 2, accent)
  text(ctx, 'TERMINAL', x + 22, y + 13, '#73849c', 8)
  text(ctx, title, x + 12, y + 36, accent, 13)
  text(ctx, subtitle, x + 12, y + 56, '#899ab1', 10)
  line(ctx, [x + 115, y + 72, x + 115, 458], '#36334b', 3)
}

/** Neon accent per platform role, so the rule is read before it is felt. */
function slabTint(p: Platform): { edge: string; glow: string; trace: string } {
  if (p.unstable) return { edge: '#ffb879', glow: '#ff8c3a2e', trace: '#ffd2a0' }
  if (p.arena) return { edge: '#ffa24d', glow: '#ff7a2e2e', trace: '#ffc98f' }
  if (p.travel) return { edge: '#b3a2ff', glow: '#7d5cff2e', trace: '#d6ccff' }
  if (p.floating) return { edge: '#7ce7ff', glow: '#3ba6ff33', trace: '#a9f0ff' }
  return { edge: '#6ff0ff', glow: '#2f8cff26', trace: '#8fd8ff' }
}

/** Etched copper: a trace runs, turns, and ends on a via. */
function drawTraces(ctx: CanvasRenderingContext2D, p: Platform, color: string) {
  ctx.save()
  ctx.beginPath(); ctx.roundRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4, 5); ctx.clip()
  ctx.globalAlpha = 0.34
  for (let x = p.x + 16; x < p.x + p.w - 12; x += 44) {
    const drop = 7 + ((x / 44) % 3) * 4
    line(ctx, [x, p.y + p.h - 5, x, p.y + drop + 4, x + 16, p.y + drop, x + 30, p.y + drop], color, 1.4)
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x + 30, p.y + drop, 2.1, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/** One platform: lit edge, end caps, etched face and a recessed glyph window. */
function drawSlab(ctx: CanvasRenderingContext2D, p: Platform, time: number, glyph: string) {
  const tint = slabTint(p)
  const h = Math.min(p.h, 26)
  glow(ctx, p.x + p.w / 2, p.y + h / 2, Math.max(60, p.w * 0.42), tint.glow)

  // Chassis, then the inset face that carries the traces.
  box(ctx, p.x - 2, p.y - 2, p.w + 4, h + 5, 7, '#070a16')
  box(ctx, p.x, p.y, p.w, h, 6, '#171a2e')
  const face = ctx.createLinearGradient(0, p.y, 0, p.y + h)
  face.addColorStop(0, '#242a48'); face.addColorStop(0.55, '#141830'); face.addColorStop(1, '#0d1024')
  ctx.fillStyle = face
  ctx.beginPath(); ctx.roundRect(p.x + 2, p.y + 2, p.w - 4, h - 4, 5); ctx.fill()
  drawTraces(ctx, p, tint.trace)

  // The lit rail a0 actually stands on.
  const rail = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0)
  rail.addColorStop(0, 'transparent'); rail.addColorStop(0.12, tint.edge)
  rail.addColorStop(0.88, tint.edge); rail.addColorStop(1, 'transparent')
  ctx.fillStyle = rail; ctx.fillRect(p.x + 3, p.y, p.w - 6, 3)
  ctx.globalAlpha = 0.5; ctx.fillRect(p.x + 3, p.y + 3, p.w - 6, 1.5); ctx.globalAlpha = 1
  ctx.strokeStyle = tint.edge + '66'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.roundRect(p.x + 0.5, p.y + 0.5, p.w - 1, h - 1, 6); ctx.stroke()

  // End caps.
  for (const side of [0, 1]) {
    const x = side ? p.x + p.w - 16 : p.x
    box(ctx, x, p.y + 1, 16, h - 2, 5, '#0f1326')
    ctx.fillStyle = tint.edge
    ctx.fillRect(side ? x + 12 : x + 2, p.y + 6, 2, h - 12)
    ctx.globalAlpha = 0.55
    ctx.fillRect(side ? x + 7 : x + 6, p.y + 8, 2, 2)
    ctx.fillRect(side ? x + 7 : x + 6, p.y + h - 11, 2, 2)
    ctx.globalAlpha = 1
  }

  // Recessed glyph window: one per slab, centred, never on the short ones.
  if (p.w >= 96) {
    const gw = 62, gx = p.x + p.w / 2 - gw / 2
    box(ctx, gx, p.y + 7, gw, h - 13, 3, '#050810')
    ctx.strokeStyle = tint.edge + '44'; ctx.strokeRect(gx + 0.5, p.y + 7.5, gw - 1, h - 14)
    ctx.textAlign = 'center'
    ctx.globalAlpha = 0.65 + Math.abs(Math.sin(time * 2.2 + p.x * 0.01)) * 0.35
    text(ctx, glyph, p.x + p.w / 2, p.y + h - 8, tint.edge, 11)
    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
  }
}

/** Ground slabs are bolted to the room: chassis, vents, bolts, then pylons. */
function drawPylons(ctx: CanvasRenderingContext2D, p: Platform, time: number) {
  const h = Math.min(p.h, 26)
  const top = p.y + h
  const deep = Math.max(74, Math.min(p.h, 120) - h)

  // Chassis under the lit rail, so the floor has mass instead of hanging.
  const body = ctx.createLinearGradient(0, top, 0, top + deep)
  body.addColorStop(0, '#191d33'); body.addColorStop(0.35, '#121628'); body.addColorStop(1, '#0a0d1c')
  ctx.fillStyle = body
  ctx.beginPath(); ctx.roundRect(p.x + 4, top, p.w - 8, deep, 4); ctx.fill()
  line(ctx, [p.x + 4, top + 1, p.x + p.w - 4, top + 1], '#2b3356', 2)

  for (let x = p.x + 16; x < p.x + p.w - 22; x += 62) {
    // Vent louvres with one live status light per bay.
    box(ctx, x, top + 9, 42, 26, 3, '#0c1020')
    for (let i = 0; i < 4; i++) { ctx.fillStyle = '#1e2542'; ctx.fillRect(x + 4, top + 13 + i * 6, 34, 3) }
    const lit = Math.sin(time * 1.7 + x * 0.05) > 0.45
    ctx.fillStyle = lit ? '#63e0d0' : '#26405a'
    ctx.fillRect(x + 34, top + 40, 4, 4)
    ctx.fillStyle = '#212a4a'; ctx.fillRect(x + 4, top + 40, 24, 4)
    // Bolts on the seam.
    for (const bx of [x + 2, x + 46]) { ctx.fillStyle = '#2d3559'; ctx.beginPath(); ctx.arc(bx, top + 5, 2, 0, Math.PI * 2); ctx.fill() }
  }

  for (let x = p.x + 40; x < p.x + p.w - 28; x += 150) {
    box(ctx, x - 11, top + deep - 4, 22, 9, 3, '#171c33')
    box(ctx, x - 6, top + deep + 5, 12, 96, 2, '#101426')
    ctx.fillStyle = '#39456f'; ctx.fillRect(x - 6, top + deep + 5, 2, 96)
    for (let y = top + deep + 18; y < top + deep + 98; y += 24) {
      ctx.fillStyle = '#1d2444'; ctx.fillRect(x - 13, y, 26, 5)
    }
    ctx.strokeStyle = '#252d52'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(x + 6, top + deep + 10)
    ctx.quadraticCurveTo(x + 44, top + deep + 40, x + 36, top + deep + 100)
    ctx.stroke()
  }

  const shade = ctx.createLinearGradient(0, top + deep, 0, 540)
  shade.addColorStop(0, '#080b18cc'); shade.addColorStop(1, '#070a14')
  ctx.fillStyle = shade; ctx.fillRect(p.x, top + deep, p.w, 160)
}

/** Anti-gravity mounts: the brackets a floating slab hangs from. */
function drawMounts(ctx: CanvasRenderingContext2D, p: Platform, time: number) {
  const h = Math.min(p.h, 26)
  const tint = slabTint(p)
  for (const x of [p.x + 13, p.x + p.w - 13]) {
    box(ctx, x - 7, p.y + h - 1, 14, 6, 2, '#141a30')
    const pulse = 0.45 + Math.abs(Math.sin(time * 3 + x * 0.02)) * 0.55
    ctx.globalAlpha = pulse
    ctx.fillStyle = tint.edge; ctx.fillRect(x - 4, p.y + h + 4, 8, 2)
    glow(ctx, x, p.y + h + 9, 15, tint.glow)
    ctx.globalAlpha = 1
    line(ctx, [x, p.y + h + 7, x, p.y + h + 13 + Math.sin(time * 4 + x) * 2], tint.edge + '55', 2)
  }
}

function drawPlatforms(ctx: CanvasRenderingContext2D, camera: number, time: number, state: VisualState) {
  for (const p of state.platforms) {
    if (p.x + p.w < camera - 40 || p.x > camera + 1000) continue
    if (p.deleted) {
      ctx.setLineDash([7, 9]); line(ctx, [p.x, p.y, p.x + p.w, p.y], '#ff6d8c33', 2); ctx.setLineDash([])
      continue
    }
    if ((p.crumble ?? 0) > 0.8) { line(ctx, [p.x, p.y, p.x + p.w, p.y], '#66566a44', 2); continue }
    if (p.ceiling) {
      // Same slab, hung the other way up: the rail faces the arena.
      const flipped: Platform = { ...p, y: p.y, h: Math.min(p.h, 26) }
      ctx.save(); ctx.translate(0, p.y * 2 + Math.min(p.h, 26)); ctx.scale(1, -1)
      drawSlab(ctx, flipped, time, '///')
      ctx.restore()
      const hang = ctx.createLinearGradient(0, p.y + p.h, 0, p.y + p.h + 80)
      hang.addColorStop(0, '#090c1b'); hang.addColorStop(1, 'transparent')
      ctx.fillStyle = hang; ctx.fillRect(p.x, p.y + p.h, p.w, 80)
      continue
    }
    if (!p.floating) drawPylons(ctx, p, time)
    const glyph = p.unstable ? ((p.crumble ?? 0) > 0 ? '! ! !' : '/ / /')
      : p.travel ? '<   >'
      : p.floating ? '</>'
      : '>>>'
    drawSlab(ctx, p, time, glyph)
    if (p.floating) drawMounts(ctx, p, time)
  }
  for (const p of LEVELS[state.level].spikes) {
    glow(ctx, p.x + p.w / 2, p.y + 17, 44, '#ef526222')
    for (let x = p.x; x < p.x + p.w; x += 16) {
      ctx.fillStyle = '#ed7f8c'; ctx.beginPath(); ctx.moveTo(x, p.y + p.h); ctx.lineTo(x + 8, p.y); ctx.lineTo(x + 16, p.y + p.h); ctx.fill()
      ctx.fillStyle = '#ffbdba'; ctx.fillRect(x + 7, p.y + 6, 2, 5)
    }
    text(ctx, '! NULL', p.x + 7, p.y - 12, '#f4a2ac', 9)
  }
  // Hazard symbols remain visible independently of the red/purple palette.
  const ground = state.platforms.filter(p => !p.floating).sort((a, b) => a.x - b.x)
  for (const platform of ground.slice(0, -1)) {
    const x = platform.x + platform.w
    text(ctx, '∨', x + 23, 510 + Math.sin(time * 2) * 2, '#9574bf', 17)
  }
}

function drawRobot(ctx: CanvasRenderingContext2D, p: PlayerVisual, time: number, reducedMotion: boolean, flipped = false) {
  if ((p.dash ?? 0) > 0) {
    line(ctx, [p.x + 17 - p.facing * 65, p.y + 20, p.x + 17, p.y + 20], '#83ffe899', 9)
    line(ctx, [p.x + 17 - p.facing * 45, p.y + 35, p.x + 17, p.y + 35], '#c9a0ff88', 4)
  }
  const moving = Math.abs(p.vx) > 20
  const bob = reducedMotion ? 0 : Math.sin(time * (moving ? 19 : 3.2)) * (moving ? 1.1 : 1.4)
  ctx.save()
  ctx.translate(p.x + p.w / 2, flipped ? p.y : p.y + p.h)
  if (flipped) ctx.scale(1, -1)
  if (p.invulnerable > 0) ctx.globalAlpha = 0.65 + Math.sin(time * 18) * 0.2
  glow(ctx, 0, -17, 44, '#973ce329')
  ctx.fillStyle = '#a870f026'; ctx.beginPath(); ctx.ellipse(0, 2, 21, 4, 0, 0, Math.PI * 2); ctx.fill()
  ctx.translate(0, -3 + bob)
  if (!reducedMotion) { ctx.rotate(p.vx / 5000); ctx.scale(1 + p.squash, 1 - p.squash) }
  // Floating origami torso and folded hands echo the supplied a0 reference.
  ctx.fillStyle = '#9862f0'; ctx.beginPath(); ctx.moveTo(-12, -17); ctx.lineTo(12, -17); ctx.lineTo(5, -1); ctx.lineTo(-5, 1); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#5825a2'; ctx.beginPath(); ctx.moveTo(-12, -17); ctx.lineTo(9, -12); ctx.lineTo(-5, 1); ctx.closePath(); ctx.fill()
  for (const side of [-1, 1]) {
    const armY = -17 + (moving && !reducedMotion ? Math.sin(time * 19 + side) * 3 : 0)
    ctx.fillStyle = '#ac7bff'; ctx.beginPath(); ctx.moveTo(side * 15, armY); ctx.lineTo(side * 22, armY - 7); ctx.lineTo(side * 19, armY + 6); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#6b35be'; ctx.beginPath(); ctx.moveTo(side * 15, armY); ctx.lineTo(side * 19, armY + 6); ctx.lineTo(side * 13, armY + 2); ctx.closePath(); ctx.fill()
  }
  const flame = p.grounded ? 4 : 9 + (reducedMotion ? 0 : Math.sin(time * 28) * 3)
  ctx.fillStyle = '#c094ff'; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.lineTo(0, flame); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#ecdeff'; ctx.fillRect(-1, 0, 2, Math.max(2, flame * 0.45))
  box(ctx, -19, -48, 38, 34, 10, '#b98af6')
  box(ctx, -18, -47, 36, 32, 9, '#6632aa')
  box(ctx, -15, -44, 30, 27, 7, '#080e1b')
  line(ctx, [-10, -42, 7, -42], '#87879e77')
  const blink = !moving && p.grounded && time % 5.5 > 5.36
  // Counter-flip the face: upside down, `aO` would read as `90`.
  ctx.save()
  if (flipped) { ctx.translate(0, -62); ctx.scale(1, -1) }
  if (blink) line(ctx, [-8, -30, 9, -30], '#ece9ff', 2)
  else text(ctx, 'aO', -12 + p.facing * 0.6, -25, '#faf5ff', 20)
  ctx.strokeStyle = '#bb6aff'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(-5, -21); ctx.quadraticCurveTo(0, -17, 6, -21); ctx.stroke()
  ctx.restore()
  ctx.restore()
}

function drawTurret(ctx: CanvasRenderingContext2D, bug: Bug, time: number) {
  const charge = Math.min(1, (bug.fuse ?? 0) / TURRET_CYCLE)
  const aiming = (bug.alert ?? 0) > 0.2
  const hot = charge > 0.7
  const color = hot ? '#ff7b6b' : aiming ? '#ffb56b' : '#8c7f9e'
  glow(ctx, bug.x + 19, bug.y + 17, hot ? 48 : 30, hot ? '#ff5a4a33' : '#ffb56b22')
  if (aiming) {
    ctx.setLineDash([5, 7])
    line(ctx, [bug.x + 19, bug.y + 13, bug.x + 19 + bug.direction * (60 + charge * 190), bug.y + 13], hot ? '#ff9a8b99' : '#ffb56b44', 2)
    ctx.setLineDash([])
  }
  box(ctx, bug.x + 2, bug.y + 8, 34, 26, 6, '#3a2f4d')
  box(ctx, bug.x + 5, bug.y + 10, 28, 8, 4, color)
  box(ctx, bug.x + 17 + bug.direction * 16, bug.y + 9, 12, 9, 2, color)
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < Math.ceil(charge * 3) ? color : '#4c4160'
    ctx.fillRect(bug.x + 9 + i * 8, bug.y + 24, 6, 4)
  }
  box(ctx, bug.x + 6, bug.y + 34, 26, 5, 2, '#2a2239')
  if (hot) text(ctx, '!', bug.x + 16, bug.y - 6 + Math.sin(time * 22) * 1.5, '#ffd0a8', 15)
  text(ctx, 'THROW', bug.x - 4, bug.y - 18, aiming ? '#ffc79a' : '#8c7f9e', 8)
}

function drawArmour(ctx: CanvasRenderingContext2D, bug: Bug) {
  if ((bug.hp ?? 1) < 2) return
  box(ctx, bug.x + 4, bug.y - 4, 30, 6, 3, '#f0d7a0')
  ctx.fillStyle = '#8a7340'
  for (let i = 0; i < 3; i++) ctx.fillRect(bug.x + 9 + i * 9, bug.y - 3, 4, 4)
}

function drawBug(ctx: CanvasRenderingContext2D, bug: Bug, time: number) {
  if (bug.kind === 'turret') { drawTurret(ctx, bug, time); drawArmour(ctx, bug); return }
  const alert = bug.kind === 'chaser' ? (bug.alert ?? 0) : 0
  if (alert > 0.6) {
    glow(ctx, bug.x + 19, bug.y + 16, 46, '#ff33553a')
    text(ctx, '!!', bug.x + 12, bug.y - 14 + Math.sin(time * 20) * 2, '#ff9db4', 16)
  } else if (bug.kind === 'chaser') {
    text(ctx, '?', bug.x + 16, bug.y - 12, '#b6a7d6', 13)
  }
  if (bug.hover) {
    glow(ctx, bug.x + 19, bug.y + 16, 32, '#67c8ff44')
    line(ctx, [bug.x - 9, bug.y - 5, bug.x + 47, bug.y - 5], '#97dcff', 2)
    text(ctx, '↑', bug.x + 14, bug.y - 14, '#b2e7ff', 14)
  }
  const bob = Math.sin(time * 12 + bug.phase)
  ctx.save(); ctx.translate(bug.x + 19, bug.y + 20)
  glow(ctx, 0, 7, 30, '#ed426023')
  for (let i = 0; i < 3; i++) {
    const offset = Math.sin(time * 15 + i * 2 + bug.phase) * 3
    line(ctx, [-12 + i * 11, 6, -17 + i * 13, 14 + offset], '#a44569', 3)
  }
  box(ctx, -18, -10 + bob, 36, 22, 9, '#bb365c')
  box(ctx, -15, -10 + bob, 30, 10, 7, '#e7697a')
  line(ctx, [-10, -9, -13, -19, -18, -21], '#f4929a', 2)
  line(ctx, [10, -9, 13, -19, 18, -21], '#f4929a', 2)
  const look = bug.direction * 2
  const eye = alert > 0.6 ? '#ff5c6e' : '#fff5da'
  box(ctx, -10 + look, -3 + bob, 6, 5, 1, eye)
  box(ctx, 5 + look, -3 + bob, 6, 5, 1, eye)
  line(ctx, [-5, 6 + bob, 5, 6 + bob], '#531c39', 2)
  ctx.restore()
  drawArmour(ctx, bug)
}

/** a0's packets read cyan and fast; turret bolts read orange and slow. */
function drawShots(ctx: CanvasRenderingContext2D, shots: Shot[], t: number) {
  for (const shot of shots) {
    const direction = Math.sign(shot.vx) || 1
    if (shot.enemy) {
      glow(ctx, shot.x, shot.y, 22, '#ff7b5a44')
      line(ctx, [shot.x - direction * 14, shot.y, shot.x, shot.y], '#ffb56b88', 4)
      box(ctx, shot.x - 6, shot.y - 6, 13, 12, 5, '#ff8a5c')
      ctx.fillStyle = '#ffe2c9'; ctx.fillRect(shot.x - 2, shot.y - 2, 4, 4)
      continue
    }
    glow(ctx, shot.x, shot.y, 20, '#6ff0ff3d')
    line(ctx, [shot.x - direction * 26, shot.y, shot.x, shot.y], '#8cf7ec88', 3)
    ctx.save(); ctx.translate(shot.x, shot.y); ctx.scale(direction, 1)
    ctx.fillStyle = '#c9fbff'
    ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(8, 0); ctx.lineTo(-7, 5); ctx.lineTo(-3, 0); ctx.closePath(); ctx.fill()
    ctx.restore()
    if (Math.floor(t * 30) % 2 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(shot.x - 1, shot.y - 1, 2, 2) }
  }
}

/** Magnetic anchors: a pulsing node, brighter once a0 is inside latch range. */
function drawAnchors(ctx: CanvasRenderingContext2D, state: VisualState, t: number) {
  const cx = state.player.x + state.player.w / 2, cy = state.player.y + state.player.h / 2
  for (const anchor of LEVELS[state.level].anchors) {
    if (anchor.x < state.camera - 60 || anchor.x > state.camera + 1020) continue
    const near = Math.hypot(anchor.x - cx, anchor.y - cy) < 300 && anchor.y < cy - 24
    const color = near ? '#8cf7ec' : '#6a7fc0'
    glow(ctx, anchor.x, anchor.y, near ? 54 : 30, near ? '#4ee0d033' : '#5f6fb322')
    ctx.save(); ctx.translate(anchor.x, anchor.y); ctx.rotate(t * (near ? 1.9 : 0.7))
    ctx.strokeStyle = color; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, 0, 13 + Math.sin(t * 4) * (near ? 2.5 : 1), 0.4, Math.PI * 0.9); ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 0, 13, Math.PI * 1.4, Math.PI * 1.9); ctx.stroke()
    ctx.restore()
    box(ctx, anchor.x - 5, anchor.y - 5, 10, 10, 3, color)
    ctx.fillStyle = '#eafcff'; ctx.fillRect(anchor.x - 1, anchor.y - 1, 2, 2)
    if (near) text(ctx, 'E', anchor.x - 4, anchor.y - 22, '#b9fff5', 11)
  }
}

/** The live cable: a taut line with a charge travelling up to the anchor. */
function drawCable(ctx: CanvasRenderingContext2D, state: VisualState, t: number) {
  const cable = state.player.grapple
  if (!cable) return
  const px = state.player.x + state.player.w / 2, py = state.player.y + 14
  line(ctx, [px, py, cable.x, cable.y], '#8cf7ecaa', 3)
  line(ctx, [px, py, cable.x, cable.y], '#eafcffcc', 1)
  const travel = (t * 1.6) % 1
  glow(ctx, px + (cable.x - px) * travel, py + (cable.y - py) * travel, 13, '#9ff0ff66')
  glow(ctx, cable.x, cable.y, 46, '#4ee0d044')
}

/** The DELETE wave: everything to its left is gone, not just dark. */
function drawPurge(ctx: CanvasRenderingContext2D, state: VisualState, t: number) {
  if (state.purgeState !== 'active') return
  const edge = state.purgeX
  if (edge < state.camera - 120) return
  const left = Math.max(state.camera - 140, edge - 1100)
  const void_ = ctx.createLinearGradient(left, 0, edge, 0)
  void_.addColorStop(0, '#05030b'); void_.addColorStop(0.72, '#140617e6'); void_.addColorStop(1, '#3c0f2bcc')
  ctx.fillStyle = void_; ctx.fillRect(left, 0, edge - left, 540)
  for (let i = 0; i < 26; i++) {
    const y = (i * 41 + (t * 140) % 41) % 540
    const w = 40 + ((i * 97) % 260)
    ctx.fillStyle = i % 3 ? '#ff5d8a22' : '#b388ff26'
    ctx.fillRect(edge - w - ((i * 53 + t * 90) % 420), y, w, 2)
  }
  glow(ctx, edge, 270, 190, '#ff3f7a2e')
  const front = ctx.createLinearGradient(edge - 34, 0, edge + 6, 0)
  front.addColorStop(0, '#ff5d8a00'); front.addColorStop(1, '#ff85a8')
  ctx.fillStyle = front; ctx.fillRect(edge - 34, 0, 40, 540)
  line(ctx, [edge, 0, edge, 540], '#fff0f5', 2)
  ctx.save(); ctx.translate(edge - 12, 0)
  for (let y = 40; y < 520; y += 96) {
    ctx.save(); ctx.translate(0, y); ctx.rotate(-Math.PI / 2)
    text(ctx, 'DELETE  FROM  *', 0, 0, '#ffd8e3aa', 13)
    ctx.restore()
  }
  ctx.restore()
}

/** The stack the Monolith refuses to leave behind. */
const LEGACY_STACK = ['JAVA 6', 'EJB', 'WSDL', 'JAX-WS', 'STRUTS', 'ORACLE']

/** A thrown SOAP envelope, speed lines and all. */
function drawEnvelope(ctx: CanvasRenderingContext2D, envelope: Envelope) {
  const cx = envelope.x + envelope.w / 2, cy = envelope.y + envelope.h / 2
  const back = Math.sign(envelope.vx) || -1
  glow(ctx, cx, cy, 40, '#b9c8ff2e')
  for (let i = 0; i < 3; i++) {
    const length = 26 + i * 13
    line(ctx, [cx - back * 20, cy - 8 + i * 8, cx - back * (20 + length), cy - 8 + i * 8], '#dfe7ff55', 2)
  }
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.sin(envelope.spin) * 0.12)
  box(ctx, -21, -15, 42, 30, 3, '#ffffff')
  ctx.strokeStyle = '#b9c6e4'; ctx.lineWidth = 1
  ctx.strokeRect(-20.5, -14.5, 41, 29)
  // The flap, then the envelope body a0 must not let touch him.
  line(ctx, [-21, -15, 0, 1, 21, -15], '#93a6cd', 1.5)
  text(ctx, 'SOAP', -17, -1, '#2f5bc4', 11)
  line(ctx, [-17, 5, 14, 5], '#aab8d8')
  line(ctx, [-17, 10, 7, 10], '#aab8d8')
  ctx.restore()
}

/** The Legacy Monolith: a tower of unretired stacks with a very angry CRT. */
function drawMonolith(ctx: CanvasRenderingContext2D, state: VisualState, t: number) {
  const boss = state.boss, c = state.copy
  const tower = BOSS_TOWER, b = BOSS_BODY
  const open = boss.clock >= 2 && !boss.hit
  const color = open ? '#85ffcc' : '#f395a0'
  const cx = tower.x + tower.w / 2
  const hum = Math.sin(t * 2.2) * 2

  // Wall graffiti, far behind everything else.
  ctx.save(); ctx.translate(0, hum * 0.3)
  text(ctx, c.bossWallCode, 2276, 214, '#5b4f7a44', 15)
  text(ctx, c.bossWallLegacy, 3010, 210, '#5b4f7a44', 14)
  ctx.restore()

  // Arms: heavy cables out to two fists, the throwing one kicked back.
  for (const [index, fist] of BOSS_FISTS.entries()) {
    const side = index ? 1 : -1
    const kick = boss.arm === index ? boss.recoil * 46 : 0
    const fx = fist.x + side * kick, fy = fist.y - kick * 0.3
    const shoulder = { x: cx + side * (tower.w / 2 - 6), y: 244 + hum }
    for (const [width, tint] of [[13, '#2b2135'], [7, '#4a3a53']] as const) {
      ctx.strokeStyle = tint; ctx.lineWidth = width; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y)
      ctx.quadraticCurveTo(shoulder.x + side * 52, shoulder.y + 46, fx, fy + 8)
      ctx.stroke()
    }
    ctx.lineCap = 'butt'
    box(ctx, fx - 24, fy - 20, 48, 42, 10, '#c9cfe4')
    box(ctx, fx - 24, fy - 20, 48, 12, 6, '#eef1fa')
    for (let finger = 0; finger < 3; finger++) box(ctx, fx - 19 + finger * 14, fy - 24, 11, 14, 5, '#dde2f0')
    box(ctx, fx - 20, fy + 8, 40, 7, 3, '#9aa2bd')
  }

  // Tower body.
  glow(ctx, cx, 300, 210, open ? '#59e6ac26' : '#eb416d22')
  box(ctx, tower.x - 3, tower.y - 3, tower.w + 6, tower.h + 3, 11, '#0d0a18')
  box(ctx, tower.x, tower.y, tower.w, tower.h, 10, '#4a4168')
  box(ctx, tower.x + 6, tower.y + 6, tower.w - 12, tower.h - 12, 8, '#2a2440')
  for (let y = tower.y + 18; y < 460; y += 46) line(ctx, [tower.x + 8, y, tower.x + tower.w - 8, y], '#00000022', 2)

  // Horns and the name plate, clear of the arena ceiling.
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#bfa15e'
    ctx.beginPath(); ctx.moveTo(cx + side * 54, tower.y + 2); ctx.lineTo(cx + side * 40, tower.y - 22); ctx.lineTo(cx + side * 30, tower.y + 2); ctx.closePath(); ctx.fill()
  }
  box(ctx, cx - 62, tower.y - 16, 124, 26, 5, '#d8d2bd')
  ctx.textAlign = 'center'
  text(ctx, c.bossName, cx, tower.y + 2, '#2f2a3d', 11)

  // The CRT face. Eyes track a0; the shape changes when the core opens.
  const screen = { x: tower.x + 14, y: tower.y + 20, w: tower.w - 28, h: 104 }
  box(ctx, screen.x - 6, screen.y - 6, screen.w + 12, screen.h + 12, 8, '#b9b3a0')
  box(ctx, screen.x, screen.y, screen.w, screen.h, 6, '#04170f')
  glow(ctx, screen.x + screen.w / 2, screen.y + screen.h / 2, 74, open ? '#59e6ac3a' : '#38ff9e26')
  const face = open ? '#9cffd8' : '#4dfb9b'
  const look = Math.max(-7, Math.min(7, (state.player.x + state.player.w / 2 - cx) / 46))
  const eyeY = screen.y + 36 + hum * 0.6
  for (const side of [-1, 1]) {
    const ex = screen.x + screen.w / 2 + side * 26 + look
    if (open) {
      box(ctx, ex - 12, eyeY - 12, 24, 24, 4, face)
      box(ctx, ex - 5, eyeY - 5, 10, 10, 2, '#04170f')
    } else {
      // Angry: the inner brow drops toward the middle of the screen.
      ctx.fillStyle = face
      ctx.beginPath()
      ctx.moveTo(ex - side * 14, eyeY - 14); ctx.lineTo(ex + side * 13, eyeY - 2)
      ctx.lineTo(ex + side * 13, eyeY + 12); ctx.lineTo(ex - side * 14, eyeY + 12)
      ctx.closePath(); ctx.fill()
    }
  }
  const mouthY = screen.y + 76
  if (open) { box(ctx, screen.x + screen.w / 2 - 20, mouthY - 8, 40, 20, 9, face) }
  else {
    ctx.fillStyle = face
    ctx.beginPath(); ctx.moveTo(screen.x + 26, mouthY + 8); ctx.quadraticCurveTo(screen.x + screen.w / 2, mouthY - 12, screen.x + screen.w - 26, mouthY + 8)
    ctx.lineTo(screen.x + screen.w - 26, mouthY + 14); ctx.quadraticCurveTo(screen.x + screen.w / 2, mouthY - 4, screen.x + 26, mouthY + 14)
    ctx.closePath(); ctx.fill()
  }
  for (let y = screen.y + 3; y < screen.y + screen.h; y += 5) line(ctx, [screen.x + 2, y, screen.x + screen.w - 2, y], '#00000033', 1)
  ctx.textAlign = 'left'

  // The stack it will not retire, and the notes nobody dares remove.
  for (const [index, label] of LEGACY_STACK.entries()) {
    const y = 286 + index * 15
    box(ctx, tower.x + 14, y, 78, 13, 3, '#ded9cc')
    text(ctx, label, tower.x + 18, y + 10, '#2f2a3d', 8)
    ctx.fillStyle = index % 2 ? '#7de8c4' : '#f2a15f'
    ctx.fillRect(tower.x + 100, y + 4, 5, 5)
    ctx.fillStyle = '#4b4363'; ctx.fillRect(tower.x + 110, y + 3, 28, 7)
  }
  for (const [index, note] of [c.bossNoteWorks, c.bossNoteTouch].entries()) {
    const nx = tower.x + tower.w + 8, ny = 290 + index * 52
    ctx.save(); ctx.translate(nx, ny); ctx.rotate(index ? 0.05 : -0.04)
    box(ctx, 0, 0, 74, 44, 3, '#e8d75c')
    const words = note.split(' ')
    const lines: string[] = []
    for (const word of words) {
      const last = lines[lines.length - 1]
      if (last && (last + ' ' + word).length <= 11) lines[lines.length - 1] = last + ' ' + word
      else lines.push(word)
    }
    for (const [row, phrase] of lines.slice(0, 4).entries()) text(ctx, phrase, 5, 13 + row * 10, '#4a3f18', 8)
    ctx.restore()
  }

  // The core: the one part a0 can land on, and the health it still has.
  glow(ctx, b.x + 45, b.y + 42, 116, open ? '#59e6ac44' : '#eb416d2e')
  box(ctx, b.x - 4, b.y, b.w + 8, b.h, 9, '#322c47')
  box(ctx, b.x + 3, b.y, b.w - 6, 13, 4, color)
  for (let i = 0; i < 3; i++) box(ctx, b.x + 14 + i * 23, b.y + 34, 16, 34, 3, i < boss.health ? color : '#514456')
  if (open) for (let i = 0; i < 3; i++) line(ctx, [b.x + 22 + i * 23, b.y - 8 - ((t * 28 + i * 9) % 18), b.x + 22 + i * 23, b.y - 16 - ((t * 28 + i * 9) % 18)], color, 2)

  ctx.textAlign = 'center'
  const state_ = open ? c.bossOpen : boss.health === 1 && boss.clock < 2 ? c.bossDoubleWave : boss.clock < 1.3 ? c.bossWarning : c.bossLocked
  box(ctx, cx - 116, 468, 232, 20, 5, '#0c0a17cc')
  text(ctx, state_, cx, 482, color, 11)
  ctx.textAlign = 'left'

  for (const envelope of boss.envelopes) drawEnvelope(ctx, envelope)
}

/** The command banner lives in screen space: it can never cover the boss. */
function drawBossAnnounce(ctx: CanvasRenderingContext2D, state: VisualState, t: number) {
  const boss = state.boss
  if (state.level !== 2 || boss.health <= 0 || !boss.command || boss.announce <= 0) return
  const left = boss.announce / BOSS_ANNOUNCE
  const pulse = 0.5 + Math.abs(Math.sin(t * 9)) * 0.5
  const w = 470, x = 480 - w / 2, top = 84
  glow(ctx, 480, top + 40, 260, `rgba(255, 150, 90, ${0.1 + pulse * 0.08})`)
  box(ctx, x, top, w, 82, 8, '#160d1ef2')
  line(ctx, [x, top, x + w, top], '#ffb56b', 2)
  ctx.textAlign = 'center'
  text(ctx, state.copy.bossRule, 480, top + 21, '#ffd18a', 12)
  text(ctx, state.copy.bossCmd[boss.command], 480, top + 46, pulse > 0.5 ? '#fff0d6' : '#ffb56b', 17)
  text(ctx, state.copy.bossCmdHint[boss.command], 480, top + 67, '#c7b9dd', 10)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#ffb56b'; ctx.fillRect(x + 6, top + 76, (w - 12) * left, 3)
}

export function renderLocalhost(ctx: CanvasRenderingContext2D, state: VisualState) {
  const checkpointX = state.level === 2 ? 2500 : CHECKPOINT_X
  const gateOpen = state.hotfix && (state.level !== 2 || state.boss.health === 0)
  const t = state.reducedMotion ? 0 : state.time
  drawBackdrop(ctx, state.camera, t, state.level)
  ctx.save()
  const shake = state.reducedMotion ? 0 : state.shake
  ctx.translate(-Math.round(state.camera) + Math.sin(t * 83) * shake, Math.cos(t * 71) * shake * 0.45)
  drawPlatforms(ctx, state.camera, t, state)
  drawAnchors(ctx, state, t)

  for (const spring of LEVELS[state.level].springs) {
    glow(ctx, spring.x + 22, spring.y, 42, '#9affdf33')
    box(ctx, spring.x, spring.y, spring.w, spring.h, 5, '#4b3472')
    box(ctx, spring.x, spring.y, spring.w, 5, 3, '#b3ffda')
    text(ctx, '↑ ↑', spring.x + 9, spring.y - 9, '#b3ffda', 17)
  }
  const c = state.copy
  if (state.level === 0) {
  drawTerminal(ctx, 48, 305, c.signFriday, c.signFridayQuote, '#c4a1ff')
  drawTerminal(ctx, 550, 235, c.signBug, c.signBugHint)
  drawTerminal(ctx, checkpointX - 55, 272, c.signCommit, state.checkpoint ? c.signCommitSaved : c.signCommitHint)
  drawTerminal(ctx, 2710, 230, c.signPush, c.signPushHint, '#e8cc85')
  text(ctx, c.signSurprise, 1615, 266, '#b9a0db', 11)
  text(ctx, c.signSecret, 1824, 178, '#eccc80', 12)

  } else {
    drawTerminal(ctx, 48, 305, LEVELS[state.level].name, state.level === 1 ? 'RETRY / ROUTE / REPEAT' : 'FRIDAY / FINAL DEPLOY')
    drawTerminal(ctx, checkpointX - 55, 272, c.signCommit, state.checkpoint ? c.signCommitSaved : c.signCommitHint)
  }
  for (const wall of LEVELS[state.level].firewalls) {
    const phase = firewallPhase(state.worldTime, wall.phase)
    const color = phase === 'active' ? '#ff687f' : phase === 'warning' ? '#ffd280' : '#68d8ca'
    box(ctx, wall.x - 5, wall.y + wall.h - 6, wall.w + 10, 6, 2, color)
    text(ctx, phase.toUpperCase(), wall.x - 10, wall.y - 16, color, 10)
    if (phase !== 'off') {
      ctx.globalAlpha = phase === 'active' ? 0.65 : 0.18
      box(ctx, wall.x, wall.y, wall.w, wall.h, 4, color); ctx.globalAlpha = 1
      for (let y = wall.y + 4; y < 453; y += 16) line(ctx, [wall.x, y, wall.x + wall.w, y + 8], color, 2)
    }
  }
  if (state.level === 2 && state.boss.health > 0) drawMonolith(ctx, state, t)
  for (const bit of LEVELS[state.level].bits) {
    if (state.collected.has(bit.id) || bit.x < state.camera - 20 || bit.x > state.camera + 980) continue
    const y = bit.y + Math.sin(t * 3.8 + bit.id * 0.65) * 3
    glow(ctx, bit.x, y, 24, '#e5c65b26')
    ctx.save(); ctx.translate(bit.x, y); ctx.scale(0.55 + Math.abs(Math.cos(t * 2.5 + bit.id)) * 0.45, 1)
    ctx.fillStyle = bit.secret ? '#d1a6ff' : '#efcc75'
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 0); ctx.lineTo(0, 9); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#fff9db'; ctx.fillRect(-1, -4, 2, 8); ctx.restore()
  }

  const cpColor = state.checkpoint ? '#72edca' : '#827b9e'
  glow(ctx, checkpointX + 13, 410, state.checkpoint ? 70 : 25, state.checkpoint ? '#45dbab30' : '#6551a022')
  box(ctx, checkpointX, 397, 26, 63, 4, '#192b3d')
  box(ctx, checkpointX + 5, 403, 16, 33, 3, cpColor)
  text(ctx, state.checkpoint ? '✓' : '●', checkpointX + 7, 424, '#0c2d2c', 15)
  line(ctx, [checkpointX + 13, 436, checkpointX + 13, 458], cpColor, 2)

  if (!state.hotfix) {
    const x = HOTFIX.x + 15, y = HOTFIX.y + 17 + Math.sin(t * 3) * 4
    glow(ctx, x, y, 55, '#57eacf35')
    ctx.strokeStyle = '#69e5d088'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 24 + Math.sin(t * 2) * 2, 0, Math.PI * 2); ctx.stroke()
    box(ctx, x - 13, y - 13, 26, 26, 5, '#81f5d6')
    box(ctx, x - 8, y - 8, 16, 16, 2, '#163f42')
    text(ctx, '+', x - 5, y + 5, '#dcfff5', 15)
    text(ctx, 'HOTFIX', x - 22, y - 34, '#a9f0da', 11)
  }

  const gate = gateOpen ? '#76e8b9' : '#9480b1'
  glow(ctx, EXIT_X, 397, 96, gateOpen ? '#57e5a431' : '#7961a220')
  box(ctx, EXIT_X - 37, 346, 74, 114, 9, '#1b283b')
  box(ctx, EXIT_X - 29, 354, 58, 106, 5, '#071820')
  line(ctx, [EXIT_X - 30, 458, EXIT_X - 30, 353, EXIT_X + 30, 353, EXIT_X + 30, 458], gate, 4)
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = gateOpen ? `rgba(97, 237, 176, ${0.12 + i * 0.06})` : '#56516833'
    ctx.fillRect(EXIT_X - 25, 363 + ((i * 19 + t * 20) % 88), 50, 3)
  }
  ctx.textAlign = 'center'; text(ctx, gateOpen ? c.gatePassed : c.gateLocked, EXIT_X, 329, gate, 11); ctx.textAlign = 'left'
  text(ctx, gateOpen ? '→' : '×', EXIT_X - 11, 411, gate, 31)

  const bugTime = state.reducedMotion ? 0 : state.worldTime
  drawPowerPickups(ctx, state.level, state.powers, state.camera, t)
  for (const bug of state.enemies) if (bug.alive) drawBug(ctx, bug, bugTime)
  if (state.powers.breakpoint > 0) drawBreakpointMarkers(ctx, state.enemies, state.time)
  for (const bug of state.enemies) if (bug.alive && bug.retry) text(ctx, 'RETRY', bug.x, bug.y - 17, '#f2b2cb', 9)
  drawRewindGhosts(ctx, state.powers)
  drawSudoAura(ctx, state.player, state.time, state.powers.sudo)
  drawCable(ctx, state, t)
  drawRobot(ctx, state.player, t, state.reducedMotion, state.gravity < 0)
  drawShots(ctx, state.shots, state.time)
  drawPurge(ctx, state, t)
  drawGcWave(ctx, state.powers.gc)
  for (const particle of state.particles) {
    ctx.globalAlpha = Math.min(1, particle.life / particle.maxLife)
    ctx.fillStyle = particle.color
    ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size)
  }
  ctx.globalAlpha = 1
  for (const popup of state.popups) {
    ctx.globalAlpha = Math.min(1, popup.life * 2)
    ctx.textAlign = 'center'; text(ctx, popup.text, popup.x, popup.y, popup.color, 12); ctx.textAlign = 'left'
  }
  ctx.globalAlpha = 1
  ctx.restore()
  const vignette = ctx.createRadialGradient(480, 300, 230, 480, 280, 620)
  vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, '#03071499')
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, 960, 540)
  drawBossAnnounce(ctx, state, t)
  drawPowerOverlay(ctx, state.powers, state.time, state.copy, state.reducedMotion)
}

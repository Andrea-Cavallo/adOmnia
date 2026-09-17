import type { BugHuntCopy } from './copy'
import { LEVELS, BOSS_BODY, firewallPhase, CHECKPOINT_X, EXIT_X, HOTFIX, type Platform, type Boss, type Bug } from './level'
import { drawBreakpointMarkers, drawGcWave, drawPowerOverlay, drawPowerPickups, drawRewindGhosts, drawSudoAura } from './powerVisuals'
import type { PowerState } from './powers'

export type PlayerVisual = { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean; facing: number; invulnerable: number; squash: number; dash?: number }
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; gravity: number }
export type Popup = { x: number; y: number; text: string; color: string; life: number }
export type VisualState = {
  level: number; platforms: Platform[]; boss: Boss; player: PlayerVisual; enemies: Bug[]; camera: number; time: number; collected: Set<number>
  particles: Particle[]; popups: Popup[]; checkpoint: boolean; hotfix: boolean; secret: boolean
  shake: number; reducedMotion: boolean; finished: boolean; copy: BugHuntCopy
  /** Clock that stops on a breakpoint. */
  worldTime: number; powers: PowerState
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

function drawPlatforms(ctx: CanvasRenderingContext2D, camera: number, time: number, state: VisualState) {
  for (const p of state.platforms) {
    if ((p.crumble ?? 0) > 0.8) { line(ctx, [p.x, p.y, p.x + p.w, p.y], "#66566a44", 2); continue }
    if (p.x + p.w < camera - 20 || p.x > camera + 980) continue
    if (p.floating) glow(ctx, p.x + p.w / 2, p.y + 13, 55, '#5d3cb63a')
    box(ctx, p.x, p.y, p.w, p.h, 5, p.floating ? '#323456' : '#20223d')
    box(ctx, p.x, p.y, p.w, 6, 3, p.unstable ? '#ffb879' : '#8de8e0')
    if (p.unstable) text(ctx, (p.crumble ?? 0) > 0 ? '!!' : ' / / / ', p.x + 15, p.y + 18, '#ffdcad', 11)
    if (p.travel) text(ctx, '<  >', p.x + p.w / 2 - 15, p.y + 18, '#b5ffff', 10)
    ctx.fillStyle = '#3e9fa6'; ctx.fillRect(p.x + 2, p.y + 6, p.w - 4, 3)
    for (let x = p.x + 14; x < p.x + p.w - 10; x += 48) {
      ctx.fillStyle = '#4b5573'; ctx.fillRect(x, p.y + 13, 3, 3)
      if (!p.floating) {
        box(ctx, x - 7, p.y + 27, 37, 48, 3, '#141b2e')
        line(ctx, [x, p.y + 65, x, p.y + 38, x + 12, p.y + 38, x + 12, p.y + 48, x + 25, p.y + 48], '#3a4b6666')
        ctx.fillStyle = '#638c9955'; ctx.fillRect(x + 15, p.y + 59, 12, 3)
      }
    }
    if (p.floating) {
      for (const x of [p.x + 17, p.x + p.w - 25]) {
        ctx.fillStyle = '#ae78ed'; ctx.fillRect(x, p.y + p.h - 3, 8, 3)
        glow(ctx, x + 4, p.y + p.h, 15, '#8a47e343')
      }
    } else {
      const shade = ctx.createLinearGradient(0, p.y + 40, 0, 540)
      shade.addColorStop(0, 'transparent'); shade.addColorStop(1, '#090c1b')
      ctx.fillStyle = shade; ctx.fillRect(p.x, p.y + 40, p.w, 90)
    }
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

function drawRobot(ctx: CanvasRenderingContext2D, p: PlayerVisual, time: number, reducedMotion: boolean) {
  if ((p.dash ?? 0) > 0) {
    line(ctx, [p.x + 17 - p.facing * 65, p.y + 20, p.x + 17, p.y + 20], '#83ffe899', 9)
    line(ctx, [p.x + 17 - p.facing * 45, p.y + 35, p.x + 17, p.y + 35], '#c9a0ff88', 4)
  }
  const moving = Math.abs(p.vx) > 20
  const bob = reducedMotion ? 0 : Math.sin(time * (moving ? 19 : 3.2)) * (moving ? 1.1 : 1.4)
  ctx.save()
  ctx.translate(p.x + p.w / 2, p.y + p.h)
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
  if (blink) line(ctx, [-8, -30, 9, -30], '#ece9ff', 2)
  else text(ctx, 'aO', -12 + p.facing * 0.6, -25, '#faf5ff', 20)
  ctx.strokeStyle = '#bb6aff'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(-5, -21); ctx.quadraticCurveTo(0, -17, 6, -21); ctx.stroke()
  ctx.restore()
}

function drawBug(ctx: CanvasRenderingContext2D, bug: Bug, time: number) {
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
  box(ctx, -10 + look, -3 + bob, 6, 5, 1, '#fff5da')
  box(ctx, 5 + look, -3 + bob, 6, 5, 1, '#fff5da')
  line(ctx, [-5, 6 + bob, 5, 6 + bob], '#531c39', 2)
  ctx.restore()
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
  if (state.level === 2 && state.boss.health > 0) {
    const b = BOSS_BODY, open = state.boss.clock >= 2 && !state.boss.hit
    const color = open ? '#85ffcc' : '#f395a0'
    glow(ctx, b.x + 45, b.y + 45, 110, open ? '#59e6ac33' : '#eb416d33')
    box(ctx, b.x, b.y, b.w, b.h, 9, '#322c47')
    box(ctx, b.x + 7, b.y, b.w - 14, 13, 4, color)
    for (let i = 0; i < 3; i++) box(ctx, b.x + 14 + i * 23, b.y + 36, 16, 32, 3, i < state.boss.health ? color : '#514456')
    ctx.textAlign = 'center'
    text(ctx, 'LEGACY MONOLITH', b.x + 45, b.y - 46, '#f1c9e1', 13)
    text(ctx, open ? c.bossOpen : state.boss.clock < 1.3 ? c.bossWarning : c.bossLocked, b.x + 20, b.y - 25, color, 10)
    ctx.textAlign = 'left'
    for (const wave of state.boss.waves) {
      glow(ctx, wave.x + 17, wave.y + 12, 40, '#ff9c6244')
      box(ctx, wave.x, wave.y, wave.w, wave.h, 8, '#ffa46b')
    }
  }
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
  drawRobot(ctx, state.player, t, state.reducedMotion)
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
  drawPowerOverlay(ctx, state.powers, state.time, state.copy, state.reducedMotion)
}

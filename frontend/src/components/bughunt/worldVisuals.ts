import { box, line, text, glow } from './drawing'
import { ARENA_X, GRAVITY_SAFE_X, LEVELS, type Bug, type Platform } from './level'
import type { VisualState } from './visuals'

function window95(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string) {
  box(ctx, x, y, w, h, 1, '#aaa9b1')
  line(ctx, [x, y + h, x, y, x + w, y], '#f1eff8', 2)
  line(ctx, [x + w, y, x + w, y + h, x, y + h], '#494754', 3)
  box(ctx, x + 3, y + 3, w - 6, 17, 0, '#282968')
  text(ctx, title, x + 9, y + 15, '#eeedf8', 9)
  box(ctx, x + w - 16, y + 5, 11, 11, 0, '#bdbbc8'); text(ctx, 'x', x + w - 14, y + 14, '#282639', 9)
}

export function drawWorld(ctx: CanvasRenderingContext2D, camera: number, t: number, stage: number) {
  // The Legacy Dimension rots as a0 walks into it: the Monolith is already here.
  const corruption = stage === 2 ? Math.min(1, camera / 2200) : 0
  const colors = [['#20182b', '#514039'], ['#071923', '#0b3441'], ['#17162f', '#203632']][stage]
  const gradient = ctx.createLinearGradient(0, 0, 0, 540)
  gradient.addColorStop(0, corruption ? `rgb(${23 + corruption * 58}, ${22 - corruption * 14}, ${47 + corruption * 26})` : colors[0])
  gradient.addColorStop(1, corruption ? `rgb(${32 + corruption * 46}, ${54 - corruption * 34}, ${50 - corruption * 6})` : colors[1])
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 960, 540)
  ctx.save(); ctx.translate(-camera * 0.22, 0)
  if (stage === 0) {
    // A huge desk: IDE screens, books, coffee, keyboard and loosely draped USB.
    for (let i = 0; i < 5; i++) {
      const x = i * 620 + 75
      box(ctx, x, 110, 330, 213, 12, '#111721'); box(ctx, x + 12, 122, 306, 184, 4, '#182a35')
      box(ctx, x + 12, 122, 306, 19, 3, '#32444e'); text(ctx, 'a0.ts — Friday deploy', x + 25, 135, '#acbfbe', 10)
      for (let j = 0; j < 9; j++) {
        text(ctx, String(j + 1).padStart(2, '0'), x + 24, 160 + j * 15, '#567274', 9)
        line(ctx, [x + 55 + j % 3 * 11, 157 + j * 15, x + 120 + j % 4 * 35, 157 + j * 15], j % 3 ? '#698e9b' : '#b58eaf', 3)
      }
      box(ctx, x + 145, 323, 40, 56, 2, '#252c35'); box(ctx, x + 102, 375, 126, 10, 3, '#171d28')
      for (let j = 0; j < 4; j++) box(ctx, x + 370 - j * 6, 350 - j * 27, 110, 25, 2, ['#746880', '#78614d', '#456a72', '#746249'][j])
      box(ctx, x - 54, 322, 57, 63, 8, '#b49778'); line(ctx, [x + 3, 335, x + 21, 335, x + 21, 365, x + 3, 365], '#b49778', 7)
      text(ctx, '☕', x - 43, 360, '#514339', 20)
      ctx.strokeStyle = '#3b343b'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x, 405); ctx.bezierCurveTo(x + 100, 340, x + 170, 440, x + 295, 409); ctx.stroke()
      for (let key = 0; key < 11; key++) { box(ctx, x + key * 27, 393, 23, 17, 3, '#6a5a60'); text(ctx, 'QWERTYASDFG'[key], x + key * 27 + 8, 405, '#bdb0af', 8) }
    }
    box(ctx, 0, 423, 2200, 117, 0, '#47333a')
    for (let j = 0; j < 8; j++) line(ctx, [0, 440 + j * 13, 2200, 446 + j * 13], '#64454b', 1)
  } else if (stage === 1) {
    for (let i = 0; i < 13; i++) {
      const x = i * 145 - 15
      box(ctx, x, 98, 115, 395, 5, '#101e29'); line(ctx, [x + 4, 493, x + 4, 100, x + 110, 100], '#346070', 2)
      for (let j = 0; j < 9; j++) {
        box(ctx, x + 10, 120 + j * 38, 95, 31, 2, '#213644')
        for (let k = 0; k < 5; k++) { ctx.fillStyle = (k + j + i) % 4 ? '#55bcac' : '#d89659'; ctx.fillRect(x + 18 + k * 7, 129 + j * 38, 3, 3) }
        for (let k = 0; k < 3; k++) line(ctx, [x + 63, 128 + j * 38 + k * 5, x + 97, 128 + j * 38 + k * 5], '#101e29', 2)
      }
      line(ctx, [x + 32, 0, x + 32, 65, x + 100, 80, x + 100, 120], '#2a7d92', 4)
    }
    for (let i = 0; i < 5; i++) {
      ctx.save(); ctx.translate(140 + i * 340, 230); ctx.rotate(t * 1.5)
      for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); box(ctx, -6, 10, 18, 43, 8, '#39586366') }
      ctx.restore()
    }
  } else {
    for (let i = 0; i < 9; i++) {
      // Each window tears sideways as the corruption takes the frame apart.
      const tear = corruption > 0.3 ? Math.sin(t * 7 + i * 2) * (corruption - 0.3) * 26 : 0
      const x = i * 235 - 10 + tear, y = 120 + i % 3 * 49
      window95(ctx, x, y, 207, 175, ['Java 6 Runtime', 'Enterprise Console', 'XML Document'][i % 3])
      box(ctx, x + 9, y + 28, 188, 118, 0, corruption > 0.55 ? '#2a1030' : '#122c24')
      for (let row = 0; row < 7; row++) {
        const glitched = corruption > 0.5 && (row + i + Math.floor(t * 3)) % 5 === 0
        const slip = corruption > 0.4 ? ((row * 37 + i * 13 + Math.floor(t * 6)) % 11 - 5) * corruption : 0
        text(ctx, glitched ? '▓▒░ NullPointerException ░▒▓' : ['<legacy>', '  <session id="a0">', '  javax.ejb.Error', '  RETRY = FOREVER', '  </session>', '  <soap:Envelope>', '</legacy>'][(row + i) % 7],
          x + 15 + slip, y + 43 + row * 14, glitched ? '#e58bb6' : '#75b68b', 9)
      }
      box(ctx, x + 66, y + 153, 70, 16, 0, '#c8c5cc'); text(ctx, 'OK / CANCEL', x + 72, y + 165, '#413a52', 8)
    }
    for (let i = 0; i < 18; i++) {
      const y = 100 + i * 21
      ctx.fillStyle = `rgba(152, 91, 176, ${corruption * 0.28})`
      ctx.fillRect((i * 173 + Math.floor(t * 2 + corruption * 9) * 7) % 1600, y, 140 + corruption * 110, 3 + corruption * 4)
    }
    // Columns of dead memory falling behind the level, once the rot is past half.
    for (let i = 0; i < 14 && corruption > 0.45; i++) {
      const x = (i * 131 + 40) % 1600
      ctx.fillStyle = `rgba(214, 120, 176, ${(corruption - 0.45) * 0.4})`
      ctx.fillRect(x, (t * (60 + i * 17) + i * 90) % 620 - 80, 2, 74)
    }
  }
  ctx.restore()
  const haze = ctx.createLinearGradient(0, 250, 0, 540); haze.addColorStop(0, 'transparent'); haze.addColorStop(1, '#050b1bab')
  ctx.fillStyle = haze; ctx.fillRect(0, 0, 960, 540)
}

export function drawWorldPlatform(ctx: CanvasRenderingContext2D, p: Platform, t: number): boolean {
  if (!p.skin) return false
  const h = p.floating || p.ceiling ? p.h : 42
  const accent = p.unstable ? '#ffc08c' : '#a0efd6'
  ctx.save()
  if (p.crumble) ctx.translate(Math.sin(t * 38) * 1.5, 0)
  if (p.skin === 'key') {
    box(ctx, p.x, p.y, p.w, h, 5, '#393545'); box(ctx, p.x + 4, p.y + 2, p.w - 8, h - 7, 4, '#857c8d')
    text(ctx, p.unstable ? 'CTRL !' : 'ENTER ↵', p.x + 12, p.y + 16, '#f6edf8', 10)
  } else if (p.skin === 'book') {
    for (let i = 0; i < 3; i++) { box(ctx, p.x + i * 2, p.y + i * h / 3, p.w - i * 2, h / 3, 2, ['#637ca2', '#886777', '#887550'][i]); line(ctx, [p.x + 10, p.y + i * h / 3 + 5, p.x + p.w - 8, p.y + i * h / 3 + 5], '#d3c2aa', 2) }
  } else if (p.skin === 'phone') {
    box(ctx, p.x, p.y, p.w, h, 7, '#92939f'); box(ctx, p.x + 8, p.y + 3, p.w - 21, h - 6, 4, '#244458'); text(ctx, '17:59', p.x + 20, p.y + 16, '#acdedb', 10)
  } else if (p.skin === 'usb') {
    // Slack hanging from the fixed anchor, so the swing is legible from the cable itself.
    const anchorX = (p.originX ?? p.x) + p.w / 2, anchorY = (p.originY ?? p.y) - 88
    ctx.strokeStyle = '#4c3f59'; ctx.lineWidth = 6
    ctx.beginPath(); ctx.moveTo(anchorX, anchorY)
    ctx.quadraticCurveTo((anchorX + p.x + p.w / 2) / 2, anchorY + 62, p.x + p.w / 2, p.y + 4); ctx.stroke()
    line(ctx, [p.x, p.y + 9, p.x + p.w, p.y + 9], '#6d577d', 14); box(ctx, p.x, p.y, 28, h, 3, '#b8b5c2'); box(ctx, p.x + p.w - 28, p.y, 28, h, 3, '#b8b5c2')
  } else if (p.skin === 'ide' || p.skin === 'popup' || p.skin === 'window') {
    window95(ctx, p.x, p.y, p.w, h, p.skin === 'ide' ? 'a0.ts' : p.unstable ? 'DEPRECATED' : 'Runtime')
  } else if (p.skin === 'floppy') {
    box(ctx, p.x, p.y, p.w, h, 2, '#303d6d'); box(ctx, p.x + 9, p.y + 2, p.w * 0.5, h - 4, 0, '#aaa9bb'); box(ctx, p.x + 15, p.y + 4, p.w * 0.16, h - 8, 0, '#333b55')
  } else if (p.skin === 'button' || p.skin === 'toolbar' || p.skin === 'progress') {
    box(ctx, p.x, p.y, p.w, h, 1, '#9998a8'); line(ctx, [p.x, p.y + h, p.x, p.y, p.x + p.w, p.y], '#ece9f1', 2)
    if (p.skin === 'progress') for (let x = p.x + 5; x < p.x + p.w - 5; x += 13) box(ctx, x, p.y + 5, 9, h - 10, 0, '#4347a7')
    else text(ctx, p.skin === 'button' ? 'OK     CANCEL' : 'FILE   EDIT   VIEW', p.x + 10, p.y + 16, '#28283c', 10)
  } else {
    const tint = p.skin === 'xml' ? '#527c5a' : p.skin === 'pod' ? '#4c4d87' : '#264e65'
    box(ctx, p.x, p.y, p.w, h, 4, tint)
    text(ctx, p.skin === 'xml' ? '<XML />' : p.skin === 'pod' ? (p.crumble ? 'POD EVICTED' : 'K8S / POD') : p.skin === 'packet' ? '1010 →' : 'RACK / LIFT', p.x + 12, p.y + 16, '#d1eee8', 10)
    for (let x = p.x + 12; x < p.x + p.w - 5; x += 25) box(ctx, x, p.y + h - 8, 13, 3, 1, '#6d99a7')
  }
  line(ctx, [p.x + 2, p.y, p.x + p.w - 2, p.y], accent, 2)
  if (!p.floating && !p.ceiling) for (let x = p.x + 16; x < p.x + p.w; x += 120) {
    box(ctx, x, p.y + h, 13, p.h - h, 1, '#272435'); line(ctx, [x, p.y + h + 3, x + 80, p.y + p.h], '#484255', 3)
  }
  ctx.restore(); return true
}

export function drawSpecialBug(ctx: CanvasRenderingContext2D, b: Bug, t: number): boolean {
  if (!b.kind || ['patrol', 'chaser', 'turret'].includes(b.kind)) return false
  const x = b.x + b.w / 2, y = b.y + b.h / 2, warn = (b.alert ?? 0) > 0.6
  ctx.save(); ctx.translate(x, y)
  if (b.kind === 'flyer') {
    const wing = Math.sin(t * 23 + b.phase) * 13
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#9ce4ffbb'; ctx.beginPath(); ctx.moveTo(side * 8, -3); ctx.lineTo(side * 37, -20 + wing); ctx.lineTo(side * 29, 7); ctx.closePath(); ctx.fill()
      line(ctx, [side * 8, -3, side * 29, -5], '#daeaff', 1)
    }
    box(ctx, -16, -13, 32, 27, 10, '#417bb4'); box(ctx, -11, -8, 22, 12, 4, warn ? '#ffb47b' : '#c9faff')
    line(ctx, [-8, 14, 0, 20, 8, 14], '#90e3ff', 2)
  } else if (b.kind === 'timeout') {
    ctx.strokeStyle = '#f5ca89'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke()
    line(ctx, [0, -11, 0, 0, 9 * Math.sin(t), 9 * Math.cos(t)], '#fff1cf', 2)
    for (const side of [-1, 1]) { line(ctx, [side * 18, 0, side * 31, -8, side * 36, 3], '#e3a361', 3) }
  } else if (b.kind === 'leak') {
    ctx.fillStyle = '#70c989'; ctx.beginPath(); ctx.ellipse(0, 1, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill()
    for (let i = 0; i < 4; i++) box(ctx, -b.w / 2 + 4 + i * b.w / 4, b.h / 2 - 5, 8, 8, 4, '#4b9c78')
    text(ctx, 'MEM', -12, 6, '#143e34', 11)
  } else if (b.kind === 'race') {
    for (const side of [-1, 1]) { box(ctx, side * 10 - 8, -14, 16, 27, 4, side > 0 ? '#64d9e7' : '#db7cda'); text(ctx, side > 0 ? 'B' : 'A', side * 10 - 4, 5, '#17233c', 11) }
    line(ctx, [-25, 17, 22, 17], '#cddcff', 2)
  } else if (b.kind === 'deadlock') {
    ctx.strokeStyle = '#e0b27c'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, -10, 12, Math.PI, 0); ctx.stroke()
    box(ctx, -19, -7, 38, 26, 4, '#926ca5'); box(ctx, -3, 0, 6, 12, 2, '#f4d0a4')
    for (const side of [-1, 1]) line(ctx, [side * 19, 8, side * 27, 16, side * 22, 20], '#c89ad4', 3)
  } else if (b.kind === 'clone') {
    box(ctx, -17, -24, 34, 31, 8, '#596c9c'); box(ctx, -13, -20, 26, 23, 5, '#152037'); text(ctx, 'a0', -12, -3, '#9ff4e8', 18)
    line(ctx, [-13, 10, 0, 24, 13, 10], '#7ec1bc', 7)
  } else if (b.kind === 'null') {
    glow(ctx, 0, 0, 65, '#fa937a33'); box(ctx, -28, -29, 56, 58, 9, '#775182')
    box(ctx, -23, -23, 46, 24, 5, '#231d32'); text(ctx, 'NULL', -19, -7, '#f8c185', 15)
    for (const side of [-1, 1]) line(ctx, [side * 27, -5, side * 38, 5, side * 35, 25], '#cc93a9', 7)
    text(ctx, '∅', -10, 21, '#ffcf9d', 21)
  } else {
    box(ctx, -16, -17, 32, 33, 3, '#7f9689'); text(ctx, 'Z', -7, 5, '#172d2b', 16)
    line(ctx, [-16, 0, -26, -7, -30, -1], '#adc3a0', 5); line(ctx, [16, 0, 26, -7, 30, -1], '#adc3a0', 5)
  }
  if (warn) text(ctx, '!', -4, -32, '#ffd6a0', 20)
  ctx.restore()
  const label = { flyer: 'BUG / WING', timeout: 'TIMEOUT', leak: 'MEMORY LEAK', race: 'RACE CONDITION', deadlock: 'DEADLOCK', clone: 'fork(a0)', null: 'NullPointer', zombie: 'ZOMBIE' }[b.kind as 'flyer' | 'timeout' | 'leak' | 'race' | 'deadlock' | 'clone' | 'null' | 'zombie']
  ctx.textAlign = 'center'; text(ctx, label ?? '', x, b.y - 12, '#e1d5ec', 8); ctx.textAlign = 'left'
  if ((b.hp ?? 1) > 1) for (let i = 0; i < b.hp!; i++) box(ctx, b.x + i * 10, b.y - 6, 7, 3, 1, '#ffc18a')
  return true
}

export function drawEnvironment(ctx: CanvasRenderingContext2D, state: VisualState, t: number) {
  for (const fan of LEVELS[state.level].fans ?? []) {
    box(ctx, fan.x, 449, fan.w, 11, 2, '#39546b')
    for (let i = 0; i < 5; i++) {
      const x = fan.x + 10 + i * 19, y = 445 - (t * 110 + i * 47) % fan.h
      line(ctx, [x, y + 23, x, y, x - 4, y + 6], '#9af4ec88', 2)
    }
    text(ctx, 'FAN ↑', fan.x + 22, fan.y, '#a0ded6', 12)
  }
  for (const zone of LEVELS[state.level].lessons ?? []) {
    text(ctx, state.copy.bossCmd[zone.command], zone.x, 205, '#dbb6ff', 12)
    if (zone.command === 'gravity') { text(ctx, '↑  5s  ↓', zone.x + 40, 229, '#9fe9dc', 14); line(ctx, [zone.x, 250, zone.x, 460], '#a78ad055', 2) }
  }
  if (state.level === 2 && state.camera > ARENA_X - 960) {
    ctx.fillStyle = '#69e2bc12'; ctx.fillRect(GRAVITY_SAFE_X, 130, 540, 330)
    line(ctx, [GRAVITY_SAFE_X, 130, GRAVITY_SAFE_X, 460], '#84ebbe88', 2)
    text(ctx, state.copy.gravitySafe, GRAVITY_SAFE_X + 10, 150, '#a5f7d0', 11)
    if (state.boss.remaining > 0) text(ctx, `${Math.ceil(state.boss.remaining)}s`, ARENA_X + 30, 165, '#e5c0ff', 18)
  }
}

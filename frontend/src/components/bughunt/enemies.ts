import type { Bug } from './level'
import type { PlayerVisual, Shot } from './visuals'

/** Telegraphs use fuse/dive; a dive commits to its target, so dodging is possible. */
export function stepSpecialBug(b: Bug, p: PlayerVisual, dt: number, time: number, shots: Shot[]): boolean {
  const dx = p.x + p.w / 2 - b.x - b.w / 2
  const close = Math.abs(dx) < 400
  if (b.ghost) {
    b.homeX ??= b.x; b.homeY ??= b.y
    const cycle=(time+b.phase)%4
    b.hidden=cycle<1.05 || cycle>3.25
    b.alert=cycle>.7 && cycle<1.05 ? 1 : 0
    b.x=b.homeX+Math.sin(time*1.4+b.phase)*48
    b.y=b.homeY+Math.sin(time*2+b.phase)*18
    b.direction=Math.sign(dx)||1
    return true
  }
  if (b.kind === 'flyer' || b.kind === 'timeout') {
    b.homeX ??= b.x; b.homeY ??= b.y
    b.fuse = Math.max(0, (b.fuse ?? 1.5) - (close ? dt : 0))
    if (b.kind === 'timeout') {
      b.y = b.homeY + Math.sin(time * 2.2 + b.phase) * 30
      b.x = b.homeX + Math.sin(time * 0.8 + b.phase) * 80
      b.alert = close && b.fuse < 0.8 ? 1 : 0
      if (close && b.fuse === 0) {
        b.fuse = 2.8
        const dy = p.y + 20 - b.y - 17, distance = Math.hypot(dx, dy) || 1
        shots.push({ x: b.x + 19, y: b.y + 17, vx: dx / distance * 225, vy: dy / distance * 225, life: 3, enemy: true })
      }
      return true
    }
    if ((b.dive ?? 0) > 0) {
      b.dive = Math.max(0, b.dive! - dt)
      const tx = b.targetX ?? b.x, ty = b.targetY ?? b.y
      const distance = Math.hypot(tx - b.x, ty - b.y) || 1
      const step = Math.min(distance, dt * 330)
      b.x += (tx - b.x) / distance * step; b.y += (ty - b.y) / distance * step
      if (distance < 10) b.dive = 0
      if (!b.dive) { b.fuse = 2.4; b.alert = 0 }
    } else if (b.fuse === 0 && close) {
      b.targetX = Math.max(b.homeX - 250, Math.min(b.homeX + 250, p.x))
      b.targetY = Math.max(155, Math.min(409, p.y))
      b.dive = 0.9
    } else {
      b.alert = close && b.fuse < 0.75 ? 1 : 0
      const targetY = b.homeY + Math.sin(time * 3 + b.phase) * 16
      b.x += (b.homeX + Math.sin(time * 1.2 + b.phase) * 65 - b.x) * Math.min(1, dt * 3)
      b.y += (targetY - b.y) * Math.min(1, dt * 4)
    }
    b.direction = Math.sign(dx) || 1
    return true
  }
  if (b.kind === 'leak') {
    const feet = b.y + b.h
    b.w = Math.min(66, b.w + dt * 1.5); b.h = Math.min(62, b.h + dt * 1.5); b.y = feet - b.h
    b.x += b.direction * dt * 50
    return true
  }
  if (b.kind === 'race') {
    const cycle = (time + b.phase) % 2.8
    b.alert = cycle > 1.6 && cycle < 2.1 ? 1 : 0
    if (cycle >= 2.1) b.x += b.direction * dt * 285
    else if (cycle < 1.6) b.direction = Math.sign(dx) || 1
    return true
  }
  if (b.kind === 'deadlock' || b.kind === 'null') {
    b.fuse = (b.fuse ?? 0) + (close ? dt : 0)
    b.alert = b.fuse > 1.8 ? 1 : 0
    if (b.fuse > 2.6) {
      b.fuse = 0
      for (const dir of [-1, 1]) shots.push({ x: b.x + b.w / 2 + dir * 26, y: b.y + b.h - 15, vx: dir * 230, life: 2, enemy: true })
    }
    if (b.kind === 'null') b.x += Math.sign(dx) * dt * 75
    return true
  }
  if (b.kind === 'zombie') { b.x += b.direction * dt * 48; return true }
  if (b.kind === 'clone') { b.alert = 1; b.x += Math.sign(dx) * dt * 165; return true }
  return false
}

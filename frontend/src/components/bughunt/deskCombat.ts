import type { Bug, Rect } from './level'
import type { PlayerVisual, Shot } from './visuals'

export type DeskFoe = 'retry' | 'soap' | 'legacy'
export type EncounterPhase = 'waiting' | 'entrance' | 'approach' | 'tell' | 'attack' | 'recover' | 'cleared'
export const DESK_ARENAS = {
  retry: { left: 1540, right: 2340, spawn: 1830, floor: 460, hp: 2, name: 'Race Condition Twins' },
  soap: { left: 3330, right: 4160, spawn: 3610, floor: 460, hp: 3, name: 'Null Pointer Ghost' },
  legacy: { left: 5020, right: 5960, spawn: 5670, floor: 460, hp: 8, name: 'Merge Conflict Brute' },
} as const
export type DeskCombat = {
  phase: EncounterPhase; clock: number; duration: number; cycles: number; move: 0 | 1
  targetX: number; targetY: number; startX: number; startY: number; direction: number
  gate: number; locked: boolean; enraged: boolean; elapsed: number; hitCooldown: number
}
export function createDeskCombat(): DeskCombat {
  return { phase: 'waiting', clock: 0, duration: 1.4, cycles: 0, move: 0, targetX: 0, targetY: 0,
    startX: 0, startY: 0, direction: -1, gate: 0, locked: false, enraged: false, elapsed: 0, hitCooldown: 0 }
}
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }
function transition(c: DeskCombat, phase: EncounterPhase, duration: number) { c.phase = phase; c.clock = 0; c.duration = duration }
export function arenaDamageable(b: Bug, stomp = false) {
  if (!b.encounter) return true
  const c = b.combat
  return !!c && c.hitCooldown <= 0 && (b.encounter === 'legacy' && !stomp ? c.phase === 'recover' : !['waiting', 'entrance', 'cleared'].includes(c.phase))
}

/** Actual impact area, shared by damage and the contact effect. */
export function arenaImpact(b: Bug): Rect | null {
  const c = b.combat
  if (!c || !b.encounter) return null
  if (b.encounter === 'retry' && c.move === 0) return { x: c.targetX - 36, y: 435, w: b.w + 72, h: 25 }
  if (b.encounter === 'soap' && c.move === 1) return { x: c.targetX - 45, y: 332, w: 90, h: 128 }
  if (b.encounter === 'legacy' && c.move === 0) return { x: c.targetX - 45, y: 420, w: b.w + 90, h: 40 }
  return null
}
export function arenaBodyDangerous(b: Bug) {
  return b.combat?.phase === 'attack' && b.encounter !== 'soap'
}

/** No random attacks or tracking after tell. dt=0 freezes every encounter timer. */
export function stepDeskCombat(b: Bug, p: PlayerVisual, dt: number, shots: Shot[]): 'entrance' | 'tell' | 'attack' | 'recover' | undefined {
  const kind = b.encounter
  if (!kind) return
  const a = DESK_ARENAS[kind], c = b.combat ??= createDeskCombat()
  if (!b.alive) { c.phase = 'cleared'; c.locked = false; c.gate = Math.max(0, c.gate - dt * 2.5); return }
  if (dt <= 0) return
  c.hitCooldown = Math.max(0, c.hitCooldown - dt)
  const inside = p.x >= a.left + 18 && p.x + p.w <= a.right - 18 && p.y + p.h <= a.floor + 4
  if (c.phase === 'waiting') {
    if (!inside) return
    transition(c, 'entrance', kind === 'legacy' ? 1.1 : .3); c.startY = b.y
    return 'entrance'
  }
  c.clock += dt
  if (c.phase === 'entrance') {
    // Retreat is allowed while the gate is only an outline; no late teleport.
    if (!inside) { transition(c, 'waiting', 1.4); c.gate = 0; return }
    c.gate = kind === 'legacy' ? Math.min(1, c.clock / c.duration) : 0
    if (c.clock >= c.duration) { c.locked = kind === 'legacy'; transition(c, 'approach', kind === 'legacy' ? .65 : .4) }
    return
  }
  c.elapsed += dt
  c.enraged = (b.hp ?? a.hp) / a.hp <= .4 || c.cycles >= 3
  const feet = a.floor - b.h
  if (c.phase === 'approach') {
    const dx = p.x + p.w / 2 - b.x - b.w / 2
    b.direction = Math.sign(dx) || b.direction
    const desired = kind === 'soap' ? p.x - b.direction * 170 : p.x - b.direction * 125
    const speed = kind === 'legacy' ? 120 : 90
    b.x += clamp(desired - b.x, -speed * dt, speed * dt)
    b.x = clamp(b.x, a.left + 35, a.right - b.w - 35)
    b.y += ((kind === 'soap' ? 285 : feet) - b.y) * Math.min(1, dt * 5)
    if (c.clock >= c.duration) {
      c.move = c.cycles % 2 as 0 | 1
      c.startX = b.x; c.startY = b.y; c.direction = Math.sign(dx) || -1
      const reach = kind === 'legacy' ? (c.move === 0 ? 400 : 500) : kind === 'retry' ? 210 : 400
      c.targetX = clamp(kind === 'legacy' && c.move === 1 ? b.x + c.direction * reach : p.x, Math.max(a.left + 35, b.x - reach), Math.min(a.right - b.w - 35, b.x + reach))
      c.targetY = p.y + p.h / 2
      transition(c, 'tell', kind === 'legacy' ? 1.05 : .9)
      return 'tell'
    }
  } else if (c.phase === 'tell') {
    if (c.clock >= c.duration) {
      transition(c, 'attack', kind === 'legacy' ? (c.move === 0 ? 1.2 : 1.1) : kind === 'soap' ? (c.move === 0 ? 1.5 : .4) : c.move === 0 ? .8 : .65)
      if (kind === 'soap' && c.move === 0) {
        const angle = Math.atan2(c.targetY - b.y - b.h / 2, c.targetX - b.x - b.w / 2)
        for (const offset of (c.enraged ? [-.28, 0, .28] : [-.18, 0, .18])) shots.push({
          x: b.x + b.w / 2, y: b.y + b.h / 2, vx: Math.cos(angle + offset) * 190,
          vy: Math.sin(angle + offset) * 190, life: 1.4, enemy: true, encounter: kind,
        })
      }
      return 'attack'
    }
  } else if (c.phase === 'attack') {
    const u = Math.min(1, c.clock / c.duration)
    if ((kind === 'retry' || kind === 'legacy') && c.move === 0) {
      const leap = kind === 'legacy' ? Math.min(1, c.clock / .8) : u
      b.x = c.startX + (c.targetX - c.startX) * leap
      b.y = feet - Math.sin(leap * Math.PI) * (kind === 'legacy' ? 155 : c.enraged ? 125 : 100)
    } else if (kind !== 'soap' && c.move === 1) {
      // Commit to the displayed destination. Never follow a late dodge.
      b.x = c.startX + (c.targetX - c.startX) * u; b.y = feet
    }
    if (c.clock >= c.duration) {
      c.cycles++; b.y = kind === 'soap' ? 452 - b.h : feet
      transition(c, 'recover', kind === 'legacy' ? 1.8 : 1.25)
      return 'recover'
    }
  } else if (c.phase === 'recover' && c.clock >= c.duration) transition(c, 'approach', c.enraged ? .3 : .5)
}

export function arenaAttackHits(b: Bug, p: Rect): boolean {
  const c = b.combat
  if (!c || c.phase !== 'attack') return false
  const impact = arenaImpact(b)
  if (!impact) return false
  // Gremlin's landing only damages on the last part of its announced arc.
  if (b.encounter === 'retry' && c.clock < c.duration - .16) return false
  if (b.encounter === 'legacy' && c.clock < .8) return false
  return p.x < impact.x + impact.w && p.x + p.w > impact.x && p.y < impact.y + impact.h && p.y + p.h > impact.y
}

export function confineToArena(b: Bug, p: PlayerVisual) {
  if (!b.encounter || !b.alive || !b.combat?.locked) return
  const a = DESK_ARENAS[b.encounter]
  const x = clamp(p.x, a.left + 8, a.right - p.w - 8)
  if (x !== p.x) { p.x = x; p.vx = 0; p.grapple = null }
}

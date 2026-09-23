import { describe, expect, it } from 'vitest'
import { LEVELS } from './level'
import { DESK_ARENAS, arenaAttackHits, arenaBodyDangerous, arenaDamageable, confineToArena, stepDeskCombat, type DeskFoe } from './deskCombat'
import type { PlayerVisual, Shot } from './visuals'

function fixture(kind: DeskFoe) {
  const b = { ...LEVELS[0].bugs.find(b => b.encounter === kind)! }
  const a = DESK_ARENAS[kind]
  const p: PlayerVisual = { x: a.left + 45, y: 412, w: 34, h: 48, vx: 0, vy: 0, grounded: true, facing: 1, invulnerable: 0, squash: 0 }
  const shots: Shot[] = []
  const tick = (n = 1) => { for (let i = 0; i < n; i++) stepDeskCombat(b, p, 1 / 60, shots) }
  const until = (phase: string) => { for (let i = 0; i < 600 && b.combat?.phase !== phase; i++) tick(); expect(b.combat?.phase).toBe(phase) }
  return { a, b, p, shots, tick, until }
}

describe('Developer Desk readable arenas', () => {
  it('lets a0 retreat during the gradual entry and locks only after it is complete', () => {
    const { a, b, p, tick, until } = fixture('retry')
    tick(31)
    expect(b.combat!.gate).toBeGreaterThan(.3)
    expect(b.combat!.gate).toBeLessThan(.5)
    expect(b.combat!.locked).toBe(false)
    p.x = a.left - 20; tick()
    expect(b.combat!.phase).toBe('waiting')
    confineToArena(b, p); expect(p.x).toBe(a.left - 20)
    p.x = a.left + 45; until('approach')
    expect(b.combat!.gate).toBe(1)
    p.x = a.left - 20; confineToArena(b, p); expect(p.x).toBe(a.left + 8)
    b.alive = false; tick(30)
    expect(b.combat!.locked).toBe(false)
    expect(b.combat!.gate).toBe(0)
  })

  for (const kind of Object.keys(DESK_ARENAS) as DeskFoe[]) {
    it(`${kind}: alternates two committed attacks with warning, safe space and recovery`, () => {
      const { a, b, p, shots, tick, until } = fixture(kind)
      for (const move of [0, 1]) {
        p.x = a.left + 45
        until('tell')
        expect(b.combat!.move).toBe(move)
        expect(b.combat!.duration).toBeGreaterThanOrEqual(.9)
        expect(arenaDamageable(b)).toBe(false)
        expect(arenaAttackHits(b, p)).toBe(false)
        expect(arenaBodyDangerous(b)).toBe(false)
        const target = b.combat!.targetX
        p.x = a.right - p.w - 20
        tick(20)
        expect(b.combat!.targetX).toBe(target)
        until('attack')
        // The announced far-side dodge remains safe for the entire committed move.
        while (b.combat!.phase === 'attack') {
          expect(arenaAttackHits(b, p)).toBe(false)
          if (arenaBodyDangerous(b)) expect(p.x >= b.x + b.w || p.x + p.w <= b.x).toBe(true)
          tick()
        }
        expect(b.combat!.phase).toBe('recover')
        expect(b.combat!.duration).toBeGreaterThanOrEqual(1.25)
        expect(arenaDamageable(b)).toBe(true)
        if (kind === 'soap') expect(b.y + b.h).toBe(452)
        until('approach')
      }
      if (kind === 'soap') {
        expect(shots).toHaveLength(3)
        expect(shots.every(s => s.encounter === 'soap' && s.life === 1.4)).toBe(true)
      }
    })

    it(`${kind}: follows a0 before tell, freezes completely and changes pace below 40% HP`, () => {
      const { a, b, p, shots, tick, until } = fixture(kind)
      until('approach'); const x = b.x
      tick(10); expect(b.x).not.toBe(x)
      until('tell')
      const before = JSON.stringify(b)
      p.x = a.right - 65
      stepDeskCombat(b, p, 0, shots)
      expect(JSON.stringify(b)).toBe(before)
      b.hp = Math.floor(a.hp * .4); tick()
      expect(b.combat!.enraged).toBe(true)
      expect(b.combat!.duration).toBeGreaterThanOrEqual(.9)
      until('recover'); until('approach')
      expect(b.combat!.duration).toBe(.3)
    })
  }
})

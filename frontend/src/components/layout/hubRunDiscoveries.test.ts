import { describe, expect, it } from 'vitest'
import { startCemeteryRun, stepCemeteryRun } from './hubRunCemetery'
import { stepArcade } from './hubRunArcade'
import { CEMETERY } from './hubRunStages'
import { placeOnSurface } from './hubRunPlacement'
import type { RunInput, RunState } from './hubRunModel'

const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }
const at = (x: number, upper = false) => {
  const s = startCemeteryRun(464, 218), floor = placeOnSurface(s, x, 3, upper)!.y
  s.knight = { ...s.knight, x, y: floor, grounded: true, attack: -1 }
  return s
}
const strike = (s: RunState) => stepArcade({ ...s, knight: { ...s.knight, attack: 0.1 } }, idle, 1 / 60)

describe('environmental discoveries', () => {
  it('requires a weapon hit to uncover the root cache and grants real equipment', () => {
    let s = at(1200, true)
    expect(stepArcade(s, idle, 1 / 60).stage!.secrets).toEqual([])
    s = strike(s)
    expect(s.stage!.secrets).toContain(0)
    expect(s.stage!.armorTier).toBe('verdant')
  })
  it('reveals the buried prisoner only after the cracked grave is broken', () => {
    let s = at(2150)
    s = strike(s)
    expect(s.stage!.secrets).toContain(1)
    expect(s.stage!.rescued).not.toContain(3)
    s.stage!.elapsed += 0.8
    s.knight.x = 2155
    s = strike(s)
    expect(s.stage!.rescued).toContain(3)
    expect(s.escapes![0].facing).toBe(-1)
    expect(s.escapes![0].exitX).toBeLessThan(s.cameraX)
  })
  it('requires breaking the crypt niche before collecting the sacred blade', () => {
    let s = at(3230)
    s = stepArcade(s, idle, 1 / 60)
    expect(s.stage!.holyWeapon).toBe(false)
    s = strike(s)
    expect(s.stage!.revealedSecrets).toContain(2)
    expect(s.stage!.holyWeapon).toBe(false)
    s = stepArcade(s, idle, 1 / 60)
    expect(s.stage!.holyWeapon).toBe(true)
  })
  it('opens the locked gate with the key and exposes a timed opening instead of deleting it', () => {
    let s = at(CEMETERY.gate - 20)
    s.stage!.key = true
    s = stepCemeteryRun(s, idle, 1 / 60)
    expect(s.stage!.gate).toBe(true)
    expect(s.stage!.gateOpenedAt).toBeDefined()
    expect(s.events.some(e => e.type === 'reward' && e.text.includes('KEY USED'))).toBe(true)
  })
  it('smashes an urn once, scattering a real coin reward', () => {
    let s = at(1460)
    s = strike(s)
    expect(s.stage!.brokenUrns).toContain(0)
    const coins = s.stats.coins
    s = strike(s)
    expect(s.stats.coins).toBe(coins)
  })
})

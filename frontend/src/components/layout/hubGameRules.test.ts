import { describe, expect, it } from 'vitest'
import {
  CHARGE_MAX, COIN_POINTS, CRITTER_POINTS, GOLDEN_FACTOR, MAX_MULTIPLIER, MAX_WOUNDS, ROUND_SECONDS, SPECIAL_FACTOR,
  clearHubTargets, clickHubGame, comboMultiplier, isDead, moveIndexForCombo, newHubGame, roundPace, specialReady, startHubRound, stepHubGame,
  type HubGameState, type HubTarget,
} from './hubGameRules'

const W = 500
const H = 80
const base = { rested: 0, attacker: false, golden: false }
const bat: HubTarget = { ...base, id: 1, kind: 'bat', x: 100, y: 40, speed: 20 }
const coin: HubTarget = { ...base, id: 2, kind: 'coin', x: 300, y: -8, speed: 46 }
const bomb: HubTarget = { ...base, id: 3, kind: 'bomb', x: 200, y: 40, speed: 20 }
const game = (targets: HubTarget[], extra: Partial<HubGameState> = {}): HubGameState => ({ ...startHubRound(), targets, wait: 99, ...extra })
const click = (state: HubGameState, x: number, y: number) => clickHubGame(state, x, y, H)

describe('hub game round', () => {
  it('does nothing until a round is started', () => {
    const idle = newHubGame()
    expect(idle.phase).toBe('idle')
    expect(stepHubGame(idle, 1, W, H)).toBe(idle)
    expect(click(idle, 10, 10).state).toBe(idle)
  })
  it('ends after 30 seconds and clears the field, keeping the score', () => {
    const over = stepHubGame(game([bat], { score: 7, timeLeft: 0.5 }), 1, W, H)
    expect(over).toMatchObject({ phase: 'over', targets: [], score: 7 })
    expect(startHubRound().timeLeft).toBe(ROUND_SECONDS)
  })
  it('spawns faster critters late in the round', () => {
    const roll = () => 0.9
    const early = stepHubGame(game([], { wait: 0 }), 0.01, W, H, roll).targets[0]
    const late = stepHubGame(game([], { wait: 0, timeLeft: 1 }), 0.01, W, H, roll).targets[0]
    expect(Math.abs(late.speed)).toBeGreaterThan(Math.abs(early.speed) * 2)
    expect(roundPace(ROUND_SECONDS)).toBe(1)
    expect(roundPace(0)).toBe(3)
  })
  it('spawns a critter off screen, so nothing pops into view', () => {
    const [spawned] = stepHubGame(game([], { wait: 0 }), 0.01, W, H, () => 0.9).targets
    expect(spawned.x < 0 || spawned.x > W).toBe(true)
  })
  it('holds bombs back for the first seconds', () => {
    const roll = () => 0.15 // Inside the bomb band.
    expect(stepHubGame(game([], { wait: 0 }), 0.01, W, H, roll).targets[0].kind).not.toBe('bomb')
    expect(stepHubGame(game([], { wait: 0, timeLeft: 20 }), 0.01, W, H, roll).targets[0].kind).toBe('bomb')
  })
  it('lands a coin on the ground, keeps it, then lets it expire', () => {
    const landed = stepHubGame(game([coin]), 2, W, H).targets[0]
    expect(landed.y).toBe(H - 8)
    const later = stepHubGame(game([landed]), 1, W, H).targets
    expect(later).toHaveLength(1)
    expect(stepHubGame(game(later), 2, W, H).targets).toEqual([])
  })
})

describe('hub game attacks', () => {
  const attacker: HubTarget = { ...bat, id: 5, attacker: true, x: 150, y: 40, speed: 40 }
  it('chases the knight wherever he moved', () => {
    const left = stepHubGame(game([attacker], { knightX: 40 }), 0.1, W, H).targets[0]
    expect(left.x).toBeLessThan(attacker.x)
    expect(left.speed).toBeLessThan(0)
    const right = stepHubGame(game([attacker], { knightX: 400 }), 0.1, W, H).targets[0]
    expect(right.x).toBeGreaterThan(attacker.x)
    expect(right.speed).toBeGreaterThan(0)
  })
  it('costs a heart and ends the chain when it reaches him', () => {
    const next = stepHubGame(game([{ ...attacker, x: 40, y: H - 22 }], { knightX: 40, combo: 6, charge: 9 }), 0.01, W, H)
    expect(next).toMatchObject({ wounds: 1, combo: 0, charge: 0, targets: [] })
  })
  it('kills him on the last heart', () => {
    const next = stepHubGame(game([{ ...attacker, x: 40, y: H - 22 }], { knightX: 40, wounds: MAX_WOUNDS - 1 }), 0.01, W, H)
    expect(next.phase).toBe('over')
    expect(isDead(next)).toBe(true)
  })
  it('never lets an attacker fly away unpunished', () => {
    const far = stepHubGame(game([{ ...attacker, x: W + 39, speed: 40 }], { knightX: 40 }), 1, W, H)
    expect(far.targets).toHaveLength(1)
  })
  it('can be struck down before it arrives', () => {
    expect(click(game([attacker]), 150, 40).hit?.id).toBe(attacker.id)
  })
})

describe('hub game clicks', () => {
  it('multiplies the points by the chain', () => {
    const first = click(game([bat]), 100, 40).state
    expect(first).toMatchObject({ combo: 1, score: CRITTER_POINTS, targets: [] })
    const second = click({ ...first, targets: [{ ...bat, id: 9 }] }, 100, 40)
    expect(second.points).toBe(2 * CRITTER_POINTS)
    expect(second.state).toMatchObject({ combo: 2, score: 3 * CRITTER_POINTS })
  })
  it('caps the multiplier', () => {
    expect(comboMultiplier(0)).toBe(1)
    expect(comboMultiplier(MAX_MULTIPLIER + 20)).toBe(MAX_MULTIPLIER)
  })
  it('pays more for a coin and for a golden critter', () => {
    expect(click(game([{ ...coin, y: 70 }], { combo: 1 }), 300, 70).state.score).toBe(COIN_POINTS * 2)
    expect(click(game([{ ...bat, golden: true }]), 100, 40).points).toBe(CRITTER_POINTS * GOLDEN_FACTOR)
  })
  it('ends the chain on a miss, keeping the score and the charge', () => {
    const { state, hit } = click(game([bat], { combo: 5, score: 40, charge: 5 }), 400, 10)
    expect(hit).toBeUndefined()
    expect(state).toMatchObject({ combo: 0, charge: 5, score: 40 })
    expect(state.targets).toHaveLength(1)
  })
  it('survives two bombs and dies on the third, keeping the score', () => {
    const second = click(game([bomb], { wounds: 1, score: 40, combo: 5, charge: CHARGE_MAX }), 200, 40).state
    expect(second).toMatchObject({ wounds: 2, phase: 'playing', combo: 0, charge: 0 })
    const third = click({ ...second, targets: [bomb, bat] }, 200, 40).state
    expect(third).toMatchObject({ wounds: MAX_WOUNDS, phase: 'over', score: 40, targets: [] })
    expect(isDead(third)).toBe(true)
  })
  it('does not count a bomb that flies away', () => {
    expect(stepHubGame(game([{ ...bomb, x: W + 39 }]), 1, W, H)).toMatchObject({ wounds: 0, targets: [] })
  })
  it('gives overlapping targets to the nearest', () => {
    expect(click(game([bat, { ...bat, id: 7, x: 120 }]), 118, 40).hit?.id).toBe(7)
  })
  it('climbs through the moves with the chain, then cycles', () => {
    expect([1, 2, 3, 4].map((combo) => moveIndexForCombo(combo, 3))).toEqual([0, 1, 2, 0])
    expect(moveIndexForCombo(0, 3)).toBe(0)
  })
})

describe('hub game special', () => {
  it('charges with every hit, up to the limit', () => {
    const near = click(game([bat], { charge: CHARGE_MAX - 1 }), 100, 40).state
    expect(specialReady(near)).toBe(true)
    expect(click({ ...near, targets: [{ ...bat, id: 8 }] }, 100, 40).state.charge).toBe(CHARGE_MAX)
  })
  it('fires from a click on the knight only when charged', () => {
    const ready = game([bat], { charge: CHARGE_MAX, knightX: 40 })
    const fired = click(ready, 40, H - 22)
    expect(fired.special).toBe(true)
    expect(fired.state.charge).toBe(0)
    expect(click({ ...ready, charge: 3 }, 40, H - 22).special).toBeUndefined()
  })
  it('clears the strip for double points, bombs without harm', () => {
    const { state, cleared, points } = clearHubTargets(game([bat, bomb, { ...coin, id: 4 }], { combo: 2, score: 10 }))
    expect(cleared).toHaveLength(3)
    expect(points).toBe((CRITTER_POINTS + COIN_POINTS) * 2 * SPECIAL_FACTOR)
    expect(state).toMatchObject({ targets: [], score: 10 + points, wounds: 0, combo: 2 })
  })
})

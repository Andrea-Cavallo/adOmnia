import { describe, expect, it } from 'vitest'
import {
  CHARGE_MAX, COIN_POINTS, COMBO_STEP, CRITTER_POINTS, FRENZY_FACTOR, FRENZY_SECONDS, GOLDEN_FACTOR, GOLDEN_SECONDS, KNIGHT_EDGE, MAX_BONUS_SECONDS,
  MAX_MULTIPLIER, MAX_WOUNDS, ROUND_SECONDS, SPECIAL_FACTOR, WARN_SECONDS,
  accuracy, clearHubTargets, clickHubGame, comboMultiplier, isDead, isFrenzy, medalFor, moveIndexForCombo, newHubGame, roundPace, specialReady,
  startHubRound, stepHubGame, strikePosition,
  type HubGameState, type HubTarget,
} from './hubGameRules'

const W = 500
const H = 80
const base = { rested: 0, attacker: false, attack: 'none' as const, warn: 0, golden: false }
const bat: HubTarget = { ...base, id: 1, kind: 'bat', x: 100, y: 40, speed: 20 }
const coin: HubTarget = { ...base, id: 2, kind: 'coin', x: 300, y: -8, speed: 46 }
const bomb: HubTarget = { ...base, id: 3, kind: 'bomb', x: 200, y: 40, speed: 20 }
/** A round with spawns and waves held back, so only the given targets are in play. */
const game = (targets: HubTarget[], extra: Partial<HubGameState> = {}): HubGameState => ({ ...startHubRound(), targets, wait: 99, waveIn: 99, ...extra })
const click = (state: HubGameState, x: number, y: number) => clickHubGame(state, x, y, H)
/** Runs the round for `seconds` without spawning anything. */
const run = (state: HubGameState, seconds: number, knightX = state.knightX) => {
  let current = { ...state, knightX }
  for (let t = 0; t < seconds; t += 1 / 30) current = stepHubGame({ ...current, wait: 99, waveIn: 99 }, 1 / 30, W, H)
  return current
}

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
  it('spawns a critter just off screen, so nothing pops into view', () => {
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
    const later = stepHubGame(game([landed]), 1, W, H).targets.filter((target) => target.id === coin.id)
    expect(later).toHaveLength(1)
    expect(stepHubGame(game(later), 2, W, H).targets.some((target) => target.id === coin.id)).toBe(false)
  })
})

describe('hub game pace', () => {
  it('refills an empty strip at once instead of leaving dead air', () => {
    const refilled = stepHubGame({ ...startHubRound(), wait: 1.5, waveIn: 99 }, 0.2, W, H, () => 0.9)
    expect(refilled.targets).toHaveLength(1)
  })
  it('keeps to the normal rhythm when the strip is busy', () => {
    const busy = [1, 2, 3, 4, 5].map((id) => ({ ...bat, id, x: 50 * id }))
    expect(stepHubGame({ ...startHubRound(), targets: busy, wait: 1.5, waveIn: 99 }, 0.2, W, H, () => 0.9).targets).toHaveLength(5)
  })
  it('alternates waves: a swarm of bats, then a rain of coins', () => {
    const swarm = stepHubGame(game([], { waveIn: 0.01 }), 0.02, W, H, () => 0.3)
    expect(swarm).toMatchObject({ waves: 1, lastWave: 'swarm' })
    expect(swarm.targets.filter((target) => target.kind === 'bat').length).toBeGreaterThanOrEqual(4)
    expect(swarm.targets.filter((target) => target.golden)).toHaveLength(1)
    const coins = stepHubGame({ ...swarm, targets: [], waveIn: 0.01, wait: 99 }, 0.02, W, H, () => 0.3)
    expect(coins).toMatchObject({ waves: 2, lastWave: 'coins' })
    expect(coins.targets.every((target) => target.kind === 'coin')).toBe(true)
  })
  it('keeps a queued wave bat in play until it has crossed', () => {
    const queued = { ...bat, x: -100, speed: 34 }
    expect(stepHubGame(game([queued]), 0.1, W, H).targets).toHaveLength(1)
  })
  it('doubles the points in the frenzy of the last seconds', () => {
    const frenzy = game([bat], { timeLeft: FRENZY_SECONDS - 1 })
    expect(isFrenzy(frenzy)).toBe(true)
    expect(click(frenzy, 100, 40).points).toBe(CRITTER_POINTS * FRENZY_FACTOR)
    expect(isFrenzy(game([], { timeLeft: FRENZY_SECONDS + 1 }))).toBe(false)
  })
})

describe('hub game attacks', () => {
  const diver: HubTarget = { ...bat, id: 5, attacker: true, attack: 'dive', x: 150, y: 40, speed: 40 }
  const incoming: HubTarget = { ...bat, id: 6, attacker: true, attack: 'approach', x: -14, y: 40, speed: 40 }
  it('flies in, stops and warns before it dives', () => {
    const inside = run(game([incoming]), 2)
    expect(inside.targets[0].attack).not.toBe('approach')
    const warning = stepHubGame(game([{ ...incoming, x: 60 }]), 0.01, W, H).targets[0]
    expect(warning).toMatchObject({ attack: 'warn' })
    expect(warning.warn).toBeCloseTo(WARN_SECONDS)
    const held = stepHubGame(game([warning]), WARN_SECONDS / 2, W, H).targets[0]
    expect(held).toMatchObject({ attack: 'warn', x: warning.x, y: warning.y })
    expect(stepHubGame(game([held]), WARN_SECONDS, W, H).targets[0].attack).toBe('dive')
  })
  it('never wounds the knight before its warning is over, even right next to him', () => {
    const onTop = { ...incoming, x: 60, y: H - 22 }
    let state = game([onTop], { knightX: 60 })
    for (let t = 0; t < WARN_SECONDS - 0.05; t += 1 / 30) state = stepHubGame({ ...state, wait: 99 }, 1 / 30, W, H)
    expect(state.wounds).toBe(0)
    expect(run(state, 0.5).wounds).toBe(1)
  })
  it('chases the knight wherever he moved', () => {
    const left = stepHubGame(game([diver], { knightX: 40 }), 0.1, W, H).targets[0]
    expect(left.x).toBeLessThan(diver.x)
    expect(left.speed).toBeLessThan(0)
    const right = stepHubGame(game([diver], { knightX: 400 }), 0.1, W, H).targets[0]
    expect(right.x).toBeGreaterThan(diver.x)
    expect(right.speed).toBeGreaterThan(0)
  })
  it('costs a heart, ends the chain and halves the charge when it reaches him', () => {
    const next = stepHubGame(game([{ ...diver, x: 40, y: H - 22 }], { knightX: 40, combo: 6, charge: 9 }), 0.01, W, H)
    expect(next).toMatchObject({ wounds: 1, combo: 0, charge: 4, targets: [] })
  })
  it('kills him on the last heart', () => {
    const next = stepHubGame(game([{ ...diver, x: 40, y: H - 22 }], { knightX: 40, wounds: MAX_WOUNDS - 1 }), 0.01, W, H)
    expect(next.phase).toBe('over')
    expect(isDead(next)).toBe(true)
  })
  it('never lets an attacker fly away unpunished', () => {
    const far = stepHubGame(game([{ ...diver, x: W + 39, speed: 40 }], { knightX: 40 }), 1, W, H)
    expect(far.targets.some((target) => target.id === diver.id)).toBe(true)
  })
  it('can be struck down before it arrives', () => {
    expect(click(game([diver]), 150, 40).hit?.id).toBe(diver.id)
  })
  it('keeps the knight away from the edges, where attackers come in', () => {
    // Striking toward an edge would put him past it: he stops short.
    expect(strikePosition(30, 10, 60, W)).toEqual({ x: KNIGHT_EDGE, flip: false })
    expect(strikePosition(W - 30, W, 60, W)).toEqual({ x: W - KNIGHT_EDGE, flip: true })
    expect(strikePosition(250, 100, 60, W)).toEqual({ x: 190, flip: false })
    expect(strikePosition(100, 300, 60, W)).toEqual({ x: 160, flip: true })
  })
})

describe('hub game clicks', () => {
  it('climbs the multiplier every few hits in a row', () => {
    const first = click(game([bat]), 100, 40).state
    expect(first).toMatchObject({ combo: 1, score: CRITTER_POINTS, targets: [] })
    expect(click(game([bat], { combo: COMBO_STEP - 1 }), 100, 40).points).toBe(2 * CRITTER_POINTS)
  })
  it('caps the multiplier', () => {
    expect(comboMultiplier(0)).toBe(1)
    expect(comboMultiplier(COMBO_STEP)).toBe(2)
    expect(comboMultiplier(1000)).toBe(MAX_MULTIPLIER)
  })
  it('pays more for a coin and for a golden critter', () => {
    expect(click(game([{ ...coin, y: 70 }], { combo: 1 }), 300, 70).state.score).toBe(COIN_POINTS)
    expect(click(game([{ ...bat, golden: true }]), 100, 40).points).toBe(CRITTER_POINTS * GOLDEN_FACTOR)
  })
  it('gives time back for a golden target, up to a limit per round', () => {
    const golden = { ...bat, golden: true }
    const gained = click(game([golden], { timeLeft: 10 }), 100, 40)
    expect(gained.bonusSeconds).toBe(GOLDEN_SECONDS)
    expect(gained.state.timeLeft).toBe(10 + GOLDEN_SECONDS)
    const capped = click(game([golden], { timeLeft: 10, stats: { ...startHubRound().stats, bonusSeconds: MAX_BONUS_SECONDS } }), 100, 40)
    expect(capped.bonusSeconds).toBeUndefined()
    expect(capped.state.timeLeft).toBe(10)
  })
  it('halves the chain on a miss, keeping the score and the charge', () => {
    const { state, hit } = click(game([bat], { combo: 10, score: 40, charge: 5 }), 400, 10)
    expect(hit).toBeUndefined()
    expect(state).toMatchObject({ combo: 5, charge: 5, score: 40 })
    expect(state.targets).toHaveLength(1)
    expect(state.stats).toMatchObject({ clicks: 1, misses: 1 })
  })
  it('survives two bombs and dies on the third, keeping the score', () => {
    const second = click(game([bomb], { wounds: 1, score: 40, combo: 5, charge: CHARGE_MAX }), 200, 40).state
    expect(second).toMatchObject({ wounds: 2, phase: 'playing', combo: 0, charge: CHARGE_MAX / 2 })
    const third = click({ ...second, targets: [bomb, bat] }, 200, 40).state
    expect(third).toMatchObject({ wounds: MAX_WOUNDS, phase: 'over', score: 40, targets: [] })
    expect(isDead(third)).toBe(true)
  })
  it('does not count a bomb that flies away', () => {
    const after = stepHubGame(game([{ ...bomb, x: W + 39 }]), 1, W, H)
    expect(after.wounds).toBe(0)
    expect(after.targets.some((target) => target.id === bomb.id)).toBe(false)
  })
  it('strikes the nearest and takes down what is right next to it', () => {
    const result = click(game([bat, { ...bat, id: 7, x: 115 }, { ...bat, id: 8, x: 300 }]), 113, 40)
    expect(result.hit?.id).toBe(7)
    expect(result.hits?.map((target) => target.id)).toEqual([7, 1])
    expect(result.state.targets.map((target) => target.id)).toEqual([8])
    expect(result.state).toMatchObject({ combo: 2, charge: 2 })
    expect(result.state.stats).toMatchObject({ kills: 2, bestMulti: 2 })
  })
  it('never sets off a bomb next to a critter that was struck', () => {
    const result = click(game([bat, { ...bomb, x: 110 }]), 100, 40)
    expect(result.hits).toHaveLength(1)
    expect(result.state.wounds).toBe(0)
  })
  it('climbs through the moves with the chain, then cycles', () => {
    expect([1, 2, 3, 4].map((combo) => moveIndexForCombo(combo, 3))).toEqual([0, 1, 2, 0])
    expect(moveIndexForCombo(0, 3)).toBe(0)
  })
})

describe('hub game special', () => {
  it('charges with every target taken, up to the limit', () => {
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
    expect(points).toBe((CRITTER_POINTS + COIN_POINTS) * SPECIAL_FACTOR)
    expect(state).toMatchObject({ targets: [], score: 10 + points, wounds: 0, combo: 2 })
    expect(state.stats.kills).toBe(2)
  })
})

describe('hub game results', () => {
  it('awards a medal by score', () => {
    expect(medalFor(0)).toBeNull()
    expect(medalFor(500)).toBe('bronze')
    expect(medalFor(1000)).toBe('silver')
    expect(medalFor(5000)).toBe('gold')
  })
  it('measures accuracy from clicks and misses', () => {
    expect(accuracy({ ...startHubRound().stats, clicks: 4, misses: 1 })).toBe(0.75)
    expect(accuracy(startHubRound().stats)).toBe(0)
  })
})

describe('hub game fairness over whole rounds', () => {
  it('never lets a hidden attacker take a heart: each one is on screen for its whole warning first', () => {
    const width = 562
    const height = 80
    for (let seed = 1; seed <= 100; seed++) {
      let s = seed
      const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
      let state = startHubRound(KNIGHT_EDGE)
      let t = 0
      const onScreenSince = new Map<number, number>()
      while (state.phase === 'playing') {
        const before = state.targets
        const wounds = state.wounds
        state = stepHubGame(state, 1 / 30, width, height, random)
        t += 1 / 30
        if (state.wounds > wounds) {
          const landed = before.filter((target) => target.attack === 'dive' && !state.targets.some((next) => next.id === target.id))
          for (const target of landed) expect(t - (onScreenSince.get(target.id) ?? t)).toBeGreaterThanOrEqual(WARN_SECONDS)
        }
        for (const target of state.targets) if (!onScreenSince.has(target.id) && target.x >= 0 && target.x <= width) onScreenSince.set(target.id, t)
      }
    }
  })
})

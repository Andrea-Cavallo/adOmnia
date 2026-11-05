/**
 * Rules of the Hub mini game, without any drawing: a 30 second round started by a click. Critters
 * get faster and some dive at the knight; a chain of hits multiplies the points and charges a
 * special that clears the strip. A miss ends the chain, a bomb or a landed attack costs a heart too.
 */
export type HubTargetKind = 'bat' | 'bird' | 'butterfly' | 'coin' | 'bomb'
export type HubGamePhase = 'idle' | 'playing' | 'over'

export interface HubTarget {
  id: number
  kind: HubTargetKind
  x: number
  y: number
  /** Pixels per second; a negative speed flies left. Coins only fall. */
  speed: number
  /** Seconds a coin has been resting on the ground. */
  rested: number
  /** Dives at the knight and costs a heart if it gets there. */
  attacker: boolean
  /** Rare and worth more. */
  golden: boolean
}

export const ROUND_SECONDS = 30
export const CRITTER_POINTS = 1
export const COIN_POINTS = 5
export const GOLDEN_FACTOR = 3
export const SPECIAL_FACTOR = 2
export const MAX_MULTIPLIER = 8
export const MAX_WOUNDS = 3
export const CHARGE_MAX = 10
const COIN_CHANCE = 0.1
const BOMB_CHANCE = 0.2
const GOLDEN_CHANCE = 0.08
const BOMB_FREE_SECONDS = 3
const COIN_REST_SECONDS = 4
const COIN_FALL_SPEED = 46
const OFFSCREEN_MARGIN = 40
const ATTACK_REACH = 15
const ATTACK_SPEED_FACTOR = 1.2
const KNIGHT_CHEST_HEIGHT = 22
const KNIGHT_CLICK_RADIUS = 22
const HIT_RADIUS: Record<HubTargetKind, number> = { bat: 24, bird: 22, butterfly: 26, coin: 18, bomb: 13 }
const CRITTERS: readonly HubTargetKind[] = ['bat', 'bird', 'butterfly']

export interface HubGameState {
  phase: HubGamePhase
  timeLeft: number
  targets: HubTarget[]
  score: number
  combo: number
  /** Hearts lost this round, to bombs and to attacks. */
  wounds: number
  /** Hits toward the special. */
  charge: number
  knightX: number
  nextId: number
  /** Seconds until the next spawn. */
  wait: number
}

export const newHubGame = (): HubGameState => ({ phase: 'idle', timeLeft: ROUND_SECONDS, targets: [], score: 0, combo: 0, wounds: 0, charge: 0, knightX: 40, nextId: 1, wait: 0.4 })
export const startHubRound = (knightX = 40): HubGameState => ({ ...newHubGame(), phase: 'playing', knightX })

/** 1 at the start of the round, 3 at the end: spawn speed and spawn rate both follow it. */
export const roundPace = (timeLeft: number): number => 1 + 2 * (1 - Math.max(0, timeLeft) / ROUND_SECONDS)
export const comboMultiplier = (combo: number): number => Math.max(1, Math.min(combo, MAX_MULTIPLIER))
export const specialReady = (state: HubGameState): boolean => state.charge >= CHARGE_MAX
export const isDead = (state: HubGameState): boolean => state.wounds >= MAX_WOUNDS

export function targetPoints(target: HubTarget, combo: number): number {
  const base = target.kind === 'coin' ? COIN_POINTS : CRITTER_POINTS
  return base * (target.golden ? GOLDEN_FACTOR : 1) * comboMultiplier(combo)
}

function spawnKind(roll: number, timeLeft: number): HubTargetKind | null {
  if (roll < COIN_CHANCE) return 'coin'
  if (roll < COIN_CHANCE + BOMB_CHANCE && ROUND_SECONDS - timeLeft >= BOMB_FREE_SECONDS) return 'bomb'
  return null
}

function spawn(state: HubGameState, width: number, height: number, random: () => number): HubTarget {
  const base = { id: state.nextId, rested: 0, attacker: false, golden: false }
  const special = spawnKind(random(), state.timeLeft)
  if (special === 'coin') return { ...base, kind: 'coin', x: 24 + random() * (width - 48), y: -8, speed: COIN_FALL_SPEED }
  const kind = special ?? CRITTERS[Math.floor(random() * CRITTERS.length) % CRITTERS.length]
  const speed = (22 + random() * 16) * roundPace(state.timeLeft) * (random() < 0.5 ? 1 : -1)
  const y = height * 0.3 + random() * height * 0.34
  const x = speed > 0 ? -OFFSCREEN_MARGIN : width + OFFSCREEN_MARGIN
  if (special === 'bomb') return { ...base, kind, x, y, speed }
  // More attackers as the round goes on; the rest cross the strip and can be left alone.
  const attacker = random() < 0.15 + 0.2 * roundPace(state.timeLeft)
  return { ...base, kind, x, y, speed, attacker, golden: !attacker && random() < GOLDEN_CHANCE }
}

function moved(target: HubTarget, dt: number, height: number, knightX: number): HubTarget {
  if (target.kind === 'coin') {
    const groundY = height - 8
    const y = Math.min(groundY, target.y + target.speed * dt)
    return { ...target, y, rested: y >= groundY ? target.rested + dt : 0 }
  }
  if (!target.attacker) return { ...target, x: target.x + target.speed * dt }
  // It keeps chasing the knight, wherever his last strike took him.
  const toward = knightX >= target.x ? 1 : -1
  const pace = Math.abs(target.speed) * ATTACK_SPEED_FACTOR
  const chestY = height - KNIGHT_CHEST_HEIGHT
  return { ...target, speed: toward * Math.abs(target.speed), x: target.x + toward * pace * dt, y: target.y + (chestY - target.y) * Math.min(1, 1.2 * dt) }
}

function stillInPlay(target: HubTarget, width: number): boolean {
  if (target.attacker) return true
  if (target.kind === 'coin') return target.rested < COIN_REST_SECONDS
  return target.speed > 0 ? target.x < width + OFFSCREEN_MARGIN : target.x > -OFFSCREEN_MARGIN
}

const wounded = (state: HubGameState, wounds: number): HubGameState => {
  const dead = wounds >= MAX_WOUNDS
  return { ...state, wounds, combo: 0, charge: 0, phase: dead ? 'over' : state.phase, targets: dead ? [] : state.targets }
}

export function stepHubGame(state: HubGameState, dt: number, width: number, height: number, random: () => number = Math.random): HubGameState {
  if (state.phase !== 'playing') return state
  const timeLeft = state.timeLeft - dt
  if (timeLeft <= 0) return { ...state, phase: 'over', timeLeft: 0, targets: [] }
  const all = state.targets.map((target) => moved(target, dt, height, state.knightX))
  const arrived = (target: HubTarget) => target.attacker && Math.hypot(target.x - state.knightX, target.y - (height - KNIGHT_CHEST_HEIGHT)) <= ATTACK_REACH
  const hits = all.filter(arrived).length
  const targets = all.filter((target) => !arrived(target) && stillInPlay(target, width))
  const next = { ...state, timeLeft, targets }
  const after = hits ? wounded(next, state.wounds + hits) : next
  if (after.phase !== 'playing') return after
  const wait = state.wait - dt
  if (wait > 0) return { ...after, wait }
  return { ...after, targets: [...after.targets, spawn(after, width, height, random)], nextId: state.nextId + 1, wait: (0.7 + random() * 0.9) / roundPace(timeLeft) }
}

export interface HubClick {
  state: HubGameState
  hit?: HubTarget
  points?: number
  /** The knight was clicked with the special ready: the caller plays it, then calls clearHubTargets. */
  special?: boolean
}

export function clickHubGame(state: HubGameState, x: number, y: number, height: number): HubClick {
  if (state.phase !== 'playing') return { state }
  if (specialReady(state) && Math.hypot(x - state.knightX, y - (height - KNIGHT_CHEST_HEIGHT)) <= KNIGHT_CLICK_RADIUS) {
    return { special: true, state: { ...state, charge: 0 } }
  }
  const distance = (target: HubTarget) => Math.hypot(target.x - x, target.y - y)
  const inReach = state.targets.filter((target) => distance(target) <= HIT_RADIUS[target.kind])
  // A miss ends the chain but keeps the charge: only a wound takes that away.
  if (!inReach.length) return { state: { ...state, combo: 0 } }
  const hit = inReach.reduce((nearest, target) => (distance(target) < distance(nearest) ? target : nearest))
  const targets = state.targets.filter((target) => target.id !== hit.id)
  if (hit.kind === 'bomb') return { hit, state: wounded({ ...state, targets }, state.wounds + 1) }
  const combo = state.combo + 1
  const points = targetPoints(hit, combo)
  return { hit, points, state: { ...state, targets, combo, score: state.score + points, charge: Math.min(CHARGE_MAX, state.charge + 1) } }
}

/** The special lands: everything on the strip is gone, bombs harmlessly, critters and coins for double. */
export function clearHubTargets(state: HubGameState): { state: HubGameState; cleared: HubTarget[]; points: number } {
  const scoring = state.targets.filter((target) => target.kind !== 'bomb')
  const points = scoring.reduce((total, target) => total + targetPoints(target, state.combo) * SPECIAL_FACTOR, 0)
  return { cleared: state.targets, points, state: { ...state, targets: [], score: state.score + points } }
}

/** Which of the knight's moves a chain plays: it climbs through them as the chain grows, then cycles. */
export const moveIndexForCombo = (combo: number, moves: number): number => (Math.max(1, combo) - 1) % moves

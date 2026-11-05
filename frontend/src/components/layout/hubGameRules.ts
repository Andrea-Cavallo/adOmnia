/**
 * Rules of the Hub mini game, without any drawing: a 30 second round started by a click. Critters
 * get faster and some attack the knight; a chain of hits multiplies the points and charges a
 * special that clears the strip. A miss lowers the chain, a bomb or a landed attack costs a heart.
 *
 * Fairness first: an attacker always shows itself, stops and flashes before it dives, so a heart
 * is never lost to something that was not on screen. Pace second: the strip is never empty for
 * long, waves break the rhythm and the last seconds are a frenzy.
 */
export type HubTargetKind = 'bat' | 'bird' | 'butterfly' | 'coin' | 'bomb'
export type HubGamePhase = 'idle' | 'playing' | 'over'
/** An attacker flies in like any critter, stops to warn, then dives at the knight. */
export type HubAttackStage = 'none' | 'approach' | 'warn' | 'dive'
export type HubWaveKind = 'swarm' | 'coins'
export type HubMedal = 'bronze' | 'silver' | 'gold'

export interface HubTarget {
  id: number
  kind: HubTargetKind
  x: number
  y: number
  /** Pixels per second; a negative speed flies left. Coins only fall. */
  speed: number
  /** Seconds a coin has been resting on the ground. */
  rested: number
  /** Attacks the knight and costs a heart if it gets there. */
  attacker: boolean
  /** Where the attack stands; 'none' for everything that is not an attacker. */
  attack: HubAttackStage
  /** Seconds left in the warning. */
  warn: number
  /** Rare, worth more and adds time. */
  golden: boolean
}

export interface HubStats {
  kills: number
  clicks: number
  misses: number
  maxCombo: number
  /** Most targets taken by one click. */
  bestMulti: number
  /** Seconds won with golden targets. */
  bonusSeconds: number
}

export const ROUND_SECONDS = 30
export const CRITTER_POINTS = 1
export const COIN_POINTS = 5
export const GOLDEN_FACTOR = 3
export const SPECIAL_FACTOR = 2
export const FRENZY_FACTOR = 2
export const FRENZY_SECONDS = 5
export const MAX_MULTIPLIER = 8
/** Hits in a row for each step of the multiplier: ×8 takes a chain of 28. */
export const COMBO_STEP = 4
export const MAX_WOUNDS = 3
export const CHARGE_MAX = 20
/** A golden target gives this much time back, up to MAX_BONUS_SECONDS per round. */
export const GOLDEN_SECONDS = 2
export const MAX_BONUS_SECONDS = 6
/** How long an attacker hovers and flashes before it dives: the time to react. */
export const WARN_SECONDS = 0.8
/** The knight never stands closer to the edges than this: attackers come from there. */
export const KNIGHT_EDGE = 36
/** Score that earns each medal, calibrated on simulated rounds (see the tests). */
export const MEDALS: ReadonlyArray<readonly [HubMedal, number]> = [['gold', 2200], ['silver', 1000], ['bronze', 500]]
const COIN_CHANCE = 0.1
const BOMB_CHANCE = 0.2
const GOLDEN_CHANCE = 0.08
const FRENZY_GOLDEN_CHANCE = 0.25
const BOMB_FREE_SECONDS = 3
const COIN_REST_SECONDS = 4
const COIN_FALL_SPEED = 46
const OFFSCREEN_MARGIN = 40
/** Critters start just past the edge: hidden at birth, on screen a moment later. */
const SPAWN_MARGIN = 14
/** An attacker starts its warning once this far inside the strip. */
const ATTACK_EDGE = 50
const ATTACK_REACH = 15
const ATTACK_SPEED_FACTOR = 1.2
/** A dive never crawls: it lands in a couple of seconds wherever the knight is. */
const DIVE_MIN_SPEED = 110
/** Fewest live targets the strip keeps at the start and at the end of the round. */
const MIN_FIELD_START = 3
const MIN_FIELD_END = 5
const REFILL_WAIT = 0.12
const FIRST_WAVE_SECONDS = 6
const WAVE_GAP_SECONDS = 6
const WAVE_GAP_SPREAD = 3
const SWARM_SIZE = 4
const COIN_RAIN_SIZE = 5
/** Targets this close to the one clicked fall with it: a multi kill. */
const CLEAVE_RADIUS = 20
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
  /** Seconds until the next wave. */
  waveIn: number
  /** Waves so far; the caller announces a new one when it changes. */
  waves: number
  lastWave: HubWaveKind | null
  stats: HubStats
}

const noStats = (): HubStats => ({ kills: 0, clicks: 0, misses: 0, maxCombo: 0, bestMulti: 0, bonusSeconds: 0 })

export const newHubGame = (): HubGameState => ({
  phase: 'idle', timeLeft: ROUND_SECONDS, targets: [], score: 0, combo: 0, wounds: 0, charge: 0, knightX: 40, nextId: 1, wait: 0.4,
  waveIn: FIRST_WAVE_SECONDS, waves: 0, lastWave: null, stats: noStats(),
})
export const startHubRound = (knightX = 40): HubGameState => ({ ...newHubGame(), phase: 'playing', knightX })

/** 1 at the start of the round, 3 at the end: spawn speed and spawn rate both follow it. */
export const roundPace = (timeLeft: number): number => 1 + 2 * (1 - Math.min(ROUND_SECONDS, Math.max(0, timeLeft)) / ROUND_SECONDS)
export const comboMultiplier = (combo: number): number => Math.min(MAX_MULTIPLIER, 1 + Math.floor(Math.max(0, combo) / COMBO_STEP))
export const specialReady = (state: HubGameState): boolean => state.charge >= CHARGE_MAX
export const isDead = (state: HubGameState): boolean => state.wounds >= MAX_WOUNDS
export const isFrenzy = (state: HubGameState): boolean => state.phase === 'playing' && state.timeLeft <= FRENZY_SECONDS
export const accuracy = (stats: HubStats): number => (stats.clicks ? (stats.clicks - stats.misses) / stats.clicks : 0)
export const medalFor = (score: number): HubMedal | null => MEDALS.find(([, threshold]) => score >= threshold)?.[0] ?? null

export function targetPoints(target: HubTarget, combo: number, frenzy = false): number {
  const base = target.kind === 'coin' ? COIN_POINTS : CRITTER_POINTS
  return base * (target.golden ? GOLDEN_FACTOR : 1) * comboMultiplier(combo) * (frenzy ? FRENZY_FACTOR : 1)
}

/** Where the knight stands to strike a target: `reach` before it, never against an edge. */
export function strikePosition(targetX: number, knightX: number, reach: number, width: number): { x: number; flip: boolean } {
  const flip = targetX < knightX
  const x = Math.round(Math.max(KNIGHT_EDGE, Math.min(width - KNIGHT_EDGE, targetX + (flip ? reach : -reach))))
  return { x, flip }
}

const blank = (id: number) => ({ id, rested: 0, attacker: false, attack: 'none' as const, warn: 0, golden: false })

function spawnKind(roll: number, timeLeft: number): HubTargetKind | null {
  if (roll < COIN_CHANCE) return 'coin'
  if (roll < COIN_CHANCE + BOMB_CHANCE && ROUND_SECONDS - timeLeft >= BOMB_FREE_SECONDS) return 'bomb'
  return null
}

function spawn(state: HubGameState, width: number, height: number, random: () => number): HubTarget {
  const base = blank(state.nextId)
  const special = spawnKind(random(), state.timeLeft)
  if (special === 'coin') return { ...base, kind: 'coin', x: 24 + random() * (width - 48), y: -8, speed: COIN_FALL_SPEED }
  const kind = special ?? CRITTERS[Math.floor(random() * CRITTERS.length) % CRITTERS.length]
  const speed = (22 + random() * 16) * roundPace(state.timeLeft) * (random() < 0.5 ? 1 : -1)
  const y = height * 0.3 + random() * height * 0.34
  const x = speed > 0 ? -SPAWN_MARGIN : width + SPAWN_MARGIN
  if (special === 'bomb') return { ...base, kind, x, y, speed }
  // More attackers as the round goes on; the rest cross the strip and can be left alone.
  const attacker = random() < 0.15 + 0.2 * roundPace(state.timeLeft)
  const goldenChance = isFrenzy(state) ? FRENZY_GOLDEN_CHANCE : GOLDEN_CHANCE
  return { ...base, kind, x, y, speed, attacker, attack: attacker ? 'approach' : 'none', golden: !attacker && random() < goldenChance }
}

/** A wave: a line of bats from one side, or coins raining over the strip. */
function spawnWave(state: HubGameState, kind: HubWaveKind, width: number, height: number, random: () => number): HubTarget[] {
  if (kind === 'coins') {
    return Array.from({ length: COIN_RAIN_SIZE }, (_, index) => ({
      ...blank(state.nextId + index), kind: 'coin' as const, x: 24 + random() * (width - 48), y: -8 - index * 14, speed: COIN_FALL_SPEED,
    }))
  }
  const direction = random() < 0.5 ? 1 : -1
  const speed = 34 * roundPace(state.timeLeft) * direction
  const golden = Math.floor(random() * SWARM_SIZE)
  return Array.from({ length: SWARM_SIZE }, (_, index) => ({
    ...blank(state.nextId + index), kind: 'bat' as const, speed, golden: index === golden,
    x: direction > 0 ? -SPAWN_MARGIN - index * 26 : width + SPAWN_MARGIN + index * 26,
    y: height * 0.32 + (index % 2) * height * 0.22,
  }))
}

const insideStrip = (target: HubTarget, width: number) => target.x >= ATTACK_EDGE && target.x <= width - ATTACK_EDGE

function movedAttacker(target: HubTarget, dt: number, width: number, height: number, knightX: number): HubTarget {
  if (target.attack === 'approach') {
    const x = target.x + target.speed * dt
    const arrived = { ...target, x }
    return insideStrip(arrived, width) ? { ...arrived, attack: 'warn', warn: WARN_SECONDS } : arrived
  }
  if (target.attack === 'warn') {
    const warn = target.warn - dt
    return warn > 0 ? { ...target, warn } : { ...target, warn: 0, attack: 'dive' }
  }
  // Diving: it chases the knight wherever his last strike took him.
  const toward = knightX >= target.x ? 1 : -1
  const pace = Math.max(DIVE_MIN_SPEED, Math.abs(target.speed) * ATTACK_SPEED_FACTOR)
  const chestY = height - KNIGHT_CHEST_HEIGHT
  return { ...target, speed: toward * Math.abs(target.speed), x: target.x + toward * pace * dt, y: target.y + (chestY - target.y) * Math.min(1, 1.2 * dt) }
}

function moved(target: HubTarget, dt: number, width: number, height: number, knightX: number): HubTarget {
  if (target.kind === 'coin') {
    const groundY = height - 8
    const y = Math.min(groundY, target.y + target.speed * dt)
    return { ...target, y, rested: y >= groundY ? target.rested + dt : 0 }
  }
  if (target.attacker) return movedAttacker(target, dt, width, height, knightX)
  return { ...target, x: target.x + target.speed * dt }
}

function stillInPlay(target: HubTarget, width: number): boolean {
  if (target.attacker) return true
  if (target.kind === 'coin') return target.rested < COIN_REST_SECONDS
  // Only the far side counts: a wave queues its bats further out on the side they come from.
  return target.speed > 0 ? target.x < width + OFFSCREEN_MARGIN : target.x > -OFFSCREEN_MARGIN
}

const wounded = (state: HubGameState, wounds: number): HubGameState => {
  const dead = wounds >= MAX_WOUNDS
  // A wound ends the chain and halves the charge: one mistake does not undo a whole round.
  return { ...state, wounds, combo: 0, charge: Math.floor(state.charge / 2), phase: dead ? 'over' : state.phase, targets: dead ? [] : state.targets }
}

/** Live targets that count toward keeping the strip busy: bombs and resting coins do not. */
const busyCount = (targets: HubTarget[]) => targets.filter((target) => target.kind !== 'bomb' && target.rested === 0).length
const minimumField = (timeLeft: number) => Math.round(MIN_FIELD_START + (MIN_FIELD_END - MIN_FIELD_START) * (roundPace(timeLeft) - 1) / 2)

function withWave(state: HubGameState, dt: number, width: number, height: number, random: () => number): HubGameState {
  const waveIn = state.waveIn - dt
  if (waveIn > 0) return { ...state, waveIn }
  const kind: HubWaveKind = state.lastWave === 'swarm' ? 'coins' : 'swarm'
  const wave = spawnWave(state, kind, width, height, random)
  return {
    ...state, targets: [...state.targets, ...wave], nextId: state.nextId + wave.length,
    waveIn: WAVE_GAP_SECONDS + random() * WAVE_GAP_SPREAD, waves: state.waves + 1, lastWave: kind,
  }
}

export function stepHubGame(state: HubGameState, dt: number, width: number, height: number, random: () => number = Math.random): HubGameState {
  if (state.phase !== 'playing') return state
  const timeLeft = state.timeLeft - dt
  if (timeLeft <= 0) return { ...state, phase: 'over', timeLeft: 0, targets: [] }
  const all = state.targets.map((target) => moved(target, dt, width, height, state.knightX))
  const arrived = (target: HubTarget) => target.attack === 'dive' && Math.hypot(target.x - state.knightX, target.y - (height - KNIGHT_CHEST_HEIGHT)) <= ATTACK_REACH
  const hits = all.filter(arrived).length
  const targets = all.filter((target) => !arrived(target) && stillInPlay(target, width))
  const next = { ...state, timeLeft, targets }
  const after = hits ? wounded(next, state.wounds + hits) : next
  if (after.phase !== 'playing') return after
  const waved = withWave(after, dt, width, height, random)
  // An empty strip is dead air: refill it quickly, faster as the round goes on.
  const starved = busyCount(waved.targets) < minimumField(timeLeft)
  const wait = Math.min(state.wait, starved ? REFILL_WAIT : state.wait) - dt
  if (wait > 0) return { ...waved, wait }
  return { ...waved, targets: [...waved.targets, spawn(waved, width, height, random)], nextId: waved.nextId + 1, wait: (0.7 + random() * 0.9) / roundPace(timeLeft) }
}

export interface HubClick {
  state: HubGameState
  /** The target clicked. */
  hit?: HubTarget
  /** Everything the click took down, the clicked target first. */
  hits?: HubTarget[]
  points?: number
  /** Seconds a golden target gave back. */
  bonusSeconds?: number
  /** The knight was clicked with the special ready: the caller plays it, then calls clearHubTargets. */
  special?: boolean
}

const counted = (state: HubGameState, miss: boolean): HubStats => ({ ...state.stats, clicks: state.stats.clicks + 1, misses: state.stats.misses + (miss ? 1 : 0) })

export function clickHubGame(state: HubGameState, x: number, y: number, height: number): HubClick {
  if (state.phase !== 'playing') return { state }
  if (specialReady(state) && Math.hypot(x - state.knightX, y - (height - KNIGHT_CHEST_HEIGHT)) <= KNIGHT_CLICK_RADIUS) {
    return { special: true, state: { ...state, charge: 0 } }
  }
  const distance = (target: HubTarget) => Math.hypot(target.x - x, target.y - y)
  const inReach = state.targets.filter((target) => distance(target) <= HIT_RADIUS[target.kind])
  // A miss halves the chain and keeps the charge: only a wound takes charge away.
  if (!inReach.length) return { state: { ...state, combo: Math.floor(state.combo / 2), stats: counted(state, true) } }
  const hit = inReach.reduce((nearest, target) => (distance(target) < distance(nearest) ? target : nearest))
  if (hit.kind === 'bomb') {
    const targets = state.targets.filter((target) => target.id !== hit.id)
    return { hit, hits: [hit], state: wounded({ ...state, targets, stats: counted(state, false) }, state.wounds + 1) }
  }
  // Critters and coins right next to the one clicked fall with it.
  const cleaved = state.targets.filter((target) => target.id !== hit.id && target.kind !== 'bomb' && Math.hypot(target.x - hit.x, target.y - hit.y) <= CLEAVE_RADIUS)
  const hits = [hit, ...cleaved]
  const frenzy = isFrenzy(state)
  let combo = state.combo
  let points = 0
  for (const target of hits) {
    combo += 1
    points += targetPoints(target, combo, frenzy)
  }
  const golden = hits.filter((target) => target.golden).length
  const bonusSeconds = Math.min(golden * GOLDEN_SECONDS, MAX_BONUS_SECONDS - state.stats.bonusSeconds)
  const gone = new Set(hits.map((target) => target.id))
  const stats: HubStats = {
    ...counted(state, false), kills: state.stats.kills + hits.length, maxCombo: Math.max(state.stats.maxCombo, combo),
    bestMulti: Math.max(state.stats.bestMulti, hits.length), bonusSeconds: state.stats.bonusSeconds + bonusSeconds,
  }
  return {
    hit, hits, points, bonusSeconds: bonusSeconds || undefined,
    state: {
      ...state, targets: state.targets.filter((target) => !gone.has(target.id)), combo, score: state.score + points, stats,
      charge: Math.min(CHARGE_MAX, state.charge + hits.length), timeLeft: Math.min(ROUND_SECONDS, state.timeLeft + bonusSeconds),
    },
  }
}

/** The special lands: everything on the strip is gone, bombs harmlessly, critters and coins for double. */
export function clearHubTargets(state: HubGameState): { state: HubGameState; cleared: HubTarget[]; points: number } {
  const scoring = state.targets.filter((target) => target.kind !== 'bomb')
  const frenzy = isFrenzy(state)
  const points = scoring.reduce((total, target) => total + targetPoints(target, state.combo, frenzy) * SPECIAL_FACTOR, 0)
  const stats = { ...state.stats, kills: state.stats.kills + scoring.length }
  return { cleared: state.targets, points, state: { ...state, targets: [], score: state.score + points, stats } }
}

/** Which of the knight's moves a chain plays: it climbs through them as the chain grows, then cycles. */
export const moveIndexForCombo = (combo: number, moves: number): number => (Math.max(1, combo) - 1) % moves

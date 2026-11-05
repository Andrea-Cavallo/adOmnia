/**
 * Rules of the Hub mini game, without any drawing: a side scroller. The knight runs right through
 * an endless world, jumps pits and onto platforms, slashes or stomps critters and picks up coins.
 * Three hearts; a pit costs one and puts him back on the last safe ground. The world gets harder
 * the further he goes. All positions are in game pixels, y down, the ground surface at groundY.
 */
export type RunPhase = 'idle' | 'playing' | 'paused' | 'over'
export type EnemyKind = 'slime' | 'frog' | 'bat' | 'bird'
export type RunMedal = 'bronze' | 'silver' | 'gold'

export interface Span { x0: number; x1: number }
export interface Platform extends Span { y: number }
export interface Coin { id: number; x: number; y: number }
export interface Enemy {
  id: number
  kind: EnemyKind
  /** Center of the body. */
  x: number
  y: number
  vx: number
  vy: number
  /** Seconds since it woke up (it sleeps until it is near the screen). */
  age: number
  awake: boolean
  /** Flyers bob around this height. */
  baseY: number
  /** Seconds until a frog hops again. */
  hop: number
}
export interface Knight {
  /** Feet. */
  x: number
  y: number
  vx: number
  vy: number
  grounded: boolean
  facing: 1 | -1
  /** Seconds he can still jump after walking off an edge. */
  coyote: number
  /** Seconds a jump pressed too early waits for the ground. */
  buffer: number
  /** Seconds since the swing started, or -1. */
  attack: number
  /** Enemies this swing already hit. */
  struck: number[]
  /** Seconds he cannot be hurt. */
  invulnerable: number
  /** Last ground he stood on, where a fall puts him back. */
  safeX: number
}
export interface RunInput {
  left: boolean
  right: boolean
  jumpHeld: boolean
  /** Pressed since the last step. */
  jump: boolean
  attack: boolean
  special: boolean
}
export type RunEvent =
  | { type: 'jump' | 'land' | 'swing'; x: number; y: number }
  | { type: 'kill' | 'stomp'; x: number; y: number; kind: EnemyKind; points: number }
  | { type: 'coin'; x: number; y: number; points: number }
  | { type: 'hurt' | 'fall'; x: number; y: number }
  | { type: 'special'; x: number; y: number; points: number; cleared: Array<{ x: number; y: number; kind: EnemyKind }> }

export interface RunStats { kills: number; stomps: number; coins: number; bestChain: number }
export interface RunState {
  phase: RunPhase
  width: number
  height: number
  knight: Knight
  cameraX: number
  ground: Span[]
  platforms: Platform[]
  coins: Coin[]
  enemies: Enemy[]
  /** World x up to which the level exists. */
  builtTo: number
  nextId: number
  hearts: number
  /** Points from kills and coins; the meters run are added by runScore. */
  points: number
  /** Furthest the knight got, in pixels from the start. */
  furthest: number
  chain: number
  /** Seconds left before the chain lapses. */
  chainLeft: number
  charge: number
  stats: RunStats
  events: RunEvent[]
}

export const MAX_HEARTS = 3
export const CHARGE_MAX = 10
export const PIXELS_PER_METER = 10
export const KILL_POINTS = 10
export const COIN_POINTS = 2
export const SPECIAL_FACTOR = 2
export const MAX_CHAIN_MULTIPLIER = 5
/** Kills or coins in a row for each step of the multiplier. */
export const CHAIN_STEP = 3
export const CHAIN_SECONDS = 3
export const RUN_SPEED = 95
export const GRAVITY = 900
export const JUMP_SPEED = 310
/** Releasing jump early cuts the rise to this fraction: tap for a hop, hold for a leap. */
const JUMP_CUT = 0.45
const ACCELERATION = 900
const FRICTION = 1100
const MAX_FALL = 420
const COYOTE_SECONDS = 0.09
const BUFFER_SECONDS = 0.12
/** The swing lasts this long; its blade cuts between ATTACK_FROM and ATTACK_TO. */
export const ATTACK_SECONDS = 0.3
const ATTACK_FROM = 0.03
const ATTACK_TO = 0.2
export const ATTACK_REACH = 36
const ATTACK_SLOWDOWN = 0.5
export const INVULNERABLE_SECONDS = 1.2
const KNOCKBACK_X = 120
const KNOCKBACK_Y = 170
const STOMP_BOUNCE = 230
/** Below this fall speed a touch from above is a collision, not a stomp. */
const STOMP_MIN_SPEED = 40
/** The knight's body, from his feet. */
const BODY_HALF_WIDTH = 6
const BODY_HEIGHT = 38
/** He keeps standing while this close to the edge of the ground. */
const FOOTING = 4
const LEFT_MARGIN = 8
/** The camera keeps him at this fraction of the width: most of the screen is what comes. */
const CAMERA_LEAD = 0.38
const GROUND_MARGIN = 12
const CHUNK = 150
const SAFE_START = 260
/** Pits stay well inside the longest jump (about 65 px at full run). */
export const PIT_MIN = 24
export const PIT_MAX = 46
const PLATFORM_RISE_MIN = 30
const PLATFORM_RISE_MAX = 42
const DIFFICULTY_PIXELS = 1200
const MAX_DIFFICULTY = 3
const ENEMY_RADIUS: Record<EnemyKind, number> = { slime: 9, frog: 9, bat: 10, bird: 9 }
const COIN_RADIUS = 7
/** Enemies wake when they get this close to the right edge of the screen. */
const WAKE_MARGIN = 24
const DESPAWN_MARGIN = 48
const SLIME_SPEED = 22
const FROG_HOP_X = 58
const FROG_HOP_Y = 210
const FROG_REST = 1.1
const FROG_RANGE = 170
const BAT_SPEED = 34
const BAT_BOB = 14
const BAT_SWOOP_RANGE = 80
const BIRD_SPEED = 85
export const MEDALS: ReadonlyArray<readonly [RunMedal, number]> = [['gold', 7000], ['silver', 3500], ['bronze', 1500]]

const noStats = (): RunStats => ({ kills: 0, stomps: 0, coins: 0, bestChain: 0 })
export const groundY = (height: number) => height - GROUND_MARGIN
export const chainMultiplier = (chain: number) => Math.min(MAX_CHAIN_MULTIPLIER, 1 + Math.floor(Math.max(0, chain) / CHAIN_STEP))
export const meters = (state: RunState) => Math.floor(state.furthest / PIXELS_PER_METER)
export const runScore = (state: RunState) => state.points + meters(state)
export const difficulty = (state: RunState) => Math.min(MAX_DIFFICULTY, state.furthest / DIFFICULTY_PIXELS)
export const specialReady = (state: RunState) => state.charge >= CHARGE_MAX
export const medalFor = (score: number): RunMedal | null => MEDALS.find(([, threshold]) => score >= threshold)?.[0] ?? null
export const swinging = (knight: Knight) => knight.attack >= ATTACK_FROM && knight.attack <= ATTACK_TO

const standingKnight = (height: number): Knight => ({
  x: 40, y: groundY(height), vx: 0, vy: 0, grounded: true, facing: 1, coyote: 0, buffer: 0, attack: -1, struck: [], invulnerable: 0, safeX: 40,
})

export function newRun(width: number, height: number, random: () => number = Math.random): RunState {
  return extendWorld({
    phase: 'idle', width, height, knight: standingKnight(height), cameraX: 0, ground: [{ x0: -200, x1: SAFE_START }], platforms: [], coins: [], enemies: [],
    builtTo: SAFE_START, nextId: 1, hearts: MAX_HEARTS, points: 0, furthest: 0, chain: 0, chainLeft: 0, charge: 0, stats: noStats(), events: [],
  }, random)
}
export const startRun = (width: number, height: number, random: () => number = Math.random): RunState => ({ ...newRun(width, height, random), phase: 'playing' })
export const pauseRun = (state: RunState, paused: boolean): RunState =>
  (state.phase === 'playing' && paused) || (state.phase === 'paused' && !paused) ? { ...state, phase: paused ? 'paused' : 'playing' } : state

/** A new size keeps the run: the ground moves with the bottom of the strip. */
export function resizeRun(state: RunState, width: number, height: number): RunState {
  const dy = groundY(height) - groundY(state.height)
  if (!dy && width === state.width) return state
  const shift = <T extends { y: number }>(item: T): T => ({ ...item, y: item.y + dy })
  return {
    ...state, width, height, knight: shift(state.knight), platforms: state.platforms.map(shift), coins: state.coins.map(shift),
    enemies: state.enemies.map((enemy) => ({ ...shift(enemy), baseY: enemy.baseY + dy })),
  }
}

// ---- the level

interface Builder { state: RunState; random: () => number }

const enemyAt = (b: Builder, kind: EnemyKind, x: number, y: number): Enemy => ({
  id: b.state.nextId++, kind, x, y, vx: 0, vy: 0, age: 0, awake: false, baseY: y, hop: FROG_REST * b.random(),
})
const coinAt = (b: Builder, x: number, y: number): Coin => ({ id: b.state.nextId++, x, y })
/** Coins this far apart read as separate coins; closer, their glow runs together. */
const COIN_SPACING = 16
const coinRow = (b: Builder, x0: number, count: number, y: number) => Array.from({ length: count }, (_, index) => coinAt(b, x0 + index * COIN_SPACING, y))

function groundEnemy(b: Builder, x: number, d: number): Enemy {
  const top = groundY(b.state.height)
  const kind: EnemyKind = d > 0.3 && b.random() < 0.45 ? 'frog' : 'slime'
  return enemyAt(b, kind, x, top - ENEMY_RADIUS[kind])
}
function flyer(b: Builder, x: number, d: number): Enemy {
  const top = groundY(b.state.height)
  if (d > 0.5 && b.random() < 0.5) return enemyAt(b, 'bird', x, top - 26)
  return enemyAt(b, 'bat', x, top - 44 - b.random() * 14)
}

/** One stretch of world: flat, a pit, a platform or a flight of critters, harder with distance. */
function buildChunk(b: Builder, x0: number) {
  const s = b.state
  const d = Math.min(MAX_DIFFICULTY, x0 / DIFFICULTY_PIXELS)
  const top = groundY(s.height)
  const roll = b.random()
  const enemies: Enemy[] = []
  const coins: Coin[] = []
  let ground: Span[] = [{ x0, x1: x0 + CHUNK }]
  const platforms: Platform[] = []
  if (roll < 0.3 && x0 > SAFE_START + CHUNK) {
    const width = PIT_MIN + b.random() * Math.min(PIT_MAX - PIT_MIN, 8 + 14 * d)
    const start = x0 + 50 + b.random() * 40
    ground = [{ x0, x1: start }, { x0: start + width, x1: x0 + CHUNK }]
    // An arc of coins over the pit shows the jump.
    for (let index = 0; index < 4; index++) coins.push(coinAt(b, start - 10 + (index * (width + 20)) / 3, top - 14 - Math.sin((index / 3) * Math.PI) * 26))
  } else if (roll < 0.55) {
    const px = x0 + 30 + b.random() * 50
    const y = top - PLATFORM_RISE_MIN - b.random() * (PLATFORM_RISE_MAX - PLATFORM_RISE_MIN)
    platforms.push({ x0: px, x1: px + 52, y })
    coins.push(...coinRow(b, px + 4, 3, y - 12))
    if (d > 0.2 && b.random() < 0.5) enemies.push(groundEnemy(b, x0 + 120, d))
  } else if (roll < 0.75 && x0 > SAFE_START) {
    const count = 1 + (b.random() < 0.3 + 0.3 * d ? 1 : 0) + (d > 1.5 && b.random() < 0.4 ? 1 : 0)
    for (let index = 0; index < count; index++) enemies.push(flyer(b, x0 + 40 + index * 60, d))
  } else {
    coins.push(...coinRow(b, x0 + 20, 3 + Math.floor(b.random() * 3), top - 14))
    const count = x0 <= SAFE_START ? 0 : (b.random() < 0.55 + 0.2 * d ? 1 : 0) + (d > 0.6 && b.random() < 0.5 ? 1 : 0)
    for (let index = 0; index < count; index++) enemies.push(groundEnemy(b, x0 + 70 + index * 50, d))
  }
  s.ground = mergeGround([...s.ground, ...ground])
  s.platforms = [...s.platforms, ...platforms]
  s.coins = [...s.coins, ...coins]
  s.enemies = [...s.enemies, ...enemies]
  s.builtTo = x0 + CHUNK
}

/** Adjacent spans become one, so a slime walks on and a pit is just the gap between two spans. */
function mergeGround(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.x0 - b.x0)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out[out.length - 1]
    if (last && span.x0 <= last.x1 + 0.5) out[out.length - 1] = { x0: last.x0, x1: Math.max(last.x1, span.x1) }
    else out.push({ ...span })
  }
  return out
}

/** Builds the level ahead of the camera and forgets what is far behind it. */
function extendWorld(state: RunState, random: () => number): RunState {
  const s = { ...state }
  const b: Builder = { state: s, random }
  while (s.builtTo < s.cameraX + s.width + CHUNK) buildChunk(b, s.builtTo)
  const behind = s.cameraX - DESPAWN_MARGIN
  s.ground = s.ground.filter((span) => span.x1 > behind - 200)
  s.platforms = s.platforms.filter((platform) => platform.x1 > behind)
  s.coins = s.coins.filter((coin) => coin.x > behind)
  return s
}

// ---- support under a point

const groundUnder = (state: RunState, x: number) => state.ground.some((span) => x >= span.x0 - FOOTING && x <= span.x1 + FOOTING)
/** The highest floor at x that is at or below `fromY`: ground or a platform. */
function floorAt(state: RunState, x: number, fromY: number): number | null {
  let best: number | null = groundUnder(state, x) && fromY <= groundY(state.height) + 0.5 ? groundY(state.height) : null
  for (const platform of state.platforms) {
    if (x >= platform.x0 - FOOTING && x <= platform.x1 + FOOTING && fromY <= platform.y + 0.5 && (best === null || platform.y < best)) best = platform.y
  }
  return best
}

// ---- the knight

function steer(knight: Knight, input: RunInput, dt: number): Knight {
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const top = RUN_SPEED * (knight.attack >= 0 && knight.grounded ? ATTACK_SLOWDOWN : 1)
  let vx = knight.vx
  if (direction) vx = Math.max(-top, Math.min(top, vx + direction * ACCELERATION * dt))
  else vx = Math.sign(vx) * Math.max(0, Math.abs(vx) - FRICTION * dt)
  const facing = knight.attack >= 0 || !direction ? knight.facing : (direction as 1 | -1)
  return { ...knight, vx, facing }
}

function jumped(knight: Knight, input: RunInput, dt: number, events: RunEvent[]): Knight {
  const buffer = input.jump ? BUFFER_SECONDS : Math.max(0, knight.buffer - dt)
  const coyote = knight.grounded ? COYOTE_SECONDS : Math.max(0, knight.coyote - dt)
  if (buffer > 0 && coyote > 0) {
    events.push({ type: 'jump', x: knight.x, y: knight.y })
    return { ...knight, vy: -JUMP_SPEED, grounded: false, coyote: 0, buffer: 0 }
  }
  // Letting go on the way up cuts the jump short.
  const vy = !input.jumpHeld && knight.vy < 0 ? knight.vy * JUMP_CUT ** (dt * 30) : knight.vy
  return { ...knight, vy, buffer, coyote }
}

function swung(knight: Knight, input: RunInput, dt: number, events: RunEvent[]): Knight {
  if (knight.attack >= 0) {
    const attack = knight.attack + dt
    return attack >= ATTACK_SECONDS ? { ...knight, attack: -1, struck: [] } : { ...knight, attack }
  }
  if (!input.attack) return knight
  events.push({ type: 'swing', x: knight.x, y: knight.y })
  return { ...knight, attack: 0, struck: [] }
}

/** Gravity, the floor and the left edge of the screen. */
function moved(state: RunState, knight: Knight, dt: number, events: RunEvent[]): Knight {
  const vy = knight.grounded ? 0 : Math.min(MAX_FALL, knight.vy + GRAVITY * dt)
  const x = Math.max(state.cameraX + LEFT_MARGIN, knight.x + knight.vx * dt)
  const y = knight.y + vy * dt
  if (knight.grounded) {
    const floor = floorAt(state, x, knight.y)
    if (floor !== null && Math.abs(floor - knight.y) < 1) return { ...knight, x, safeX: groundUnder(state, x) ? x : knight.safeX }
    return { ...knight, x, grounded: false, coyote: COYOTE_SECONDS }
  }
  // Landing: the floor he crossed on the way down, platforms included (one-way, from above).
  const floor = vy >= 0 ? floorAt(state, x, knight.y) : null
  if (floor !== null && y >= floor) {
    events.push({ type: 'land', x, y: floor })
    return { ...knight, x, y: floor, vy: 0, grounded: true }
  }
  return { ...knight, x, y, vy }
}

// ---- enemies

function wokenEnemy(state: RunState, enemy: Enemy): Enemy {
  if (enemy.awake || enemy.x > state.cameraX + state.width + WAKE_MARGIN) return enemy
  const toward = state.knight.x < enemy.x ? -1 : 1
  const speed = { slime: SLIME_SPEED, frog: 0, bat: BAT_SPEED, bird: BIRD_SPEED }[enemy.kind] * (1 + 0.25 * difficulty(state))
  return { ...enemy, awake: true, vx: enemy.kind === 'bird' ? -speed : toward * speed }
}

function stepEnemy(state: RunState, enemy: Enemy, dt: number): Enemy {
  const awake = wokenEnemy(state, enemy)
  if (!awake.awake) return awake
  const age = awake.age + dt
  const knight = state.knight
  const top = groundY(state.height)
  switch (awake.kind) {
    case 'slime': {
      // It turns round at the edge of its ground rather than walk into a pit.
      const ahead = awake.x + Math.sign(awake.vx) * ENEMY_RADIUS.slime
      const vx = groundUnder(state, ahead) ? awake.vx : -awake.vx
      return { ...awake, age, vx, x: awake.x + vx * dt }
    }
    case 'frog': {
      if (awake.vy !== 0 || awake.y < top - ENEMY_RADIUS.frog - 0.5) {
        const vy = awake.vy + GRAVITY * dt
        const y = awake.y + vy * dt
        const floorY = top - ENEMY_RADIUS.frog
        if (vy > 0 && y >= floorY && groundUnder(state, awake.x)) return { ...awake, age, x: awake.x + awake.vx * dt, y: floorY, vy: 0, vx: 0, hop: FROG_REST }
        return { ...awake, age, x: awake.x + awake.vx * dt, y, vy }
      }
      const hop = awake.hop - dt
      if (hop > 0 || Math.abs(knight.x - awake.x) > FROG_RANGE) return { ...awake, age, hop }
      return { ...awake, age, hop: FROG_REST, vy: -FROG_HOP_Y, vx: (knight.x < awake.x ? -1 : 1) * FROG_HOP_X }
    }
    case 'bat': {
      // It drifts in bobbing, then swoops down to his chest once it is close.
      const close = Math.abs(knight.x - awake.x) < BAT_SWOOP_RANGE
      const baseY = close ? awake.baseY + ((knight.y - 20) - awake.baseY) * Math.min(1, 2 * dt) : awake.baseY
      const vx = (knight.x < awake.x ? -1 : 1) * Math.abs(awake.vx)
      return { ...awake, age, baseY, vx, x: awake.x + vx * dt, y: baseY + Math.sin(age * 3.2) * BAT_BOB }
    }
    case 'bird':
      return { ...awake, age, x: awake.x + awake.vx * dt }
  }
}

const gone = (state: RunState, enemy: Enemy) => enemy.x < state.cameraX - DESPAWN_MARGIN || enemy.y > state.height + 30

// ---- contact

const touches = (knight: Knight, x: number, y: number, radius: number) =>
  x + radius > knight.x - BODY_HALF_WIDTH && x - radius < knight.x + BODY_HALF_WIDTH && y + radius > knight.y - BODY_HEIGHT && y - radius < knight.y

/** The blade: in front of him, from his knees to above his head. */
function inBlade(knight: Knight, enemy: Enemy): boolean {
  if (!swinging(knight)) return false
  const near = knight.x - knight.facing * 4
  const far = knight.x + knight.facing * ATTACK_REACH
  const [left, right] = near < far ? [near, far] : [far, near]
  const radius = ENEMY_RADIUS[enemy.kind]
  return enemy.x + radius > left && enemy.x - radius < right && enemy.y + radius > knight.y - BODY_HEIGHT - 8 && enemy.y - radius < knight.y - 4
}

const scored = (state: RunState, base: number) => base * chainMultiplier(state.chain + 1)
function counted(state: RunState, points: number, charge: number): RunState {
  const chain = state.chain + 1
  return {
    ...state, points: state.points + points, chain, chainLeft: CHAIN_SECONDS, charge: Math.min(CHARGE_MAX, state.charge + charge),
    stats: { ...state.stats, bestChain: Math.max(state.stats.bestChain, chain) },
  }
}

function hurt(state: RunState, type: 'hurt' | 'fall'): RunState {
  const { knight } = state
  const hearts = state.hearts - 1
  state.events.push({ type, x: knight.x, y: knight.y })
  const base = { ...state, hearts, chain: 0, chainLeft: 0, charge: Math.floor(state.charge / 2), phase: hearts <= 0 ? ('over' as const) : state.phase }
  if (type === 'fall') {
    // Back on the last ground he stood on, a little before the edge.
    const x = Math.max(state.cameraX + LEFT_MARGIN, knight.safeX - 10)
    return { ...base, knight: { ...knight, x, y: groundY(state.height), vx: 0, vy: 0, grounded: true, invulnerable: INVULNERABLE_SECONDS, attack: -1 } }
  }
  return { ...base, knight: { ...knight, vx: -knight.facing * KNOCKBACK_X, vy: -KNOCKBACK_Y, grounded: false, invulnerable: INVULNERABLE_SECONDS } }
}

/** Blade, stomp or a bump that hurts, for every enemy he touches. */
function fight(state: RunState): RunState {
  let s = state
  const survivors: Enemy[] = []
  for (const enemy of s.enemies) {
    const radius = ENEMY_RADIUS[enemy.kind]
    const knight = s.knight
    if (enemy.awake && inBlade(knight, enemy) && !knight.struck.includes(enemy.id)) {
      const points = scored(s, KILL_POINTS)
      s.events.push({ type: 'kill', x: enemy.x, y: enemy.y, kind: enemy.kind, points })
      s = counted({ ...s, knight: { ...knight, struck: [...knight.struck, enemy.id] }, stats: { ...s.stats, kills: s.stats.kills + 1 } }, points, 1)
      continue
    }
    if (!touches(knight, enemy.x, enemy.y, radius)) { survivors.push(enemy); continue }
    const fromAbove = knight.vy > STOMP_MIN_SPEED && knight.y - 4 < enemy.y
    if (fromAbove) {
      const points = scored(s, KILL_POINTS)
      s.events.push({ type: 'stomp', x: enemy.x, y: enemy.y, kind: enemy.kind, points })
      s = counted({ ...s, knight: { ...knight, vy: -STOMP_BOUNCE, grounded: false }, stats: { ...s.stats, kills: s.stats.kills + 1, stomps: s.stats.stomps + 1 } }, points, 1)
      continue
    }
    survivors.push(enemy)
    if (knight.invulnerable <= 0 && s.phase === 'playing') s = hurt(s, 'hurt')
  }
  return { ...s, enemies: survivors }
}

function collect(state: RunState): RunState {
  let s = state
  const left: Coin[] = []
  for (const coin of s.coins) {
    if (!touches(s.knight, coin.x, coin.y, COIN_RADIUS)) { left.push(coin); continue }
    const points = scored(s, COIN_POINTS)
    s.events.push({ type: 'coin', x: coin.x, y: coin.y, points })
    s = counted({ ...s, stats: { ...s.stats, coins: s.stats.coins + 1 } }, points, 0)
  }
  return { ...s, coins: left }
}

/** The lightning: every enemy on screen is gone, for double points. */
function special(state: RunState): RunState {
  const onScreen = state.enemies.filter((enemy) => enemy.x < state.cameraX + state.width + 8)
  const points = onScreen.length * KILL_POINTS * chainMultiplier(state.chain) * SPECIAL_FACTOR
  state.events.push({ type: 'special', x: state.knight.x, y: state.knight.y, points, cleared: onScreen.map(({ x, y, kind }) => ({ x, y, kind })) })
  return {
    ...state, charge: 0, points: state.points + points, enemies: state.enemies.filter((enemy) => !onScreen.includes(enemy)),
    stats: { ...state.stats, kills: state.stats.kills + onScreen.length },
  }
}

export function stepRun(state: RunState, input: RunInput, dt: number, random: () => number = Math.random): RunState {
  if (state.phase !== 'playing') return state
  const events: RunEvent[] = []
  let s: RunState = { ...state, events }
  let knight = steer(s.knight, input, dt)
  knight = jumped(knight, input, dt, events)
  knight = swung(knight, input, dt, events)
  knight = moved(s, { ...knight, invulnerable: Math.max(0, knight.invulnerable - dt) }, dt, events)
  const cameraX = Math.max(s.cameraX, knight.x - s.width * CAMERA_LEAD)
  s = { ...s, knight, cameraX, furthest: Math.max(s.furthest, knight.x - 40) }
  s = extendWorld(s, random)
  s = { ...s, enemies: s.enemies.map((enemy) => stepEnemy(s, enemy, dt)).filter((enemy) => !gone(s, enemy)) }
  if (input.special && specialReady(s)) s = special(s)
  s = fight(s)
  s = collect(s)
  if (s.phase === 'playing' && s.knight.y > s.height + 24) s = hurt(s, 'fall')
  const chainLeft = Math.max(0, s.chainLeft - dt)
  return { ...s, chainLeft, chain: chainLeft > 0 ? s.chain : 0, events }
}

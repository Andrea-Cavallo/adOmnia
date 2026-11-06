/**
 * Rules of the Hub mini game, without any drawing: a side scroller. The knight runs right through
 * an endless world, jumps pits and onto platforms, slashes or stomps critters, picks up coins and
 * opens chests. Every 20 seconds a boss comes for him. Three hearts; a pit costs one and puts him
 * back on the last safe ground. The world gets harder the further he goes.
 */
import { blankEnemy, bossAt, gone, splitSlime, stepEnemy } from './hubRunEnemies'
import {
  ATTACK_REACH, ATTACK_SECONDS, BOSS_EVERY, BOSS_POINTS, CHAIN_SECONDS, CHARGE_MAX, COIN_POINTS, FOOTING, GRAVITY, HEART_CAP,
  INVULNERABLE_SECONDS, JUMP_SPEED, KILL_POINTS, MAX_HEARTS, PIT_MAX, PIT_MIN, RUN_SPEED, SHIELD_SECONDS, SPECIAL_FACTOR, WIDE_REACH, WIDE_SECONDS,
  bossOf, chainMultiplier, difficultyAt, enemyRadius, groundUnder, groundY, specialReady, swinging, tangible,
  type BossKind, type Chest, type Coin, type Enemy, type Knight, type Platform, type RunEvent, type RunInput, type RunPower, type RunState, type RunStats, type Span,
} from './hubRunModel'

export * from './hubRunModel'

/** Releasing jump early cuts the rise to this fraction: tap for a hop, hold for a leap. */
const JUMP_CUT = 0.45
const ACCELERATION = 900
const FRICTION = 1100
const MAX_FALL = 420
const COYOTE_SECONDS = 0.09
const BUFFER_SECONDS = 0.12
const ATTACK_SLOWDOWN = 0.5
const KNOCKBACK_X = 120
const KNOCKBACK_Y = 170
const BLOCK_SECONDS = 0.8
const STOMP_BOUNCE = 230
/** Below this fall speed a touch from above is a collision, not a stomp. */
const STOMP_MIN_SPEED = 40
/** The knight's body, from his feet. */
const BODY_HALF_WIDTH = 6
const BODY_HEIGHT = 38
const LEFT_MARGIN = 8
/** The camera keeps him at this fraction of the width: most of the screen is what comes. */
const CAMERA_LEAD = 0.38
const CHUNK = 150
const SAFE_START = 260
const PLATFORM_RISE_MIN = 30
const PLATFORM_RISE_MAX = 42
const COIN_RADIUS = 7
/** Coins this far apart read as separate coins; closer, their glow runs together. */
const COIN_SPACING = 16
const CHEST_HALF_WIDTH = 10
const CHEST_HEIGHT = 14
const CHEST_CHANCE = 0.07
const CHEST_FIRST = 700
const CHEST_GAP = 600
/** A struck boss shrugs off hits this long, so one swing takes one point of its life. */
const BOSS_HIT_GRACE = 0.35
const BOSS_KNOCK = 40

const noStats = (): RunStats => ({ kills: 0, stomps: 0, coins: 0, bestChain: 0, bosses: 0, chests: 0 })

const standingKnight = (height: number): Knight => ({
  x: 40, y: groundY(height), vx: 0, vy: 0, grounded: true, facing: 1, coyote: 0, buffer: 0, attack: -1, struck: [], invulnerable: 0, safeX: 40,
})

export function newRun(width: number, height: number, random: () => number = Math.random): RunState {
  return extendWorld({
    phase: 'idle', width, height, knight: standingKnight(height), cameraX: 0, ground: [{ x0: -200, x1: SAFE_START }], platforms: [], coins: [], chests: [], enemies: [],
    builtTo: SAFE_START, nextId: 1, hearts: MAX_HEARTS, points: 0, furthest: 0, chain: 0, chainLeft: 0, charge: 0, wide: 0, shield: 0, bossIn: BOSS_EVERY,
    stats: noStats(), events: [],
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
    ...state, width, height, knight: shift(state.knight), platforms: state.platforms.map(shift), coins: state.coins.map(shift), chests: state.chests.map(shift),
    enemies: state.enemies.map((enemy) => ({ ...shift(enemy), baseY: enemy.baseY + dy, targetY: enemy.targetY + dy })),
  }
}

// ---- the level

interface Builder { state: RunState; random: () => number }

function enemyAt(b: Builder, kind: Enemy['kind'], x: number, y: number, big = false): Enemy {
  return { ...blankEnemy(b.state.nextId++, kind, x, y), big, hop: 0.6 + b.random() }
}
const coinAt = (b: Builder, x: number, y: number): Coin => ({ id: b.state.nextId++, x, y })
const coinRow = (b: Builder, x0: number, count: number, y: number) => Array.from({ length: count }, (_, index) => coinAt(b, x0 + index * COIN_SPACING, y))

function groundEnemy(b: Builder, x: number, d: number): Enemy {
  const top = groundY(b.state.height)
  if (d > 0.3 && b.random() < 0.4) return enemyAt(b, 'frog', x, top - enemyRadius({ kind: 'frog', big: false, boss: false }))
  const big = d > 0.25 && b.random() < 0.35
  return enemyAt(b, 'slime', x, top - enemyRadius({ kind: 'slime', big, boss: false }), big)
}
function flyer(b: Builder, x: number, d: number): Enemy {
  const top = groundY(b.state.height)
  const roll = b.random()
  if (d > 0.4 && roll < 0.3) return enemyAt(b, 'ghost', x, top - 30 - b.random() * 10)
  if (d > 0.5 && roll < 0.65) return enemyAt(b, 'bird', x, top - 26)
  return enemyAt(b, 'bat', x, top - 44 - b.random() * 14)
}

function maybeChest(b: Builder, x: number): Chest[] {
  const s = b.state
  const last = s.chests.reduce((far, chest) => Math.max(far, chest.x), -Infinity)
  if (x < CHEST_FIRST || x - last < CHEST_GAP || b.random() >= CHEST_CHANCE) return []
  return [{ id: s.nextId++, x, y: groundY(s.height) }]
}

/** One stretch of world: flat, a pit, a platform or a flight of critters, harder with distance. */
function buildChunk(b: Builder, x0: number) {
  const s = b.state
  const d = difficultyAt(x0)
  const top = groundY(s.height)
  const roll = b.random()
  // While a boss is out the world keeps its other enemies back: the fight is the boss.
  const quiet = !!bossOf(s)
  const enemies: Enemy[] = []
  const coins: Coin[] = []
  const chests: Chest[] = []
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
    if (!quiet && d > 0.2 && b.random() < 0.5) enemies.push(groundEnemy(b, x0 + 120, d))
  } else if (roll < 0.75 && x0 > SAFE_START) {
    const count = quiet ? 0 : 1 + (b.random() < 0.3 + 0.3 * d ? 1 : 0) + (d > 1.5 && b.random() < 0.4 ? 1 : 0)
    for (let index = 0; index < count; index++) enemies.push(flyer(b, x0 + 40 + index * 60, d))
  } else {
    coins.push(...coinRow(b, x0 + 20, 3 + Math.floor(b.random() * 3), top - 14))
    chests.push(...maybeChest(b, x0 + 120))
    const count = x0 <= SAFE_START || quiet ? 0 : (b.random() < 0.55 + 0.2 * d ? 1 : 0) + (d > 0.6 && b.random() < 0.5 ? 1 : 0)
    for (let index = 0; index < count; index++) enemies.push(groundEnemy(b, x0 + 70 + index * 50, d))
  }
  s.ground = mergeGround([...s.ground, ...ground])
  s.platforms = [...s.platforms, ...platforms]
  s.coins = [...s.coins, ...coins]
  s.chests = [...s.chests, ...chests]
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
  const behind = s.cameraX - 48
  s.ground = s.ground.filter((span) => span.x1 > behind - 200)
  s.platforms = s.platforms.filter((platform) => platform.x1 > behind)
  s.coins = s.coins.filter((coin) => coin.x > behind)
  s.chests = s.chests.filter((chest) => chest.x > behind)
  return s
}

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

// ---- contact

const touches = (knight: Knight, x: number, y: number, radius: number) =>
  x + radius > knight.x - BODY_HALF_WIDTH && x - radius < knight.x + BODY_HALF_WIDTH && y + radius > knight.y - BODY_HEIGHT && y - radius < knight.y

export const bladeReach = (state: RunState) => (state.wide > 0 ? WIDE_REACH : ATTACK_REACH)

/** The blade: in front of him, from his knees to above his head (higher with the wide slash). */
function inBlade(state: RunState, enemy: Enemy): boolean {
  const { knight } = state
  if (!swinging(knight) || !tangible(enemy)) return false
  const wide = state.wide > 0
  const near = knight.x - knight.facing * (wide ? 14 : 4)
  const far = knight.x + knight.facing * bladeReach(state)
  const [left, right] = near < far ? [near, far] : [far, near]
  const radius = enemyRadius(enemy)
  return enemy.x + radius > left && enemy.x - radius < right && enemy.y + radius > knight.y - BODY_HEIGHT - (wide ? 20 : 8) && enemy.y - radius < knight.y - 4
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
  if (type === 'hurt' && state.shield > 0) {
    // The shield takes the hit and breaks: no heart lost, the chain goes on.
    state.events.push({ type: 'block', x: knight.x, y: knight.y })
    return { ...state, shield: 0, knight: { ...knight, vx: -knight.facing * KNOCKBACK_X * 0.5, invulnerable: BLOCK_SECONDS } }
  }
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

/** A chest ahead on solid ground: the prize for a boss. */
function dropChest(state: RunState): RunState {
  let x = state.cameraX + state.width * 0.62
  if (!groundUnder(state, x)) x = (state.ground.find((span) => span.x0 > x)?.x0 ?? x) + 16
  return { ...state, chests: [...state.chests, { id: state.nextId, x, y: groundY(state.height) }], nextId: state.nextId + 1 }
}

/** A boss loses a point of life per swing or stomp, and drops a chest when it falls. */
function hitBoss(state: RunState, boss: Enemy): { state: RunState; boss: Enemy | null } {
  const hp = boss.hp - 1
  const kind = boss.kind as BossKind
  if (hp > 0) {
    state.events.push({ type: 'bossHit', x: boss.x, y: boss.y, kind, hp })
    return { state: counted(state, scored(state, KILL_POINTS), 1), boss: { ...boss, hp, flash: BOSS_HIT_GRACE, y: boss.y - BOSS_KNOCK * 0.3, bossPhase: 'return', timer: 0 } }
  }
  const points = scored(state, BOSS_POINTS)
  state.events.push({ type: 'bossDown', x: boss.x, y: boss.y, kind, points })
  const won = counted({ ...state, bossIn: BOSS_EVERY, stats: { ...state.stats, kills: state.stats.kills + 1, bosses: state.stats.bosses + 1 } }, points, 3)
  return { state: dropChest(won), boss: null }
}

/** What a stomp or a blade does to one enemy: a boss loses life, a big slime splits, the rest fall. */
function strike(state: RunState, enemy: Enemy, type: 'kill' | 'stomp'): { state: RunState; left: Enemy[] } {
  if (enemy.boss) {
    const { state: next, boss } = hitBoss(state, enemy)
    return { state: next, left: boss ? [boss] : [] }
  }
  const points = scored(state, KILL_POINTS)
  state.events.push({ type, x: enemy.x, y: enemy.y, kind: enemy.kind, points })
  const stats = { ...state.stats, kills: state.stats.kills + 1, stomps: state.stats.stomps + (type === 'stomp' ? 1 : 0) }
  const next = counted({ ...state, stats }, points, 1)
  if (!enemy.big) return { state: next, left: [] }
  state.events.push({ type: 'split', x: enemy.x, y: enemy.y })
  return { state: { ...next, nextId: next.nextId + 2 }, left: splitSlime(enemy, next.nextId, state.height) }
}

/** Blade, stomp or a bump that hurts, for every enemy he touches. */
function fight(state: RunState): RunState {
  let s = state
  const survivors: Enemy[] = []
  for (const enemy of s.enemies) {
    const knight = s.knight
    const bladeHits = enemy.awake && inBlade(s, enemy) && !knight.struck.includes(enemy.id) && enemy.flash <= 0
    if (bladeHits) {
      const result = strike({ ...s, knight: { ...knight, struck: [...knight.struck, enemy.id] } }, enemy, 'kill')
      s = result.state
      survivors.push(...result.left)
      continue
    }
    if (!tangible(enemy) || !touches(knight, enemy.x, enemy.y, enemyRadius(enemy))) { survivors.push(enemy); continue }
    const fromAbove = knight.vy > STOMP_MIN_SPEED && knight.y - 4 < enemy.y
    if (fromAbove && enemy.flash <= 0) {
      const result = strike({ ...s, knight: { ...knight, vy: -STOMP_BOUNCE, grounded: false } }, enemy, 'stomp')
      s = result.state
      survivors.push(...result.left)
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

/** Which power a chest holds: never a heart he could not keep. */
function powerFor(state: RunState, random: () => number): RunPower {
  const powers: RunPower[] = state.hearts < HEART_CAP ? ['heart', 'wide', 'shield'] : ['wide', 'shield']
  return powers[Math.floor(random() * powers.length) % powers.length]
}

function withPower(state: RunState, power: RunPower): RunState {
  if (power === 'heart') return { ...state, hearts: Math.min(HEART_CAP, state.hearts + 1) }
  if (power === 'wide') return { ...state, wide: WIDE_SECONDS }
  return { ...state, shield: SHIELD_SECONDS }
}

function openChests(state: RunState, random: () => number): RunState {
  let s = state
  const left: Chest[] = []
  for (const chest of s.chests) {
    if (!touches(s.knight, chest.x, chest.y - CHEST_HEIGHT / 2, CHEST_HALF_WIDTH)) { left.push(chest); continue }
    const power = powerFor(s, random)
    s.events.push({ type: 'chest', x: chest.x, y: chest.y, power })
    s = withPower({ ...s, stats: { ...s.stats, chests: s.stats.chests + 1 } }, power)
  }
  return { ...s, chests: left }
}

/** The lightning: every enemy on screen is gone for double points; a boss loses one point of life. */
function special(state: RunState): RunState {
  const onScreen = state.enemies.filter((enemy) => enemy.x < state.cameraX + state.width + 8 && !enemy.boss)
  const points = onScreen.length * KILL_POINTS * chainMultiplier(state.chain) * SPECIAL_FACTOR
  state.events.push({ type: 'special', x: state.knight.x, y: state.knight.y, points, cleared: onScreen.map(({ x, y, kind }) => ({ x, y, kind })) })
  let s: RunState = {
    ...state, charge: 0, points: state.points + points, enemies: state.enemies.filter((enemy) => !onScreen.includes(enemy)),
    stats: { ...state.stats, kills: state.stats.kills + onScreen.length },
  }
  const boss = bossOf(s)
  if (boss && boss.flash <= 0) {
    const { state: next, boss: after } = hitBoss(s, boss)
    s = { ...next, enemies: next.enemies.filter((enemy) => !enemy.boss).concat(after ? [after] : []) }
  }
  return s
}

/** Counts down to the next boss while none is out, and sends it in from the right. */
function scheduleBoss(state: RunState, dt: number): RunState {
  if (bossOf(state)) return state
  const bossIn = state.bossIn - dt
  if (bossIn > 0) return { ...state, bossIn }
  const kind: BossKind = state.stats.bosses % 2 === 0 ? 'skull' : 'ghost'
  const boss = bossAt(state.nextId, kind, state.cameraX + state.width + 30, groundY(state.height) - 62)
  state.events.push({ type: 'boss', x: boss.x, y: boss.y, kind })
  return { ...state, bossIn: BOSS_EVERY, enemies: [...state.enemies, boss], nextId: state.nextId + 1 }
}

export function stepRun(state: RunState, input: RunInput, dt: number, random: () => number = Math.random): RunState {
  if (state.phase !== 'playing') return state
  const events: RunEvent[] = []
  let s: RunState = { ...state, events, wide: Math.max(0, state.wide - dt), shield: Math.max(0, state.shield - dt) }
  let knight = steer(s.knight, input, dt)
  knight = jumped(knight, input, dt, events)
  knight = swung(knight, input, dt, events)
  knight = moved(s, { ...knight, invulnerable: Math.max(0, knight.invulnerable - dt) }, dt, events)
  const cameraX = Math.max(s.cameraX, knight.x - s.width * CAMERA_LEAD)
  s = { ...s, knight, cameraX, furthest: Math.max(s.furthest, knight.x - 40) }
  s = extendWorld(s, random)
  s = scheduleBoss(s, dt)
  s = { ...s, enemies: s.enemies.map((enemy) => stepEnemy(s, enemy, dt)).filter((enemy) => !gone(s, enemy)) }
  if (input.special && specialReady(s)) s = special(s)
  s = fight(s)
  s = collect(s)
  s = openChests(s, random)
  if (s.phase === 'playing' && s.knight.y > s.height + 24) s = hurt(s, 'fall')
  const chainLeft = Math.max(0, s.chainLeft - dt)
  return { ...s, chainLeft, chain: chainLeft > 0 ? s.chain : 0, events }
}


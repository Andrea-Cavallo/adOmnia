import { stepCorpses } from './hubRunCorpses'
import { thrownWeapon } from './hubRunThrow'
import { WEAPONS, ARMOR, armorTier, equippedWeapon, bonusDamage, projectileHit } from './hubRunEquipment'
/**
 * Rules of the Hub mini game, without any drawing: a side scroller. The knight runs right through
 * an endless world, jumps pits and onto platforms, slashes or stomps critters, picks up coins and
 * opens chests. Every 20 seconds a boss comes for him. Three hearts; a pit costs one and puts him
 * back on the last safe ground. The world gets harder the further he goes.
 */
import { blankEnemy, bossAt, gone, splitSlime, stepEnemy } from './hubRunEnemies'
import { deathSeconds } from './hubEnemyAnim'
import { stepDebris } from './hubRunDebris'
import { guardAfterHit, shieldStops } from './hubRunShield'
import { levelElevationAt } from './hubRunLevel'
import {
  ATTACK_REACH, ATTACK_SECONDS, BOSS_EVERY, BOSS_POINTS, CHAIN_SECONDS, CHARGE_MAX, COIN_POINTS, FOOTING, GRAVITY, HEART_CAP,
  INVULNERABLE_SECONDS, JUMP_SPEED, KILL_POINTS, MAX_HEARTS, PIT_MAX, PIT_MIN, RUN_SPEED, SHIELD_SECONDS, SPECIAL_FACTOR, WIDE_REACH, WIDE_SECONDS,
  bossHp, bossOf, chainMultiplier, difficultyAt, enemyRadius, groundHeightAt, groundUnder, groundY, knightBodyHeight, specialReady, swinging, tangible,
  type BossKind, type Chest, type Coin, type Enemy, type EnemyKind, type Knight, type Platform, type RunEvent, type RunInput, type RunPower, type RunState, type RunStats, type Span,
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
const CHEST_CHANCE = 0.04
const CHEST_FIRST = 700
const CHEST_GAP = 600
/** A struck boss shrugs off hits this long, so one swing takes one point of its life. */
const BOSS_HIT_GRACE = 0.35
/** The Guardian shrugs off hits longer: about 10 s of fight and several attacks, not a 5 s melt. */
const WARDEN_HIT_GRACE = 0.7
const BOSS_KNOCK = 40

const noStats = (): RunStats => ({ kills: 0, stomps: 0, coins: 0, bestChain: 0, bosses: 0, chests: 0 })

const standingKnight = (height: number): Knight => ({
  x: 40, y: groundY(height), vx: 0, vy: 0, grounded: true, facing: 1, coyote: 0, buffer: 0, attack: -1, struck: [], invulnerable: 0, safeX: 40,
})

export function newRun(width: number, height: number, random: () => number = Math.random): RunState {
  return extendWorld({
    phase: 'idle', width, height, knight: standingKnight(height), cameraX: 0, ground: [{ x0: -200, x1: SAFE_START }], platforms: [], coins: [], chests: [], enemies: [], swords: [], swordCooldown: 0,
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
    ...state, width, height, knight: shift(state.knight), ground: state.ground.map((span) => ({ ...span, y0: span.y0 === undefined ? undefined : span.y0 + dy, y1: span.y1 === undefined ? undefined : span.y1 + dy })), platforms: state.platforms.map(shift), coins: state.coins.map(shift), chests: state.chests.map(shift),
    enemies: state.enemies.map((enemy) => ({ ...shift(enemy), baseY: enemy.baseY + dy, targetY: enemy.targetY + dy })), swords: state.swords.map(shift),
    debris: state.debris?.map((piece) => ({ ...piece, y: piece.y + dy, floor: piece.floor + dy })),
    corpses: state.corpses?.map(shift),
    escapes: state.escapes?.map((actor) => ({ ...actor, y: actor.y + dy })),
  }
}

// ---- the level

interface Builder { state: RunState; random: () => number }

function enemyAt(b: Builder, kind: Enemy['kind'], x: number, y: number, big = false): Enemy {
  return { ...blankEnemy(b.state.nextId++, kind, x, y), big, hop: 0.6 + b.random() }
}
const coinAt = (b: Builder, x: number, y: number): Coin => ({ id: b.state.nextId++, x, y })
const coinRow = (b: Builder, x0: number, count: number, y: number) => Array.from({ length: count }, (_, index) => coinAt(b, x0 + index * COIN_SPACING, y))

function groundEnemy(b: Builder, x: number): Enemy {
  const top = groundY(b.state.height) + levelElevationAt(x)
  return enemyAt(b, 'zombie', x, top - 16, false)
}
/** Ghost and reaper share one hooded look: never two of them in the strip at once. */
const GHOSTLY: ReadonlySet<EnemyKind> = new Set(['ghost', 'reaper'])
export const hasGhostly = (enemies: readonly Enemy[]) => enemies.some((enemy) => GHOSTLY.has(enemy.kind))

function flyer(b: Builder, x: number, d: number, ghostFree: boolean): Enemy {
  const top = groundY(b.state.height) + levelElevationAt(x)
  const roll = b.random()
  if (ghostFree && d > 0.4 && roll < 0.3) return enemyAt(b, 'ghost', x, top - 30 - b.random() * 10)
  if (d > 0.5 && roll < 0.65) return enemyAt(b, 'bird', x, top - 26)
  return enemyAt(b, 'bat', x, top - 44 - b.random() * 14)
}

function maybeChest(b: Builder, x: number): Chest[] {
  const s = b.state
  const last = s.chests.reduce((far, chest) => Math.max(far, chest.x), -Infinity)
  if (x < CHEST_FIRST || x - last < CHEST_GAP || b.random() >= CHEST_CHANCE) return []
  return [{ id: s.nextId++, x, y: groundY(s.height) + levelElevationAt(x) }]
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
    const y = top + levelElevationAt(px) - PLATFORM_RISE_MIN - b.random() * (PLATFORM_RISE_MAX - PLATFORM_RISE_MIN)
    platforms.push({ x0: px, x1: px + 52, y })
    coins.push(...coinRow(b, px + 4, 3, y - 12))
    if (!quiet && d > 0.2 && b.random() < 0.5) enemies.push(groundEnemy(b, x0 + 120))
  } else if (roll < 0.75 && x0 > SAFE_START) {
    const count = quiet ? 0 : 1 + (b.random() < 0.3 + 0.3 * d ? 1 : 0) + (d > 1.5 && b.random() < 0.4 ? 1 : 0)
    for (let index = 0; index < count; index++) enemies.push(flyer(b, x0 + 40 + index * 60, d, !hasGhostly([...s.enemies, ...enemies])))
  } else {
    coins.push(...coinRow(b, x0 + 20, 3 + Math.floor(b.random() * 3), top - 14))
    chests.push(...maybeChest(b, x0 + 120))
    const count = x0 <= SAFE_START || quiet ? 0 : (b.random() < 0.55 + 0.2 * d ? 1 : 0) + (d > 0.6 && b.random() < 0.5 ? 1 : 0)
    for (let index = 0; index < count; index++) enemies.push(groundEnemy(b, x0 + 70 + index * 50))
  }
  if (!quiet && x0 === SAFE_START) {
    const x = x0 + 100
    enemies.push(enemyAt(b, 'zombie', x, top + levelElevationAt(x) - enemyRadius({ kind: 'zombie', big: false, boss: false })))
  }
  if (!quiet && x0 > SAFE_START && b.random() < 0.7) {
    const wanderer = wandererAt(b, x0 + 105, d, [...s.enemies, ...enemies])
    if (wanderer) enemies.push(wanderer)
  }
  if (platforms.length === 0) for (const coin of coins) coin.y += levelElevationAt(coin.x)
  const shaped = ground.map((span) => ({ ...span, y0: top + levelElevationAt(span.x0), y1: top + levelElevationAt(span.x1) }))
  s.ground = mergeGround([...s.ground, ...shaped])
  s.platforms = [...s.platforms, ...platforms]
  s.coins = [...s.coins, ...coins]
  s.chests = [...s.chests, ...chests]
  s.enemies = enemies.reduce((placed, enemy) => (validSpawn(s, placed, enemy) ? [...placed, enemy] : placed), s.enemies)
  s.builtTo = x0 + CHUNK
}

/** Who roams each stretch, with its weight: the undead come in once he is some way in. */
const WANDERERS: ReadonlyArray<readonly [EnemyKind, number, number]> = [
  ['zombie', 4, 0], ['bat', 2, 0], ['ghost', 1.5, 0.4], ['reaper', 1.5, 0.6], ['bird', 1, 0.5],
]

/**
 * One roaming enemy per stretch, drawn by weight so the cast keeps changing: never the same kind
 * as the last one sent, and never a second ghost or reaper while one is still about.
 */
function wandererAt(b: Builder, x: number, d: number, around: readonly Enemy[]): Enemy | null {
  const roamers = around.filter((enemy) => !enemy.boss)
  const last = roamers[roamers.length - 1]?.kind
  const ghostly = hasGhostly(around)
  const pool = WANDERERS.filter(([kind, , from]) => d >= from && kind !== last && !(ghostly && GHOSTLY.has(kind)))
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = b.random() * total
  const kind = pool.find(([, weight]) => (roll -= weight) < 0)?.[0]
  const top = groundY(b.state.height) + levelElevationAt(x)
  switch (kind) {
    case undefined: return null
    case 'slime': {
      const big = d > 0.25 && b.random() < 0.35
      return enemyAt(b, 'slime', x, top - enemyRadius({ kind, big, boss: false }), big)
    }
    case 'bat': case 'bird': case 'ghost': return enemyAt(b, kind, x, kind === 'bat' ? top - 44 : top - 28)
    case 'reaper': return enemyAt(b, 'reaper', x, top - 30)
    default: return enemyAt(b, kind, x, top - enemyRadius({ kind, big: false, boss: false }))
  }
}

const WALKERS: ReadonlySet<EnemyKind> = new Set(['slime', 'frog', 'zombie'])
/** Two spawns closer than this read as one blob and hit as one. */
const SPAWN_GAP = 30

/**
 * A spawn is dropped, not moved, when it would be unfair or broken: a walker needs ground under its
 * whole body (never born over a pit), a flyer must clear the ground, and no two enemies share a spot.
 */
function validSpawn(state: RunState, placed: readonly Enemy[], enemy: Enemy): boolean {
  const radius = enemyRadius(enemy)
  if (placed.some((other) => !other.boss && Math.abs(other.x - enemy.x) < SPAWN_GAP && Math.abs(other.y - enemy.y) < SPAWN_GAP)) return false
  if (WALKERS.has(enemy.kind)) return [enemy.x - radius, enemy.x, enemy.x + radius].every((x) => groundHeightAt(state, x, 0) !== null)
  const floor = groundHeightAt(state, enemy.x, 0)
  return floor === null || enemy.y + radius <= floor - 2
}

/** Adjacent spans become one, so a slime walks on and a pit is just the gap between two spans. */
function mergeGround(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.x0 - b.x0)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out[out.length - 1]
    if (last && last.y0 === undefined && span.y0 === undefined && span.x0 <= last.x1 + 0.5) out[out.length - 1] = { x0: last.x0, x1: Math.max(last.x1, span.x1) }
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
  const ground = groundHeightAt(state, x)
  let best: number | null = ground !== null && fromY <= ground + 0.5 ? ground : null
  for (const platform of state.platforms) {
    if (x >= platform.x0 - FOOTING && x <= platform.x1 + FOOTING && fromY <= platform.y + 0.5 && (best === null || platform.y < best)) best = platform.y
  }
  return best
}

// ---- the knight

function steer(knight: Knight, input: RunInput, dt: number, multiplier = 1): Knight {
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const crouching = !!input.crouch && knight.grounded && !input.jump
  const top = RUN_SPEED * multiplier * (crouching ? 0.35 : knight.attack >= 0 && knight.grounded ? ATTACK_SLOWDOWN : 1)
  let vx = knight.vx
  if (direction) vx = Math.max(-top, Math.min(top, vx + direction * ACCELERATION * dt))
  else vx = Math.sign(vx) * Math.max(0, Math.abs(vx) - FRICTION * dt)
  const facing = knight.attack >= 0 || !direction ? knight.facing : (direction as 1 | -1)
  return { ...knight, vx, facing, crouching }
}

function jumped(knight: Knight, input: RunInput, dt: number, events: RunEvent[]): Knight {
  const buffer = input.jump ? BUFFER_SECONDS : Math.max(0, knight.buffer - dt)
  const coyote = knight.grounded ? COYOTE_SECONDS : Math.max(0, knight.coyote - dt)
  if (buffer > 0 && coyote > 0) {
    events.push({ type: 'jump', x: knight.x, y: knight.y })
    return { ...knight, vy: -JUMP_SPEED, grounded: false, crouching: false, coyote: 0, buffer: 0 }
  }
  // Letting go on the way up cuts the jump short.
  const vy = !input.jumpHeld && knight.vy < 0 ? knight.vy * JUMP_CUT ** (dt * 30) : knight.vy
  return { ...knight, vy, buffer, coyote }
}

function swung(knight: Knight, input: RunInput, dt: number, events: RunEvent[], weapon = 'sword' as ReturnType<typeof equippedWeapon>): Knight {
  if (knight.attack >= 0) {
    const attack = knight.attack + dt
    return attack >= (knight.attackWeapon === 'hammer' ? 0.7 : knight.attackWeapon === 'daggers' ? 0.18 : ATTACK_SECONDS) ? { ...knight, attack: -1, struck: [] } : { ...knight, attack }
  }
  if (!input.attack && !(weapon === 'hammer' && input.throwSword)) return knight
  events.push({ type: 'swing', x: knight.x, y: knight.y })
  return { ...knight, attack: 0, attackWeapon: weapon, struck: [] }
}

/** Gravity, the floor and the left edge of the screen. */
function moved(state: RunState, start: Knight, dt: number, events: RunEvent[]): Knight {
  const vy = start.grounded ? 0 : Math.min(MAX_FALL, start.vy + GRAVITY * dt)
  const y = start.y + vy * dt
  const wanted = Math.max(state.cameraX + LEFT_MARGIN, start.x + start.vx * dt)
  // The side of a pit or a higher step is a wall: below its surface he cannot walk or fall into it.
  const wall = groundHeightAt(state, wanted + Math.sign(start.vx) * BODY_HALF_WIDTH, 0)
  const blocked = wall !== null && Math.min(start.y, y) > wall + 6
  const x = blocked ? start.x : wanted
  const knight = blocked ? { ...start, vx: 0 } : start
  if (knight.grounded) {
    const floor = floorAt(state, x, knight.y - 6)
    if (floor !== null && Math.abs(floor - knight.y) <= 6) return { ...knight, x, y: floor, safeX: groundUnder(state, x) ? x : knight.safeX }
    return { ...knight, x, grounded: false, crouching: false, coyote: COYOTE_SECONDS }
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
  x + radius > knight.x - BODY_HALF_WIDTH && x - radius < knight.x + BODY_HALF_WIDTH && y + radius > knight.y - knightBodyHeight(knight) && y - radius < knight.y

export const bladeReach = (state: RunState) => equippedWeapon(state) === 'hammer' ? WEAPONS.hammer.reach : equippedWeapon(state) === 'daggers' ? WEAPONS.daggers.reach : equippedWeapon(state) === 'lance' ? WEAPONS.lance.reach : state.wide > 0 ? WIDE_REACH : ATTACK_REACH

/** The blade: in front of him, from his knees to above his head (higher with the wide slash). */
function inBlade(state: RunState, enemy: Enemy): boolean {
  const { knight } = state
  if (!swinging(knight) || !tangible(enemy)) return false
  const wide = state.wide > 0
  const near = knight.x - knight.facing * (wide ? 14 : 4)
  const far = knight.x + knight.facing * bladeReach(state)
  const [left, right] = near < far ? [near, far] : [far, near]
  const radius = enemyRadius(enemy)
  return enemy.x + radius > left && enemy.x - radius < right && enemy.y + radius > knight.y - knightBodyHeight(knight) - (wide ? 20 : 8) && enemy.y - radius < knight.y - 4
}

const scored = (state: RunState, base: number) => base * chainMultiplier(state.chain + 1)
function counted(state: RunState, points: number, charge: number): RunState {
  const chain = state.chain + 1
  return {
    ...state, points: state.points + points, chain, chainLeft: CHAIN_SECONDS, charge: Math.min(CHARGE_MAX, state.charge + charge),
    stats: { ...state.stats, bestChain: Math.max(state.stats.bestChain, chain) },
  }
}

export function damageKnight(state: RunState): RunState {
  return state.knight.invulnerable > 0 || state.phase !== 'playing' ? state : hurt(state, 'hurt')
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
    const back = Math.max(state.cameraX + LEFT_MARGIN, knight.safeX - 10)
    const x = groundHeightAt(state, back, 0) === null ? knight.safeX : back
    return { ...base, knight: { ...knight, x, y: groundHeightAt(state, x) ?? groundY(state.height), vx: 0, vy: 0, grounded: true, invulnerable: INVULNERABLE_SECONDS, attack: -1 } }
  }
  return { ...base, knight: { ...knight, vx: -knight.facing * KNOCKBACK_X, vy: -KNOCKBACK_Y, grounded: false, invulnerable: INVULNERABLE_SECONDS } }
}

/** A chest ahead on solid ground: the prize for a boss. */
function dropChest(state: RunState): RunState {
  let x = state.cameraX + state.width * 0.62
  if (!groundUnder(state, x)) x = (state.ground.find((span) => span.x0 > x)?.x0 ?? x) + 16
  return { ...state, chests: [...state.chests, { id: state.nextId, x, y: groundHeightAt(state, x, 0) ?? groundY(state.height) }], nextId: state.nextId + 1 }
}

/** A boss loses a point of life per swing or stomp, and drops a chest when it falls. */
function hitBoss(state: RunState, boss: Enemy, damage = 1): { state: RunState; boss: Enemy | null } {
  const hp = boss.hp - damage
  const kind = boss.kind as BossKind
  if (hp > 0) {
    state.events.push({ type: 'bossHit', x: boss.x, y: boss.y, kind, hp })
    // The Guardian walks: a hit must not reset its attack clock, or spamming throws stun-locks it forever.
    const reeled = kind === 'warden' ? { ...boss, hp, flash: WARDEN_HIT_GRACE } : { ...boss, hp, flash: BOSS_HIT_GRACE, y: boss.y - BOSS_KNOCK * 0.3, bossPhase: 'return' as const, timer: 0 }
    return { state: counted(state, scored(state, KILL_POINTS), 1), boss: reeled }
  }
  const points = scored(state, BOSS_POINTS)
  state.events.push({ type: 'bossDown', x: boss.x, y: boss.y, kind, points })
  const won = counted({ ...state, bossIn: BOSS_EVERY, stats: { ...state.stats, kills: state.stats.kills + 1, bosses: state.stats.bosses + 1 } }, points, 3)
  return { state: state.stage ? won : dropChest(won), boss: null }
}

/**
 * What a stomp or a blade does to one enemy: a boss loses life, a big slime splits, the rest fall.
 * A killed enemy is not deleted at once: it keeps a `dying` timer so its death animation can play.
 */
function strike(state: RunState, enemy: Enemy, type: 'kill' | 'stomp', damage = 1): { state: RunState; left: Enemy[] } {
  if (enemy.boss) {
    const { state: next, boss } = hitBoss(state, enemy, damage)
    return { state: next, left: boss ? [boss] : [] }
  }
  if (enemy.hp > damage) {
    const loose = enemy.kind === 'zombie' && !enemy.armLost
    let next = state
    if (loose) {
      state.events.push({ type: 'armLost', x: enemy.x, y: enemy.y })
      const floor = groundHeightAt(state, enemy.x) ?? enemy.y + enemyRadius(enemy)
      next = { ...state, nextId: state.nextId + 1, debris: [...(state.debris ?? []), { id: state.nextId, kind: 'arm', x: enemy.x, y: enemy.y - 4, vx: state.knight.facing * 85, vy: -95, angle: 0, spin: 8, life: 2, bounces: 0, floor, size: 8 }] }
    }
    return { state: next, left: [{ ...enemy, hp: enemy.hp - damage, flash: 0.2, guardOpen: 0, x: enemy.x + state.knight.facing * 5, vx: enemy.kind === 'zombie' ? state.knight.facing * 150 : enemy.vx, vy: enemy.kind === 'zombie' ? -45 : enemy.vy, knockTime: enemy.kind === 'zombie' ? 0.32 : 0, bumped: false, armLost: loose || enemy.armLost, armRecover: loose ? 1.6 : enemy.armRecover, armX: loose ? enemy.x + state.knight.facing * 40 : enemy.armX }] }
  }
  const points = scored(state, KILL_POINTS)
  state.events.push({ type, x: enemy.x, y: enemy.y, kind: enemy.kind, points })
  const stats = { ...state.stats, kills: state.stats.kills + 1, stomps: state.stats.stomps + (type === 'stomp' ? 1 : 0) }
  const next = counted({ ...state, stats }, points, 1)
  const hammer = equippedWeapon(state) === 'hammer' && type === 'kill'
  const dying = hammer ? Math.max(1.1, deathSeconds(enemy.kind)) : deathSeconds(enemy.kind)
  const corpse: Enemy = { ...enemy, hp: 0, dying, dyingFor: dying, flash: 0, vx: hammer ? state.knight.facing * 115 : 0, vy: hammer ? -145 : 0 }
  const withCorpse = { ...next, corpses: [...(next.corpses ?? []), corpse] }
  if (!enemy.big) return { state: withCorpse, left: [] }
  state.events.push({ type: 'split', x: enemy.x, y: enemy.y })
  const halves = splitSlime(enemy, next.nextId, state.height).map((half) => ({ ...half, y: (groundHeightAt(state, half.x) ?? groundY(state.height)) - enemyRadius(half) - 4 }))
  return { state: { ...withCorpse, nextId: next.nextId + 2 }, left: halves }
}

export function damageEnemy(state: RunState, id: number, damage: number): RunState {
  const enemy = state.enemies.find(e => e.id === id)
  if (!enemy || enemy.hp <= 0) return state
  const hit = strike(state, enemy, 'kill', damage)
  return { ...hit.state, enemies: hit.state.enemies.filter(e => e.id !== id).concat(hit.left) }
}

function bumpEnemies(state: RunState): RunState {
  let next = state
  for (const source of state.enemies) {
    if ((source.knockTime ?? 0) <= 0 || source.bumped || source.hp <= 0) continue
    const target = next.enemies.find(e => e.id !== source.id && !e.boss && tangible(e) && Math.abs(e.x - source.x) < enemyRadius(e) + enemyRadius(source) + 4 && Math.abs(e.y - source.y) < 24)
    if (!target) continue
    next = { ...next, enemies: next.enemies.map(e => e.id === source.id ? { ...e, bumped: true } : e) }
    next = damageEnemy(next, target.id, 1)
    next = damageEnemy(next, source.id, 1)
  }
  return next
}

/** A shielded holder that blocks a hit: the guard loses a point and the hit does not land. */
function shieldBlocked(state: RunState, enemy: Enemy, weapon = 'sword'): { enemy: Enemy; broke: boolean } {
  const hit = guardAfterHit(enemy, weapon)
  state.events.push({ type: hit.broken ? 'shieldBreak' : 'shieldBlock', x: enemy.x, y: enemy.y, guard: hit.guard })
  return {
    enemy: { ...enemy, guard: hit.guard, guardOpen: hit.broken ? 0 : hit.stagger, flash: 0.18 },
    broke: hit.broken,
  }
}

/** Sweep the full distance traveled this tick: a quick sword cannot skip a narrow enemy. */
function flyingSwords(state: RunState, dt: number): RunState {
  let next = state
  const swords: RunState['swords'] = []
  for (const sword of state.swords) {
    const flight = { ...sword, previousX: sword.x, previousY: sword.y, x: sword.x + sword.vx * dt, y: sword.y + (sword.vy ?? 0) * dt, life: sword.life - dt }
    if (flight.life <= 0 || flight.x < state.cameraX - 40 || flight.x > state.cameraX + state.width + 80) continue
    const hit = next.enemies.filter((enemy) => {
      const radius = enemyRadius(enemy)
      return enemy.awake && tangible(enemy) && enemy.flash <= 0 && projectileHit(flight, enemy.x, enemy.y, radius)
    }).sort((a, b) => Math.abs(a.x - flight.previousX) - Math.abs(b.x - flight.previousX))[0]
    if (!hit) { swords.push(flight); continue }
    // A shield only stops the hit it faces; a heavy lance can break it and still land.
    if (shieldStops(hit, flight.previousX, false)) {
      const result = shieldBlocked(next, hit, flight.weapon === 'lance' ? 'lance' : 'sword')
      next = { ...next, enemies: next.enemies.map((enemy) => (enemy.id === hit.id ? result.enemy : enemy)) }
      if (!result.broke) continue
    }
    const struck = strike(next, hit, 'kill', flight.damage ?? 1)
    next = { ...struck.state, enemies: struck.state.enemies.filter((enemy) => enemy.id !== hit.id).concat(struck.left) }
    if ((flight.pierces ?? 0) > 0 && !struck.left.length) swords.push({ ...flight, pierces: flight.pierces! - 1 })
  }
  return { ...next, swords }
}

/** Blade, stomp or a bump that hurts, for every enemy he touches. */
function fight(state: RunState): RunState {
  let s = state
  const survivors: Enemy[] = []
  for (const enemy of s.enemies) {
    const knight = s.knight
    const bladeHits = enemy.awake && inBlade(s, enemy) && !knight.struck.includes(enemy.id) && enemy.flash <= 0
    if (bladeHits) {
      const fromAbove = knight.y < enemy.y - 6
      s = { ...s, knight: { ...knight, struck: [...knight.struck, enemy.id] } }
      if (shieldStops(enemy, knight.x, fromAbove)) {
        const result = shieldBlocked(s, enemy, equippedWeapon(s))
        if (!result.broke) {
          survivors.push(result.enemy)
          continue
        }
        const struck = strike(s, result.enemy, 'kill', WEAPONS[equippedWeapon(s)].damage + bonusDamage(s))
        const born = struck.left.filter((left) => left.id !== enemy.id).map((left) => left.id)
        s = { ...struck.state, knight: { ...struck.state.knight, struck: [...struck.state.knight.struck, ...born] } }
        survivors.push(...struck.left)
        continue
      }
      const result = strike(s, enemy, 'kill', WEAPONS[equippedWeapon(s)].damage + bonusDamage(s))
      // The halves of a split slime are born inside the blade: this swing must not cut them too.
      const born = result.left.filter((left) => left.id !== enemy.id).map((left) => left.id)
      s = { ...result.state, knight: { ...result.state.knight, struck: [...result.state.knight.struck, ...born] } }
      survivors.push(...result.left)
      continue
    }
    if (!tangible(enemy) || !touches(knight, enemy.x, enemy.y, enemyRadius(enemy))) { survivors.push(enemy); continue }
    // A boss he has just struck is reeling back: the hit that landed must not cost him a heart too.
    // A charging Guardian still hurts: a hit does not stop its dive.
    if (enemy.boss && enemy.flash > 0 && !(enemy.kind === 'warden' && enemy.bossPhase === 'dive')) { survivors.push(enemy); continue }
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
  const onScreen = state.enemies.filter((enemy) => !enemy.boss && enemy.hp > 0 && enemy.x < state.cameraX + state.width + 8)
  const points = onScreen.length * KILL_POINTS * chainMultiplier(state.chain) * SPECIAL_FACTOR
  state.events.push({ type: 'special', x: state.knight.x, y: state.knight.y, points, cleared: onScreen.map(({ x, y, kind }) => ({ x, y, kind })) })
  let s: RunState = {
    ...state, charge: 0, points: state.points + points,
    enemies: state.enemies.filter((enemy) => !onScreen.includes(enemy)),
    corpses: [
      ...(state.corpses ?? []),
      ...onScreen.map((enemy) => ({ ...enemy, hp: 0, dying: deathSeconds(enemy.kind), dyingFor: deathSeconds(enemy.kind), flash: 0, vx: 0, vy: 0 })),
    ],
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
  const boss = bossAt(state.nextId, kind, state.cameraX + state.width + 30, groundY(state.height) - 62, bossHp(state.stats.bosses))
  state.events.push({ type: 'boss', x: boss.x, y: boss.y, kind })
  // The ghost boss is the only hooded one on screen: lesser ghosts and reapers fade as it comes.
  const enemies = kind === 'ghost' ? state.enemies.filter((enemy) => !GHOSTLY.has(enemy.kind)) : state.enemies
  return { ...state, bossIn: BOSS_EVERY, enemies: [...enemies, boss], nextId: state.nextId + 1 }
}

export function stepRun(state: RunState, input: RunInput, dt: number, random: () => number = Math.random): RunState {
  if (state.phase !== 'playing') return state
  const events: RunEvent[] = []
  let s: RunState = { ...state, events, wide: Math.max(0, state.wide - dt), shield: Math.max(0, state.shield - dt) }
  let knight = steer(s.knight, input, dt, s.stage?.armor ? ARMOR[armorTier(s)].speed : 1)
  knight = jumped(knight, input, dt, events)
  knight = swung(knight, input, dt, events, equippedWeapon(s))
  if (knight.attackWeapon === 'hammer' && s.knight.attack < 0.24 && knight.attack >= 0.24)
    events.push({ type: 'hammerImpact', x: knight.x + knight.facing * 23, y: knight.y })
  knight = moved(s, { ...knight, invulnerable: Math.max(0, knight.invulnerable - dt) }, dt, events)
  const cameraX = Math.max(s.cameraX, knight.x - s.width * CAMERA_LEAD)
  s = { ...s, knight, cameraX, furthest: Math.max(s.furthest, knight.x - 40) }
  s = extendWorld(s, random)
  s = scheduleBoss(s, dt)
  s = { ...s, enemies: s.enemies.map((enemy) => stepEnemy(s, enemy, dt)).filter((enemy) => !gone(s, enemy)) }
  s = bumpEnemies(s)
  s = thrownWeapon(s, input, dt)
  s = flyingSwords(s, dt)
  if (input.special && specialReady(s)) s = special(s)
  s = fight(s)
  s = collect(s)
  s = openChests(s, random)
  s = { ...s, debris: stepDebris(s.debris ?? [], dt) }
  // Corpses only play their death animation; they are never fought, and they leave when it ends.
  s = { ...s, corpses: stepCorpses(s, dt) }
  if (s.phase === 'playing' && s.knight.y > s.height + 24) s = hurt(s, 'fall')
  const chainLeft = Math.max(0, s.chainLeft - dt)
  return { ...s, chainLeft, chain: chainLeft > 0 ? s.chain : 0, events }
}


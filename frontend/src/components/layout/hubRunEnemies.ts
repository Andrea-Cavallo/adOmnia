/**
 * How each enemy of the Hub run moves, and the bosses. Every attack is announced: a frog crouches
 * before it leaps, a ghost flickers before it is solid again, a boss flashes before it dives.
 */
import {
  BOSS_HP, BOSS_WARN_SECONDS, GRAVITY, difficulty, enemyRadius, groundUnder, groundY,
  type BossKind, type BossPhase, type Enemy, type EnemyKind, type RunState,
} from './hubRunModel'

/** Enemies wake when they get this close to the right edge of the screen. */
const WAKE_MARGIN = 24
const DESPAWN_MARGIN = 48
const SPEEDS: Record<EnemyKind, number> = { slime: 22, frog: 0, bat: 34, bird: 85, ghost: 26, skull: 0 }
/** A frog crouches this long before it leaps: the tell. */
export const FROG_CROUCH = 0.35
const FROG_HOP_X = 72
const FROG_HOP_Y = 255
const FROG_REST = 1.2
const FROG_RANGE = 170
const BAT_BOB = 14
const BAT_SWOOP_RANGE = 80
const GHOST_BOB = 8
const SPLIT_HOP = 140
const SPLIT_SPEED = 46
/** Where a boss hovers: ahead of the knight, high in the strip. */
const BOSS_LEAD = 0.72
const BOSS_HEIGHT = 62
const BOSS_ENTER_SPEED = 120
const BOSS_RETURN_SPEED = 130
const BOSS_DIVE_SPEED: Record<BossKind, number> = { skull: 230, ghost: 190 }
const BOSS_HOVER_SECONDS: Record<BossKind, number> = { skull: 1.6, ghost: 2.2 }
const BOSS_DIVE_LIMIT = 1.3
const BOSS_BOB = 6
/** Every boss beaten makes the next one dive this much faster, up to BOSS_FURY_MAX. */
const BOSS_FURY = 0.1
const BOSS_FURY_MAX = 0.6

const diveSpeed = (state: RunState, kind: BossKind) =>
  BOSS_DIVE_SPEED[kind] * (1 + 0.1 * difficulty(state) + Math.min(BOSS_FURY_MAX, BOSS_FURY * state.stats.bosses))

export function blankEnemy(id: number, kind: EnemyKind, x: number, y: number): Enemy {
  return {
    id, kind, x, y, vx: 0, vy: 0, age: 0, awake: false, baseY: y, hop: FROG_REST, hp: 1, maxHp: 1, big: false,
    boss: false, bossPhase: 'enter', timer: 0, targetX: x, targetY: y, flash: 0,
  }
}

export function bossAt(id: number, kind: BossKind, x: number, y: number, hp = BOSS_HP): Enemy {
  return { ...blankEnemy(id, kind, x, y), awake: true, boss: true, hp, maxHp: hp, bossPhase: 'enter' }
}

/** The two small slimes a big one leaves, hopping away on both sides. */
export function splitSlime(enemy: Enemy, nextId: number, height: number): Enemy[] {
  const y = groundY(height) - enemyRadius({ kind: 'slime', big: false, boss: false })
  return [-1, 1].map((side, index) => ({
    ...blankEnemy(nextId + index, 'slime', enemy.x + side * 6, y - 4), awake: true, vx: side * SPLIT_SPEED, vy: -SPLIT_HOP,
  }))
}

function wokenEnemy(state: RunState, enemy: Enemy): Enemy {
  if (enemy.awake || enemy.x > state.cameraX + state.width + WAKE_MARGIN) return enemy
  const side = state.knight.x < enemy.x ? -1 : 1
  const speed = SPEEDS[enemy.kind] * (1 + 0.25 * difficulty(state))
  return { ...enemy, awake: true, vx: enemy.kind === 'bird' ? -speed : side * speed }
}

/** A slime walks, turns at the edge of its ground, and lands when it was sent hopping by a split. */
function slime(state: RunState, enemy: Enemy, dt: number): Enemy {
  const floor = groundY(state.height) - enemyRadius(enemy)
  if (enemy.vy !== 0 || enemy.y < floor - 0.5) {
    const vy = enemy.vy + GRAVITY * dt
    const y = enemy.y + vy * dt
    const x = enemy.x + enemy.vx * dt
    if (vy > 0 && y >= floor && groundUnder(state, x)) return { ...enemy, x, y: floor, vy: 0 }
    return { ...enemy, x, y, vy }
  }
  const ahead = enemy.x + Math.sign(enemy.vx) * enemyRadius(enemy)
  const vx = groundUnder(state, ahead) ? enemy.vx : -enemy.vx
  return { ...enemy, vx, x: enemy.x + vx * dt }
}

/** A frog waits, crouches for a moment when he is near, then leaps at him. */
function frog(state: RunState, enemy: Enemy, dt: number): Enemy {
  const floor = groundY(state.height) - enemyRadius(enemy)
  if (enemy.vy !== 0 || enemy.y < floor - 0.5) {
    const vy = enemy.vy + GRAVITY * dt
    const y = enemy.y + vy * dt
    const x = enemy.x + enemy.vx * dt
    if (vy > 0 && y >= floor && groundUnder(state, x)) return { ...enemy, x, y: floor, vy: 0, vx: 0, hop: FROG_REST }
    return { ...enemy, x, y, vy }
  }
  // Far from him it gets ready but holds just before the crouch, so the crouch always means a leap.
  const near = Math.abs(state.knight.x - enemy.x) <= FROG_RANGE
  const hop = near ? enemy.hop - dt : Math.max(FROG_CROUCH + 0.01, enemy.hop - dt)
  if (hop > 0) return { ...enemy, hop }
  return { ...enemy, hop: FROG_REST, vy: -FROG_HOP_Y, vx: (state.knight.x < enemy.x ? -1 : 1) * FROG_HOP_X }
}
export const frogCrouching = (enemy: Enemy) => enemy.kind === 'frog' && enemy.vy === 0 && enemy.hop > 0 && enemy.hop <= FROG_CROUCH

function bat(state: RunState, enemy: Enemy, dt: number): Enemy {
  // It drifts in bobbing, then swoops down to his chest once it is close.
  const { knight } = state
  const close = Math.abs(knight.x - enemy.x) < BAT_SWOOP_RANGE
  const baseY = close ? enemy.baseY + (knight.y - 20 - enemy.baseY) * Math.min(1, 2 * dt) : enemy.baseY
  const vx = (knight.x < enemy.x ? -1 : 1) * Math.abs(enemy.vx)
  return { ...enemy, baseY, vx, y: baseY + Math.sin(enemy.age * 3.2) * BAT_BOB }
}

function ghost(state: RunState, enemy: Enemy, dt: number): Enemy {
  // It drifts after him, at his height, whatever it is doing with its visibility.
  const { knight } = state
  const vx = (knight.x < enemy.x ? -1 : 1) * Math.abs(enemy.vx)
  const baseY = enemy.baseY + (knight.y - 22 - enemy.baseY) * Math.min(1, 0.6 * dt)
  return { ...enemy, vx, baseY, y: baseY + Math.sin(enemy.age * 2.4) * GHOST_BOB }
}

export function stepEnemy(state: RunState, enemy: Enemy, dt: number): Enemy {
  if (enemy.boss) return stepBoss(state, enemy, dt)
  const awake = wokenEnemy(state, enemy)
  if (!awake.awake) return awake
  const aged = { ...awake, age: awake.age + dt }
  switch (aged.kind) {
    case 'slime': return slime(state, aged, dt)
    case 'frog': return frog(state, aged, dt)
    case 'bat': { const next = bat(state, aged, dt); return { ...next, x: next.x + next.vx * dt } }
    case 'ghost': { const next = ghost(state, aged, dt); return { ...next, x: next.x + next.vx * dt } }
    default: return { ...aged, x: aged.x + aged.vx * dt }
  }
}

export const gone = (state: RunState, enemy: Enemy) => !enemy.boss && (enemy.x < state.cameraX - DESPAWN_MARGIN || enemy.y > state.height + 30)

// ---- bosses

const hoverPoint = (state: RunState, enemy: Enemy) => ({
  x: state.cameraX + state.width * BOSS_LEAD, y: groundY(state.height) - BOSS_HEIGHT + Math.sin(enemy.age * 2) * BOSS_BOB,
})

function flyToward(enemy: Enemy, x: number, y: number, speed: number, dt: number): { enemy: Enemy; arrived: boolean } {
  const dx = x - enemy.x
  const dy = y - enemy.y
  const distance = Math.hypot(dx, dy)
  const step = speed * dt
  if (distance <= step || distance < 1) return { enemy: { ...enemy, x, y, vx: Math.sign(dx) * speed }, arrived: true }
  return { enemy: { ...enemy, x: enemy.x + (dx / distance) * step, y: enemy.y + (dy / distance) * step, vx: (dx / distance) * speed }, arrived: false }
}

const phased = (enemy: Enemy, bossPhase: BossPhase, timer: number): Enemy => ({ ...enemy, bossPhase, timer })

/**
 * A boss flies in, hovers ahead of the knight, flashes a warning with the spot it will dive at,
 * dives, then flies back up. It keeps pace with the camera, so it can be fought while running.
 */
function stepBoss(state: RunState, enemy: Enemy, dt: number): Enemy {
  const boss = { ...enemy, age: enemy.age + dt, flash: Math.max(0, enemy.flash - dt), timer: enemy.timer - dt }
  const kind = boss.kind as BossKind
  const home = hoverPoint(state, boss)
  switch (boss.bossPhase) {
    case 'enter': {
      const { enemy: moved, arrived } = flyToward(boss, home.x, home.y, BOSS_ENTER_SPEED + Math.abs(state.knight.vx), dt)
      return arrived ? phased(moved, 'hover', BOSS_HOVER_SECONDS[kind]) : moved
    }
    case 'hover': {
      const { enemy: moved } = flyToward(boss, home.x, home.y, BOSS_RETURN_SPEED + Math.abs(state.knight.vx), dt)
      if (moved.timer > 0) return moved
      return { ...phased(moved, 'warn', BOSS_WARN_SECONDS), targetX: state.knight.x, targetY: state.knight.y - 18 }
    }
    case 'warn':
      return boss.timer > 0 ? boss : phased(boss, 'dive', BOSS_DIVE_LIMIT)
    case 'dive': {
      const { enemy: moved, arrived } = flyToward(boss, boss.targetX, boss.targetY, diveSpeed(state, kind), dt)
      return arrived || moved.timer <= 0 ? phased(moved, 'return', 0) : moved
    }
    case 'return': {
      const { enemy: moved, arrived } = flyToward(boss, home.x, home.y, BOSS_RETURN_SPEED + Math.abs(state.knight.vx), dt)
      return arrived ? phased(moved, 'hover', BOSS_HOVER_SECONDS[kind]) : moved
    }
  }
}

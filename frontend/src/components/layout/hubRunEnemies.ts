import { stepGargoyle } from './hubRunGargoyle'
/**
 * How each enemy of the Hub run moves, and the bosses. Every attack is announced: a frog crouches
 * before it leaps, a ghost flickers before it is solid again, a boss flashes before it dives.
 */
import {
  BOSS_HP, BOSS_WARN_SECONDS, GRAVITY, difficulty, enemyRadius, groundHeightAt, groundUnder, groundY,
  type BossKind, type BossPhase, type Enemy, type EnemyKind, type RunState,
} from './hubRunModel'
import { CEMETERY } from './hubRunStages'

/** Enemies wake when they get this close to the right edge of the screen. */
const WAKE_MARGIN = 24
/** After it notices the knight an enemy turns (and pauses) for this long before it moves. */
const ALERT_SECONDS = 0.22
const DESPAWN_MARGIN = 48
const SPEEDS: Record<EnemyKind, number> = { slime: 22, frog: 0, bat: 34, bird: 85, ghost: 26, skull: 0, zombie: 18, reaper: 30, burster: 22, armored: 14, warden: 20, bonecaster: 0, gargoyle: 0 }
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
const BOSS_DIVE_SPEED: Record<BossKind, number> = { skull: 230, ghost: 190, warden: 105 }
const BOSS_HOVER_SECONDS: Record<BossKind, number> = { skull: 1.6, ghost: 2.2, warden: 1.2 }
const BOSS_DIVE_LIMIT = 1.3
const BOSS_BOB = 6
/** Every boss beaten makes the next one dive this much faster, up to BOSS_FURY_MAX. */
const BOSS_FURY = 0.1
const BOSS_FURY_MAX = 0.6

const diveSpeed = (state: RunState, kind: BossKind) =>
  BOSS_DIVE_SPEED[kind] * (1 + 0.1 * difficulty(state) + Math.min(BOSS_FURY_MAX, BOSS_FURY * state.stats.bosses))

export function blankEnemy(id: number, kind: EnemyKind, x: number, y: number): Enemy {
  return {
    id, kind, x, y, vx: 0, vy: 0, age: 0, stride: 0, awake: false, baseY: y, hop: FROG_REST, hp: 1, maxHp: 1, big: false,
    boss: false, bossPhase: 'enter', timer: 0, targetX: x, targetY: y, flash: 0, facing: 1, guard: 0, guardOpen: 0,
    dying: 0, dyingFor: 0, alert: 0, bossAttack: 'dive',
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
  // Waking up is a visible beat: it turns toward the knight, then charges.
  return { ...enemy, awake: true, alert: ALERT_SECONDS, facing: side, vx: enemy.kind === 'bird' ? -speed : side * speed }
}

/** A slime walks, turns at the edge of its ground, and lands when it was sent hopping by a split. */
function slime(state: RunState, enemy: Enemy, dt: number): Enemy {
  const floor = (groundHeightAt(state, enemy.x) ?? groundY(state.height)) - enemyRadius(enemy)
  if (enemy.vy !== 0 || enemy.y < floor - 0.5) {
    const vy = enemy.vy + GRAVITY * dt
    const y = enemy.y + vy * dt
    const x = enemy.x + enemy.vx * dt
    if (vy > 0 && y >= floor && groundUnder(state, x)) return { ...enemy, x, y: floor, vy: 0 }
    return { ...enemy, x, y, vy }
  }
  const ahead = enemy.x + Math.sign(enemy.vx) * enemyRadius(enemy)
  const vx = groundUnder(state, ahead) ? enemy.vx : -enemy.vx
  const x = enemy.x + vx * dt
  return { ...enemy, vx, x, y: (groundHeightAt(state, x) ?? floor + enemyRadius(enemy)) - enemyRadius(enemy) }
}

/** A frog waits, crouches for a moment when he is near, then leaps at him. */
function frog(state: RunState, enemy: Enemy, dt: number): Enemy {
  const floor = (groundHeightAt(state, enemy.x) ?? groundY(state.height)) - enemyRadius(enemy)
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
  const next = stepEnemyBody(state, enemy, dt)
  // Every kind, bosses included, adds the ground it covered: that is what drives the walk cycle.
  const walked = Math.abs(next.x - enemy.x)
  return walked > 0.001 ? { ...next, stride: (enemy.stride ?? 0) + walked } : next
}

function stepEnemyBody(state: RunState, enemy: Enemy, dt: number): Enemy {
  // A corpse plays its death animation where it fell: it stops moving and cannot be touched.
  if (enemy.dying > 0) return { ...enemy, dying: Math.max(0, enemy.dying - dt) }
  if (enemy.kind === 'gargoyle') return stepGargoyle(state, enemy, dt)
  if (enemy.kind === 'warden') return stepWarden(state, enemy, dt)
  if (enemy.boss) return stepBoss(state, enemy, dt)
  const awake = wokenEnemy(state, enemy)
  if (!awake.awake) return awake
  const aged = { ...awake, age: awake.age + dt, flash: Math.max(0, awake.flash - dt), guardOpen: Math.max(0, awake.guardOpen - dt), alert: Math.max(0, awake.alert - dt) }
  if (aged.emerging && aged.age < 0.85) return aged
  // It has just noticed him: it faces him and holds for a beat before it charges.
  if (aged.alert > 0 && aged.kind !== 'burster') return { ...aged, facing: state.knight.x < aged.x ? -1 : 1 }
  // A blocked hit knocks the guard down and stuns the holder: this is the opening the player needs.
  if (aged.guardOpen > 0 && aged.kind === 'armored') return aged
  if ((aged.knockTime ?? 0) > 0) {
    const x = aged.x + aged.vx * dt, floor = (groundHeightAt(state, x) ?? groundY(state.height)) - enemyRadius(aged)
    const vy = aged.vy + GRAVITY * dt, y = Math.min(floor, aged.y + vy * dt)
    return { ...aged, x, y, vy: y >= floor ? 0 : vy, knockTime: aged.knockTime! - dt }
  }
  if (aged.armLost && (aged.armRecover ?? 0) > 0) {
    const toward = Math.sign((aged.armX ?? aged.x) - aged.x), timer = aged.armRecover! - dt
    const x = aged.x + toward * (Math.abs((aged.armX ?? aged.x) - aged.x) < 5 ? 0 : 32) * dt
    return { ...aged, x, y: (groundHeightAt(state, x) ?? groundY(state.height)) - enemyRadius(aged), vx: toward * 32, armRecover: timer, armLost: timer > 0 }
  }
  const moved = movedEnemy(state, aged, dt)
  return moved.vx === 0 ? moved : { ...moved, facing: moved.vx > 0 ? 1 : -1 }
}

/** The per-archetype movement, without ageing or facing. */
function movedEnemy(state: RunState, aged: Enemy, dt: number): Enemy {
  switch (aged.kind) {
    case 'slime': return slime(state, aged, dt)
    case 'armored': return slime(state, aged, dt)
    case 'burster': {
      if (aged.bossPhase === 'warn') {
        const timer = aged.timer - dt
        if (timer <= 0) {
          state.events.push({ type: 'burst', x: aged.x, y: aged.y })
          return { ...aged, hp: 0, dying: 0.35, dyingFor: 0.35 }
        }
        return { ...aged, timer, vx: 0 }
      }
      if (Math.abs(aged.x - state.knight.x) < 62) return { ...aged, bossPhase: 'warn', timer: 0.75, vx: 0 }
      return slime(state, aged, dt)
    }
    case 'zombie': {
      const next = slime(state, aged, dt)
      const side = state.knight.x < next.x ? -1 : 1
      const speed = Math.max(18, Math.abs(next.vx))
      return { ...next, vx: groundUnder(state, next.x + side * enemyRadius(next)) ? side * speed : -side * speed }
    }
    case 'frog': return frog(state, aged, dt)
    case 'bat': { const next = bat(state, aged, dt); return { ...next, x: next.x + next.vx * dt } }
    case 'ghost': { const next = ghost(state, aged, dt); return { ...next, x: next.x + next.vx * dt } }
    case 'reaper': { const next = ghost(state, aged, dt); return { ...next, x: next.x + next.vx * dt } }
    default: return { ...aged, x: aged.x + aged.vx * dt }
  }
}

/**
 * The Grave Guardian: it walks the arena, announces an attack, then either dives at the knight or
 * slams the ground where he stood (the shockwave is handled by the stage). Below half life it
 * alternates both attacks faster and the bell tolls for it.
 */
function stepWarden(state: RunState, enemy: Enemy, dt: number): Enemy {
  const timer = enemy.timer - dt
  const side = state.knight.x < enemy.x ? -1 : 1
  const angry = enemy.hp <= enemy.maxHp / 2
  const left = CEMETERY.bossTrigger - 10
  const right = CEMETERY.bell - 90
  let phase = enemy.bossPhase
  let attack = enemy.bossAttack
  let vx = 0
  let nextTimer = timer
  let x = enemy.x
  let y = enemy.y
  let targetX = enemy.targetX
  let targetY = enemy.targetY
  const floorAt = (at: number) => groundHeightAt(state, at) ?? groundY(state.height)
  if (phase === 'enter' || phase === 'hover') {
    vx = Math.abs(state.knight.x - enemy.x) > 70 ? side * (angry ? 34 : 24) : 0
    if (timer <= 0) {
      phase = 'warn'
      nextTimer = angry ? 0.55 : 0.85
      // Phase one teaches the dive; phase two swaps in the slam so the fight changes shape.
      attack = angry && enemy.bossAttack !== 'slam' ? 'slam' : 'dive'
      // Lock the spot now: the marker must not follow the knight after the warning starts.
      targetX = Math.max(left, Math.min(right, state.knight.x))
      targetY = attack === 'slam' ? floorAt(targetX) : state.knight.y - 18
      vx = 0
    }
  } else if (phase === 'warn' && timer <= 0) {
    if (attack === 'slam') {
      phase = 'slam'
      nextTimer = 0.5
    } else {
      phase = 'dive'
      nextTimer = 0.48
      vx = side * (angry ? 140 : 110)
    }
  } else if (phase === 'dive') {
    vx = enemy.vx || side * 100
    if (timer <= 0) { phase = 'return'; nextTimer = 1.1; vx = 0 }
  } else if (phase === 'slam') {
    const target = Math.max(left, Math.min(right, enemy.targetX))
    vx = Math.abs(target - x) > 3 ? Math.sign(target - x) * Math.min(240, Math.abs(target - x) * 12) : 0
    if (timer <= 0) {
      state.events.push({ type: 'bossSlam', x, y: floorAt(x) })
      phase = 'return'
      nextTimer = 1.2
      vx = 0
    }
  } else if (phase === 'return' && timer <= 0) {
    phase = 'hover'
    nextTimer = angry ? 0.7 : 1.1
  }
  x = Math.max(left, Math.min(right, x + vx * dt))
  const home = floorAt(x) - enemyRadius(enemy)
  // It only descends for the slam: every other phase walks the arena floor.
  y = phase === 'slam' ? Math.min(home, y + 240 * dt) : Math.min(home, y + 180 * dt)
  // The marker shows where the next hit will land, not where the boss is.
  return {
    ...enemy, x, y, vx, age: enemy.age + dt, flash: Math.max(0, enemy.flash - dt),
    bossPhase: phase, timer: nextTimer, bossAttack: attack, targetX, targetY,
    facing: side, guardOpen: 0,
  }
}

export const gone = (state: RunState, enemy: Enemy) =>
  enemy.hp <= 0
    ? enemy.dying <= 0
    : !enemy.boss && ((!state.stage && enemy.x < state.cameraX - DESPAWN_MARGIN) || enemy.y > state.height + 30)

// ---- bosses

function hoverPoint(state: RunState, enemy: Enemy) {
  const x = state.cameraX + state.width * BOSS_LEAD
  return { x, y: Math.min(groundY(state.height), groundHeightAt(state, x) ?? groundY(state.height)) - BOSS_HEIGHT + Math.sin(enemy.age * 2) * BOSS_BOB }
}

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
    case 'slam':
      return boss
  }
}

/**
 * One small animation state machine for every enemy archetype. It does not draw: it says which
 * pose, frame, bob, lean, tip and squash an enemy has this instant, so gameplay stays pure and
 * testable and the renderer only has to apply numbers.
 *
 * A walk cycle is driven by the distance the enemy has walked, never by the clock: that is what
 * keeps its feet on the ground instead of letting the whole body slide. Only flying enemies flap on
 * time, because the air has no ground to grip.
 */
import type { Enemy, EnemyKind, RunState } from './hubRunModel'

export type EnemyAnimState = 'emerge' | 'idle' | 'walk' | 'windup' | 'attack' | 'stagger' | 'hurt' | 'death' | 'enter' | 'hover'

export interface EnemyAnimConfig {
  /** Frames in its walk sheet: 1 when the sprite is baked, 3 or more when the sheet has a cycle. */
  frames: number
  /** Ground distance of one full cycle (two steps), in pixels. */
  cyclePx: number
  /** How far the body rises between two footfalls, pixels. */
  bob: number
  /** Horizontal sway of the body, pixels. */
  lean: number
  /** Tip of the body around the feet, radians. */
  rock: number
  /** Death animation length, seconds. */
  death: number
  /** Flaps on the clock instead of on distance. */
  air?: boolean
}

const anim = (frames: number, cyclePx: number, bob: number, lean: number, rock: number, death: number, air = false): EnemyAnimConfig =>
  ({ frames, cyclePx, bob, lean, rock, death, air })

/** Per-archetype timing: heavy things are slow and low, small things are quick and bouncy. */
export const ENEMY_ANIM: Record<EnemyKind, EnemyAnimConfig> = {
  gargoyle: anim(2, 35, 1, 0.4, 0.03, 1.2, true),
  zombie: anim(3, 30, 2.4, 0.9, 0.05, 0.9),
  bonecaster: anim(3, 30, 1.2, 0.4, 0.02, 0.9),
  armored: anim(1, 26, 1.8, 0.5, 0.03, 1.1),
  burster: anim(1, 24, 2.2, 0.6, 0.04, 0.8),
  warden: anim(1, 48, 3, 1.2, 0.025, 1.6),
  reaper: anim(4, 34, 2.2, 1, 0.03, 1),
  ghost: anim(1, 40, 1.6, 0.8, 0.02, 1, true),
  slime: anim(2, 22, 0, 0, 0, 0.6),
  frog: anim(2, 20, 0, 0, 0, 0.6),
  bat: anim(1, 26, 2.4, 0, 0, 0.6, true),
  bird: anim(2, 26, 2, 0, 0, 0.6, true),
  skull: anim(1, 30, 2.4, 0, 0, 0.8, true),
}

/** How fast a flying enemy beats its wings, in cycles per second. */
const AIR_FPS: Record<EnemyKind, number> = {
  gargoyle: 3, zombie: 0, bonecaster: 0, armored: 0, burster: 0, warden: 0, reaper: 0, slime: 0, frog: 0,
  ghost: 1.6, bat: 4.2, bird: 5.5, skull: 3.2,
}

/** Death animation length for a kind; the rules keep a corpse around this long. */
export const deathSeconds = (kind: EnemyKind): number => ENEMY_ANIM[kind].death

/** Which of the enemy's states it is in, for both its animation and its weapon. */
export function enemyAnimState(_state: Pick<RunState, 'knight'>, enemy: Enemy): EnemyAnimState {
  if (enemy.dying > 0) return 'death'
  if (enemy.bossPhase === 'warn' && !enemy.boss) return 'windup'
  if (enemy.emerging && enemy.age < 0.85) return 'emerge'
  if (enemy.guardOpen > 0) return 'stagger'
  if (enemy.flash > 0) return 'hurt'
  if (enemy.boss) {
    if (enemy.bossPhase === 'enter') return 'enter'
    if (enemy.bossPhase === 'warn') return 'windup'
    if (enemy.bossPhase === 'dive' || enemy.bossPhase === 'slam') return 'attack'
    return 'hover'
  }
  if (enemy.kind === 'frog' && enemy.hop > 0 && enemy.hop <= 0.35) return 'windup'
  return Math.abs(enemy.vx) > 2 ? 'walk' : 'idle'
}

export interface EnemyPose {
  state: EnemyAnimState
  /** Frame index inside its sheet, or inside its baked cycle. */
  frame: number
  /** 0–1 progress of the current state (deaths use it to fade and sink). */
  progress: number
  /** Where the walk cycle stands, 0–1. Walk frames and baked legs both read it. */
  cycle: number
  /** Vertical offset in pixels. */
  bob: number
  /** Horizontal lean in pixels, positive forward. */
  lean: number
  /** Tip of the body around the feet, radians. */
  rock: number
  /** Vertical scale: below 1 crouches, above 1 swells. */
  squash: number
  /** Opacity, 1 while alive. */
  fade: number
  /** Rotation in radians: only a death topple uses it. */
  rotate: number
}

const TAU = Math.PI * 2
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** The pose of one enemy this instant. Pure: same inputs, same numbers. */
export function enemyPose(state: Pick<RunState, 'knight'>, enemy: Enemy, clock: number): EnemyPose {
  const config = ENEMY_ANIM[enemy.kind]
  const animState = enemyAnimState(state, enemy)
  const base: EnemyPose = {
    state: animState,
    frame: 0,
    progress: 0,
    cycle: 0,
    bob: 0,
    lean: 0,
    rock: 0,
    squash: 1,
    fade: 1,
    rotate: 0,
  }
  switch (animState) {
    case 'death': {
      const total = enemy.dyingFor || config.death
      const progress = clamp01(1 - enemy.dying / Math.max(0.001, total))
      return { ...base, progress, bob: progress * 6, lean: -progress * 4, squash: 1 - progress * 0.35, fade: 1 - clamp01((progress - 0.5) / 0.5), rotate: progress * 0.5 * -enemy.facing }
    }
    case 'emerge':
      return { ...base, progress: clamp01(enemy.age / 0.85), fade: 0.4 + 0.6 * clamp01(enemy.age / 0.85) }
    case 'walk': {
      const turns = config.air ? clock * (AIR_FPS[enemy.kind] || 2) : Math.max(0, enemy.stride ?? 0) / config.cyclePx
      const cycle = turns - Math.floor(turns)
      const step = Math.sin(TAU * cycle)
      const frames = Math.max(1, config.frames)
      return {
        ...base,
        cycle,
        frame: Math.floor(cycle * frames) % frames,
        // The hips ride high while the legs pass under the body and sink as the feet plant wide.
        bob: -config.bob * 0.5 * (1 + Math.cos(TAU * 2 * cycle)),
        lean: config.lean * step,
        rock: enemy.facing * config.rock * step,
      }
    }
    case 'idle':
      return { ...base, bob: Math.sin(clock * 2.2 + enemy.id) * config.bob * 0.45 }
    case 'hurt':
      return { ...base, lean: -enemy.facing * 2, squash: 1.06 }
    case 'stagger':
      return { ...base, lean: -enemy.facing * 2.5, squash: 0.94, bob: 1 }
    case 'windup': {
      if (enemy.kind === 'burster') return { ...base, squash: 1 + 0.22 * Math.sin(clock * 22) ** 2, bob: -1 }
      if (enemy.kind === 'frog') return { ...base, squash: 0.8, bob: 2 }
      return { ...base, lean: -enemy.facing * 3, squash: 0.92, bob: 1 }
    }
    case 'attack':
      return { ...base, lean: enemy.facing * 5, squash: 1.05, bob: -1 }
    case 'enter':
      return { ...base, progress: clamp01(enemy.age / 1.2), squash: 0.6 + 0.4 * clamp01(enemy.age / 1.2), fade: clamp01(enemy.age / 0.6) }
    default:
      return { ...base, bob: Math.sin(clock * 2) * config.bob }
  }
}

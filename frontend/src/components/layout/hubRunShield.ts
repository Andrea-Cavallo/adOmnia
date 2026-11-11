/**
 * Shields and guards, shared by every shielded archetype. A shield only covers the side the body
 * faces: hit it from behind (or from above) and the hit lands. A blocked hit costs the shield a
 * point and staggers the holder for a moment, so a frontal attacker gets a real opening.
 */
import type { Enemy, EnemyKind } from './hubRunModel'

/** Shield points per archetype. Anything missing here has no shield. */
export const GUARDS: Partial<Record<EnemyKind, number>> = { armored: 3 }
/** A blocked hit leaves the guard down (and the holder unable to move) this long. */
export const GUARD_STAGGER_SECONDS = 0.7
/** After a block the guard is open to a frontal follow-up for this long. */
export const GUARD_OPEN_SECONDS = 0.9
/** How many shield points a hit removes: a lance is heavier than a thrown sword. */
export const GUARD_DAMAGE: Record<string, number> = { sword: 1, lance: 2, hammer: 3, daggers: 1 }

export const shieldOf = (kind: EnemyKind): number => GUARDS[kind] ?? 0

/** Whether the raised shield covers a hit arriving from `fromX`. */
export function shieldCovers(enemy: Pick<Enemy, 'guard' | 'guardOpen' | 'facing' | 'x'>, fromX: number): boolean {
  if (enemy.guard <= 0 || enemy.guardOpen > 0) return false
  return (fromX - enemy.x) * enemy.facing > 0
}

/** A stomp, a hit from behind, or a hit while the guard is down: all bypass the shield. */
export function shieldStops(enemy: Pick<Enemy, 'guard' | 'guardOpen' | 'facing' | 'x'>, fromX: number, fromAbove: boolean): boolean {
  return !fromAbove && shieldCovers(enemy, fromX)
}

export interface GuardHit {
  guard: number
  /** The shield just broke: the holder is open from now on. */
  broken: boolean
  /** Seconds to add to the holder's stagger. */
  stagger: number
}

/** The guard after a blocked hit. */
export function guardAfterHit(enemy: Pick<Enemy, 'guard'>, weapon = 'sword'): GuardHit {
  const damage = GUARD_DAMAGE[weapon] ?? 1
  const guard = Math.max(0, enemy.guard - damage)
  return { guard, broken: guard <= 0, stagger: GUARD_STAGGER_SECONDS }
}

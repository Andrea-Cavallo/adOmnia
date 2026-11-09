/**
 * How the Hub run's enemies, chests and powers look: which pixelfx sprite, which colors, and
 * whether a sprite shows this frame (a hidden ghost, a struck boss blinking). Pure, so it is tested
 * without a canvas.
 */
import type { PixelFxModule, PixelFxOptions } from 'pixelfx'
import * as batEffect from 'pixelfx/fx/critters/bat'
import * as birdEffect from 'pixelfx/fx/critters/bird'
import * as skullEffect from 'pixelfx/fx/critters/flying-skull'
import * as frogEffect from 'pixelfx/fx/critters/frog'
import * as ghostEffect from 'pixelfx/fx/critters/ghost'
import * as slimeEffect from 'pixelfx/fx/critters/slime'
import { frogCrouching } from './hubRunEnemies'
import { ghostVisibility, type Enemy, type EnemyKind, type RunPower } from './hubRunRules'

export const CRITTERS: Record<EnemyKind, PixelFxModule> = {
  slime: slimeEffect, frog: frogEffect, bat: batEffect, bird: birdEffect, ghost: ghostEffect, skull: skullEffect,
}
/** From the sprite's origin (its floor) to the body's middle: slimes and frogs sit on it, the rest float above. */
export const FEET_OFFSET: Record<EnemyKind, number> = { slime: 9, frog: 9, bat: 0, bird: 0, ghost: 29, skull: 40 }

/** A big slime is red, so it reads as "this one splits" before it is struck. */
const BIG_SLIME_PALETTE = ['#180608', '#3e0c14', '#741a22', '#b02a2a', '#e0503a', '#ff9a6a', '#ffe2c8']
/** The ghost boss glows violet, apart from the ordinary blue ghosts. */
const BOSS_GHOST_PALETTE = ['#140a24', '#2e1450', '#522286', '#7e3cbc', '#ae6ee0', '#dcb0ff', '#ffffff']
/** The wide slash a chest grants swings in gold. */
export const WIDE_SLASH_PALETTE = ['#2a1604', '#5e3208', '#a05c0c', '#e09414', '#ffc626', '#ffe866', '#fff8c4']

export const POWER_LABELS: Record<RunPower, string> = { heart: '+1 HEART', wide: 'WIDE SLASH', shield: 'SHIELD' }

/** Blink rates, in flips per second. */
const FADING_BLINK = 12
const STRUCK_BLINK = 20
const WARN_BLINK = 10
/** A frog about to leap trembles by this many pixels. */
const CROUCH_TREMBLE = 1

/** The options a new sprite for this enemy is created with. */
export function critterOptions(enemy: Enemy): PixelFxOptions {
  const options: PixelFxOptions = { seed: enemy.id }
  if (enemy.big) return { ...options, palette: BIG_SLIME_PALETTE }
  if (enemy.boss && enemy.kind === 'ghost') return { ...options, palette: BOSS_GHOST_PALETTE }
  return options
}

const blinkOff = (clock: number, rate: number) => Math.floor(clock * rate) % 2 === 1

/** Whether the enemy is drawn this frame: a hidden ghost is not, a fading one or a struck boss blinks. */
export function enemyShown(enemy: Enemy, clock: number): boolean {
  if (enemy.flash > 0 && blinkOff(clock, STRUCK_BLINK)) return false
  const ghostly = enemy.kind === 'ghost' && (!enemy.boss || enemy.bossPhase === 'hover')
  if (!ghostly) return true
  const visibility = ghostVisibility(enemy.age)
  if (visibility === 'hidden') return false
  return visibility === 'solid' || !blinkOff(clock, FADING_BLINK)
}

/** The sideways shake of a frog about to leap; 0 for everything else. */
export function trembleOf(enemy: Enemy, clock: number): number {
  if (!frogCrouching(enemy)) return 0
  return blinkOff(clock, STRUCK_BLINK) ? CROUCH_TREMBLE : -CROUCH_TREMBLE
}

/** Whether the dive warning (the target cross and the "!") shows this frame. */
export const warningShown = (enemy: Enemy, clock: number) => enemy.boss && enemy.bossPhase === 'warn' && !blinkOff(clock, WARN_BLINK)

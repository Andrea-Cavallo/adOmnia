/**
 * The shapes and numbers of the Hub run, shared by its rules and its enemies. All positions are
 * in game pixels, y down; the ground surface is at groundY(height).
 */
export type RunPhase = 'idle' | 'playing' | 'paused' | 'over'
export type EnemyKind = 'slime' | 'frog' | 'bat' | 'bird' | 'ghost' | 'skull'
export type BossKind = 'skull' | 'ghost'
/** What a boss is doing: flying in, hovering ahead, warning, diving at the knight, flying back. */
export type BossPhase = 'enter' | 'hover' | 'warn' | 'dive' | 'return'
export type RunPower = 'heart' | 'wide' | 'shield'
export type RunMedal = 'bronze' | 'silver' | 'gold'

export interface Span { x0: number; x1: number }
export interface Platform extends Span { y: number }
export interface Coin { id: number; x: number; y: number }
/** A chest on the ground: touching it opens it and grants a power. */
export interface Chest { id: number; x: number; y: number }
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
  hp: number
  maxHp: number
  /** A big slime splits in two when it is struck. */
  big: boolean
  boss: boolean
  bossPhase: BossPhase
  /** Seconds left in the boss phase. */
  timer: number
  /** Where a dive aims: the knight when the warning started. */
  targetX: number
  targetY: number
  /** Seconds a struck boss shrugs off further hits (and flashes). */
  flash: number
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
interface At { x: number; y: number }
export type RunEvent =
  | ({ type: 'jump' | 'land' | 'swing' | 'block' | 'split' } & At)
  | ({ type: 'kill' | 'stomp'; kind: EnemyKind; points: number } & At)
  | ({ type: 'coin'; points: number } & At)
  | ({ type: 'hurt' | 'fall' } & At)
  | ({ type: 'chest'; power: RunPower } & At)
  | ({ type: 'boss'; kind: BossKind } & At)
  | ({ type: 'bossHit'; kind: BossKind; hp: number } & At)
  | ({ type: 'bossDown'; kind: BossKind; points: number } & At)
  | ({ type: 'special'; points: number; cleared: Array<{ x: number; y: number; kind: EnemyKind }> } & At)

export interface RunStats { kills: number; stomps: number; coins: number; bestChain: number; bosses: number; chests: number }
export interface RunState {
  phase: RunPhase
  width: number
  height: number
  knight: Knight
  cameraX: number
  ground: Span[]
  platforms: Platform[]
  coins: Coin[]
  chests: Chest[]
  enemies: Enemy[]
  /** World x up to which the level exists. */
  builtTo: number
  nextId: number
  hearts: number
  /** Points from kills, coins and bosses; the meters run are added by runScore. */
  points: number
  /** Furthest the knight got, in pixels from the start. */
  furthest: number
  chain: number
  /** Seconds left before the chain lapses. */
  chainLeft: number
  charge: number
  /** Seconds of the wide slash left. */
  wide: number
  /** Seconds of the shield left; it also breaks on the first hit it takes. */
  shield: number
  /** Seconds until the next boss; it only counts down while no boss is out. */
  bossIn: number
  stats: RunStats
  events: RunEvent[]
}

export const MAX_HEARTS = 3
/** A chest can raise the hearts above the start, up to this. */
export const HEART_CAP = 5
export const CHARGE_MAX = 10
export const PIXELS_PER_METER = 10
export const KILL_POINTS = 10
export const COIN_POINTS = 2
export const BOSS_POINTS = 100
export const SPECIAL_FACTOR = 2
export const MAX_CHAIN_MULTIPLIER = 5
/** Kills or coins in a row for each step of the multiplier. */
export const CHAIN_STEP = 3
export const CHAIN_SECONDS = 3
export const RUN_SPEED = 95
export const GRAVITY = 900
export const JUMP_SPEED = 310
export const ATTACK_SECONDS = 0.3
export const ATTACK_FROM = 0.03
export const ATTACK_TO = 0.2
export const ATTACK_REACH = 36
export const WIDE_REACH = 62
export const WIDE_SECONDS = 8
export const SHIELD_SECONDS = 15
export const INVULNERABLE_SECONDS = 1.2
/** Pits stay well inside the longest jump (about 65 px at full run). */
export const PIT_MIN = 24
export const PIT_MAX = 46
export const BOSS_EVERY = 20
export const BOSS_HP = 5
export const BOSS_WARN_SECONDS = 0.6
export const GHOST_CYCLE = 3
export const MEDALS: ReadonlyArray<readonly [RunMedal, number]> = [['gold', 7000], ['silver', 3500], ['bronze', 1500]]
export const BOSS_NAMES: Record<BossKind, string> = { skull: 'Flying skull', ghost: 'Ghost' }

const GROUND_MARGIN = 12
const DIFFICULTY_PIXELS = 1200
const MAX_DIFFICULTY = 3
/** He keeps standing while this close to the edge of the ground. */
export const FOOTING = 4
const RADIUS: Record<EnemyKind, number> = { slime: 9, frog: 9, bat: 10, bird: 9, ghost: 10, skull: 14 }
const BIG_SLIME_RADIUS = 13
const BOSS_RADIUS = 15

export const groundY = (height: number) => height - GROUND_MARGIN
export const enemyRadius = (enemy: Pick<Enemy, 'kind' | 'big' | 'boss'>) => (enemy.boss ? BOSS_RADIUS : enemy.big ? BIG_SLIME_RADIUS : RADIUS[enemy.kind])
export const chainMultiplier = (chain: number) => Math.min(MAX_CHAIN_MULTIPLIER, 1 + Math.floor(Math.max(0, chain) / CHAIN_STEP))
export const meters = (state: RunState) => Math.floor(state.furthest / PIXELS_PER_METER)
export const runScore = (state: RunState) => state.points + meters(state)
export const difficulty = (state: Pick<RunState, 'furthest'>) => Math.min(MAX_DIFFICULTY, state.furthest / DIFFICULTY_PIXELS)
export const difficultyAt = (x: number) => Math.min(MAX_DIFFICULTY, x / DIFFICULTY_PIXELS)
export const specialReady = (state: RunState) => state.charge >= CHARGE_MAX
export const medalFor = (score: number): RunMedal | null => MEDALS.find(([, threshold]) => score >= threshold)?.[0] ?? null
export const swinging = (knight: Knight) => knight.attack >= ATTACK_FROM && knight.attack <= ATTACK_TO
export const bossOf = (state: RunState): Enemy | undefined => state.enemies.find((enemy) => enemy.boss)
export const groundUnder = (state: RunState, x: number) => state.ground.some((span) => x >= span.x0 - FOOTING && x <= span.x1 + FOOTING)

/**
 * A ghost (and the ghost boss while it hovers) goes through a cycle: solid, fading, gone, coming back.
 * Only a solid ghost can hurt or be hurt; the flicker before it is solid again is the warning.
 */
export type Visibility = 'solid' | 'fading' | 'hidden'
export function ghostVisibility(age: number): Visibility {
  const t = age % GHOST_CYCLE
  if (t < 1.6) return 'solid'
  if (t < 1.9 || t >= 2.6) return 'fading'
  return 'hidden'
}
/** Whether an enemy can touch or be touched right now. */
export function tangible(enemy: Enemy): boolean {
  if (enemy.boss) return enemy.kind !== 'ghost' || enemy.bossPhase !== 'hover' || ghostVisibility(enemy.age) === 'solid'
  return enemy.kind !== 'ghost' || ghostVisibility(enemy.age) === 'solid'
}

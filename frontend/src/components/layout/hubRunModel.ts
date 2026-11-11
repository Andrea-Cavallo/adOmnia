export type WeaponKind = 'sword' | 'lance' | 'hammer' | 'daggers'
export type ArmorTier = 'steel' | 'verdant' | 'arcane' | 'royal'
/**
 * The shapes and numbers of the Hub run, shared by its rules and its enemies. All positions are
 * in game pixels, y down; the ground surface is at groundY(height).
 */
import type { CemeteryProgress } from './hubRunStages'

export type RunPhase = 'idle' | 'playing' | 'paused' | 'over' | 'complete'
export type EnemyKind = 'slime' | 'frog' | 'bat' | 'bird' | 'ghost' | 'skull' | 'zombie' | 'reaper' | 'burster' | 'armored' | 'warden' | 'bonecaster' | 'gargoyle'
export type BossKind = 'skull' | 'ghost' | 'warden'
/** What a boss is doing: flying in, hovering ahead, warning, attacking, flying back. */
export type BossPhase = 'enter' | 'hover' | 'warn' | 'dive' | 'slam' | 'return'
/** The attack a boss has committed to when its warning ends. */
export type BossAttack = 'dive' | 'slam' | 'raise'
export type RunPower = 'heart' | 'wide' | 'shield'
export type RunMedal = 'bronze' | 'silver' | 'gold'

export interface Span { x0: number; x1: number; y0?: number; y1?: number }
export interface Platform extends Span { y: number }
export interface Coin { id: number; x: number; y: number }
export interface Sword { id: number; x: number; y: number; previousX: number; vx: number; life: number; weapon?: WeaponKind; damage?: number; vy?: number; previousY?: number; pierces?: number }
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
  /** Pixels walked so far: the walk cycle is driven by distance, so the feet never skate. */
  stride?: number
  knockTime?: number
  bumped?: boolean
  armLost?: boolean
  armRecover?: number
  armX?: number
  awake: boolean
  emerging?: boolean
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
  /** Which way the body (and its shield) faces: 1 right, -1 left. */
  facing: 1 | -1
  /** Shield points left. 0 means no shield, or one that has already been broken. */
  guard: number
  /** Seconds the guard stays down after a block: frontal hits land in this window. */
  guardOpen: number
  /** Seconds left of its death animation; the enemy is gone when it reaches 0. */
  dying: number
  /** The whole death animation, so the renderer can read a 0–1 progress. */
  dyingFor: number
  /** Seconds it stands alert after noticing the knight, before it charges. */
  alert: number
  /** The Guardian's announced attack, chosen when its warning starts. */
  bossAttack: BossAttack
}
/** A piece of equipment knocked off the knight: it flies, spins and falls to the ground. */
export interface Debris {
  id: number
  kind: 'helmet' | 'plate' | 'rivet' | 'arm'
  x: number
  y: number
  vx: number
  vy: number
  /** Radians. */
  angle: number
  spin: number
  /** Seconds left before it fades. */
  life: number
  /** 1 when it has touched the ground (it stops bouncing after a couple of hits). */
  bounces: number
  floor: number
  size: number
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
  attackWeapon?: WeaponKind
  throwing?: number
  crouching?: boolean
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
  selectWeapon?: WeaponKind
  aimX?: number
  aimY?: number
  throwSword?: boolean
  crouch?: boolean
  interact?: boolean
  special: boolean
}
interface At { x: number; y: number }
/** A freed prisoner's escape: out of the cage, over the ground, then away. */
export type RescuePhase = 'freed' | 'climb' | 'run'
export interface RescueActor {
  /** The prisoner's id in the stage data. */
  prisoner: number
  x: number
  y: number
  phase: RescuePhase
  timer: number
  facing: 1 | -1
  /** Where it is running to: off the critical path, past the cage. */
  exitX: number
  /** Set while it hops over a gap. */
  vy: number
}
export type RunEvent =
  | ({ type: 'jump' | 'land' | 'swing' | 'throw' | 'bell' | 'block' | 'split' | 'burst' | 'armorBreak' | 'hammerImpact' | 'crowCry' | 'gargoyleCrash' | 'topple' | 'distantBell' | 'armLost' } & At)
  | ({ type: 'shieldBlock' | 'shieldBreak'; guard: number } & At)
  | ({ type: 'bossSlam' } & At)
  | ({ type: 'rescue'; name: string; reward: string } & At)
  | ({ type: 'reward'; text: string } & At)
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
  swords: Sword[]
  swordCooldown: number
  stage?: CemeteryProgress
  /** Pieces of the knight's armor still in the air. */
  debris?: Debris[]
  /** Killed enemies playing their death animation: not targetable and not in `enemies`. */
  corpses?: Enemy[]
  /** Freed prisoners running to safety. */
  escapes?: RescueActor[]
  hazards?: Array<{ id: number; x: number; y: number; vx: number; vy: number; life: number; kind?: 'bone' | 'wave' }>
  hitStop?: number
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
/** Each boss beaten makes the next one take a hit more, up to this. */
export const BOSS_HP_MAX = 9
export const BOSS_WARN_SECONDS = 0.75
export const GHOST_CYCLE = 3
export const MEDALS: ReadonlyArray<readonly [RunMedal, number]> = [['gold', 7000], ['silver', 3500], ['bronze', 1500]]
export const BOSS_NAMES: Record<BossKind, string> = { skull: 'Flying skull', ghost: 'Ghost', warden: 'Grave Guardian' }

const GROUND_MARGIN = 12
const DIFFICULTY_PIXELS = 1200
const MAX_DIFFICULTY = 3
/** He keeps standing while this close to the edge of the ground. */
export const FOOTING = 4
const RADIUS: Record<EnemyKind, number> = { slime: 9, frog: 9, bat: 10, bird: 9, ghost: 10, skull: 14, zombie: 16, reaper: 15, burster: 16, armored: 17, warden: 23, bonecaster: 16, gargoyle: 12 }
const BIG_SLIME_RADIUS = 13
const BOSS_RADIUS = 15

export const groundY = (height: number) => height - GROUND_MARGIN
export const knightBodyHeight = (knight: Pick<Knight, 'crouching'>) => knight.crouching ? 22 : 38
export const enemyRadius = (enemy: Pick<Enemy, 'kind' | 'big' | 'boss'>) => (enemy.boss ? BOSS_RADIUS : enemy.big ? BIG_SLIME_RADIUS : RADIUS[enemy.kind])
export const chainMultiplier = (chain: number) => Math.min(MAX_CHAIN_MULTIPLIER, 1 + Math.floor(Math.max(0, chain) / CHAIN_STEP))
export const meters = (state: RunState) => Math.floor(state.furthest / PIXELS_PER_METER)
export const runScore = (state: RunState) => state.points + meters(state)
export const difficulty = (state: Pick<RunState, 'furthest'>) => Math.min(MAX_DIFFICULTY, state.furthest / DIFFICULTY_PIXELS)
export const difficultyAt = (x: number) => Math.min(MAX_DIFFICULTY, x / DIFFICULTY_PIXELS)
export const bossHp = (beaten: number) => Math.min(BOSS_HP_MAX, BOSS_HP + beaten)
export const specialReady = (state: RunState) => state.charge >= CHARGE_MAX
export const medalFor = (score: number): RunMedal | null => MEDALS.find(([, threshold]) => score >= threshold)?.[0] ?? null
export const swinging = (knight: Knight) => knight.attackWeapon === 'hammer' ? knight.attack >= 0.24 && knight.attack <= 0.4 : knight.attackWeapon === 'daggers' ? knight.attack >= 0.04 && knight.attack <= 0.12 : knight.attack >= ATTACK_FROM && knight.attack <= ATTACK_TO
export const bossOf = (state: RunState): Enemy | undefined => state.enemies.find((enemy) => enemy.boss)
export function spanHeight(span: Span, x: number, height: number): number {
  const start = span.y0 ?? groundY(height)
  const end = span.y1 ?? start
  const t = Math.max(0, Math.min(1, (x - span.x0) / Math.max(1, span.x1 - span.x0)))
  return start + (end - start) * t
}
export function groundHeightAt(state: Pick<RunState, 'ground' | 'height'>, x: number, padding = FOOTING): number | null {
  const span = state.ground.find((item) => x >= item.x0 && x <= item.x1)
    ?? state.ground.find((item) => x >= item.x0 - padding && x <= item.x1 + padding)
  return span ? spanHeight(span, x, state.height) : null
}
export const groundUnder = (state: RunState, x: number) => groundHeightAt(state, x) !== null

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
  if (enemy.dying > 0 || enemy.hp <= 0) return false
  if (enemy.kind === 'gargoyle' && enemy.bossPhase === 'enter') return false
  if (enemy.emerging && enemy.age < 0.85) return false
  if (enemy.kind === 'burster' && enemy.age < 0.7) return false
  if (enemy.boss) return enemy.kind !== 'ghost' || enemy.bossPhase !== 'hover' || ghostVisibility(enemy.age) === 'solid'
  return enemy.kind !== 'ghost' || ghostVisibility(enemy.age) === 'solid'
}

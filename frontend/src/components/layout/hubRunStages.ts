export const CEMETERY_URNS = [1460, 2880]
import type { EnemyKind, Platform, Span, WeaponKind, ArmorTier } from './hubRunModel'
import { groundY } from './hubRunModel'

export interface CemeteryProgress {
  id: 'cemetery'
  brokenUrns?: number[]
  lastDamageAt?: number
  lastHealAt?: number
  fallenStoneAt?: number
  stoneDirection?: 1 | -1
  ambientEvents?: Array<{ kind: 'crows' | 'masonry'; x: number; time: number }>
  urnBrokenAt?: Record<number, number>
  gateOpenedAt?: number
  revealedSecrets?: number[]
  secretFoundAt?: Record<number, number>
  key: boolean
  gate: boolean
  defended: boolean
  prisoner: boolean
  checkpoint: number
  bossDefeated: boolean
  bellDestroyed: boolean
  bellHp: number
  bellGrace: number
  armor: number
  elapsed: number
  waveTime: number
  triggered: string[]
  weapon: WeaponKind
  weapons: WeaponKind[]
  armorTier: ArmorTier
  weaponCharges: number
  holyWeapon: boolean
  rescued: number[]
  secrets: number[]
  openedChests: number[]
  chestOpenedAt?: Record<number, number>
  curse: number
  damageTaken: number
  ending: 'true' | 'half' | null
  armorBreak?: { x: number; y: number; time: number }
  pressureTime: number
}

export const CEMETERY = {
  end: 4360,
  gate: 1880,
  key: 1650,
  chest: 710,
  prisoner: 2730,
  checkpoint: 2920,
  /** A second checkpoint right before the Guardian's arena. */
  checkpointBoss: 3520,
  bossTrigger: 3600,
  boss: 3840,
  bell: 4070,
  waveTrigger: 2500,
  waveBarrier: 2860,
  tree: 1080,
  crypt: { entrance: 3000, exit: 3430, lowStart: 3150, lowEnd: 3210, clearance: 27 },
  objectives: [
    'Explore the tree and recover the mausoleum key',
    'Open the locked cemetery gate',
    'Reach the chapel courtyard and defend the gravedigger',
    'Free the gravedigger beside the cage',
    'Reach the chapel checkpoint',
    'Defeat the Grave Guardian',
    'Destroy the cursed bell with your weapon',
    'The bell is silent — leave through the open gate',
  ],
  geometry: [
    [-200, 520, 0, 0],
    [520, 680, 0, -22],
    [680, 800, -22, -22],
    [800, 980, -22, 22],
    [980, 1100, 22, 22],
    [1100, 1240, 22, 0],
    [1240, 1500, 0, 0],
    [1500, 1640, 0, -18],
    [1640, 1900, -18, -18],
    [1900, 2040, -18, 0],
    [2040, 2280, 0, 0],
    [2280, 2390, 0, -26],
    [2390, 2460, -26, -26],
    [2490, 2600, -26, -14],
    [2600, 2750, -14, 0],
    [2750, 2900, 0, 0],
    [2900, 3040, 0, -20],
    [3040, 4420, -20, -20],
  ] as readonly (readonly number[])[],
  roofs: [
    [660, 760, -50],
    [1170, 1240, -45],
    [1700, 1810, -55],
    [3280, 3380, -54],
  ] as readonly (readonly number[])[],
  prisoners: [
    { id: 0, name: 'Monk', x: 1760, upper: true, reward: 'coins' },
    { id: 1, name: 'Gravedigger', x: 2730, upper: false, reward: 'armor' },
    { id: 2, name: 'Royal scout', x: 3360, upper: true, reward: 'coins' },
    { id: 3, name: 'Buried captive', x: 2170, upper: false, reward: 'coins' },
    { id: 4, name: 'Gatekeeper', x: 875, upper: false, reward: 'coins' },
  ] as const,
  secrets: [{ id: 0, x: 1200, upper: true }, { id: 1, x: 2150, upper: false }, { id: 2, x: 3230, upper: false }, { id: 3, x: 940, upper: false }] as const,
  chests: [{ id: 0, x: 710, upper: true, contents: 'lance' }, { id: 1, x: 1715, upper: true, contents: 'potion' }, { id: 2, x: 3320, upper: true, contents: 'sword' }, { id: 3, x: 1380, upper: false, contents: 'hammer' }, { id: 4, x: 2230, upper: false, contents: 'daggers' }] as const,
  pressure: { start: 2200, end: 2390 },
  encounters: [
    { id: 'first-zombie', trigger: 270, spawns: [['zombie', 440]] },
    { id: 'mausoleum', trigger: 520, spawns: [['gargoyle', 745]] },
    { id: 'cursed-tree', trigger: 1100, spawns: [['zombie', 1220]] },
    { id: 'side-mausoleum', trigger: 1430, spawns: [['zombie', 1600], ['burster', 1690]] },
    { id: 'bone-thrower', trigger: 1900, spawns: [['bonecaster', 2050]] },
    { id: 'chapel-path', trigger: 2150, spawns: [['zombie', 2350], ['zombie', 2430]] },
    { id: 'inner-crypt', trigger: 3000, spawns: [['burster', 3090], ['bonecaster', 3390]] },
  ] as readonly { id: string; trigger: number; spawns: readonly (readonly [EnemyKind, number])[] }[],
}

export function cemeteryGeometry(height: number): { ground: Span[]; platforms: Platform[] } {
  const base = groundY(height)
  return {
    ground: CEMETERY.geometry.map(([x0, x1, y0, y1]) => ({ x0, x1, y0: base + y0, y1: base + y1 })),
    platforms: CEMETERY.roofs.map(([x0, x1, y]) => ({ x0, x1, y: base + y })),
  }
}

export function cemeteryObjective(stage: CemeteryProgress): number {
  if (!stage.key) return 0
  if (!stage.gate) return 1
  if (!stage.defended) return 2
  if (!stage.prisoner) return 3
  if (!stage.checkpoint) return 4
  if (!stage.bossDefeated) return 5
  return stage.ending ? 7 : 6
}

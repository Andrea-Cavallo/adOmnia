import type { RunState, WeaponKind, ArmorTier } from './hubRunModel'

export const WEAPONS = {
  sword: { name: 'Sword', damage: 1, reach: 36, cooldown: 0.32, speed: 260 },
  lance: { name: 'Lance', damage: 2, reach: 42, cooldown: 0.42, speed: 330 },
  hammer: { name: 'Hammer', damage: 4, reach: 23, cooldown: 0.7, speed: 0 },
  daggers: { name: 'Daggers', damage: 1, reach: 18, cooldown: 0.13, speed: 370 },
} as const
export const ARMOR = {
  steel: { name: 'Steel', hits: 1, color: '#b7c2cc', speed: 1 },
  verdant: { name: 'Restoring green', hits: 2, color: '#74bd79', speed: 1 },
  arcane: { name: 'Arcane', hits: 2, color: '#ba8ce5', speed: 1 },
  royal: { name: 'Royal', hits: 3, color: '#efcf78', speed: 1 },
} as const
export const armorTier = (state: RunState): ArmorTier => state.stage?.armorTier ?? 'steel'
export const equippedWeapon = (state: RunState): WeaponKind => state.stage?.weapon ?? 'sword'
export const bonusDamage = (state: RunState) => state.stage && state.stage.armor > 0 && armorTier(state) === 'royal' ? 1 : 0
export function upgradeArmor(state: RunState): RunState {
  if (!state.stage) return state
  const tiers: ArmorTier[] = ['steel', 'verdant', 'arcane', 'royal']
  const tier = tiers[Math.min(3, tiers.indexOf(armorTier(state)) + 1)]
  return { ...state, stage: { ...state.stage, armorTier: tier, armor: ARMOR[tier].hits } }
}

/** Level one only grants restoring armor; higher tiers belong to later levels. */
export function grantCemeteryArmor(state: RunState): RunState {
  if (!state.stage) return state
  return { ...state, hearts: 2, stage: { ...state.stage, armorTier: 'verdant', armor: 2 } }
}

export function projectileHit(sword: RunState['swords'][number], x: number, y: number, radius: number): boolean {
  const fromY = sword.previousY ?? sword.y
  const dx = sword.x - sword.previousX, dy = sword.y - fromY
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((x - sword.previousX) * dx + (y - fromY) * dy) / length)) : 0
  return Math.hypot(x - sword.previousX - dx * t, y - fromY - dy * t) <= radius + (sword.weapon === 'daggers' ? 3 : 8)
}

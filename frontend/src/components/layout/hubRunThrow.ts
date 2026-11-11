import { WEAPONS, armorTier, bonusDamage, equippedWeapon } from './hubRunEquipment'
import type { RunInput, RunState } from './hubRunModel'

export function thrownWeapon(state: RunState, input: RunInput, dt: number): RunState {
  const swordCooldown = Math.max(0, state.swordCooldown - dt)
  const knight = { ...state.knight, throwing: Math.max(0, (state.knight.throwing ?? 0) - dt) }
  const weapon = equippedWeapon(state)
  if (weapon === 'lance' && state.stage && state.stage.weaponCharges <= 0)
    return { ...state, knight, swordCooldown, stage: { ...state.stage, weapon: 'sword' } }
  if (!input.throwSword || swordCooldown > 0 || weapon === 'hammer') return { ...state, knight, swordCooldown }
  const spec = WEAPONS[weapon]
  let dx = weapon === 'daggers' ? input.aimX ?? 0 : knight.facing
  const dy = weapon === 'daggers' ? input.aimY ?? 0 : 0
  if (!dx && !dy) dx = knight.facing
  const length = Math.hypot(dx, dy)
  const vx = dx / length * spec.speed, vy = dy / length * spec.speed
  const x = knight.x + dx / length * 12, y = knight.y - (knight.crouching ? 12 : 23)
  const empowered = !!state.stage?.armor
  state.events.push({ type: 'throw', x, y })
  const stage = state.stage ? { ...state.stage, weaponCharges: weapon === 'lance' ? Math.max(0, state.stage.weaponCharges - 1) : state.stage.weaponCharges } : undefined
  if (stage && weapon === 'lance' && stage.weaponCharges <= 0) stage.weapon = 'sword'
  return {
    ...state, stage, knight: { ...knight, throwing: weapon === 'daggers' ? 0.1 : 0.22 },
    swordCooldown: spec.cooldown * (empowered && armorTier(state) === 'arcane' ? 0.75 : 1), nextId: state.nextId + 1,
    swords: [...state.swords, { id: state.nextId, x, previousX: x, y, previousY: y, vx, vy, life: weapon === 'daggers' ? 0.85 : 1.3, damage: spec.damage + bonusDamage(state), weapon, pierces: empowered && armorTier(state) === 'arcane' ? 1 : 0 }],
  }
}

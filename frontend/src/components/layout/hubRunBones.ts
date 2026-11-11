import { damageKnight, groundHeightAt, knightBodyHeight, enemyRadius, type RunState } from './hubRunRules'

export const BONE_WINDUP = 0.6
const SPEED = 135
const GRAVITY = 45

export function stepBones(state: RunState, dt: number): RunState {
  let next = { ...state }
  const hazards = [...(state.hazards ?? [])]
  const enemies = state.enemies.map(enemy => {
    if (enemy.kind !== 'bonecaster' || !enemy.awake || enemy.age < 0.85 || (enemy.knockTime ?? 0) > 0) return enemy
    const facing: 1 | -1 = state.knight.x < enemy.x ? -1 : 1
    const distance = Math.abs(enemy.x - state.knight.x)
    const visible = enemy.x >= state.cameraX + 8 && enemy.x <= state.cameraX + state.width - 8
    if (!visible || distance > 210 || distance < 42)
      return { ...enemy, facing, bossPhase: 'hover' as const, timer: Math.max(enemy.timer, 0.5) }
    const timer = enemy.timer - dt
    if (enemy.bossPhase === 'warn') {
      if (timer > 0) return { ...enemy, facing, timer }
      const x = enemy.x + facing * 8
      const y = enemy.y + enemyRadius(enemy) - 29
      const flight = Math.max(0.3, Math.abs(state.knight.x - x) / SPEED)
      const floor = groundHeightAt(state, state.knight.x) ?? state.knight.y
      const vy = (floor - 29 - y) / flight - GRAVITY * flight / 2
      hazards.push({ id: next.nextId++, x, y, vx: facing * SPEED, vy, life: 2.4, kind: 'bone' })
      return { ...enemy, facing, timer: 1.8, bossPhase: 'hover' as const }
    }
    return timer > 0 ? { ...enemy, facing, timer } : { ...enemy, facing, bossPhase: 'warn' as const, timer: BONE_WINDUP }
  })
  next.enemies = enemies
  const movedHazards = hazards.flatMap(shot => {
    if (shot.kind === 'wave') return [shot]
    const vy = shot.vy + GRAVITY * dt
    const moved = { ...shot, x: shot.x + shot.vx * dt, y: shot.y + vy * dt, vy, life: shot.life - dt }
    const floor = groundHeightAt(state, moved.x)
    if (moved.life <= 0 || floor !== null && moved.y > floor) return []
    const k = next.knight
    if (Math.abs(moved.x - k.x) < 9 && moved.y > k.y - knightBodyHeight(k) && moved.y < k.y) {
      next = damageKnight(next)
      return []
    }
    return [moved]
  })
  return { ...next, hazards: movedHazards }
}

import { enemyRadius, groundHeightAt, type Enemy, type RunState } from './hubRunModel'
export const CRASH_PILLAR_X = 540

export function stepGargoyle(state: RunState, enemy: Enemy, dt: number): Enemy {
  const age = enemy.age + dt, flash = Math.max(0, enemy.flash - dt)
  if (enemy.dying > 0) return { ...enemy, dying: Math.max(0, enemy.dying - dt), age }
  const facing: 1 | -1 = state.knight.x < enemy.x ? -1 : 1
  if (enemy.bossPhase === 'enter') {
    if (Math.abs(state.knight.x - enemy.x) < 190 && state.knight.x > 540) {
      state.events.push({ type: 'crowCry', x: enemy.x, y: enemy.y })
      return { ...enemy, age, flash, awake: true, bossPhase: 'warn', timer: 1, facing, targetX: state.knight.x, targetY: (groundHeightAt(state, state.knight.x) ?? state.knight.y) - 35 }
    }
    return { ...enemy, age, flash, awake: true }
  }
  if (enemy.bossPhase === 'warn') {
    if (enemy.timer > dt) return { ...enemy, age, flash, timer: enemy.timer - dt }
    const dx = enemy.targetX - enemy.x, dy = enemy.targetY - enemy.y, length = Math.max(1, Math.hypot(dx, dy))
    return { ...enemy, age, flash, bossPhase: 'dive', timer: 1.5, vx: dx / length * 235, vy: dy / length * 235 }
  }
  const x = enemy.x + enemy.vx * dt, y = enemy.y + enemy.vy * dt
  const floor = groundHeightAt(state, x), pillar = enemy.vx < 0 && enemy.x > CRASH_PILLAR_X && x <= CRASH_PILLAR_X
  if (pillar || enemy.timer <= dt || floor !== null && y + enemyRadius(enemy) >= floor) {
    const at = floor === null ? enemy.y : floor - 12
    state.events.push({ type: 'gargoyleCrash', x, y: at })
    return { ...enemy, x, y: at, age, hp: 0, bossPhase: 'return', dying: 1.2, dyingFor: 1.2, vx: 0, vy: 0 }
  }
  return { ...enemy, x, y, age, flash, timer: enemy.timer - dt }
}

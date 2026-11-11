import { enemyRadius, groundHeightAt, type Enemy, type RunState } from './hubRunModel'

export function stepCorpses(state: RunState, dt: number): Enemy[] {
  return (state.corpses ?? []).flatMap(corpse => {
    const dying = corpse.dying - dt
    if (dying <= 0) return []
    if (!corpse.vx && !corpse.vy) return [{ ...corpse, dying }]
    const x = corpse.x + corpse.vx * dt
    let vy = corpse.vy + 650 * dt, y = corpse.y + vy * dt
    const ground = groundHeightAt(state, x)
    if (ground !== null && y + enemyRadius(corpse) >= ground) { y = ground - enemyRadius(corpse); vy = 0 }
    return [{ ...corpse, x, y, vy, vx: vy === 0 ? corpse.vx * Math.exp(-8 * dt) : corpse.vx, dying }]
  })
}

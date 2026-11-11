import { GRAVITY, groundHeightAt, type RescueActor, type RunState } from './hubRunModel'

type EscapeWorld = Pick<RunState, 'ground' | 'platforms' | 'height'> & Partial<Pick<RunState, 'cameraX'>>
export const RESCUE = { react: 0.3, climb: 0.35 } as const
const SPEED = 110
const MARGIN = 45

export function escapeTarget(state: Pick<RunState, 'ground' | 'platforms'> & Partial<Pick<RunState, 'cameraX'>>, _x: number, _upper: boolean, _facing: 1 | -1): number {
  return (state.cameraX ?? 0) - MARGIN
}

export function freedPrisoner(prisoner: number, x: number, y: number, _facing: 1 | -1, exitX: number): RescueActor {
  return { prisoner, x, y, phase: 'freed', timer: prisoner === 4 ? 1 : RESCUE.react, facing: -1, exitX, vy: 0 }
}

export function stepEscapes(state: EscapeWorld & Pick<RunState, 'escapes'>, dt: number): RescueActor[] {
  return (state.escapes ?? []).flatMap(actor => {
    const edge = (state.cameraX ?? 0) - MARGIN
    if (actor.x < edge && actor.phase === 'run') return []
    if (actor.phase === 'freed') return [{ ...actor, timer: actor.timer - dt, ...(actor.timer <= dt ? { phase: 'climb' as const, timer: RESCUE.climb, vy: -110 } : {}) }]
    const support = (x: number) => {
      const ground = groundHeightAt(state, x, 0)
      const tops = state.platforms.filter(p => x >= p.x0 && x <= p.x1 && p.y >= actor.y - 3).map(p => p.y)
      if (ground !== null) tops.push(ground)
      return tops.length ? Math.min(...tops) : null
    }
    const floor = support(actor.x), ahead = support(actor.x - 12)
    const onFloor = actor.vy === 0 && floor !== null && Math.abs(actor.y - floor) < 4
    let vy = actor.vy + GRAVITY * dt
    if (onFloor && ahead !== null && Math.abs(ahead - floor!) < 9) vy = 0
    if (onFloor && ahead === null) vy = -190
    const x = actor.x - (actor.phase === 'climb' ? 35 : SPEED) * dt
    const below = support(x)
    let y = actor.y + vy * dt
    if (vy >= 0 && below !== null && y >= below) { y = below; vy = 0 }
    const timer = actor.timer - dt
    const phase = actor.phase === 'climb' && timer > 0 ? 'climb' as const : 'run' as const
    return [{ ...actor, x, y, vy, phase, timer, facing: -1 as const, exitX: Math.min(actor.exitX, edge) }]
  })
}

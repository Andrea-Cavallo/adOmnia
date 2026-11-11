import {
  GRAVITY,
  JUMP_SPEED,
  RUN_SPEED,
  enemyRadius,
  groundHeightAt,
  groundY,
  spanHeight,
  type Enemy,
  type RunState,
} from './hubRunModel'

export function walkableSurface(
  state: Pick<RunState, 'ground' | 'platforms' | 'height'>,
  x: number,
  upper = false,
): number | null {
  let y = groundHeightAt(state, x, 0)
  if (upper)
    for (const platform of state.platforms) {
      if (x >= platform.x0 + 4 && x <= platform.x1 - 4 && (y === null || platform.y < y)) y = platform.y
    }
  return y
}

/** One placement contract for enemies, rewards and stage interactables. */
export function placeOnSurface(
  state: Pick<RunState, 'ground' | 'platforms' | 'height'>,
  x: number,
  halfWidth: number,
  upper = false,
): { x: number; y: number } | null {
  const y = walkableSurface(state, x, upper)
  if (y === null) return null
  const left = walkableSurface(state, x - halfWidth, upper)
  const right = walkableSurface(state, x + halfWidth, upper)
  if (left === null || right === null || Math.abs(left - y) > 6 || Math.abs(right - y) > 6) return null
  return { x, y }
}

export function validateEnemyPlacement(state: RunState, enemy: Enemy, safeRadius = 65): Enemy | null {
  if (Math.abs(enemy.x - state.knight.x) < safeRadius) return null
  if (enemy.kind === 'gargoyle') { const perch = walkableSurface(state, enemy.x, true) ?? groundY(state.height); return { ...enemy, y: perch - 12, baseY: perch - 12 } }
  if (['bat', 'bird', 'ghost', 'skull', 'reaper'].includes(enemy.kind)) {
    const surface = groundHeightAt(state, enemy.x) ?? groundY(state.height)
    return { ...enemy, y: surface - 42, baseY: surface - 42 }
  }
  const point = placeOnSurface(state, enemy.x, 7)
  if (!point) return null
  const head = point.y - enemyRadius(enemy) * 2
  if (
    state.platforms.some(
      (platform) =>
        enemy.x + 7 > platform.x0 && enemy.x - 7 < platform.x1 && head < platform.y + 6 && point.y > platform.y,
    )
  )
    return null
  const y = point.y - enemyRadius(enemy)
  return { ...enemy, y, baseY: y, targetY: y }
}

/** Conservative forward graph: walk connected ground and jump only within the real arc. */
export function cemeteryReachable(
  state: Pick<RunState, 'ground' | 'height'>,
  maxJumpHeight: number,
  maxJumpDistance: number,
): boolean {
  return state.ground.every((span, index) => {
    if (!index) return true
    const previous = state.ground[index - 1]
    const gap = span.x0 - previous.x1
    const rise = spanHeight(previous, previous.x1, state.height) - spanHeight(span, span.x0, state.height)
    return gap <= maxJumpDistance && rise <= maxJumpHeight
  })
}

export function objectiveReachable(
  state: Pick<RunState, 'ground' | 'platforms' | 'height'>,
  x: number,
  upper = false,
): boolean {
  const surfaces = [
    ...state.ground,
    ...state.platforms.map((platform) => ({ ...platform, y0: platform.y, y1: platform.y })),
  ]
  const target = walkableSurface(state, x, upper)
  const visited = new Set<number>()
  const queue = surfaces.flatMap((surface, index) => (surface.x0 <= 40 && surface.x1 >= 40 ? [index] : []))
  while (queue.length) {
    const index = queue.shift()!
    if (visited.has(index)) continue
    visited.add(index)
    const from = surfaces[index]
    if (target !== null && x >= from.x0 && x <= from.x1 && Math.abs(spanHeight(from, x, state.height) - target) < 1)
      return true
    for (let next = 0; next < surfaces.length; next++) {
      if (visited.has(next)) continue
      const to = surfaces[next]
      const overlap = Math.max(from.x0, to.x0) <= Math.min(from.x1, to.x1)
      const takeoff = overlap
        ? (Math.max(from.x0, to.x0) + Math.min(from.x1, to.x1)) / 2
        : from.x1 < to.x0
          ? from.x1
          : from.x0
      const landing = Math.max(to.x0, Math.min(to.x1, takeoff))
      const rise = spanHeight(from, takeoff, state.height) - spanHeight(to, landing, state.height)
      const discriminant = JUMP_SPEED ** 2 - 2 * GRAVITY * rise
      if (discriminant < 0) continue
      const reach = (RUN_SPEED * (JUMP_SPEED + Math.sqrt(discriminant))) / GRAVITY
      if (Math.abs(landing - takeoff) + (overlap ? 0 : 6) <= reach) queue.push(next)
    }
  }
  return false
}

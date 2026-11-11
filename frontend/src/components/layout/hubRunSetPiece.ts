import { blankEnemy } from './hubRunEnemies'
import { damageEnemy, groundHeightAt, swinging, type RunInput, type RunState } from './hubRunRules'
import { validateEnemyPlacement } from './hubRunPlacement'

export const FALLING_GRAVE_X = 570
export const INTRO_WALL_X = 940

function companion(state: RunState, x: number, kind: 'zombie' | 'bonecaster'): RunState {
  const placed = validateEnemyPlacement(state, blankEnemy(state.nextId, kind, x, 0), 45)
  return placed ? { ...state, nextId: state.nextId + 1, enemies: [...state.enemies, { ...placed, emerging: kind === 'bonecaster', awake: kind === 'zombie', age: kind === 'zombie' ? 1 : 0, hp: kind === 'bonecaster' ? 2 : 1, maxHp: kind === 'bonecaster' ? 2 : 1 }] } : state
}

/** The opening sequence follows actions, rather than stopping the player for a timed cutscene. */
export function stepSetPiece(state: RunState, input: RunInput): RunState {
  let next = { ...state }
  const stage = { ...state.stage!, triggered: [...state.stage!.triggered] }
  const first = state.enemies.find(e => e.kind === 'zombie' && e.armLost && e.x < 560)
  if (first && !stage.triggered.includes('intro-companion')) {
    next = companion(next, first.x + 55, 'zombie')
    stage.triggered.push('intro-companion')
  }
  const gargoyle = state.enemies.find(e => e.kind === 'gargoyle')
  if (stage.triggered.includes('mausoleum') && (!gargoyle || gargoyle.hp <= 0)) stage.triggered.push(...stage.triggered.includes('intro-gargoyle-resolved') ? [] : ['intro-gargoyle-resolved'])
  const k = state.knight, floor = groundHeightAt(state, FALLING_GRAVE_X)
  if (floor !== null && stage.fallenStoneAt === undefined && Math.abs(k.x - FALLING_GRAVE_X) < 32 && Math.abs(k.y - floor) < 30 && (input.interact || swinging(k))) {
    stage.fallenStoneAt = stage.elapsed; stage.stoneDirection = k.facing
    next.events.push({ type: 'topple', x: FALLING_GRAVE_X, y: floor })
  }
  if (stage.fallenStoneAt !== undefined && stage.elapsed - stage.fallenStoneAt > 0.24 && !stage.triggered.includes('intro-stone-landed')) {
    stage.triggered.push('intro-stone-landed')
    const x = FALLING_GRAVE_X + (stage.stoneDirection ?? 1) * 25
    for (const enemy of next.enemies) if (enemy.hp > 0 && Math.abs(enemy.x - x) < 48 && Math.abs(enemy.y - (floor ?? enemy.y)) < 55)
      next = damageEnemy(next, enemy.id, 4)
  }
  if (stage.rescued.includes(4) && !stage.triggered.includes('intro-prisoner-hint')) {
    stage.triggered.push('intro-prisoner-hint')
    next.events.push({ type: 'reward', text: 'THE WALL TO THE RIGHT… THERE IS SOMETHING BEHIND IT!', x: 920, y: (groundHeightAt(next, 920) ?? k.y) - 43 })
  }
  if (stage.secrets.includes(3) && !stage.triggered.includes('intro-treasure-bell')) {
    stage.triggered.push('intro-treasure-bell')
    next.events.push({ type: 'distantBell', x: INTRO_WALL_X + 100, y: k.y - 35 })
    next = companion(next, 1140, 'bonecaster')
  }
  return { ...next, stage }
}

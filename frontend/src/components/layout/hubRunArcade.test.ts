import { describe, expect, it } from 'vitest'
import { cemeteryGrade } from './hubRunArcade'
import { startCemeteryRun, stepCemeteryRun } from './hubRunCemetery'
import { blankEnemy, bossAt } from './hubRunEnemies'
import { placeOnSurface, objectiveReachable } from './hubRunPlacement'
import { CEMETERY } from './hubRunStages'
import { groundHeightAt, type RunInput, type RunState } from './hubRunRules'

const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }
const tick = (state: RunState, input: Partial<RunInput> = {}) => stepCemeteryRun(state, { ...idle, ...input }, 1 / 60)
/** A run past the gate and the defence, so no barrier stops him. */
const open = (): RunState => {
  const state = startCemeteryRun(464, 218)
  return { ...state, phase: 'playing', stage: { ...state.stage!, key: true, gate: true, defended: true } }
}
const standAt = (state: RunState, x: number, upper = false): RunState => ({
  ...state,
  knight: { ...state.knight, x, y: placeOnSurface(state, x, 3, upper)!.y, grounded: true, vx: 0, facing: 1 },
})

describe('cemetery arcade systems', () => {
  it('opens a chest with slash input, grants actual lance ammunition only once, and records its opening', () => {
    let state = standAt(open(), 710, true)
    expect(tick(state).stage!.openedChests).toEqual([])
    state = tick(state, { attack: true })
    expect(state.stage!.openedChests).toContain(0)
    expect(state.stage!.chestOpenedAt?.[0]).toBeDefined()
    expect(state.stage).toMatchObject({ weapon: 'lance', weaponCharges: 12 })
    state = tick(state, { throwSword: true })
    expect(state.swords[0]).toMatchObject({ weapon: 'lance', damage: 2 })
    state = tick(state, { interact: true })
    expect(state.stage!.weaponCharges).toBe(11)
  })

  it('gives a restorative potion and a real temporary melee upgrade from the other two chests', () => {
    let state = standAt(open(), 1715, true)
    state.stage!.armor = 0
    state = tick(state, { interact: true })
    expect(state.stage!.openedChests).toContain(1)
    expect(state.stage!.armor).toBe(1)
    expect(state.shield).toBe(8)
    state = standAt(state, 3320, true)
    state = tick(state, { attack: true })
    expect(state.stage!.openedChests).toContain(2)
    expect(state.wide).toBe(30)
  })

  it('cannot open an elevated chest from the ground or at a distance', () => {
    expect(tick(standAt(open(), 710), { interact: true }).stage!.openedChests).toEqual([])
    expect(tick(standAt(open(), 650), { attack: true }).stage!.openedChests).toEqual([])
  })

  it('keeps the four optional platforms reachable and gives each a reward or secret', () => {
    const state = open()
    expect(state.platforms).toHaveLength(4)
    for (const target of [...CEMETERY.chests, ...CEMETERY.secrets, ...CEMETERY.prisoners])
      expect(objectiveReachable(state, target.x, target.upper ?? false)).toBe(true)
    for (const platform of state.platforms)
      expect([...CEMETERY.chests, ...CEMETERY.secrets, ...CEMETERY.prisoners].some(p => p.x >= platform.x0 && p.x <= platform.x1)).toBe(true)
  })

  it('frees a prisoner with the weapon and hands over his reward on the spot', () => {
    const monk = CEMETERY.prisoners[0]
    let state = standAt(open(), monk.x - 12, monk.upper)
    const coins = state.stats.coins
    state = tick(state, { attack: true })
    for (let i = 0; i < 6; i++) state = tick(state)
    expect(state.stage!.rescued).toContain(monk.id)
    expect(state.stats.coins).toBe(coins + 25)
  })

  it('spends lance charges and falls back to the sword when they run out', () => {
    let state = open()
    state = { ...state, stage: { ...state.stage!, weapon: 'lance', weaponCharges: 1 } }
    state = tick(state, { throwSword: true })
    expect(state.swords[0]).toMatchObject({ weapon: 'lance' })
    expect(state.stage!.weapon).toBe('sword')
  })

  it('makes a grave-burster warn, then burst and hurt a knight standing close', () => {
    let state = standAt(open(), 2000)
    const floor = groundHeightAt(state, 2040)!
    state = { ...state, enemies: [{ ...blankEnemy(900, 'burster', 2040, floor - 16), awake: true, age: 1 }] }
    state = tick(state)
    expect(state.enemies[0].bossPhase).toBe('warn')
    let burst = false
    for (let i = 0; i < 60 && !burst; i++) {
      state = tick(state)
      burst = state.events.some((event) => event.type === 'burst')
    }
    expect(burst).toBe(true)
    expect(state.stage!.armor).toBeLessThan(2)
  })

  it('makes the wounded Grave Guardian toll the bell and raise the dead once per threshold', () => {
    let state = standAt(open(), CEMETERY.bossTrigger + 100)
    const guardian = { ...bossAt(state.nextId, 'warden', CEMETERY.boss, 0, 12), hp: 6, timer: 5 }
    state = { ...state, nextId: state.nextId + 1, stage: { ...state.stage!, triggered: ['warden'] }, enemies: [guardian] }
    state = tick(state)
    const raised = state.enemies.filter((enemy) => enemy.kind === 'zombie').length
    expect(raised).toBeGreaterThan(0)
    expect(state.stage!.triggered).toContain('bell-toll-0')
    state = tick(state)
    expect(state.enemies.filter((enemy) => enemy.kind === 'zombie').length).toBe(raised)
  })

  it('silences the bell for good only with the sacred blade', () => {
    const silence = (holyWeapon: boolean) => {
      let state = standAt(open(), CEMETERY.bell - 30)
      state = { ...state, stage: { ...state.stage!, prisoner: true, checkpoint: CEMETERY.checkpoint, bossDefeated: true, bellHp: 1, holyWeapon } }
      state = tick(state, { attack: true })
      for (let i = 0; i < 10 && !state.stage!.ending; i++) state = tick(state)
      return state.stage!.ending
    }
    expect(silence(true)).toBe('true')
    expect(silence(false)).toBe('half')
  })

  it('grades a clean, thorough run above a slow, careless one', () => {
    expect(cemeteryGrade({ elapsed: 150, damageTaken: 0, rescued: [0, 1, 2], secrets: [0, 1, 2] })).toBe('S')
    expect(cemeteryGrade({ elapsed: 600, damageTaken: 5, rescued: [1], secrets: [] })).toBe('C')
  })
})

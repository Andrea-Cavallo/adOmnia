import { describe, expect, it } from 'vitest'
import { restoreCemeteryCheckpoint, startCemeteryRun, stepCemeteryRun, CEMETERY_JUMP } from './hubRunCemetery'
import { cemeteryReachable, objectiveReachable, placeOnSurface, validateEnemyPlacement } from './hubRunPlacement'
import { CEMETERY, cemeteryObjective } from './hubRunStages'
import { blankEnemy } from './hubRunEnemies'
import { groundHeightAt, groundY, tangible, type RunInput, type RunState } from './hubRunRules'

const idle: RunInput = { left: false, right: false, jump: false, jumpHeld: false, attack: false, special: false }
const fresh = () => startCemeteryRun(464, 218)
const at = (state: RunState, x: number): RunState => ({
  ...state,
  knight: { ...state.knight, x, y: groundHeightAt(state, x)!, grounded: true, vx: 0 },
})
const tick = (state: RunState, input: Partial<RunInput> = {}, dt = 1 / 60) =>
  stepCemeteryRun(state, { ...idle, ...input }, dt)

describe('authored cemetery stage', () => {
  it('loses the equipment on the first contact and dies on the next unprotected hit', () => {
    let state = { ...fresh(), phase: 'playing' as const }
    const contact = (s: RunState) => {
      const enemy = { ...blankEnemy(999, 'zombie', s.knight.x, s.knight.y - 16), awake: true, age: 2 }
      return tick({ ...s, knight: { ...s.knight, invulnerable: 0 }, enemies: [enemy] })
    }
    state = contact(state) as typeof state
    expect(state.phase).toBe('playing')
    expect(state.hearts).toBe(1)
    expect(state.stage!.armor).toBe(0)
    expect(state.events.some(event => event.type === 'armorBreak')).toBe(true)
    expect(state.debris?.some(piece => piece.kind === 'helmet')).toBe(true)
    expect(contact(state).phase).toBe('over')
  })

  it('starts safely and uses a finite, reachable route with an elevated alternative', () => {
    const state = fresh()
    expect(state.enemies).toHaveLength(0)
    expect(state.ground[state.ground.length - 1].x1).toBeLessThan(4500)
    expect(state.platforms.length).toBeGreaterThan(2)
    expect(cemeteryReachable(state, CEMETERY_JUMP.height, CEMETERY_JUMP.distance)).toBe(true)
    for (const x of [CEMETERY.key, CEMETERY.gate, CEMETERY.prisoner, CEMETERY.checkpoint, CEMETERY.bell])
      expect(placeOnSurface(state, x, 3)).not.toBeNull()
    for (const x of [CEMETERY.key, CEMETERY.gate, CEMETERY.prisoner, CEMETERY.checkpoint, CEMETERY.bell])
      expect(objectiveReachable(state, x)).toBe(true)
    expect(objectiveReachable(state, CEMETERY.chest, true)).toBe(true)
  })

  it('crouches the knight by itself in the low crypt passage and lets him stand after leaving', () => {
    let state = at(fresh(), CEMETERY.crypt.lowStart - 1)
    state.stage = { ...state.stage!, key: true, gate: true, defended: true, prisoner: true }
    state.knight.vx = 95
    state = tick(state, { right: true })
    state = tick(state, { right: true })
    expect(state.knight.x).toBeGreaterThan(CEMETERY.crypt.lowStart)
    expect(state.knight.crouching).toBe(true)
    state = tick(state, { right: true, jump: true })
    expect(state.knight.crouching).toBe(true)
    expect(state.knight.grounded).toBe(true)
    state = tick(at(state, CEMETERY.crypt.lowEnd + 4))
    expect(state.knight.crouching).toBe(false)
  })

  it('validates safe distance, ground support and flying placement', () => {
    const state = fresh()
    expect(validateEnemyPlacement(state, blankEnemy(1, 'zombie', 45, 0))).toBeNull()
    expect(validateEnemyPlacement(state, blankEnemy(1, 'zombie', 2475, 0))).toBeNull()
    const enemy = validateEnemyPlacement(state, blankEnemy(1, 'zombie', 440, 0))!
    expect(enemy.y + 16).toBe(groundHeightAt(state, 440))
    expect(validateEnemyPlacement(state, blankEnemy(2, 'bat', 440, 0))!.y).toBeLessThan(enemy.y)
  })

  it('triggers encounters once and makes the first zombie emerge without touching the player', () => {
    let state = tick(at(fresh(), 275))
    expect(state.enemies).toHaveLength(1)
    expect(state.enemies[0].emerging).toBe(true)
    expect(tangible(state.enemies[0])).toBe(false)
    state = { ...state, enemies: [] }
    expect(tick(state).enemies).toHaveLength(0)
  })

  it('keeps the gate closed until the crypt key has been collected', () => {
    let state = tick(at(fresh(), CEMETERY.gate))
    expect(state.knight.x).toBeLessThan(CEMETERY.gate)
    expect(state.stage!.gate).toBe(false)
    state = tick(at(state, CEMETERY.key))
    expect(state.stage!.key).toBe(true)
    state = tick(at(state, CEMETERY.gate - 20))
    expect(state.stage!.gate).toBe(true)
    expect(cemeteryObjective(state.stage!)).toBe(2)
  })

  it('rewards the roof route with a lance that really deals more damage', () => {
    let state = fresh()
    state.knight = { ...state.knight, x: CEMETERY.chest, y: placeOnSurface(state, CEMETERY.chest, 3, true)!.y }
    state = tick(state, { interact: true })
    expect(state.stage!.weapon).toBe('lance')
    state = tick(state, { throwSword: true })
    expect(state.swords[0]).toMatchObject({ weapon: 'lance', damage: 2, vx: 330 })
  })

  it('restores the chapel checkpoint while retaining the key, rescued prisoner and weapon', () => {
    let state = fresh()
    state.stage = { ...state.stage!, key: true, gate: true, defended: true, prisoner: true, weapon: 'lance', weaponCharges: 12, weapons: ['sword', 'lance'] }
    state = tick(at(state, CEMETERY.checkpoint))
    expect(state.stage!.checkpoint).toBe(CEMETERY.checkpoint)
    state = restoreCemeteryCheckpoint({ ...state, phase: 'over', hearts: 0 })
    expect(state.phase).toBe('playing')
    expect(state.knight.x).toBe(CEMETERY.checkpoint)
    expect(state.stage).toMatchObject({ key: true, prisoner: true, weapon: 'lance', armor: 1 })
  })

  it('requires the guardian before the bell, then opens the exit only after three bell hits', () => {
    let state = fresh()
    state.stage = {
      ...state.stage!,
      key: true,
      gate: true,
      defended: true,
      prisoner: true,
      checkpoint: CEMETERY.checkpoint,
    }
    state = at(state, CEMETERY.bell - 20)
    state = tick(state, { attack: true })
    expect(state.stage!.bellHp).toBe(3)
    state.stage = { ...state.stage!, bossDefeated: true }
    state.enemies = []
    for (let hit = 0; hit < 3; hit++) {
      state = at(state, CEMETERY.bell - 20)
      state.knight.attack = 0.05
      state.stage!.bellGrace = 0
      state = tick(state)
    }
    expect(state.stage!.bellDestroyed).toBe(true)
    state = tick(at(state, CEMETERY.end - 35))
    expect(state.phase).toBe('complete')
    expect(state.enemies).toHaveLength(0)
  })

  it('lets crouching avoid a high flyer, but restores the standing hurtbox on release', () => {
    let state = fresh()
    const floor = groundY(state.height)
    state.builtTo = 100000
    state.enemies = [{ ...blankEnemy(200, 'bird', 40, floor - 32), awake: true }]
    const low = tick(state, { crouch: true })
    expect(low.knight.crouching).toBe(true)
    expect(low.stage!.armor).toBe(1)
    const upright = tick({ ...low, enemies: state.enemies }, { crouch: false })
    expect(upright.knight.crouching).toBe(false)
    expect(upright.stage!.armor).toBe(0)
  })
})

describe('Grave Guardian cannot be stun-locked', () => {
  it('still attacks a knight who stands still spamming throws', () => {
    let state = at(fresh(), CEMETERY.bossTrigger + 10)
    state = {
      ...state,
      knight: { ...state.knight, facing: 1 },
      stage: { ...state.stage!, key: true, gate: true, defended: true, prisoner: true, checkpoint: CEMETERY.checkpoint, triggered: CEMETERY.encounters.map((e) => e.id) },
    }
    let attacks = 0
    let previous = ''
    for (let t = 0; t < 30 && !state.stage!.bossDefeated && state.phase === 'playing'; t += 1 / 60) {
      state = tick({ ...state, events: [] }, { throwSword: true })
      const phase = state.enemies.find((enemy) => enemy.kind === 'warden')?.bossPhase ?? previous
      if (phase === 'warn' && previous !== 'warn') attacks++
      previous = phase
    }
    expect(attacks).toBeGreaterThanOrEqual(2)
    // Standing still is no longer free: the attacks land.
    expect(state.stage!.damageTaken).toBeGreaterThan(0)
  })
})

describe('gravedigger reward', () => {
  it('restores the armor fully instead of lowering it', () => {
    let state = at(fresh(), CEMETERY.prisoner - 20)
    state = { ...state, knight: { ...state.knight, facing: 1, attack: 0.1 }, stage: { ...state.stage!, key: true, gate: true, defended: true, armor: 1 } }
    state = tick(state, { attack: true })
    for (let i = 0; i < 20 && !state.stage!.rescued.includes(1); i++) state = tick(state, { attack: i % 2 === 0 })
    expect(state.stage!.rescued).toContain(1)
    expect(state.stage!.armor).toBe(1)
  })
})

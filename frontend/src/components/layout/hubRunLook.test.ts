import { describe, expect, it } from 'vitest'
import { FROG_CROUCH, blankEnemy, bossAt } from './hubRunEnemies'
import { critterOptions, enemyShown, trembleOf, warningShown } from './hubRunLook'
import { ghostVisibility, type Enemy } from './hubRunRules'

const ageWhere = (wanted: ReturnType<typeof ghostVisibility>) => [...Array(30)].map((_, i) => i / 10).find((age) => ghostVisibility(age) === wanted)!
/** Clocks on both sides of every blink rate used, so a blink shows as on in one and off in the other. */
const CLOCKS = [0, 0.03, 0.06, 0.09, 0.12]

describe('hub run look', () => {
  it('colors a big slime and the ghost boss apart from the ordinary ones', () => {
    const slime = blankEnemy(1, 'slime', 0, 0)
    expect(critterOptions(slime).palette).toBeUndefined()
    expect(critterOptions({ ...slime, big: true }).palette).toHaveLength(7)
    expect(critterOptions(bossAt(2, 'ghost', 0, 0)).palette).toHaveLength(7)
    expect(critterOptions(bossAt(3, 'skull', 0, 0)).palette).toBeUndefined()
  })

  it('hides a hidden ghost, blinks a fading one and always shows a solid one', () => {
    const ghost = { ...blankEnemy(1, 'ghost', 0, 0), awake: true }
    const shown = (enemy: Enemy) => CLOCKS.map((clock) => enemyShown(enemy, clock))
    expect(shown({ ...ghost, age: ageWhere('solid') }).every(Boolean)).toBe(true)
    expect(shown({ ...ghost, age: ageWhere('hidden') }).some(Boolean)).toBe(false)
    const fading = shown({ ...ghost, age: ageWhere('fading') })
    expect(fading).toContain(true)
    expect(fading).toContain(false)
  })

  it('blinks a struck boss and shows the dive warning only while it warns', () => {
    const boss = bossAt(1, 'skull', 0, 0)
    expect(CLOCKS.map((clock) => enemyShown({ ...boss, flash: 0.2 }, clock))).toContain(false)
    expect(CLOCKS.every((clock) => enemyShown(boss, clock))).toBe(true)
    expect(CLOCKS.some((clock) => warningShown({ ...boss, bossPhase: 'warn' }, clock))).toBe(true)
    expect(CLOCKS.some((clock) => warningShown({ ...boss, bossPhase: 'hover' }, clock))).toBe(false)
  })

  it('makes only a crouching frog tremble', () => {
    const frog = blankEnemy(1, 'frog', 0, 0)
    expect(CLOCKS.map((clock) => trembleOf({ ...frog, hop: FROG_CROUCH / 2 }, clock))).toEqual(expect.arrayContaining([1, -1]))
    expect(trembleOf({ ...frog, hop: FROG_CROUCH * 3 }, 0)).toBe(0)
    expect(trembleOf(blankEnemy(2, 'slime', 0, 0), 0)).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { qualityEnemyFrame } from './hubQualityArt'
import { blankEnemy } from './hubRunEnemies'

describe('painted enemy animation', () => {
  it('walks through four distinct zombie poses as it covers ground', () => {
    const enemy = { ...blankEnemy(1, 'zombie', 100, 100), vx: -20 }
    expect([0, 7, 14, 21].map(stride => qualityEnemyFrame({ ...enemy, stride }))).toEqual([0, 1, 2, 3])
    expect(qualityEnemyFrame({ ...enemy, vx: 0, stride: 21 })).toBe(0)
  })
  it('shows the bone thrower wind-up and Guardian hammer strike', () => {
    expect(qualityEnemyFrame({ ...blankEnemy(1, 'bonecaster', 0, 0), bossPhase: 'warn' })).toBe(5)
    expect(qualityEnemyFrame({ ...blankEnemy(2, 'warden', 0, 0), bossPhase: 'slam' })).toBe(11)
  })
})

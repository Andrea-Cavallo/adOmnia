import { it, expect } from 'vitest'
import { startCemeteryRun, stepCemeteryRun } from './hubRunCemetery'
import { CEMETERY } from './hubRunStages'
it('can finish the cemetery using only movement, jumps and weapon inputs', () => {
  let s = startCemeteryRun(464, 218)
  let jumpHeld = 0
  let jumpCooldown = 0
  let max = 0
  for (let frame = 0; frame < 18000 && s.phase === 'playing'; frame++) {
    const g = s.stage!
    const k = s.knight
    let target = CEMETERY.key
    if (g.key && !g.gate) target = CEMETERY.gate + 20
    else if (g.gate && !g.defended) target = CEMETERY.waveTrigger + 120
    else if (g.defended && !g.prisoner) target = CEMETERY.prisoner
    else if (g.prisoner && !g.checkpoint) target = CEMETERY.checkpoint + 20
    else if (g.checkpoint && !g.bossDefeated) target = CEMETERY.bossTrigger + 60
    else if (g.bossDefeated && !g.bellDestroyed) target = CEMETERY.bell - 130
    else if (g.bellDestroyed) target = CEMETERY.end
    const enemies = s.enemies.filter((e) => e.awake && Math.abs(e.x - k.x) < 170)
    if (g.gate && !g.defended && g.waveTime > 0 && enemies.length) {
      const e = enemies.sort((a, b) => Math.abs(a.x - k.x) - Math.abs(b.x - k.x))[0]
      target = e.x > k.x ? k.x + 6 : k.x - 6
    }
    jumpCooldown = Math.max(0, jumpCooldown - 1 / 60)
    jumpHeld = Math.max(0, jumpHeld - 1 / 60)
    const nearGap = k.x > 2440 && k.x < 2460
    const boss = enemies.find((e) => e.boss)
    const incomingWave = (s.hazards ?? []).some(shot => shot.kind === 'wave' && (k.x - shot.x) * shot.vx > 0 && Math.abs(shot.x - k.x) < 70)
    const closeThreat = enemies.some(e => e.kind === 'zombie' && e.hp > 1 && Math.abs(e.x - k.x) < 60 || e.kind === 'gargoyle' && e.bossPhase === 'dive' && Math.abs(e.x - k.x) < 95)
    const leap = k.grounded && jumpCooldown <= 0 && (nearGap || incomingWave || closeThreat || (boss?.bossPhase === 'warn' && boss.bossAttack !== 'slam' && boss.timer < 0.2))
    if (leap) {
      jumpHeld = 0.6
      jumpCooldown = 0.8
    }
    s = stepCemeteryRun(
      s,
      {
        left: target < k.x - 4,
        right: target > k.x + 4,
        jump: leap,
        jumpHeld: jumpHeld > 0,
        attack: enemies.some((e) => Math.abs(e.x - k.x) < 40),
        throwSword: true,
        crouch: k.x > CEMETERY.crypt.lowStart - 15 && k.x < CEMETERY.crypt.lowEnd + 10,
        special: false,
      },
      1 / 60,
    )
    max = Math.max(max, s.knight.x)
  }
  expect(max).toBeGreaterThan(CEMETERY.end - 40)
  expect(s.stage).toMatchObject({
    key: true,
    gate: true,
    defended: true,
    prisoner: true,
    bossDefeated: true,
    bellDestroyed: true,
  })
  expect(s.phase).toBe('complete')
})

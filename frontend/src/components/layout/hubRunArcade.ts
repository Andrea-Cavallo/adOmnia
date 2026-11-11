import { CEMETERY_URNS } from './hubRunStages'
import { ARMOR, grantCemeteryArmor } from './hubRunEquipment'
import { stepBones } from './hubRunBones'
import { CEMETERY, type CemeteryProgress } from './hubRunStages'
import { placeOnSurface } from './hubRunPlacement'
import { blankEnemy } from './hubRunEnemies'
import { escapeTarget, freedPrisoner, stepEscapes } from './hubRunRescue'
import { damageKnight, knightBodyHeight, swinging, type RunInput, type RunState } from './hubRunRules'

export function cemeteryGrade(stage: Pick<CemeteryProgress, 'elapsed' | 'damageTaken' | 'rescued' | 'secrets'>): 'S' | 'A' | 'B' | 'C' {
  const score = stage.rescued.length * 20 + stage.secrets.length * 20 - stage.damageTaken * 15 - Math.max(0, stage.elapsed - 180) / 6
  return score >= 110 ? 'S' : score >= 70 ? 'A' : score >= 25 ? 'B' : 'C'
}

export function stageWeaponHit(state: RunState, x: number, y: number, width = 16, height = 34): boolean {
  const k = state.knight
  if (swinging(k) && (x - k.x) * k.facing > -8 && (x - k.x) * k.facing < 40 + width && k.y > y - height && k.y - knightBodyHeight(k) < y) return true
  return state.swords.some((sword) => Math.min(sword.previousX, sword.x) - 12 < x + width && Math.max(sword.previousX, sword.x) + 12 > x - width && sword.y < y && sword.y > y - height)
}

export function stepArcade(state: RunState, input: RunInput, dt: number): RunState {
  let next = { ...state }
  const stage = { ...state.stage!, rescued: [...state.stage!.rescued], secrets: [...state.stage!.secrets], openedChests: [...state.stage!.openedChests] }
  const reward = (text: string, x: number, y: number) => next.events.push({ type: 'reward', text, x, y })
  for (const event of [{ x: 920, kind: 'crows' as const }, { x: 3000, kind: 'masonry' as const }]) {
    const id = 'ambient-' + event.kind
    if (next.knight.x < event.x || stage.triggered.includes(id)) continue
    stage.triggered = [...stage.triggered, id]
    stage.ambientEvents = [...(stage.ambientEvents ?? []), { ...event, time: stage.elapsed }]
  }
  const armorReward = () => { Object.assign(stage, grantCemeteryArmor({ ...next, stage }).stage); next.hearts = 2; reward('GREEN ARMOR · LIFE RESTORED', next.knight.x, next.knight.y - 40) }
  const near = (x: number, upper = false) => {
    const p = placeOnSurface(next, x, 3, upper)
    return p && Math.abs(next.knight.x - x) < 20 && Math.abs(next.knight.y - p.y) < 18 ? p : null
  }
  for (const prisoner of CEMETERY.prisoners) {
    if (prisoner.id === 3 && (!stage.secrets.includes(1) || stage.elapsed - (stage.secretFoundAt?.[1] ?? stage.elapsed) < 0.6)) continue
    if (prisoner.id === 4 && !stage.triggered.includes('intro-gargoyle-resolved')) continue
    if (stage.rescued.includes(prisoner.id) || (prisoner.id === 1 && !stage.defended)) continue
    const p = placeOnSurface(next, prisoner.x, 3, prisoner.upper)
    if (!p || !(stageWeaponHit(next, p.x, p.y, 10, 36) || input.interact && Math.abs(next.knight.x - p.x) < 25 && Math.abs(next.knight.y - p.y) < 20)) continue
    stage.rescued.push(prisoner.id)
    if (prisoner.reward === 'armor') stage.armor = 1
    if (prisoner.reward === 'armor') next.shield = Math.max(next.shield, 8)
    if (prisoner.reward === 'coins') { next.points += 100; next.stats = { ...next.stats, coins: next.stats.coins + 25 } }
    if (prisoner.id === 0) armorReward()
    stage.prisoner = stage.rescued.includes(1)
    const facing: 1 | -1 = -1
    next.escapes = [...(next.escapes ?? []), freedPrisoner(prisoner.id, p.x, p.y, facing, escapeTarget(next, p.x, prisoner.upper, facing))]
    next.events.push({
      type: 'rescue', name: prisoner.name,
      reward: prisoner.reward === 'armor' ? 'ARMOR RESTORED' : '+25 COINS',
      x: p.x, y: p.y - 38,
    })
  }
  for (const secret of CEMETERY.secrets) {
    if (stage.secrets.includes(secret.id)) continue
    const p = placeOnSurface(next, secret.x, 3, secret.upper)
    if (!p) continue
    const struck = stageWeaponHit(next, p.x, p.y, 14, 32)
    if ((secret.id === 2 || secret.id === 3) && !(stage.revealedSecrets ?? []).includes(secret.id)) {
      if (struck) {
        stage.revealedSecrets = [...(stage.revealedSecrets ?? []), secret.id]
        reward('A HIDDEN NICHE…', p.x, p.y - 30)
      }
      continue
    }
    if (secret.id === 2 || secret.id === 3 ? !near(secret.x, secret.upper) : !struck) continue
    stage.secrets.push(secret.id)
    stage.secretFoundAt = { ...stage.secretFoundAt, [secret.id]: stage.elapsed }
    if (secret.id === 0) { armorReward(); next.shield = 6; next.stats = { ...next.stats, coins: next.stats.coins + 25 } }
    if (secret.id === 2) { stage.holyWeapon = true; armorReward() }
    if (secret.id === 3) next.stats = { ...next.stats, coins: next.stats.coins + 50 }
    next.points += 100
    reward(secret.id === 3 ? 'ANCIENT TREASURE · +50 COINS' : secret.id === 2 ? 'SACRED BLADE FOUND' : secret.id === 1 ? 'SOMEONE IS STILL ALIVE!' : 'HIDDEN CACHE · ARMOR +25 COINS', p.x, p.y - 25)
  }
  for (const chest of CEMETERY.chests) {
    if (stage.openedChests.includes(chest.id)) continue
    const p = near(chest.x, chest.upper)
    if (!p || !(input.interact || input.attack || stageWeaponHit(next, p.x, p.y, 14, 24))) continue
    stage.openedChests.push(chest.id)
    stage.chestOpenedAt = { ...stage.chestOpenedAt, [chest.id]: stage.elapsed }
    if (chest.contents === 'hammer' || chest.contents === 'daggers') {
      stage.weapon = chest.contents; stage.weapons = [...new Set([...stage.weapons, chest.contents])]
      reward(chest.contents === 'hammer' ? 'HAMMER [2] · CLOSE RANGE / HEAVY IMPACT' : 'DAGGERS [3] · AIM WITH ARROWS + D', p.x, p.y - 22)
    }
    else if (chest.contents === 'lance') { stage.weapon = 'lance'; stage.weapons = [...new Set([...stage.weapons, 'lance' as const])]; stage.weaponCharges = 12; reward('LANCE [4] · 12 THROWS', p.x, p.y - 22) }
    else if (chest.contents === 'potion') { stage.armor = ARMOR[stage.armorTier].hits; next.hearts = stage.armorTier === 'verdant' ? 2 : 1; next.shield = 8; reward('RESTORATION POTION · ARMOR + WARD', p.x, p.y - 22) }
    else { stage.weapon = 'sword'; next.wide = 30; reward('BLESSED SWORD [1] · 30s', p.x, p.y - 22) }
  }
  for (let id = 0; id < CEMETERY_URNS.length; id++) {
    const p = placeOnSurface(next, CEMETERY_URNS[id], 3)
    if (!p || stage.brokenUrns?.includes(id) || !stageWeaponHit(next, p.x, p.y, 9, 18)) continue
    stage.brokenUrns = [...(stage.brokenUrns ?? []), id]
    stage.urnBrokenAt = { ...stage.urnBrokenAt, [id]: stage.elapsed }
    next.stats = { ...next.stats, coins: next.stats.coins + 10 }; next.points += 50
    reward('URN · +10 COINS', p.x, p.y - 22)
  }
  stage.curse = Math.max(0, stage.curse - dt)
  if (stage.curse > 0) next.knight = { ...next.knight, vx: next.knight.vx * 0.65 }



  let hazards = [...(state.hazards ?? [])]
  // The Guardian's ground slam sends a shockwave both ways along the floor.
  for (const event of next.events) {
    if (event.type !== 'bossSlam') continue
    for (const side of [-1, 1]) hazards.push({ id: next.nextId++, x: event.x + side * 14, y: event.y - 2, vx: side * 150, vy: 0, life: 1.1, kind: 'wave' })
  }
  next.hazards = hazards
  next = stepBones(next, dt)
  const movedWaves = (next.hazards ?? []).flatMap((shot) => {
    if (shot.kind !== 'wave') return [shot]
    const moved = { ...shot, x: shot.x + shot.vx * dt, life: shot.life - dt }
    if (Math.abs(moved.x - next.knight.x) < 11 && Math.abs(moved.y - next.knight.y) < 14) { next = damageKnight(next); return [] }
    return moved.life > 0 ? [moved] : []
  })
  next.hazards = movedWaves
  for (const event of next.events) if (event.type === 'burst' && Math.abs(event.x - next.knight.x) < 42 && Math.abs(event.y - next.knight.y) < 40) next = damageKnight(next)

  const pressure = next.knight.x >= CEMETERY.pressure.start && next.knight.x <= CEMETERY.pressure.end && !stage.ending
  stage.pressureTime = pressure ? stage.pressureTime + dt : 0
  if (pressure && stage.pressureTime >= 3 && next.enemies.filter((enemy) => enemy.kind === 'zombie' && Math.abs(enemy.x - next.knight.x) < 200).length < 3) {
    const x = next.knight.x + 100
    const p = placeOnSurface(next, x, 7)
    if (p && !stage.triggered.includes(`cleansed-${Math.round(x / 100)}`)) next.enemies = [...next.enemies, { ...blankEnemy(next.nextId++, 'zombie', x, p.y - 16), emerging: true }]
    stage.pressureTime = 0
  }
  return { ...next, stage, escapes: stepEscapes(next, dt) }
}

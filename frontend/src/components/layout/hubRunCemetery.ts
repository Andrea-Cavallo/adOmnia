import { stepSetPiece } from './hubRunSetPiece'
import { ARMOR } from './hubRunEquipment'
import { blankEnemy, bossAt } from './hubRunEnemies'
import { armorBurst } from './hubRunDebris'
import { placeOnSurface, validateEnemyPlacement } from './hubRunPlacement'
import { CEMETERY, cemeteryGeometry, type CemeteryProgress } from './hubRunStages'
import { stepArcade } from './hubRunArcade'
import {
  GRAVITY,
  JUMP_SPEED,
  RUN_SPEED,
  groundHeightAt,
  groundY,
  startRun,
  stepRun,
  swinging,
  type EnemyKind,
  type RunInput,
  type RunState,
} from './hubRunRules'

export const CEMETERY_JUMP = {
  height: JUMP_SPEED ** 2 / (2 * GRAVITY),
  distance: (RUN_SPEED * JUMP_SPEED * 2) / GRAVITY,
}

export function startCemeteryRun(width: number, height: number): RunState {
  const state = startRun(width, height, () => 0.5)
  const geometry = cemeteryGeometry(height)
  const stage: CemeteryProgress = {
    id: 'cemetery',
    key: false,
    gate: false,
    defended: false,
    prisoner: false,
    checkpoint: 0,
    bossDefeated: false,
    bellDestroyed: false,
    bellHp: 3,
    bellGrace: 0,
    armor: 1,
    elapsed: 0,
    waveTime: 0,
    triggered: [],
    weapon: 'sword',
    weapons: ['sword'],
    armorTier: 'steel',
    weaponCharges: 0,
    holyWeapon: false,
    rescued: [],
    secrets: [],
    openedChests: [],
    curse: 0,
    damageTaken: 0,
    ending: null,
    pressureTime: 0,
  }
  const bare = { ...state, ...geometry, stage, builtTo: 100000, bossIn: 100000, enemies: [], chests: [], coins: [] }
  const coins = [350, 390, 690, 715, 745, 860, 960, 1080, 1380, 2180, 2400, 2520, 2810].flatMap((x, index) => {
    const spot = placeOnSurface(bare, x, 3, true)
    return spot ? [{ id: 10000 + index, x, y: spot.y - 12 }] : []
  })
  return { ...bare, hearts: 1, coins }
}

function spawn(state: RunState, kind: EnemyKind, x: number): RunState {
  const raw = blankEnemy(state.nextId, kind, x, 0)
  const placed = validateEnemyPlacement(state, raw)
  if (!placed) return state
  const enemy = {
    ...placed,
    emerging: ['zombie', 'burster', 'armored'].includes(kind),
    hp: ['armored', 'bonecaster', 'zombie', 'gargoyle'].includes(kind) ? 2 : 1,
    maxHp: ['armored', 'bonecaster', 'zombie', 'gargoyle'].includes(kind) ? 2 : 1,
  }
  return { ...state, nextId: state.nextId + 1, enemies: [...state.enemies, enemy] }
}

function encounters(state: RunState, dt: number): RunState {
  if (state.stage!.bellDestroyed) return { ...state, enemies: [] }
  let next = state
  let stage = { ...state.stage!, triggered: [...state.stage!.triggered] }
  for (const encounter of CEMETERY.encounters) {
    if (state.knight.x < encounter.trigger || stage.triggered.includes(encounter.id)) continue
    for (const [kind, x] of encounter.spawns) next = spawn(next, kind, x)
    stage.triggered.push(encounter.id)
  }
  if (stage.gate && !stage.defended && state.knight.x >= CEMETERY.waveTrigger) {
    stage.waveTime += dt
    for (let wave = 0; wave < 3; wave++) {
      const id = `defend-${wave}`
      if (stage.waveTime < 1 + wave * 4 || stage.triggered.includes(id)) continue
      for (let index = 0; index < 2; index++) {
        const right = state.knight.x + 110 + index * 45
        const x = right < CEMETERY.waveBarrier - 15 ? right : state.knight.x - 110 - index * 40
        const previous = next.nextId
        next = spawn(next, wave === 1 ? 'burster' : 'zombie', x)
        if (next.nextId > previous) stage.triggered.push(`wave-enemy-${previous}`)
      }
      stage.triggered.push(id)
    }
    const alive = next.enemies.some((enemy) => stage.triggered.includes(`wave-enemy-${enemy.id}`))
    if (stage.waveTime >= 13 && !alive) stage.defended = true
  }
  if (state.knight.x >= CEMETERY.bossTrigger && !stage.triggered.includes('warden') && !stage.bossDefeated) {
    const raw = bossAt(next.nextId, 'warden', CEMETERY.boss, 0, 12)
    const enemy = validateEnemyPlacement(next, raw)
    if (enemy) {
      next = { ...next, nextId: next.nextId + 1, enemies: [...next.enemies, { ...enemy, timer: 1.2 }] }
      stage.triggered.push('warden')
      // The entrance: a portal, the name on screen and the bell heard across the arena.
      next.events.push({ type: 'boss', kind: 'warden', x: enemy.x, y: enemy.y })
    }
  }
  next = bellTolls(next, stage)
  return { ...next, stage }
}

/** Life fractions at which the wounded Guardian makes the bell toll: each toll raises two dead from the arena graves. */
const TOLLS = [0.5, 0.25] as const
const TOLL_GRAVES = [CEMETERY.bossTrigger + 40, CEMETERY.bell - 150] as const

/** Phase two of the boss fight. Mutates only the stage copy owned by `encounters`. */
function bellTolls(state: RunState, stage: CemeteryProgress): RunState {
  const guardian = state.enemies.find((enemy) => enemy.kind === 'warden')
  if (!guardian) return state
  let next = state
  TOLLS.forEach((fraction, index) => {
    const id = `bell-toll-${index}`
    if (guardian.hp > guardian.maxHp * fraction || stage.triggered.includes(id)) return
    stage.triggered.push(id)
    next.events.push({ type: 'reward', text: 'THE BELL TOLLS', x: CEMETERY.bell, y: (groundHeightAt(next, CEMETERY.bell) ?? groundY(next.height)) - 70 })
    for (const x of TOLL_GRAVES) next = spawn(next, 'zombie', x)
  })
  return next
}

export function stepCemeteryRun(state: RunState, input: RunInput, dt: number): RunState {
  if (!state.stage || state.phase !== 'playing') return state
  let next: RunState = { ...state, ...cemeteryGeometry(state.height), stage: { ...state.stage }, bossIn: 100000 }
  // This stage permits returning to the crypt and the upper route.
  next.cameraX = Math.max(0, Math.min(CEMETERY.end - state.width, state.knight.x - state.width * 0.38))
  if (input.selectWeapon && next.knight.attack < 0 && next.stage!.weapons.includes(input.selectWeapon) && (input.selectWeapon !== 'lance' || next.stage!.weaponCharges > 0)) next.stage = { ...next.stage!, weapon: input.selectWeapon }
  next = encounters(next, dt)
  const before = next
  const insideLow = next.knight.x > CEMETERY.crypt.lowStart && next.knight.x < CEMETERY.crypt.lowEnd
  const recovering = next.stage?.armorBreak && next.stage.elapsed - next.stage.armorBreak.time < 0.55
  const controls = recovering ? { ...input, left: false, right: false, jump: false, attack: false, throwSword: false, special: false } : input
  next = stepRun(next, insideLow ? { ...controls, crouch: true, jump: false } : controls, dt, () => 0.5)
  // Walking into the low passage crouches him by itself: never an invisible wall.
  const entersLow = next.knight.x > CEMETERY.crypt.lowStart && next.knight.x < CEMETERY.crypt.lowEnd
  if (insideLow || entersLow)
    next.knight = {
      ...next.knight,
      crouching: true,
      grounded: true,
      vy: 0,
      y: groundHeightAt(next, next.knight.x) ?? next.knight.y,
    }
  next = stepSetPiece(next, controls)
  next = stepArcade(next, controls, dt)
  const stage = {
    ...next.stage!,
    elapsed: next.stage!.elapsed + dt,
    bellGrace: Math.max(0, next.stage!.bellGrace - dt),
  }
  if (next.hearts < before.hearts) { stage.damageTaken++; stage.lastDamageAt = stage.elapsed }
  // Armor takes the hit first, and flies off where everyone can see it.
  if (next.hearts < before.hearts && stage.armor > 0 && next.events.some((event) => event.type === 'hurt')) {
    stage.armor--
    if (stage.armor === 0) stage.armorBreak = { x: next.knight.x, y: next.knight.y, time: stage.elapsed }
    if (stage.armor === 0) next.events.push({ type: 'armorBreak', x: next.knight.x, y: next.knight.y })
    // The plate and helmet become real physics bodies for a moment instead of a flat flash.
    const pieces = stage.armor === 0 ? armorBurst(next, next.knight.x, next.knight.y) : []
    next = { ...next, hearts: before.hearts, phase: 'playing', nextId: next.nextId + pieces.length, debris: [...(next.debris ?? []), ...pieces] }
  }
  const near = (x: number, upper = false) => {
    const spot = placeOnSurface(next, x, 3, upper)
    return !!spot && Math.abs(next.knight.x - x) < 16 && Math.abs(next.knight.y - spot.y) < 20
  }
  if (!stage.key && near(CEMETERY.key)) {
    stage.key = true
    next.events.push({ type: 'reward', text: 'MAUSOLEUM KEY · OPENS THE CEMETERY GATE', x: CEMETERY.key, y: next.knight.y - 35 })
  }
  if (!stage.gate && stage.key && near(CEMETERY.gate - 20)) {
    stage.gate = true
    stage.gateOpenedAt = stage.elapsed
    next.events.push({ type: 'reward', text: 'KEY USED · GATE UNLOCKED', x: CEMETERY.gate, y: next.knight.y - 42 })
  }
  if (stage.gateOpenedAt !== undefined && stage.elapsed - stage.gateOpenedAt < 0.6 && next.knight.x > CEMETERY.gate - 14)
    next.knight = { ...next.knight, x: CEMETERY.gate - 14, vx: 0 }
  if (!stage.gate && next.knight.x > CEMETERY.gate - 14) next.knight = { ...next.knight, x: CEMETERY.gate - 14, vx: 0 }
  if (stage.armorTier === 'verdant' && next.hearts < 2 && next.phase === 'playing' && stage.elapsed - Math.max(stage.lastDamageAt ?? 0, stage.lastHealAt ?? 0) >= 6) {
    next.hearts++; stage.lastHealAt = stage.elapsed
    next.events.push({ type: 'reward', text: 'GREEN RECOVERY · +1 LIFE', x: next.knight.x, y: next.knight.y - 38 })
  }
  if (!stage.defended && next.knight.x > CEMETERY.waveBarrier)
    next.knight = { ...next.knight, x: CEMETERY.waveBarrier, vx: 0 }
  if (stage.defended && stage.prisoner && next.knight.x >= CEMETERY.checkpoint && !stage.checkpoint) {
    stage.checkpoint = CEMETERY.checkpoint
    stage.armor = ARMOR[stage.armorTier].hits
    next.hearts = stage.armorTier === 'verdant' ? 2 : 1
  }
  // A second breath before the Guardian: the arena is long and the fight is the test.
  if (!stage.bossDefeated && next.knight.x >= CEMETERY.checkpointBoss && stage.checkpoint < CEMETERY.checkpointBoss) {
    stage.checkpoint = CEMETERY.checkpointBoss
    stage.armor = ARMOR[stage.armorTier].hits
    next.hearts = stage.armorTier === 'verdant' ? 2 : 1
    next.events.push({ type: 'reward', text: 'CHECKPOINT', x: CEMETERY.checkpointBoss, y: next.knight.y - 40 })
  }
  if (next.events.some((event) => event.type === 'bossDown' && event.kind === 'warden')) stage.bossDefeated = true
  if (!stage.bossDefeated && next.knight.x > CEMETERY.bell - 80)
    next.knight = { ...next.knight, x: CEMETERY.bell - 80, vx: 0 }
  if (stage.bossDefeated && !stage.bellDestroyed && stage.bellGrace <= 0) {
    const surface = groundHeightAt(next, CEMETERY.bell) ?? groundY(next.height)
    const melee = swinging(next.knight) && Math.abs(next.knight.x - CEMETERY.bell) < 45 && next.knight.y >= surface - 60
    const sword = next.swords.find(
      (item) =>
        Math.min(item.previousX, item.x) - 12 <= CEMETERY.bell &&
        Math.max(item.previousX, item.x) + 12 >= CEMETERY.bell &&
        item.y > surface - 60 &&
        item.y < surface,
    )
    if (melee || sword) {
      stage.bellHp--
      stage.bellGrace = 0.35
      if (sword) next.swords = next.swords.filter((item) => item.id !== sword.id)
      if (stage.bellHp <= 0) {
        stage.bellDestroyed = true
        // Only the sacred blade from the hidden crypt room silences the bell for good.
        stage.ending = stage.holyWeapon ? 'true' : 'half'
        next.enemies = []
        next.points += 250
        next.events.push({ type: 'bell', x: CEMETERY.bell, y: surface - 28 })
      }
    }
  }
  if (!stage.bellDestroyed && next.knight.x > CEMETERY.end - 70)
    next.knight = { ...next.knight, x: CEMETERY.end - 70, vx: 0 }
  if (stage.bellDestroyed && next.knight.x >= CEMETERY.end - 40) {
    next.phase = 'complete'
    next.points +=
      stage.rescued.length * 100 +
      stage.secrets.length * 100 +
      (stage.ending === 'true' ? 300 : 0) +
      next.hearts * 25 +
      Math.max(0, 300 - Math.floor(stage.elapsed))
  }
  next.cameraX = Math.max(0, Math.min(CEMETERY.end - next.width, next.knight.x - next.width * 0.38))
  return { ...next, stage }
}

export function restoreCemeteryCheckpoint(state: RunState): RunState {
  if (!state.stage?.checkpoint) return startCemeteryRun(state.width, state.height)
  const fresh = startCemeteryRun(state.width, state.height)
  const x = state.stage.checkpoint
  return {
    ...fresh,
    points: state.points,
    stats: { ...state.stats },
    coins: state.coins.filter((coin) => coin.x >= x - 100),
    stage: {
      ...state.stage,
      armor: ARMOR[state.stage.armorTier].hits,
      triggered: state.stage.triggered.filter((id) => id !== 'warden' && !id.startsWith('bell-toll-')),
      bossDefeated: false,
      bellDestroyed: false,
      bellHp: 3,
      ending: null,
      curse: 0,
    },
    knight: { ...fresh.knight, x, y: groundHeightAt(fresh, x)!, safeX: x, invulnerable: 2 },
    cameraX: Math.max(0, x - state.width * 0.38),
  }
}

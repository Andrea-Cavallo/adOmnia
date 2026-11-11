import { WEAPONS, ARMOR } from './hubRunEquipment'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { actTiming, clearFrame, composite, createAct, createFrame, createFx, painterFor, type PixelAct, type PixelFrame, type PixelFx, type PixelFxModule } from 'pixelfx'
import * as powEffect from 'pixelfx/fx/explosions/cartoon-pow'
import * as hitSpark from 'pixelfx/fx/impacts/hit-spark'
import * as shieldBlock from 'pixelfx/fx/impacts/shield-block'
import * as doubleSlash from 'pixelfx/fx/melee/double-slash'
import * as swordSlash from 'pixelfx/fx/melee/sword-slash'
import * as uppercut from 'pixelfx/fx/melee/uppercut'
import * as lightningCall from 'pixelfx/fx/moves/lightning-call'
import * as chestEffect from 'pixelfx/fx/pickups/chest-open'
import * as coinEffect from 'pixelfx/fx/pickups/coin-spin'
import * as collectEffect from 'pixelfx/fx/pickups/collect-burst'
import * as poofEffect from 'pixelfx/fx/spawn/poof'
import * as manaBurst from 'pixelfx/fx/arcane/mana-burst'
import * as acidSplash from 'pixelfx/fx/nature/acid-splash'
import * as spawnPortal from 'pixelfx/fx/spawn/spawn-portal'
import * as smite from 'pixelfx/fx/holy/smite'
import { CRITTERS, FEET_OFFSET, POWER_LABELS, WIDE_SLASH_PALETTE, critterOptions, enemyShown, telegraphShown, trembleOf, warningShown } from './hubRunLook'
import {
  BOSS_NAMES, CHARGE_MAX, MAX_HEARTS, bossOf, chainMultiplier, medalFor, meters, newRun, pauseRun, resizeRun, runScore, specialReady, stepRun,
  groundY, type EnemyKind, type RunEvent, type RunInput, type RunMedal, type RunPhase, type RunState, type RunStats,
} from './hubRunRules'
import { drawGothicWorld, loadGothicArt, type GothicArt } from './hubGothicArt'
import './hubGothicGame.css'
import { startCemeteryRun, stepCemeteryRun, restoreCemeteryCheckpoint } from './hubRunCemetery'
import { CEMETERY, cemeteryObjective, type CemeteryProgress } from './hubRunStages'
import { cemeteryGrade } from './hubRunArcade'
import { loadMuted, playSound, toggleMuted, unlockAudio } from './hubGameAudio'
import { levelElevationAt, levelRegionAt } from './hubRunLevel'
import { blit, drawHills, drawKnight, drawMarker, drawRing, drawTerrain, knightPose } from './hubRunScene'

const PIXEL_SCALE = 2
const FRAME_MS = 1000 / 60
const BEST_KEY = 'adomnia.hub.runBest'
/** An attack is drawn in its own small frame, feet at this point, then copied onto the knight. */
const ATTACK_FRAME = { w: 140, h: 100, x: 54, y: 88 }
/** The blade of a drawn swing lands this long after the key: the wind-up is skipped so it feels instant. */
const SWING_LEAD = 0.04
const HURT_SECONDS = 0.35
const SHAKE = 3
/** A beaten boss shakes the strip this long. */
const BOSS_DOWN_SHAKE = 0.5
/** A closed chest rattles through the first part of its opening, over and over, until it is touched. */
const CHEST_RATTLE = 0.9
const SHIELD_RADIUS = 17
/** The shield ring sits around his chest, this high above the feet. */
const SHIELD_HEIGHT = 15
const SHIELD_COLOR = 0xc0f4c862
const WARN_COLOR = 0xff3a3aff
const POPUP_SECONDS = 0.8
const POPUP_RISE = 22
const WHITE = 0xffffffff
const GOLD = 0xff30c0f0
const RED = 0xff3030ff
const OUTLINE = 0xff140c0e
const SWINGS: readonly PixelFxModule[] = [swordSlash, doubleSlash, uppercut]
/** How each kind falls: the undead burst into arcane light, slimes and frogs splash, the rest go up in smoke. */
const DEATHS: Partial<Record<EnemyKind, PixelFxModule>> = { zombie: manaBurst, armored: manaBurst, bonecaster: manaBurst, warden: manaBurst, reaper: manaBurst, ghost: manaBurst, skull: manaBurst, slime: acidSplash, frog: acidSplash }
const MEDAL_TITLES: Record<RunMedal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }

type Key = 'aim' | 'up' | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'left' | 'right' | 'jump' | 'crouch' | 'attack' | 'throw' | 'special' | 'interact' | 'pause' | 'mute'
const KEYS: Record<string, Key> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right',
  KeyW: 'jump', Space: 'jump', KeyZ: 'jump',
  ArrowUp: 'up', ShiftLeft: 'aim', ShiftRight: 'aim', Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3', Digit4: 'weapon4', KeyD: 'throw', KeyS: 'attack', KeyJ: 'throw', KeyX: 'attack', ArrowDown: 'crouch', KeyE: 'interact', KeyC: 'special', KeyK: 'special', Escape: 'pause', KeyP: 'pause', KeyM: 'mute',
}

function loadBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 }
}
function saveBest(best: number): void {
  try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* the record is only a nicety */ }
}

interface HudBoss { name: string; hp: number; maxHp: number }
interface HudState {
  weapon: 'sword' | 'lance' | 'hammer' | 'daggers'
  phase: RunPhase
  region: string
  objective: string
  equipment: string
  elapsed: number
  prisoner: boolean
  checkpoint: boolean
  rescued: number
  secrets: number
  ending: 'true' | 'half' | null
  grade: 'S' | 'A' | 'B' | 'C' | null
  score: number
  meters: number
  hearts: number
  chain: number
  charge: number
  /** Whole seconds left of the wide slash and of the shield; 0 when off. */
  wide: number
  shield: number
  boss: HudBoss | null
  stats: RunStats
}
interface Popup { text: string; x: number; y: number; age: number; color: number }
/** An effect placed in the world: it scrolls with the ground. */
interface Placed { fx: PixelFx; x: number; y: number }

const isOver = (run: RunState) => run.phase === 'over' || run.phase === 'complete'
function hudBoss(run: RunState): HudBoss | null {
  const boss = bossOf(run)
  if (!boss || (boss.kind !== 'skull' && boss.kind !== 'ghost' && boss.kind !== 'warden')) return null
  return { name: BOSS_NAMES[boss.kind], hp: boss.hp, maxHp: boss.maxHp }
}
const hudOf = (run: RunState): HudState => ({
  weapon: run.stage?.weapon ?? 'sword', phase: run.phase, region: run.stage ? 'The Cursed Cemetery' : levelRegionAt(run.cameraX).label,
  objective: run.stage ? CEMETERY.objectives[cemeteryObjective(run.stage)] : '',
  equipment: run.stage ? equipmentOf(run.stage) : '', score: runScore(run), meters: meters(run), hearts: run.hearts, chain: run.chain, charge: run.charge,
  wide: Math.ceil(run.wide), shield: Math.ceil(run.shield), boss: hudBoss(run), stats: run.stats,
  elapsed: Math.floor(run.stage?.elapsed ?? 0), prisoner: !!run.stage?.prisoner, checkpoint: !!run.stage?.checkpoint,
  rescued: run.stage?.rescued.length ?? 0, secrets: run.stage?.secrets.length ?? 0, ending: run.stage?.ending ?? null,
  grade: run.stage ? cemeteryGrade(run.stage) : null,
})
/** Whole seconds as m:ss. */
const clockOf = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
function equipmentOf(stage: CemeteryProgress): string {
  const weapon = WEAPONS[stage.weapon].name + (stage.weapon === 'lance' ? ' ×' + stage.weaponCharges : '')
  const parts = [`${ARMOR[stage.armorTier].name} ${stage.armor}/${ARMOR[stage.armorTier].hits}`, weapon, `Rescued ${stage.rescued.length}/${CEMETERY.prisoners.length}`, `Secrets ${stage.secrets.length}/${CEMETERY.secrets.length}`]
  if (stage.key && !stage.gate) parts.push('Mausoleum key')
  if (stage.curse > 0) parts.push(`Cursed ${Math.ceil(stage.curse)}s`)
  return parts.join(' · ')
}
const sameBoss = (a: HudBoss | null, b: HudBoss | null) => a === b || (!!a && !!b && a.name === b.name && a.hp === b.hp)
const sameHud = (a: HudState, b: HudState) =>
  a.phase === b.phase && a.objective === b.objective && a.equipment === b.equipment && a.region === b.region && a.score === b.score && a.meters === b.meters && a.hearts === b.hearts && a.chain === b.chain && a.charge === b.charge &&
  a.wide === b.wide && a.shield === b.shield && a.elapsed === b.elapsed && sameBoss(a.boss, b.boss)

/**
 * The Hub's full-window cemetery stage. Arrows move, Down crouches, Space jumps,
 * S slashes and D throws. The keys are read only while the
 * game has focus, and it pauses as soon as focus goes elsewhere: it never takes a key from the Hub.
 */
export function HubGame() {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controls = useRef<{ start: () => void; key: (key: Key, down: boolean, repeat: boolean) => void; pause: (paused: boolean) => void } | null>(null)
  const [hud, setHud] = useState<HudState>(() => hudOf(newRun(280, 80)))
  const [artReady, setArtReady] = useState(false)
  const [artError, setArtError] = useState('')
  const [artAttempt, setArtAttempt] = useState(0)
  const [best, setBest] = useState(loadBest)
  /** Sound can be turned off with M; the choice is remembered. */
  const [muted, setMuted] = useState(loadMuted)
  /** The record this run beat; 0 or null when there was none to beat. */
  const [beaten, setBeaten] = useState<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) { setArtError('The game needs a canvas with 2D support.'); return undefined }
    let disposed = false
    let art: GothicArt | null = null
    const effectCanvas = document.createElement('canvas')
    const effectContext = effectCanvas.getContext('2d')
    setArtReady(false)
    setArtError('')

    let frame: PixelFrame = createFrame(1, 1)
    let image = context.createImageData(1, 1)
    let run: RunState = newRun(1, 1)
    const attackFrame = createFrame(ATTACK_FRAME.w, ATTACK_FRAME.h)
    const critters = new Map<number, PixelFx>()
    const coins = new Map<number, PixelFx>()
    /** A closed chest's sprite and how long it has rattled since it was (re)started. */
    const chests = new Map<number, { fx: PixelFx; age: number }>()
    let effects: Placed[] = []
    let popups: Popup[] = []
    let swing: PixelAct | null = null
    let swings = 0
    let cast: PixelAct | null = null
    const held = new Set<Key>()
    let pressed: Partial<Record<'jump' | 'attack' | 'throw' | 'special' | 'interact' | 'up' | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4', boolean>> = {}
    let raf = 0
    let last = 0
    let clock = 0
    let hurtFlash = 0
    let bossShake = 0
    /** Frozen frames after a landed hit: the classic hit-stop that makes blows read. */
    let hitStop = 0

    const fit = () => {
      const scale = Math.max(PIXEL_SCALE, canvas.clientHeight / 260)
      const width = Math.max(1, Math.floor(canvas.clientWidth / scale))
      const height = Math.max(1, Math.floor(canvas.clientHeight / scale))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const displayWidth = Math.round(canvas.clientWidth * dpr)
      const displayHeight = Math.round(canvas.clientHeight * dpr)
      if (width === frame.w && height === frame.h && canvas.width === displayWidth && canvas.height === displayHeight) return false
      canvas.width = displayWidth
      canvas.height = displayHeight
      effectCanvas.width = width
      effectCanvas.height = height
      frame = createFrame(width, height)
      image = context.createImageData(width, height)
      run = run.phase === 'idle' ? newRun(width, Math.max(60, height - 72)) : resizeRun(run, width, Math.max(60, height - 72))
      return true
    }
    const screenX = (x: number) => x - run.cameraX
    const popup = (text: string, x: number, y: number, color: number) => { popups = [...popups, { text, x, y, age: 0, color }] }
    const place = (effect: PixelFxModule, x: number, y: number, seed: number) => { effects = [...effects, { fx: createFx(effect, { x: screenX(x), y, seed }), x, y }] }

    const react = (event: RunEvent) => {
      switch (event.type) {
        case 'crowCry': playSound('crow'); break
        case 'gargoyleCrash': playSound('slam'); place(poofEffect, event.x, event.y, Math.round(clock * 100)); popup('CRASH!', event.x, event.y - 25, GOLD); hitStop = 0.05; break
        case 'topple': playSound('slam'); break
        case 'armLost': playSound('hit'); popup('MY ARM!', event.x, event.y - 25, WHITE); break
        case 'distantBell': playSound('bell'); popup('THE CURSED BELL…', event.x, event.y, GOLD); break
        case 'bell':
          place(smite, event.x, event.y + 24, Math.round(clock * 100))
          popup(run.stage?.ending === 'true' ? 'BELL SILENCED' : 'BELL CRACKED', event.x, event.y - 40, GOLD)
          playSound('bell')
          hitStop = 0.1
          break
        case 'rescue':
          place(collectEffect, event.x, event.y + 20, Math.round(clock * 100))
          popup(`${event.name.toUpperCase()} FREED · ${event.reward}`, event.x, event.y, GOLD)
          playSound('rescue')
          break
        case 'reward':
          place(collectEffect, event.x, event.y + 20, Math.round(clock * 100))
          popup(event.text, event.x, event.y, GOLD)
          playSound('chest')
          break
        case 'burst':
          // An undead blast, not slime acid: the burster is a corpse.
          place(manaBurst, event.x, event.y + 12, Math.round(clock * 100))
          popup('BURST!', event.x, event.y - 20, RED)
          playSound('burst')
          break
        case 'bossSlam':
          place(powEffect, event.x, event.y, Math.round(clock * 100))
          bossShake = BOSS_DOWN_SHAKE
          playSound('slam')
          hitStop = 0.06
          break
        case 'shieldBlock':
          place(shieldBlock, event.x, event.y - 14, Math.round(clock * 100))
          popup(event.guard > 0 ? 'BLOCKED' : 'SHIELD CRACKED', event.x, event.y - 46, GOLD)
          playSound('clang')
          hitStop = 0.05
          break
        case 'shieldBreak':
          place(shieldBlock, event.x, event.y - 14, Math.round(clock * 100))
          place(powEffect, event.x, event.y, Math.round(clock * 100))
          popup('SHIELD BROKEN', event.x, event.y - 46, GOLD)
          bossShake = BOSS_DOWN_SHAKE * 0.5
          playSound('break')
          hitStop = 0.08
          break
        case 'armorBreak':
          place(hitSpark, event.x, event.y - 24, Math.round(clock * 100))
          popup('ARMOR LOST', event.x, event.y - 50, RED)
          playSound('break')
          hitStop = 0.08
          break
        case 'hammerImpact':
          playSound('slam'); place(poofEffect, event.x, event.y - 2, Math.round(clock * 100)); bossShake = 0.12; hitStop = 0.04; break
        case 'swing': {
          if (run.stage?.weapon === 'hammer') { playSound('swing'); break }
          const move = SWINGS[swings++ % SWINGS.length]
          // No palette key at all without the power: an undefined one would wipe the move's own colors.
          const colors = run.wide > 0 ? { palette: WIDE_SLASH_PALETTE } : {}
          swing = createAct(move, { x: ATTACK_FRAME.x, y: ATTACK_FRAME.y, flip: run.knight.facing < 0, seed: swings, ...colors })
          const windup = actTiming(move)?.windup ?? 0
          if (windup > SWING_LEAD) swing.update(windup - SWING_LEAD)
          playSound('swing')
          break
        }
        case 'throw':
          playSound('throw')
          break
        case 'jump':
          playSound('jump')
          break
        case 'kill':
        case 'stomp':
          if (!['zombie', 'burster', 'bonecaster'].includes(event.kind)) place(DEATHS[event.kind] ?? poofEffect, event.x, event.y + 12, Math.round(clock * 100))
          popup(`${event.type === 'stomp' ? 'STOMP ' : run.stage?.weapon === 'hammer' ? 'BONK! ' : ''}+${event.points}`, event.x, event.y - 16, event.type === 'stomp' ? GOLD : WHITE)
          playSound('hit')
          hitStop = 0.04
          break
        case 'coin':
          place(collectEffect, event.x, event.y + 8, Math.round(clock * 100))
          playSound('coin')
          break
        case 'hurt':
        case 'fall':
          place(hitSpark, event.x, event.y - 14, Math.round(clock * 100))
          popup(event.type === 'fall' ? 'FALL' : 'OUCH', event.x, event.y - 46, RED)
          hurtFlash = HURT_SECONDS
          playSound('hurt')
          hitStop = 0.07
          break
        case 'split':
          place(poofEffect, event.x, event.y + 12, Math.round(clock * 100))
          popup('SPLIT!', event.x, event.y - 18, WHITE)
          break
        case 'block':
          place(shieldBlock, event.x, event.y - 14, Math.round(clock * 100))
          popup('BLOCK', event.x, event.y - 46, GOLD)
          playSound('block')
          break
        case 'chest':
          place(chestEffect, event.x, event.y, Math.round(clock * 100))
          popup(POWER_LABELS[event.power], event.x, event.y - 30, GOLD)
          playSound('chest')
          break
        case 'boss':
          place(spawnPortal, event.x - 40, event.y + 30, Math.round(clock * 100))
          popup(`${BOSS_NAMES[event.kind].toUpperCase()}!`, run.cameraX + frame.w / 2, 26, RED)
          playSound('boss')
          break
        case 'bossHit':
          place(hitSpark, event.x, event.y, Math.round(clock * 100))
          popup(`${event.hp} LEFT`, event.x, event.y - 24, WHITE)
          playSound('hit')
          hitStop = 0.04
          break
        case 'bossDown':
          place(powEffect, event.x, event.y, Math.round(clock * 100))
          place(manaBurst, event.x, event.y + 10, Math.round(clock * 100) + 1)
          place(smite, event.x, groundY(run.height) + levelElevationAt(event.x), Math.round(clock * 100))
          popup('THE GUARDIAN FALLS', event.x, event.y - 28, GOLD)
          bossShake = BOSS_DOWN_SHAKE * 1.8
          hitStop = 0.14
          playSound('boss')
          break
        case 'special':
          cast = createAct(lightningCall, { x: ATTACK_FRAME.x, y: ATTACK_FRAME.y, seed: Math.round(clock * 100) })
          for (const enemy of event.cleared) place(DEATHS[enemy.kind] ?? powEffect, enemy.x, enemy.y + 12, Math.round(enemy.x))
          popup(`LIGHTNING +${event.points}`, run.knight.x + 40, 14, GOLD)
          playSound('special')
          break
        default:
          break
      }
    }

    /** Keeps one animated sprite per enemy and coin, moved to where the rules put them. */
    const syncSprites = () => {
      // The painted atlas draws every enemy; the pixelfx critters are only the pre-load fallback.
      if (!art) {
        const enemies = new Set(run.enemies.map((enemy) => enemy.id))
        for (const id of critters.keys()) if (!enemies.has(id)) critters.delete(id)
        for (const enemy of run.enemies) {
          const fx = critters.get(enemy.id) ?? createFx(CRITTERS[enemy.kind], critterOptions(enemy))
          critters.set(enemy.id, fx)
          fx.options.x = Math.round(screenX(enemy.x) + trembleOf(enemy, clock))
          fx.options.y = Math.round(enemy.y + FEET_OFFSET[enemy.kind])
          fx.options.flip = enemy.vx < 0 || (!enemy.awake && enemy.x > run.knight.x)
        }
      }
      const present = new Set(run.coins.map((coin) => coin.id))
      for (const id of coins.keys()) if (!present.has(id)) coins.delete(id)
      for (const coin of run.coins) {
        const fx = coins.get(coin.id) ?? createFx(coinEffect, { seed: coin.id })
        coins.set(coin.id, fx)
        fx.options.x = Math.round(screenX(coin.x))
        fx.options.y = Math.round(coin.y + 6)
      }
      const closed = new Set(run.chests.map((chest) => chest.id))
      for (const id of chests.keys()) if (!closed.has(id)) chests.delete(id)
      for (const chest of run.chests) {
        const sprite = chests.get(chest.id) ?? { fx: createFx(chestEffect, { seed: chest.id }), age: 0 }
        chests.set(chest.id, sprite)
        sprite.fx.options.x = Math.round(screenX(chest.x))
        sprite.fx.options.y = Math.round(chest.y)
      }
    }

    /** Closed chests replay their first rattle; the opening itself is placed as an effect when one is touched. */
    const rattleChests = (dt: number) => {
      for (const [id, sprite] of chests) {
        sprite.age += dt
        if (sprite.age < CHEST_RATTLE) { sprite.fx.update(dt); continue }
        chests.set(id, { fx: createFx(chestEffect, { ...sprite.fx.options }), age: 0 })
      }
    }

    const advance = (dt: number) => {
      const input: RunInput = {
        selectWeapon: (held.has('weapon1') || pressed.weapon1) ? 'sword' : (held.has('weapon2') || pressed.weapon2) ? 'hammer' : (held.has('weapon3') || pressed.weapon3) ? 'daggers' : (held.has('weapon4') || pressed.weapon4) ? 'lance' : undefined,
        aimX: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0), aimY: held.has('up') ? -1 : held.has('crouch') ? 1 : 0,
        left: held.has('left') && !held.has('aim'), right: held.has('right') && !held.has('aim'), jumpHeld: held.has('jump') || held.has('up') && !held.has('aim'), crouch: held.has('crouch') && !held.has('aim'),
        jump: !!pressed.jump || !!pressed.up && !held.has('aim'), attack: held.has('attack') || !!pressed.attack, throwSword: held.has('throw') || !!pressed.throw, special: !!pressed.special,
        interact: !!pressed.interact,
      }
      pressed = {}
      if (hitStop > 0) {
        hitStop = Math.max(0, hitStop - dt)
        return
      }
      run = run.stage ? stepCemeteryRun(run, input, dt) : stepRun(run, input, dt)
      for (const event of run.events) react(event)
      syncSprites()
      for (const fx of [...critters.values(), ...coins.values()]) fx.update(dt)
      rattleChests(dt)
      for (const placed of effects) {
        placed.fx.options.x = Math.round(screenX(placed.x))
        placed.fx.update(dt)
      }
      effects = effects.filter((placed) => !placed.fx.done())
      swing?.update(dt)
      if (swing?.done() || run.knight.attack < 0) swing = null
      cast?.update(dt)
      if (cast?.done()) cast = null
      popups = popups.map((item) => ({ ...item, age: item.age + dt })).filter((item) => item.age < POPUP_SECONDS)
      hurtFlash = Math.max(0, hurtFlash - dt)
      bossShake = Math.max(0, bossShake - dt)
    }

    const drawKnightNow = () => {
      const { knight } = run
      // Blinking while he cannot be hurt.
      if (knight.invulnerable > 0 && Math.floor(clock * 14) % 2 === 0) return
      const x = screenX(knight.x)
      const act = cast ?? swing
      if (!act) {
        drawKnight(frame, knightPose(knight, clock), x, knight.y, knight.facing)
        return
      }
      clearFrame(attackFrame)
      act.draw(attackFrame, { target: false })
      blit(frame, attackFrame, x - ATTACK_FRAME.x, knight.y - ATTACK_FRAME.y)
    }

    const drawShield = () => {
      if (run.shield <= 0) return
      drawRing(frame, { x: screenX(run.knight.x), y: run.knight.y - SHIELD_HEIGHT }, SHIELD_RADIUS, SHIELD_COLOR, clock * 12)
    }

    const drawEnemies = () => {
      for (const enemy of run.enemies) {
        if (!enemyShown(enemy, clock)) continue
        critters.get(enemy.id)?.draw(frame)
        if (warningShown(enemy, clock)) drawMarker(frame, screenX(enemy.targetX), enemy.targetY, WARN_COLOR)
      }
    }

    const paintLabels = () => {
      const painter = painterFor(frame)
      if (specialReady(run) && run.phase === 'playing' && Math.sin(clock * 8) > -0.4) {
        painter.text('C: LIGHTNING', Math.max(30, Math.min(frame.w - 30, screenX(run.knight.x))), Math.max(2, run.knight.y - 58), GOLD, { font: 'mini', align: 'center', outline: OUTLINE })
      }
      for (const enemy of run.enemies) {
        if (telegraphShown(enemy, clock)) painter.text('!', screenX(enemy.x), Math.max(2, enemy.y - 34), RED, { font: 'big', align: 'center', outline: OUTLINE })
      }
      for (const item of popups) {
        const y = item.y - POPUP_RISE * (item.age / POPUP_SECONDS)
        painter.text(item.text, screenX(item.x), Math.max(2, y), item.color, { font: 'big', align: 'center', outline: OUTLINE, a: 1 - Math.max(0, item.age / POPUP_SECONDS - 0.6) / 0.4 })
      }
    }

    const paint = () => {
      clearFrame(frame)
      if (!art) {
        drawHills(frame, run.cameraX)
        drawTerrain(frame, run)
        for (const fx of coins.values()) fx.draw(frame)
        drawEnemies()
        drawKnightNow()
      }
      for (const sprite of chests.values()) sprite.fx.draw(frame)
      if (art) for (const enemy of run.enemies) {
        if (warningShown(enemy, clock)) drawMarker(frame, screenX(enemy.targetX), enemy.targetY, WARN_COLOR)
      }
      drawShield()
      for (const placed of effects) placed.fx.draw(frame)
      paintLabels()
      composite(frame, image.data)
      const strength = hurtFlash / HURT_SECONDS
      const shaking = Math.max(strength, bossShake / BOSS_DOWN_SHAKE)
      const shakeX = shaking ? SHAKE * shaking * (Math.sin(clock * 90) > 0 ? 1 : -1) : 0
      context.resetTransform()
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.save()
      context.scale(canvas.width / frame.w, canvas.height / frame.h)
      context.translate(Math.round(shakeX), 0)
      context.imageSmoothingEnabled = true
      if (art) drawGothicWorld(context, art, run, frame.w, frame.h, clock)
      if (effectContext) {
        effectContext.putImageData(image, 0, 0)
        context.imageSmoothingEnabled = false
        context.drawImage(effectCanvas, 0, 0)
      }
      if (strength) {
        context.fillStyle = `rgba(255, 70, 40, ${(0.35 * strength).toFixed(3)})`
        context.fillRect(0, 0, frame.w, frame.h)
      }
      context.restore()
    }

    const publish = () => {
      const next = hudOf(run)
      setHud((current) => (sameHud(current, next) ? current : next))
    }
    const finish = () => {
      const score = runScore(run)
      setBest((current) => {
        if (score <= current) return current
        saveBest(score)
        setBeaten(current)
        return score
      })
    }

    const tick = (now: number) => {
      raf = 0
      if (run.phase !== 'playing' || document.hidden) return
      raf = requestAnimationFrame(tick)
      if (now - last < FRAME_MS - 1) return
      const dt = last ? Math.min(0.05, (now - last) / 1000) : FRAME_MS / 1000
      last = now
      clock += dt
      fit()
      advance(dt)
      paint()
      publish()
      // advance() may have ended the run: read the phase again, not the one checked above.
      if (isOver(run)) finish()
    }
    const wake = () => {
      last = 0
      if (run.phase === 'playing' && !raf) raf = requestAnimationFrame(tick)
    }
    const pause = (paused: boolean) => {
      run = pauseRun(run, paused)
      held.clear()
      pressed = {}
      publish()
      paint()
      if (!paused) wake()
    }

    controls.current = {
      start: () => {
        setBeaten(null)
        unlockAudio()
        fit()
        run = run.phase === 'over' && run.stage?.checkpoint ? restoreCemeteryCheckpoint(run) : startCemeteryRun(frame.w, Math.max(60, frame.h - 72))
        critters.clear()
        coins.clear()
        chests.clear()
        effects = []
        popups = []
        swing = null
        cast = null
        held.clear()
        pressed = {}
        clock = 0
        hurtFlash = 0
        bossShake = 0
        publish()
        wake()
      },
      key: (key, down, repeat) => {
        if (key === 'pause') {
          if (down && !repeat) pause(run.phase === 'playing')
          return
        }
        if (key === 'mute') {
          if (down && !repeat) setMuted(toggleMuted())
          return
        }
        if (down) {
          if (!repeat && (key === 'jump' || key === 'up' || key === 'attack' || key === 'throw' || key === 'special' || key === 'interact' || key === 'weapon1' || key === 'weapon2' || key === 'weapon3' || key === 'weapon4')) pressed = { ...pressed, [key]: true }
          held.add(key)
        } else {
          held.delete(key)
        }
      },
      pause,
    }

    const resize = new ResizeObserver(() => { if (fit() && run.phase !== 'playing') { syncSprites(); paint() } })
    resize.observe(canvas)
    const onVisibility = () => { if (document.hidden) pause(true) }
    document.addEventListener('visibilitychange', onVisibility)
    fit()
    syncSprites()
    paint()

    void loadGothicArt().then((assets) => {
      if (disposed) return
      art = assets
      setArtReady(true)
      controls.current?.start()
      if (document.hidden) controls.current?.pause(true)
      rootRef.current?.focus()
    }).catch((error: unknown) => {
      if (!disposed) setArtError(error instanceof Error ? error.message : 'The game artwork could not be loaded.')
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      resize.disconnect()
      controls.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [artAttempt])

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>, down: boolean) => {
    // Shortcuts with a modifier stay the app's; only plain game keys are taken.
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = KEYS[event.code]
    if (!key || (key !== 'mute' && hud.phase !== 'playing' && hud.phase !== 'paused')) return
    event.preventDefault()
    event.stopPropagation()
    controls.current?.key(key, down, event.repeat)
  }
  const start = () => {
    controls.current?.start()
    rootRef.current?.focus()
  }
  const resume = () => {
    controls.current?.pause(false)
    rootRef.current?.focus()
  }

  const active = hud.phase === 'playing' || hud.phase === 'paused'
  const multiplier = chainMultiplier(hud.chain)
  return (
    <div
      ref={rootRef}
      className="hub-game hub-game-gothic"
      data-phase={hud.phase}
      tabIndex={-1}
      onKeyDown={(event) => onKey(event, true)}
      onKeyUp={(event) => onKey(event, false)}
      onBlur={() => { if (hud.phase === 'playing') controls.current?.pause(true) }}
    >
      <canvas ref={canvasRef} className="hub-game-canvas" role="img" aria-label="The Cursed Cemetery. Arrows move, Down crouches, Space jumps, S slashes, D throws, C casts lightning." />
      {active && multiplier > 1 && <p className="hub-game-combo" aria-hidden="true" style={{ fontSize: 16 + multiplier * 3 }}>×{multiplier}</p>}
      {active && (
        <p className="hub-game-score" aria-hidden="true">
          <span className="hub-game-lives">{'♥'.repeat(Math.max(0, hud.hearts))}<i>{'♥'.repeat(Math.max(0, MAX_HEARTS - hud.hearts))}</i></span>
          <span className="hub-game-time">{hud.meters} m</span>
          <span className="hub-game-points"><i className="hub-game-coin-icon" />{hud.stats.coins}</span>
        </p>
      )}
      {active && <HubGameStatus hud={hud} />}
      {active && (
        <div className="hub-game-charge" data-ready={hud.charge >= CHARGE_MAX} aria-hidden="true">
          <i style={{ transform: `scaleX(${hud.charge / CHARGE_MAX})` }} />
        </div>
      )}
      {artReady && <><p className="hub-gothic-region">{hud.region}</p><div className="hub-stage-objective"><strong>{hud.objective}</strong><span>{hud.equipment}</span><time className="hub-stage-timer" aria-label="Time in the cemetery">⏱ {clockOf(hud.elapsed)}</time></div></>}
      {artReady && <p className="hub-gothic-controls"><span>← →</span> Move <span>↑ / SPACE</span> Jump <span>↓</span> Crouch <span>S</span> {hud.weapon === 'hammer' ? 'Smash' : 'Slash'} <span>D</span> {hud.weapon === 'hammer' ? 'Smash' : 'Throw'} <span>E</span> Open <span>M</span> {muted ? 'Sound off' : 'Sound on'} <span>1–4</span> Weapons <span>SHIFT + arrows + D</span> Aim daggers <span>ESC</span> Pause</p>}
      {hud.phase === 'paused' && (
        <div className="hub-game-menu">
          <span className="hub-gothic-ornament" aria-hidden="true"><i className="hub-gothic-crest" /></span>
          <p className="hub-gothic-title">PAUSED</p>
          <button type="button" onClick={resume}>Resume</button>
        </div>
      )}
      {!artReady && <div className="hub-game-menu hub-game-loading" role="status"><p className="hub-gothic-title">{artError ? 'Unable to load the realm' : 'Entering the realm…'}</p>{artError && <><p>{artError}</p><button type="button" onClick={() => setArtAttempt((attempt) => attempt + 1)}>Try again</button></>}</div>}
      {artReady && !active && (
        <div className="hub-game-menu">
          <span className="hub-gothic-ornament" aria-hidden="true"><i className="hub-gothic-crest" /></span>
          <p className="hub-gothic-title">{hud.phase === 'complete' ? 'THE BELL IS SILENT' : hud.phase === 'over' ? 'THE JOURNEY ENDS' : 'THE MOONLIT KEEP'}</p>
          {hud.phase === 'over' || hud.phase === 'complete' ? <HubGameResults hud={hud} best={best} beaten={beaten} /> : <HubGameControls best={best} />}
          <button type="button" onClick={start}>{hud.phase === 'complete' ? 'Play the cemetery again' : hud.phase === 'over' ? hud.checkpoint ? 'Continue from checkpoint' : 'Restart cemetery' : 'Play'}</button>
        </div>
      )}
    </div>
  )
}

/** The keys, shown before the first run. */
function HubGameControls({ best }: Readonly<{ best: number }>) {
  const medal = medalFor(best)
  return (
    <div className="hub-game-results">
      <p className="hub-game-keys"><kbd>←</kbd><kbd>→</kbd> run · <kbd>Space</kbd> jump · <kbd>↓</kbd> crouch · <kbd>S</kbd> slash · <kbd>D</kbd> throw · <kbd>C</kbd> lightning · <kbd>E</kbd> open · <kbd>M</kbd> sound · <kbd>1–4</kbd> weapons · <kbd>Shift</kbd> + arrows + <kbd>D</kbd> aim daggers · <kbd>Esc</kbd> pause</p>
      {best > 0 && <p className="hub-game-stats">best {best}{medal && <> · {MEDAL_TITLES[medal]}</>}</p>}
    </div>
  )
}

/** The end of a run: how far, what it earned and whether it beat the record. */
function HubGameResults({ hud, best, beaten }: Readonly<{ hud: HudState; best: number; beaten: number | null }>) {
  const medal = medalFor(hud.score)
  const { stats } = hud
  return (
    <div className="hub-game-results">
      <p>
        <span>{hud.score}</span> points · {hud.meters} m
        {medal && <em className="hub-game-medal" data-medal={medal}>{MEDAL_TITLES[medal]}</em>}
        {beaten ? <strong className="hub-game-record">New best!</strong> : <> · best {best}</>}
      </p>
      <p className="hub-game-stats">
        {stats.kills} down{stats.stomps > 0 && <> ({stats.stomps} stomped)</>}
        {stats.bosses > 0 && <> · {stats.bosses} {stats.bosses === 1 ? 'boss' : 'bosses'}</>} · {stats.coins} coins · chain {stats.bestChain}
      </p>
      {hud.phase === 'complete' && (
        <p className="hub-game-stats">
          Grade <strong>{hud.grade}</strong> · {clockOf(hud.elapsed)} · Rescued {hud.rescued}/{CEMETERY.prisoners.length} · Secrets {hud.secrets}/{CEMETERY.secrets.length}
          {' · '}{hud.ending === 'true' ? 'The bell is silenced for good' : 'The bell cracked, but its curse lingers: find the sacred blade'}
        </p>
      )}
    </div>
  )
}

/** The boss's life while one is out, and the powers a chest gave with the seconds they have left. */
function HubGameStatus({ hud }: Readonly<{ hud: HudState }>) {
  const { boss } = hud
  return (
    <>
      {boss && (
        <div className="hub-game-boss" aria-hidden="true">
          <span>{boss.name}</span>
          <i><b style={{ transform: `scaleX(${boss.hp / boss.maxHp})` }} /></i>
        </div>
      )}
      {(hud.wide > 0 || hud.shield > 0) && (
        <p className="hub-game-powers" aria-hidden="true">
          {hud.wide > 0 && <span data-power="wide">Wide slash {hud.wide}s</span>}
          {hud.shield > 0 && <span data-power="shield">Shield {hud.shield}s</span>}
        </p>
      )}
    </>
  )
}

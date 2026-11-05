import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { actTiming, clearFrame, composite, createAct, createFrame, createFx, painterFor, type PixelAct, type PixelFrame, type PixelFx, type PixelFxModule } from 'pixelfx'
import * as batEffect from 'pixelfx/fx/critters/bat'
import * as birdEffect from 'pixelfx/fx/critters/bird'
import * as frogEffect from 'pixelfx/fx/critters/frog'
import * as slimeEffect from 'pixelfx/fx/critters/slime'
import * as powEffect from 'pixelfx/fx/explosions/cartoon-pow'
import * as hitSpark from 'pixelfx/fx/impacts/hit-spark'
import * as doubleSlash from 'pixelfx/fx/melee/double-slash'
import * as swordSlash from 'pixelfx/fx/melee/sword-slash'
import * as uppercut from 'pixelfx/fx/melee/uppercut'
import * as lightningCall from 'pixelfx/fx/moves/lightning-call'
import * as coinEffect from 'pixelfx/fx/pickups/coin-spin'
import * as collectEffect from 'pixelfx/fx/pickups/collect-burst'
import * as poofEffect from 'pixelfx/fx/spawn/poof'
import {
  CHARGE_MAX, MAX_HEARTS, chainMultiplier, medalFor, meters, newRun, pauseRun, resizeRun, runScore, specialReady, startRun, stepRun,
  type EnemyKind, type RunEvent, type RunInput, type RunMedal, type RunPhase, type RunState, type RunStats,
} from './hubRunRules'
import { blit, drawHills, drawKnight, drawTerrain, knightPose } from './hubRunScene'

const PIXEL_SCALE = 2
const FRAME_MS = 1000 / 60
const BEST_KEY = 'adomnia.hub.runBest'
/** An attack is drawn in its own small frame, feet at this point, then copied onto the knight. */
const ATTACK_FRAME = { w: 140, h: 100, x: 54, y: 88 }
/** The blade of a drawn swing lands this long after the key: the wind-up is skipped so it feels instant. */
const SWING_LEAD = 0.04
const HURT_SECONDS = 0.35
const SHAKE = 3
const POPUP_SECONDS = 0.8
const POPUP_RISE = 22
const WHITE = 0xffffffff
const GOLD = 0xff30c0f0
const RED = 0xff3030ff
const OUTLINE = 0xff140c0e
const SWINGS: readonly PixelFxModule[] = [swordSlash, doubleSlash, uppercut]
const CRITTERS: Record<EnemyKind, PixelFxModule> = { slime: slimeEffect, frog: frogEffect, bat: batEffect, bird: birdEffect }
/** Slimes and frogs are drawn from their feet, flyers from their middle. */
const FEET_OFFSET: Record<EnemyKind, number> = { slime: 9, frog: 9, bat: 0, bird: 0 }
const MEDAL_TITLES: Record<RunMedal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }

type Key = 'left' | 'right' | 'jump' | 'attack' | 'special' | 'pause'
const KEYS: Record<string, Key> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump',
  KeyX: 'attack', KeyJ: 'attack', KeyC: 'special', KeyK: 'special', Escape: 'pause', KeyP: 'pause',
}

function loadBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 }
}
function saveBest(best: number): void {
  try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* the record is only a nicety */ }
}

interface HudState {
  phase: RunPhase
  score: number
  meters: number
  hearts: number
  chain: number
  charge: number
  stats: RunStats
}
interface Popup { text: string; x: number; y: number; age: number; color: number }
/** An effect placed in the world: it scrolls with the ground. */
interface Placed { fx: PixelFx; x: number; y: number }

const isOver = (run: RunState) => run.phase === 'over'
const hudOf = (run: RunState): HudState => ({ phase: run.phase, score: runScore(run), meters: meters(run), hearts: run.hearts, chain: run.chain, charge: run.charge, stats: run.stats })
const sameHud = (a: HudState, b: HudState) =>
  a.phase === b.phase && a.score === b.score && a.meters === b.meters && a.hearts === b.hearts && a.chain === b.chain && a.charge === b.charge

/**
 * A strip at the bottom of the Hub: a knight running through an endless world. Arrows to move,
 * Space to jump, X to slash, C for the lightning once charged. The keys are read only while the
 * game has focus, and it pauses as soon as focus goes elsewhere: it never takes a key from the Hub.
 */
export function HubGame() {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controls = useRef<{ start: () => void; key: (key: Key, down: boolean, repeat: boolean) => void; pause: (paused: boolean) => void } | null>(null)
  const [hud, setHud] = useState<HudState>(() => hudOf(newRun(280, 80)))
  const [best, setBest] = useState(loadBest)
  /** The record this run beat; 0 or null when there was none to beat. */
  const [beaten, setBeaten] = useState<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    let frame: PixelFrame = createFrame(1, 1)
    let image = context.createImageData(1, 1)
    let run: RunState = newRun(1, 1)
    const attackFrame = createFrame(ATTACK_FRAME.w, ATTACK_FRAME.h)
    const critters = new Map<number, PixelFx>()
    const coins = new Map<number, PixelFx>()
    let effects: Placed[] = []
    let popups: Popup[] = []
    let swing: PixelAct | null = null
    let swings = 0
    let cast: PixelAct | null = null
    const held = new Set<Key>()
    let pressed: Partial<Record<'jump' | 'attack' | 'special', boolean>> = {}
    let raf = 0
    let last = 0
    let clock = 0
    let hurtFlash = 0

    const fit = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth / PIXEL_SCALE))
      const height = Math.max(1, Math.floor(canvas.clientHeight / PIXEL_SCALE))
      if (width === frame.w && height === frame.h) return false
      canvas.width = width
      canvas.height = height
      frame = createFrame(width, height)
      image = context.createImageData(width, height)
      run = run.phase === 'idle' ? newRun(width, height) : resizeRun(run, width, height)
      return true
    }
    const screenX = (x: number) => x - run.cameraX
    const popup = (text: string, x: number, y: number, color: number) => { popups = [...popups, { text, x, y, age: 0, color }] }
    const place = (effect: PixelFxModule, x: number, y: number, seed: number) => { effects = [...effects, { fx: createFx(effect, { x: screenX(x), y, seed }), x, y }] }

    const react = (event: RunEvent) => {
      switch (event.type) {
        case 'swing': {
          const move = SWINGS[swings++ % SWINGS.length]
          swing = createAct(move, { x: ATTACK_FRAME.x, y: ATTACK_FRAME.y, flip: run.knight.facing < 0, seed: swings })
          const windup = actTiming(move)?.windup ?? 0
          if (windup > SWING_LEAD) swing.update(windup - SWING_LEAD)
          break
        }
        case 'kill':
        case 'stomp':
          place(poofEffect, event.x, event.y + 12, Math.round(clock * 100))
          popup(`${event.type === 'stomp' ? 'STOMP ' : ''}+${event.points}`, event.x, event.y - 16, event.type === 'stomp' ? GOLD : WHITE)
          break
        case 'coin':
          place(collectEffect, event.x, event.y + 8, Math.round(clock * 100))
          break
        case 'hurt':
        case 'fall':
          place(hitSpark, event.x, event.y - 14, Math.round(clock * 100))
          popup(event.type === 'fall' ? 'FALL' : 'OUCH', event.x, event.y - 46, RED)
          hurtFlash = HURT_SECONDS
          break
        case 'special':
          cast = createAct(lightningCall, { x: ATTACK_FRAME.x, y: ATTACK_FRAME.y, seed: Math.round(clock * 100) })
          for (const enemy of event.cleared) place(powEffect, enemy.x, enemy.y, Math.round(enemy.x))
          popup(`LIGHTNING +${event.points}`, run.knight.x + 40, 14, GOLD)
          break
        default:
          break
      }
    }

    /** Keeps one animated sprite per enemy and coin, moved to where the rules put them. */
    const syncSprites = () => {
      const enemies = new Set(run.enemies.map((enemy) => enemy.id))
      for (const id of critters.keys()) if (!enemies.has(id)) critters.delete(id)
      for (const enemy of run.enemies) {
        const fx = critters.get(enemy.id) ?? createFx(CRITTERS[enemy.kind], { seed: enemy.id })
        critters.set(enemy.id, fx)
        fx.options.x = Math.round(screenX(enemy.x))
        fx.options.y = Math.round(enemy.y + FEET_OFFSET[enemy.kind])
        fx.options.flip = enemy.vx < 0 || (!enemy.awake && enemy.x > run.knight.x)
      }
      const present = new Set(run.coins.map((coin) => coin.id))
      for (const id of coins.keys()) if (!present.has(id)) coins.delete(id)
      for (const coin of run.coins) {
        const fx = coins.get(coin.id) ?? createFx(coinEffect, { seed: coin.id })
        coins.set(coin.id, fx)
        fx.options.x = Math.round(screenX(coin.x))
        fx.options.y = Math.round(coin.y + 6)
      }
    }

    const advance = (dt: number) => {
      const input: RunInput = {
        left: held.has('left'), right: held.has('right'), jumpHeld: held.has('jump'),
        jump: !!pressed.jump, attack: !!pressed.attack, special: !!pressed.special,
      }
      pressed = {}
      run = stepRun(run, input, dt)
      for (const event of run.events) react(event)
      syncSprites()
      for (const fx of [...critters.values(), ...coins.values()]) fx.update(dt)
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

    const paintLabels = () => {
      const painter = painterFor(frame)
      if (specialReady(run) && run.phase === 'playing' && Math.sin(clock * 8) > -0.4) {
        painter.text('C: LIGHTNING', Math.max(30, Math.min(frame.w - 30, screenX(run.knight.x))), Math.max(2, run.knight.y - 58), GOLD, { font: 'mini', align: 'center', outline: OUTLINE })
      }
      for (const item of popups) {
        const y = item.y - POPUP_RISE * (item.age / POPUP_SECONDS)
        painter.text(item.text, screenX(item.x), Math.max(2, y), item.color, { font: 'big', align: 'center', outline: OUTLINE, a: 1 - Math.max(0, item.age / POPUP_SECONDS - 0.6) / 0.4 })
      }
    }

    const paint = () => {
      clearFrame(frame)
      drawHills(frame, run.cameraX)
      drawTerrain(frame, run)
      for (const fx of coins.values()) fx.draw(frame)
      for (const fx of critters.values()) fx.draw(frame)
      drawKnightNow()
      for (const placed of effects) placed.fx.draw(frame)
      paintLabels()
      composite(frame, image.data)
      const strength = hurtFlash / HURT_SECONDS
      const shakeX = strength ? SHAKE * strength * (Math.sin(clock * 90) > 0 ? 1 : -1) : 0
      context.clearRect(0, 0, frame.w, frame.h)
      context.putImageData(image, Math.round(shakeX), 0)
      if (strength) {
        context.fillStyle = `rgba(255, 70, 40, ${(0.35 * strength).toFixed(3)})`
        context.fillRect(0, 0, frame.w, frame.h)
      }
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
      if (!paused) wake()
    }

    controls.current = {
      start: () => {
        setBeaten(null)
        fit()
        run = startRun(frame.w, frame.h)
        critters.clear()
        coins.clear()
        effects = []
        popups = []
        swing = null
        cast = null
        held.clear()
        pressed = {}
        clock = 0
        hurtFlash = 0
        publish()
        wake()
      },
      key: (key, down, repeat) => {
        if (key === 'pause') {
          if (down && !repeat) pause(run.phase === 'playing')
          return
        }
        if (down) {
          if (!repeat && (key === 'jump' || key === 'attack' || key === 'special')) pressed = { ...pressed, [key]: true }
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

    return () => {
      cancelAnimationFrame(raf)
      resize.disconnect()
      controls.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>, down: boolean) => {
    // Shortcuts with a modifier stay the app's; only plain game keys are taken.
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = KEYS[event.code]
    if (!key || (hud.phase !== 'playing' && hud.phase !== 'paused')) return
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
      className="hub-game"
      data-phase={hud.phase}
      tabIndex={-1}
      onKeyDown={(event) => onKey(event, true)}
      onKeyUp={(event) => onKey(event, false)}
      onBlur={() => { if (hud.phase === 'playing') controls.current?.pause(true) }}
    >
      <canvas ref={canvasRef} className="hub-game-canvas" role="img" aria-label="Mini game: a knight runs through an endless world. Arrows move, Space jumps, X slashes, C casts lightning." />
      {active && multiplier > 1 && <p className="hub-game-combo" aria-hidden="true" style={{ fontSize: 16 + multiplier * 3 }}>×{multiplier}</p>}
      {active && (
        <p className="hub-game-score" aria-hidden="true">
          <span className="hub-game-lives">{'♥'.repeat(Math.max(0, hud.hearts))}<i>{'♥'.repeat(Math.max(0, MAX_HEARTS - hud.hearts))}</i></span>
          <span className="hub-game-time">{hud.meters} m</span>
          <span className="hub-game-points">{hud.score}</span>
        </p>
      )}
      {active && (
        <div className="hub-game-charge" data-ready={hud.charge >= CHARGE_MAX} aria-hidden="true">
          <i style={{ transform: `scaleX(${hud.charge / CHARGE_MAX})` }} />
        </div>
      )}
      {hud.phase === 'paused' && (
        <div className="hub-game-menu">
          <p>Paused</p>
          <button type="button" onClick={resume}>Resume</button>
        </div>
      )}
      {!active && (
        <div className="hub-game-menu">
          {hud.phase === 'over' ? <HubGameResults hud={hud} best={best} beaten={beaten} /> : <HubGameControls best={best} />}
          <button type="button" onClick={start}>{hud.phase === 'over' ? 'Play again' : 'Play'}</button>
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
      <p className="hub-game-keys"><kbd>←</kbd><kbd>→</kbd> run · <kbd>Space</kbd> jump · <kbd>X</kbd> slash · <kbd>C</kbd> lightning · <kbd>Esc</kbd> pause</p>
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
        {stats.kills} down{stats.stomps > 0 && <> ({stats.stomps} stomped)</>} · {stats.coins} coins · chain {stats.bestChain}
      </p>
    </div>
  )
}

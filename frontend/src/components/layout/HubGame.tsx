import { useEffect, useRef, useState } from 'react'
import { actTiming, clearFrame, composite, createAct, createFrame, createFx, painterFor, type PixelAct, type PixelFrame, type PixelFx, type PixelFxModule } from 'pixelfx'
import * as batEffect from 'pixelfx/fx/critters/bat'
import * as birdEffect from 'pixelfx/fx/critters/bird'
import * as butterflyEffect from 'pixelfx/fx/critters/butterfly'
import * as powEffect from 'pixelfx/fx/explosions/cartoon-pow'
import * as hitSpark from 'pixelfx/fx/impacts/hit-spark'
import * as doubleSlash from 'pixelfx/fx/melee/double-slash'
import * as heavyCleave from 'pixelfx/fx/melee/heavy-cleave'
import * as spinSlash from 'pixelfx/fx/melee/spin-slash'
import * as swordSlash from 'pixelfx/fx/melee/sword-slash'
import * as thrust from 'pixelfx/fx/melee/thrust'
import * as uppercut from 'pixelfx/fx/melee/uppercut'
import * as lightningCall from 'pixelfx/fx/moves/lightning-call'
import * as coinEffect from 'pixelfx/fx/pickups/coin-spin'
import * as collectEffect from 'pixelfx/fx/pickups/collect-burst'
import * as poofEffect from 'pixelfx/fx/spawn/poof'
import {
  CHARGE_MAX, FRENZY_FACTOR, MAX_WOUNDS, accuracy, clearHubTargets, clickHubGame, comboMultiplier, isDead, isFrenzy, medalFor, moveIndexForCombo, newHubGame,
  specialReady, startHubRound, stepHubGame, strikePosition,
  type HubGamePhase, type HubGameState, type HubMedal, type HubStats, type HubTarget, type HubTargetKind, type HubWaveKind,
} from './hubGameRules'

const PIXEL_SCALE = 2
const FRAME_MS = 1000 / 30
const BEST_KEY = 'adomnia.hub.gameBest'
/** The sword lands this long after the click: the wind-up is skipped so a click feels immediate. */
const STRIKE_SECONDS = 0.14
/** The whole picture holds for a beat on every kill: most of what makes a hit feel heavy. */
const HIT_STOP_SECONDS = 0.05
/** The last explosion plays out before the menu comes back. */
const DEATH_SECONDS = 1.1
const BLAST_SECONDS = 0.45
const BLAST_SHAKE = 4
const POPUP_SECONDS = 0.8
const POPUP_RISE = 26
const GROUND_MARGIN = 3
/** Topmost row a label may start on: higher and the big font is cut off. */
const LABEL_TOP = 2
const WHITE = 0xffffffff
const GOLD = 0xff30c0f0
const RED = 0xff3030ff
const OUTLINE = 0xff140c0e
const GOLD_RAMP = ['#3a2200', '#7a4a00', '#c88a10', '#f0c030', '#ffe070', '#fff2b0', '#ffffff']
const WAVE_TITLES: Record<HubWaveKind, string> = { swarm: 'SWARM!', coins: 'COIN RAIN!' }
const MULTI_TITLES = ['', '', 'DOUBLE', 'TRIPLE', 'QUAD']
const MEDAL_TITLES: Record<HubMedal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }
const MOVES: readonly PixelFxModule[] = [swordSlash, thrust, doubleSlash, uppercut, spinSlash, heavyCleave]
const EFFECTS: Partial<Record<HubTargetKind, PixelFxModule>> = { bat: batEffect, bird: birdEffect, butterfly: butterflyEffect, coin: coinEffect }

function loadBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 }
}
function saveBest(best: number): void {
  try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* the record is only a nicety */ }
}

/** How far ahead of the knight a move lands. */
function moveReach(move: PixelFxModule): number {
  const act = move.act as { target?: { x?: number } } | undefined
  return act?.target?.x ?? 60
}

/** A round bomb with a lit fuse, drawn straight into the frame: the library has no idle bomb. Colors are 0xAABBGGRR. */
function drawBomb(frame: PixelFrame, x: number, y: number, time: number): void {
  const put = (px: number, py: number, color: number) => {
    const column = Math.round(px)
    const row = Math.round(py)
    if (column >= 0 && row >= 0 && column < frame.w && row < frame.h) frame.color[row * frame.w + column] = color
  }
  const pulse = Math.sin(time * 9) > 0
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const reach = Math.hypot(dx, dy)
      if (reach > 7.2) continue
      const lit = dx < -1 && dy < -1 && reach > 2.5 && reach < 5.5
      const body = pulse ? 0xff303bff : 0xff1a1fc0
      put(x + dx, y + dy, reach > 6.2 ? 0xffd8e0ff : lit ? 0xffc8d0ff : body)
    }
  }
  for (let step = 0; step < 5; step++) put(x + 3 + step, y - 8 - step, 0xff78c8f0)
  const flicker = Math.sin(time * 40) > 0
  put(x + 8, y - 13, flicker ? 0xff1ec8ff : 0xff2a5cff)
  put(x + 9, y - 14, WHITE)
  if (flicker) put(x + 7, y - 14, 0xff1ec8ff)
}

interface HudState {
  phase: HubGamePhase
  score: number
  combo: number
  seconds: number
  wounds: number
  charge: number
  died: boolean
  frenzy: boolean
  stats: HubStats
}
interface Popup { text: string; x: number; y: number; age: number; color: number }

/**
 * A strip at the bottom of the Hub: a knight, and a 30 second round started by a click. At rest it
 * draws one frame and then nothing runs. Mouse only, so it never takes a key from the Hub.
 */
export function HubGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const startRef = useRef<(() => void) | null>(null)
  const [hud, setHud] = useState<HudState>({ phase: 'idle', score: 0, combo: 0, seconds: 30, wounds: 0, charge: 0, died: false, frenzy: false, stats: newHubGame().stats })
  const [best, setBest] = useState(loadBest)
  /** The record this round beat, shown on the results; null (or 0, the first round) when there was none to beat. */
  const [beaten, setBeaten] = useState<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    let game: HubGameState = newHubGame()
    let frame: PixelFrame = createFrame(1, 1)
    let image = context.createImageData(1, 1)
    const live = new Map<number, PixelFx>()
    let bursts: PixelFx[] = []
    let strikes: Array<{ target: HubTarget; left: number }> = []
    let popups: Popup[] = []
    let knight: PixelAct = createAct(swordSlash, { x: 40, y: 0 })
    let acting = false
    let raf = 0
    let last = 0
    let clock = 0
    let visible = true
    let dying = 0
    let blast = 0
    let hitStop = 0
    /** Seconds until the special lands: the world holds its breath meanwhile. */
    let specialLeft = 0

    const groundY = () => frame.h - GROUND_MARGIN
    /** The knight at rest: a move that has not started holds its first pose. Whole pixels only: the library draws no body at a fractional position. */
    const standKnight = (flip = false) => {
      knight = createAct(swordSlash, { x: Math.round(game.knightX), y: groundY(), flip })
      acting = false
    }
    const fit = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth / PIXEL_SCALE))
      const height = Math.max(1, Math.floor(canvas.clientHeight / PIXEL_SCALE))
      if (width === frame.w && height === frame.h) return false
      canvas.width = width
      canvas.height = height
      frame = createFrame(width, height)
      image = context.createImageData(width, height)
      game = { ...game, knightX: Math.min(game.knightX, Math.max(20, width - 20)) }
      standKnight()
      return true
    }
    const popup = (text: string, x: number, y: number, color: number) => { popups = [...popups, { text, x, y, age: 0, color }] }
    const syncEffects = () => {
      const present = new Set(game.targets.map((target) => target.id))
      for (const id of live.keys()) if (!present.has(id) && !strikes.some((strike) => strike.target.id === id)) live.delete(id)
      for (const target of game.targets) {
        const effect = EFFECTS[target.kind]
        if (!effect) continue
        const fx = live.get(target.id) ?? createFx(effect, { seed: target.id, ...(target.golden ? { palette: GOLD_RAMP } : {}) })
        live.set(target.id, fx)
        fx.options.x = target.x
        fx.options.y = target.y
        fx.options.flip = target.speed < 0
      }
    }
    const land = (target: HubTarget) => {
      const effect = target.kind === 'coin' ? collectEffect : poofEffect
      bursts = [...bursts, createFx(effect, { x: Math.round(target.x), y: Math.round(Math.min(target.y + 16, frame.h)), seed: target.id })]
      live.delete(target.id)
      hitStop = HIT_STOP_SECONDS
    }
    const wound = () => {
      const x = Math.round(game.knightX)
      bursts = [...bursts, createFx(hitSpark, { x, y: groundY() - 8, seed: Math.round(clock * 100) })]
      popup('OUCH', x, groundY() - 44, RED)
      blast = BLAST_SECONDS
      if (isDead(game)) dying = DEATH_SECONDS
    }
    const landSpecial = () => {
      const { state, cleared, points } = clearHubTargets(game)
      game = state
      for (const target of cleared) land(target)
      if (points) popup(`+${points}`, frame.w / 2, frame.h / 2 - 10, GOLD)
    }
    const advance = (dt: number) => {
      if (acting) knight.update(dt)
      if (acting && knight.done()) standKnight()
      blast = Math.max(0, blast - dt)
      popups = popups.map((item) => ({ ...item, age: item.age + dt })).filter((item) => item.age < POPUP_SECONDS)
      if (specialLeft > 0) {
        specialLeft -= dt
        if (specialLeft <= 0) landSpecial()
        return
      }
      if (hitStop > 0) { hitStop -= dt; return }
      const wounds = game.wounds
      const waves = game.waves
      const frenzy = isFrenzy(game)
      game = stepHubGame(game, dt, frame.w, frame.h)
      if (game.wounds !== wounds) wound()
      if (game.waves !== waves && game.lastWave) popup(WAVE_TITLES[game.lastWave], frame.w / 2, 14, GOLD)
      if (!frenzy && isFrenzy(game)) popup(`FRENZY ×${FRENZY_FACTOR}`, frame.w / 2, 14, RED)
      syncEffects()
      const landed = strikes.filter((strike) => strike.left - dt <= 0)
      for (const strike of landed) land(strike.target)
      strikes = strikes.filter((strike) => strike.left - dt > 0).map((strike) => ({ ...strike, left: strike.left - dt }))
      for (const fx of [...live.values(), ...bursts]) fx.update(dt)
      bursts = bursts.filter((fx) => !fx.done())
    }
    const paintLabels = () => {
      const painter = painterFor(frame)
      // An attacker stops and flashes before it dives, then keeps its mark: a heart is never lost by surprise.
      for (const target of game.targets) {
        const warning = target.attack === 'warn' && Math.sin(clock * 30) > -0.2
        // Above the critter, but never off the top of the strip, where the high fliers are.
        // Twice the size while it warns: it is the one thing the player must not miss.
        if (warning) painter.text('!!', target.x, Math.max(LABEL_TOP, target.y - 30), RED, { font: 'big', scale: 2, align: 'center', outline: OUTLINE })
        else if (target.attack === 'dive') painter.text('!', target.x, Math.max(LABEL_TOP, target.y - 24), RED, { font: 'big', align: 'center', outline: OUTLINE })
      }
      if (specialReady(game) && game.phase === 'playing' && Math.sin(clock * 8) > -0.4) {
        painter.text('CLICK ME', Math.max(24, Math.min(frame.w - 24, game.knightX)), groundY() - 50, GOLD, { font: 'mini', align: 'center', outline: OUTLINE })
      }
      for (const item of popups) {
        const y = item.y - POPUP_RISE * (item.age / POPUP_SECONDS)
        painter.text(item.text, item.x, y, item.color, { font: 'big', align: 'center', outline: OUTLINE, a: 1 - Math.max(0, item.age / POPUP_SECONDS - 0.6) / 0.4 })
      }
    }
    const paint = () => {
      clearFrame(frame)
      for (const fx of live.values()) fx.draw(frame)
      for (const target of game.targets) if (target.kind === 'bomb') drawBomb(frame, target.x, target.y, clock)
      knight.draw(frame, { target: false })
      for (const fx of bursts) fx.draw(frame)
      paintLabels()
      composite(frame, image.data)
      const strength = blast / BLAST_SECONDS
      const [hitX, hitY] = acting ? knight.shake : [0, 0]
      const shakeX = hitX + (strength ? BLAST_SHAKE * strength * (Math.sin(clock * 90) > 0 ? 1 : -1) : 0)
      const shakeY = hitY + (strength ? BLAST_SHAKE * strength * (Math.cos(clock * 70) > 0 ? 1 : -1) : 0)
      context.clearRect(0, 0, frame.w, frame.h)
      context.putImageData(image, Math.round(shakeX), Math.round(shakeY))
      if (strength) {
        context.fillStyle = `rgba(255, 70, 40, ${(0.55 * strength).toFixed(3)})`
        context.fillRect(0, 0, frame.w, frame.h)
      }
    }
    const publish = () => {
      const seconds = Math.ceil(game.timeLeft)
      const frenzy = isFrenzy(game)
      setHud((current) => (current.phase === game.phase && current.score === game.score && current.combo === game.combo && current.seconds === seconds && current.wounds === game.wounds && current.charge === game.charge && current.frenzy === frenzy
        ? current
        : { phase: game.phase, score: game.score, combo: game.combo, seconds, wounds: game.wounds, charge: game.charge, died: isDead(game), frenzy, stats: game.stats }))
    }
    const finish = () => {
      live.clear()
      bursts = []
      strikes = []
      popups = []
      standKnight()
      paint()
      const score = game.score
      setBest((current) => {
        if (score <= current) return current
        saveBest(score)
        setBeaten(current)
        return score
      })
    }
    const tick = (now: number) => {
      raf = 0
      if ((game.phase !== 'playing' && dying <= 0) || !visible || document.hidden) return
      raf = requestAnimationFrame(tick)
      if (now - last < FRAME_MS) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : FRAME_MS / 1000
      last = now
      clock += dt
      fit()
      advance(dt)
      if (dying > 0) {
        dying -= dt
        paint()
        if (dying > 0) return
        cancelAnimationFrame(raf)
        raf = 0
        publish()
        finish()
        return
      }
      publish()
      // A round that just ended stops here: at rest nothing else runs.
      if (game.phase === 'playing') paint()
      else finish()
    }
    const wake = () => {
      last = 0
      if ((game.phase === 'playing' || dying > 0) && !raf) raf = requestAnimationFrame(tick)
    }
    const strike = (hits: HubTarget[], knightBefore: number) => {
      const [target] = hits
      const move = MOVES[moveIndexForCombo(game.combo, MOVES.length)]
      const { x: knightX, flip } = strikePosition(target.x, knightBefore, moveReach(move), frame.w)
      game = { ...game, knightX }
      knight = createAct(move, { x: knightX, y: groundY(), flip, seed: target.id })
      acting = true
      const windup = actTiming(move)?.windup ?? 0
      if (windup > STRIKE_SECONDS) knight.update(windup - STRIKE_SECONDS)
      strikes = [...strikes, ...hits.map((hit) => ({ target: hit, left: STRIKE_SECONDS }))]
    }
    const fireSpecial = () => {
      knight = createAct(lightningCall, { x: Math.round(game.knightX), y: groundY(), seed: Math.round(clock * 100) })
      acting = true
      specialLeft = actTiming(lightningCall)?.hits[0]?.t ?? 0.7
      popup('LIGHTNING', frame.w / 2, 12, GOLD)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (game.phase !== 'playing' || dying > 0 || specialLeft > 0) return
      const box = canvas.getBoundingClientRect()
      const knightBefore = game.knightX
      const result = clickHubGame(game, (event.clientX - box.left) / PIXEL_SCALE, (event.clientY - box.top) / PIXEL_SCALE, frame.h)
      game = result.state
      if (result.special) {
        fireSpecial()
      } else if (result.hit?.kind === 'bomb') {
        bursts = [...bursts, createFx(powEffect, { x: Math.round(result.hit.x), y: Math.round(result.hit.y), seed: result.hit.id })]
        blast = BLAST_SECONDS
        if (isDead(game)) {
          dying = DEATH_SECONDS
          return
        }
      } else if (result.hit) {
        const hits = result.hits ?? [result.hit]
        strike(hits, knightBefore)
        const golden = hits.some((hit) => hit.golden || hit.kind === 'coin')
        const multi = MULTI_TITLES[Math.min(hits.length, MULTI_TITLES.length - 1)]
        popup(multi ? `${multi} +${result.points ?? 0}` : `+${result.points ?? 0}`, result.hit.x, result.hit.y - 14, golden || multi ? GOLD : WHITE)
        if (result.bonusSeconds) popup(`+${result.bonusSeconds}s`, Math.min(frame.w - 30, result.hit.x + 34), result.hit.y - 2, GOLD)
      }
      publish()
    }
    startRef.current = () => {
      setBeaten(null)
      game = startHubRound(game.knightX)
      live.clear()
      bursts = []
      strikes = []
      popups = []
      clock = 0
      dying = 0
      blast = 0
      hitStop = 0
      specialLeft = 0
      standKnight()
      publish()
      wake()
    }

    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      if (visible) wake()
    })
    intersection.observe(canvas)
    const resize = new ResizeObserver(() => { if (fit() && game.phase !== 'playing') paint() })
    resize.observe(canvas)
    canvas.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('visibilitychange', wake)
    fit()
    paint()

    return () => {
      cancelAnimationFrame(raf)
      resize.disconnect()
      intersection.disconnect()
      startRef.current = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  const playing = hud.phase === 'playing'
  const multiplier = comboMultiplier(hud.combo)
  const ready = hud.charge >= CHARGE_MAX
  const medal = medalFor(hud.score)
  return (
    <div className="hub-game" data-phase={hud.phase} data-frenzy={hud.frenzy}>
      <canvas ref={canvasRef} className="hub-game-canvas" role="img" aria-label="Mini game: a knight fights the critters you click. Do not click the bombs." />
      {playing && multiplier > 1 && <p className="hub-game-combo" aria-hidden="true" style={{ fontSize: 16 + multiplier * 3 }}>×{multiplier}</p>}
      {playing && (
        <p className="hub-game-score" aria-hidden="true">
          <span className="hub-game-lives">{'♥'.repeat(Math.max(0, MAX_WOUNDS - hud.wounds))}<i>{'♥'.repeat(Math.min(MAX_WOUNDS, hud.wounds))}</i></span>
          <span className="hub-game-time">{hud.seconds}s</span>
          <span className="hub-game-points">{hud.score}</span>
        </p>
      )}
      {playing && (
        <div className="hub-game-charge" data-ready={ready} aria-hidden="true">
          <i style={{ transform: `scaleX(${hud.charge / CHARGE_MAX})` }} />
        </div>
      )}
      {!playing && (
        <div className="hub-game-menu">
          {hud.phase === 'over' && <HubGameResults hud={hud} best={best} beaten={beaten} medal={medal} />}
          {hud.phase === 'idle' && best > 0 && <p>best {best}{medalFor(best) && <> · {MEDAL_TITLES[medalFor(best)!]}</>}</p>}
          <button type="button" onClick={() => startRef.current?.()}>{hud.phase === 'over' ? 'Play again' : 'Play'}</button>
        </div>
      )}
    </div>
  )
}

/** The end of a round: what happened, the medal it earned and whether it beat the record. */
function HubGameResults({ hud, best, beaten, medal }: Readonly<{ hud: HudState; best: number; beaten: number | null; medal: HubMedal | null }>) {
  const { stats } = hud
  return (
    <div className="hub-game-results">
      <p>
        {hud.died && <b>You died · </b>}
        <span>{hud.score}</span> points
        {medal && <em className="hub-game-medal" data-medal={medal}>{MEDAL_TITLES[medal]}</em>}
        {beaten ? <strong className="hub-game-record">New best!</strong> : <> · best {best}</>}
      </p>
      <p className="hub-game-stats">
        {stats.kills} down · {Math.round(accuracy(stats) * 100)}% accuracy · chain {stats.maxCombo}
        {stats.bestMulti > 1 && <> · {MULTI_TITLES[Math.min(stats.bestMulti, MULTI_TITLES.length - 1)].toLowerCase()} kill</>}
        {stats.bonusSeconds > 0 && <> · +{stats.bonusSeconds}s won</>}
      </p>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import type { DotGame, GameId, GameKey, Ink, Painter } from './types'
import { snakeGame } from './snake'
import { tictactoeGame } from './tictactoe'
import { pongGame } from './pong'
import { asteroidsGame } from './asteroids'

export const GAME_IDS: GameId[] = ['snake', 'tictactoe', 'pong', 'asteroids']

/** A random game, never the same as the previous one. */
export function pickGame(previous: GameId | null, random: () => number = Math.random): GameId {
  const pool = GAME_IDS.filter(id => id !== previous)
  return pool[Math.floor(random() * pool.length)]
}

const CELL = 11 // px between dots, like a Nothing Glyph matrix
const KEYS: Record<string, GameKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  ' ': 'action', Enter: 'action',
}
type Phase = 'ready' | 'playing' | 'paused' | 'over'

const bestKey = (id: GameId) => `adomnia.arcade.best.${id}`
function readBest(id: GameId) {
  try { return Number(localStorage.getItem(bestKey(id)) ?? (id === 'snake' ? localStorage.getItem('adomnia.snake.best') : 0)) || 0 } catch { return 0 }
}
function saveBest(id: GameId, value: number) {
  try { localStorage.setItem(bestKey(id), String(value)) } catch { /* storage unavailable */ }
}

interface ArcadeProps<S> { game: DotGame<S>; onExit: () => void }

function Arcade<S>({ game, onExit }: ArcadeProps<S>) {
  const tr = useUiTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [focused, setFocused] = useState(true)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(() => readBest(game.id))
  const [endMessage, setEndMessage] = useState('')
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current, ctx = canvas?.getContext('2d')
    if (!wrap || !canvas || !ctx) return
    let state: S | null = null
    let phaseNow: Phase = 'ready'
    let active = true // keys belong to the game only while it is active
    let raf = 0, last = performance.now(), time = 0, frame = 0, shownScore = -1
    let colors = { ink: '#e8edf5', accent: '#7dd3fc' }
    const held = new Set<GameKey>()
    const setPhaseBoth = (p: Phase) => { phaseNow = p; setPhase(p) }
    const readColors = () => {
      const css = getComputedStyle(wrap)
      colors = { ink: css.getPropertyValue('--color-text-1').trim() || colors.ink, accent: css.getPropertyValue('--color-accent').trim() || colors.accent }
    }

    const grid = () => ({ cols: Math.max(12, Math.floor(canvas.clientWidth / CELL)), rows: Math.max(9, Math.floor(canvas.clientHeight / CELL)) })
    const fit = () => {
      const ratio = Math.min(2, devicePixelRatio || 1)
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      const { cols, rows } = grid()
      if (!state || phaseNow === 'ready') state = game.init(cols, rows)
    }

    const draw = () => {
      if (!state) return
      const { cols, rows } = grid()
      const w = canvas.clientWidth, h = canvas.clientHeight
      const ox = (w - cols * CELL) / 2 + CELL / 2, oy = (h - rows * CELL) / 2 + CELL / 2
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = colors.ink
      ctx.globalAlpha = 0.09
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { ctx.beginPath(); ctx.arc(ox + x * CELL, oy + y * CELL, 1.5, 0, Math.PI * 2); ctx.fill() }
      const lit = new Map<string, { ink: Ink; size: number }>()
      const paint: Painter = {
        dot(x, y, ink = 'ink', size = 1) {
          const cx = Math.round(x), cy = Math.round(y)
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
          const key = `${cx},${cy}`, prev = lit.get(key)
          if (!prev || size >= prev.size) lit.set(key, { ink, size })
        },
      }
      game.draw(state, paint, time)
      for (const [key, { ink, size }] of lit) {
        const [cx, cy] = key.split(',').map(Number)
        ctx.fillStyle = ink === 'accent' ? colors.accent : colors.ink
        ctx.globalAlpha = (ink === 'soft' ? 0.42 : 1) * (phaseNow === 'paused' ? 0.5 : 1)
        ctx.beginPath(); ctx.arc(ox + cx * CELL, oy + cy * CELL, 3.7 * Math.min(1.35, size), 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      time += dt
      if (++frame % 30 === 0) readColors()
      if (state && phaseNow === 'playing') {
        state = game.update(state, dt, held)
        const status = game.status(state)
        if (status.score !== shownScore) { shownScore = status.score; setScore(status.score) }
        if (status.over) {
          setEndMessage(status.message ?? 'Game over')
          setPhaseBoth('over')
          if (status.score > readBest(game.id)) { saveBest(game.id, status.score); setBest(status.score) }
        }
      }
      draw()
      raf = requestAnimationFrame(tick)
    }

    const restart = () => {
      if (!state) return
      const { cols, rows } = grid()
      state = game.next ? game.next(state) : game.init(cols, rows)
      shownScore = -1
      setPhaseBoth('playing')
    }
    const begin = () => { if (phaseNow === 'ready' || phaseNow === 'paused') setPhaseBoth('playing') }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!active) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = KEYS[e.key]
      const pause = e.key === 'p' || e.key === 'P'
      if (e.key !== 'Escape' && !key && !pause) return
      // The game owns these keys: nothing else in the app sees them while playing.
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
      if (e.key === 'Escape') { exitRef.current(); return }
      if (pause) {
        if (game.realtime && phaseNow === 'playing') setPhaseBoth('paused')
        else begin()
        return
      }
      if (!key || !state) return
      if (phaseNow === 'over') { if (key === 'action') restart(); return }
      held.add(key)
      begin()
      state = game.press(state, key)
    }
    const onKeyUp = (e: KeyboardEvent) => { const key = KEYS[e.key]; if (key) held.delete(key) }
    const onBlur = () => held.clear() // no stuck keys after switching windows

    // Clicking outside hands the keyboard back to the app (and pauses a running game).
    const onPointerDown = (e: PointerEvent) => {
      const inside = wrap.contains(e.target as Node)
      active = inside
      setFocused(inside)
      if (!inside) { held.clear(); if (phaseNow === 'playing' && game.realtime) setPhaseBoth('paused') }
    }
    const onCanvasClick = (e: MouseEvent) => {
      if (!state) return
      if (phaseNow === 'over') { restart(); return }
      if (game.pointer) {
        const { cols, rows } = grid()
        const r = canvas.getBoundingClientRect()
        const ox = (r.width - cols * CELL) / 2, oy = (r.height - rows * CELL) / 2
        begin()
        state = game.pointer(state, Math.floor((e.clientX - r.left - ox) / CELL), Math.floor((e.clientY - r.top - oy) / CELL))
      } else begin()
    }

    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    readColors()
    fit()
    raf = requestAnimationFrame(tick)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    canvas.addEventListener('click', onCanvasClick)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      canvas.removeEventListener('click', onCanvasClick)
    }
  }, [game])

  const message = !focused && phase !== 'over' ? 'Paused · click to play'
    : phase === 'ready' ? game.help
    : phase === 'paused' ? 'Paused · P to resume'
    : phase === 'over' ? `${t(endMessage)} · ${t('Enter to play again')}` : ''
  return <div ref={wrapRef} className="hub-snake" role="application" aria-label={t(game.title)}>
    <div className="hub-snake-bar">
      <strong>{t(game.title)}</strong>
      <span>{String(score).padStart(3, '0')}</span>
      <span className="hub-snake-best">{t('Best')} {String(best).padStart(3, '0')}</span>
      <button type="button" className="hub-snake-exit" onClick={onExit} aria-label={t('Close game')} title="Esc">Esc</button>
    </div>
    <canvas ref={canvasRef} className="hub-snake-board"/>
    {message && <p className="hub-snake-msg">{phase === 'over' ? message : t(message)}</p>}
  </div>
}

interface DotArcadeProps { id: GameId; onExit: () => void }

/** The Hub's mini arcade: one of the dot-matrix games, inside the Today box. */
export function DotArcade({ id, onExit }: DotArcadeProps) {
  switch (id) {
    case 'snake': return <Arcade game={snakeGame} onExit={onExit}/>
    case 'tictactoe': return <Arcade game={tictactoeGame} onExit={onExit}/>
    case 'pong': return <Arcade game={pongGame} onExit={onExit}/>
    case 'asteroids': return <Arcade game={asteroidsGame} onExit={onExit}/>
  }
}

import { useEffect, useRef, useState } from 'react'
import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import type { DotGame, GameId, GameKey, Ink, Painter } from './types'
import { snakeGame } from './snake'
import { tictactoeGame } from './tictactoe'
import { pongGame } from './pong'
import { asteroidsGame } from './asteroids'

import { bubbleGame } from './bubble'
import { racerGame } from './racer'

import { GAME_IDS, GAME_TITLES } from './gameCatalog'

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
    let raf = 0, last = performance.now(), time = 0, shownScore = -1
    let boardCols = 0, boardRows = 0
    let visible = true
    let matrix: Path2D | null = null, matrixWidth = -1, matrixHeight = -1
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
    let colors = { ink: '#e8edf5', accent: '#7dd3fc', bubble1: '#34d399', bubble2: '#f472b6' }
    const schedule = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick) }
    const held = new Set<GameKey>()
    const setPhaseBoth = (p: Phase) => { phaseNow = p; setPhase(p) }
    const readColors = () => {
      const css = getComputedStyle(wrap)
      colors = { ink: css.getPropertyValue('--color-text-1').trim() || colors.ink, accent: css.getPropertyValue('--color-accent').trim() || colors.accent, bubble1: css.getPropertyValue('--color-success').trim() || colors.bubble1, bubble2: css.getPropertyValue('--color-error').trim() || colors.bubble2 }
    }

    const grid = () => ({ cols: boardCols || 24, rows: boardRows || 14 })
    const fit = () => {
      const ratio = Math.min(2, devicePixelRatio || 1)
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      if (!state || phaseNow === 'ready') {
        boardCols = Math.max(12, Math.floor(canvas.clientWidth / CELL))
        boardRows = Math.max(9, Math.floor(canvas.clientHeight / CELL))
        state = game.init(boardCols, boardRows)
      }
      draw()
    }

    const draw = () => {
      if (!state) return
      const { cols, rows } = grid()
      const w = canvas.clientWidth, h = canvas.clientHeight
      const cell = Math.min(w / cols, h / rows)
      const ox = (w - cols * cell) / 2 + cell / 2, oy = (h - rows * cell) / 2 + cell / 2
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = colors.ink
      ctx.globalAlpha = 0.09
      if (!matrix || matrixWidth !== w || matrixHeight !== h) {
        matrixWidth = w; matrixHeight = h; matrix = new Path2D()
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { matrix.moveTo(ox + x * cell + 1, oy + y * cell); matrix.arc(ox + x * cell, oy + y * cell, 1, 0, Math.PI * 2) }
      }
      ctx.fill(matrix)
      const lit = new Map<number, { ink: Ink; size: number; x: number; y: number }>()
      const paint: Painter = {
        bubble(x, y, kind) {
          const px = ox + x * cell, py = oy + y * cell
          ctx.fillStyle = kind === 0 ? colors.accent : kind === 1 ? colors.bubble1 : colors.bubble2
          ctx.globalAlpha = phaseNow === 'paused' ? 0.5 : 1
          ctx.beginPath()
          for (let i = 0; i < 16; i++) {
            const a = i * Math.PI / 8, bx = px + Math.cos(a) * cell * 1.12, by = py + Math.sin(a) * cell * 1.12
            ctx.moveTo(bx + cell * 0.12, by); ctx.arc(bx, by, cell * 0.12, 0, Math.PI * 2)
          }
          ctx.fill()
          // The matching kind is also encoded by a dot, plus or cross.
          ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(1, cell * 0.13); ctx.beginPath()
          if (kind === 0) { ctx.arc(px, py, cell * 0.2, 0, Math.PI * 2); ctx.fill() }
          else if (kind === 1) { ctx.moveTo(px-cell*0.35,py); ctx.lineTo(px+cell*0.35,py); ctx.moveTo(px,py-cell*0.35); ctx.lineTo(px,py+cell*0.35); ctx.stroke() }
          else { ctx.moveTo(px-cell*0.28,py-cell*0.28); ctx.lineTo(px+cell*0.28,py+cell*0.28); ctx.moveTo(px-cell*0.28,py+cell*0.28); ctx.lineTo(px+cell*0.28,py-cell*0.28); ctx.stroke() }
        },
        dot(x, y, ink = 'ink', size = 1) {
          const cx = Math.round(x), cy = Math.round(y)
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
          const key = cy * cols + cx, prev = lit.get(key)
          if (!prev || size >= prev.size) lit.set(key, { ink, size, x: game.id === 'snake' || game.id === 'tictactoe' ? cx : x, y: game.id === 'snake' || game.id === 'tictactoe' ? cy : y })
        },
      }
      game.draw(state, paint, reducedMotion.matches ? 0 : time)
      for (const { ink, size, x: cx, y: cy } of lit.values()) {
        ctx.fillStyle = ink === 'accent' || ink === 'bubble0' ? colors.accent : ink === 'bubble1' ? colors.bubble1 : ink === 'bubble2' ? colors.bubble2 : colors.ink
        ctx.globalAlpha = (ink === 'soft' ? 0.42 : 1) * (phaseNow === 'paused' ? 0.5 : 1)
        ctx.beginPath(); ctx.arc(ox + cx * cell, oy + cy * cell, cell * 0.34 * Math.min(1.35, size), 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const tick = (now: number) => {
      raf = 0
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      time += dt

      let changed = false
      if (state && phaseNow === 'playing') {
        const previous = state
        // Small physics steps prevent fast objects from skipping collisions.
        const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
        for (let i = 0; i < steps; i++) state = game.update(state, dt / steps, held)
        changed = state !== previous
        const status = game.status(state)
        if (status.score !== shownScore) { shownScore = status.score; setScore(status.score) }
        if (status.over) {
          setEndMessage(status.message ?? 'Game over')
          setPhaseBoth('over')
          if (status.score > readBest(game.id)) { saveBest(game.id, status.score); setBest(status.score) }
        }
      }
      draw()
      if (phaseNow === 'playing' && ((game.realtime && game.continuous !== false) || changed)) schedule()
    }

    const restart = () => {
      if (!state) return
      const { cols, rows } = grid()
      state = game.next ? game.next(state) : game.init(cols, rows)
      held.clear()
      shownScore = -1
      last = performance.now()
      setPhaseBoth('playing')
      schedule()
    }
    const begin = () => { if (phaseNow === 'ready' || phaseNow === 'paused') { last = performance.now(); setPhaseBoth('playing'); schedule() } }

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
        if (game.realtime && phaseNow === 'playing') { held.clear(); setPhaseBoth('paused'); draw() }
        else begin()
        return
      }
      if (!key || !state) return
      if (e.repeat && (game.id === 'racer' || key === 'action')) return
      if (phaseNow === 'over') { if (key === 'action') restart(); return }
      held.add(key)
      begin()
      state = game.press(state, key)
      draw(); schedule()
    }
    const onFocus = (e: FocusEvent) => { active = wrap.contains(e.target as Node); setFocused(active); if (!active) onBlur() }
    const onKeyUp = (e: KeyboardEvent) => { const key = KEYS[e.key]; if (key) held.delete(key) }
    const onBlur = () => { held.clear(); if (phaseNow === 'playing') { setPhaseBoth('paused'); draw() } }
    const onVisibility = () => { if (document.hidden) onBlur(); else { last = performance.now(); draw() } }

    // Clicking outside hands the keyboard back to the app (and pauses a running game).
    const onPointerDown = (e: PointerEvent) => {
      const inside = wrap.contains(e.target as Node)
      active = inside
      setFocused(inside)
      if (!inside) onBlur()
    }
    const onCanvasClick = (e: MouseEvent) => {
      if (!state) return
      if (phaseNow === 'over') { restart(); return }
      if (game.pointer) {
        const { cols, rows } = grid()
        const r = canvas.getBoundingClientRect()
        const cell = Math.min(r.width / cols, r.height / rows)
        const ox = (r.width - cols * cell) / 2, oy = (r.height - rows * cell) / 2
        begin()
        state = game.pointer(state, Math.floor((e.clientX - r.left - ox) / cell), Math.floor((e.clientY - r.top - oy) / cell))
      } else begin()
      draw(); schedule()
    }

    const themeObserver = new MutationObserver(() => { readColors(); draw() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) onBlur(); else draw() })
    intersection.observe(wrap)
    document.addEventListener('visibilitychange', onVisibility)
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    readColors()
    fit()
    draw()
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    canvas.addEventListener('click', onCanvasClick)
    window.addEventListener('blur', onBlur)
    document.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('focusin', onFocus)
      cancelAnimationFrame(raf)
      observer.disconnect()
      themeObserver.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
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
  return <div ref={wrapRef} className="hub-snake" data-phase={phase} tabIndex={0} role="application" aria-label={t(game.title)}>
    <div className="hub-snake-bar">
      <strong>{t(game.title)}</strong>
      <span>{String(score).padStart(3, '0')}</span>
      <span className="hub-snake-best">{t('Best')} {String(best).padStart(3, '0')}</span>
      <button type="button" className="hub-snake-exit" onClick={onExit} aria-label={t('Close game')} title="Esc">Esc</button>
    </div>
    <canvas ref={canvasRef} className="hub-snake-board" aria-label={t(game.help)}/>
    <div className="hub-arcade-controls"><span>{t(game.help)}</span><span>P / Esc</span></div>
    {message && <p className="hub-snake-msg">{phase === 'over' ? message : t(message)}</p>}
  </div>
}

interface DotArcadeProps { id: GameId; onExit: () => void; onSelect?: (id: GameId) => void }

/** The Hub's mini arcade: one of the dot-matrix games, inside the Today box. */
export function DotArcade({ id, onExit, onSelect }: DotArcadeProps) {
  const content = (() => { switch (id) {
    case 'snake': return <Arcade game={snakeGame} onExit={onExit}/>
    case 'tictactoe': return <Arcade game={tictactoeGame} onExit={onExit}/>
    case 'pong': return <Arcade game={pongGame} onExit={onExit}/>
    case 'asteroids': return <Arcade game={asteroidsGame} onExit={onExit}/>
    case 'bubble': return <Arcade game={bubbleGame} onExit={onExit}/>
    case 'racer': return <Arcade game={racerGame} onExit={onExit}/>
  } })()
  return <>{onSelect && <nav className="hub-arcade-tabs" aria-label="Arcade">{GAME_IDS.map(key => <button type="button" key={key} aria-pressed={key === id} onClick={() => onSelect(key)}>{GAME_TITLES[key]}</button>)}</nav>}{content}</>
}

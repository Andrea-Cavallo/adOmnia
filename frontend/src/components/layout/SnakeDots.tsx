import { useEffect, useRef, useState } from 'react'
import { newGame, step, turn, type Dir, type SnakeState } from './snake'
import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'

const CELL = 11 // px per dot, like a Nothing Glyph matrix
const BEST_KEY = 'adomnia.snake.best'
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
}

type Phase = 'ready' | 'playing' | 'paused' | 'over'

const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 } }
const saveBest = (v: number) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch { /* storage unavailable */ } }
// Faster as the snake grows, never below 55 ms per step.
const tickMs = (score: number) => Math.max(55, 120 - score * 3)

interface SnakeDotsProps {
  onExit: () => void
}

/** Snake on a dot matrix, played inside the Hub's Today box. Esc returns to the wordmark. */
export function SnakeDots({ onExit }: SnakeDotsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const game = useRef<SnakeState | null>(null)
  const nextDir = useRef<Dir>('right')
  const phaseRef = useRef<Phase>('ready')
  const tr = useUiTranslation()
  const t = (text: string) => tr(text as UiMessage) || text
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(readBest)
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !wrap || !ctx) return
    let timer = 0
    const css = (token: string) => getComputedStyle(wrap).getPropertyValue(token).trim()
    const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p) }

    const fit = () => {
      const ratio = Math.min(2, devicePixelRatio || 1)
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      const cols = Math.max(10, Math.floor(canvas.clientWidth / CELL))
      const rows = Math.max(8, Math.floor(canvas.clientHeight / CELL))
      if (!game.current || game.current.cols !== cols || game.current.rows !== rows) {
        game.current = newGame(cols, rows)
        nextDir.current = 'right'
      }
      draw()
    }

    const draw = () => {
      const g = game.current
      if (!g) return
      const w = canvas.clientWidth, h = canvas.clientHeight
      const ox = (w - g.cols * CELL) / 2 + CELL / 2, oy = (h - g.rows * CELL) / 2 + CELL / 2
      const ink = css('--color-text-1') || '#e8edf5'
      const accent = css('--color-accent') || '#7dd3fc'
      ctx.clearRect(0, 0, w, h)
      const dot = (x: number, y: number, r: number) => { ctx.beginPath(); ctx.arc(ox + x * CELL, oy + y * CELL, r, 0, Math.PI * 2); ctx.fill() }
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.1
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) dot(x, y, 1.6)
      ctx.globalAlpha = 1
      g.snake.forEach((c, i) => { ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 0.9 - i * 0.015); dot(c.x, c.y, i === 0 ? 4.4 : 3.8) })
      ctx.globalAlpha = g.over ? 0.35 : 1
      ctx.fillStyle = accent
      dot(g.food.x, g.food.y, 4.2 + (phaseRef.current === 'playing' ? Math.sin(performance.now() / 120) * 0.6 : 0))
      ctx.globalAlpha = 1
    }

    const loop = () => {
      const g = game.current
      if (!g || phaseRef.current !== 'playing') return
      const next = step({ ...g, dir: turn(g.dir, nextDir.current) })
      game.current = next
      if (next.score !== g.score) setScore(next.score)
      if (next.over) {
        setPhaseBoth('over')
        if (next.score > readBest()) { saveBest(next.score); setBest(next.score) }
      } else {
        timer = window.setTimeout(loop, tickMs(next.score))
      }
      draw()
    }

    const start = () => {
      if (phaseRef.current === 'over') { game.current = newGame(game.current!.cols, game.current!.rows); nextDir.current = 'right'; setScore(0) }
      setPhaseBoth('playing')
      window.clearTimeout(timer)
      timer = window.setTimeout(loop, tickMs(game.current?.score ?? 0))
    }

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') { e.preventDefault(); exitRef.current(); return }
      if (e.key === ' ') {
        e.preventDefault()
        if (phaseRef.current === 'playing') { window.clearTimeout(timer); setPhaseBoth('paused'); draw() } else start()
        return
      }
      if (e.key === 'Enter' && phaseRef.current === 'over') { e.preventDefault(); start(); return }
      const dir = KEYS[e.key]
      if (!dir) return
      e.preventDefault()
      nextDir.current = dir
      if (phaseRef.current === 'ready' || phaseRef.current === 'paused') start()
    }

    const onClick = () => { if (phaseRef.current !== 'playing') start() }
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    fit()
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('click', onClick)
    wrap.focus({ preventScroll: true })
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('click', onClick)
    }
  }, [])

  const message = phase === 'ready' ? 'Press an arrow to start' : phase === 'paused' ? 'Paused · Space to resume' : phase === 'over' ? 'Game over · Enter to retry' : ''
  return <div ref={wrapRef} className="hub-snake" role="application" aria-label="Snake" tabIndex={-1}>
    <div className="hub-snake-bar"><span>{t('Score')} {String(score).padStart(3, '0')}</span><span>{t('Best')} {String(best).padStart(3, '0')}</span><button type="button" className="hub-snake-exit" onClick={onExit} aria-label={t('Close Snake')} title="Esc">Esc</button></div>
    <canvas ref={canvasRef} className="hub-snake-board"/>
    {message && <p className="hub-snake-msg">{t(message)}</p>}
  </div>
}

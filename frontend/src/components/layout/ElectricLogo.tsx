import { useEffect, useId, useRef } from 'react'
import '@fontsource/geist/latin-800.css'

// adOmnia wordmark with a living lightning outline: the hexagonal mark is the "o".
// Own SVG take on the "electric logo" idea (react-bits ships it under MIT + Commons Clause and
// needs WebGL/ogl): turbulence-displaced outline + short arcs leaping off the mark's edges.
// Colours come from the hub tokens, so the effect follows every palette.

const MARK = 'M256 68 420 162Q428 167 428 177V331Q428 341 419 346L274 433 295 365 372 320V194L256 127 140 194V320L250 365V442L94 351Q84 345 84 334V177Q84 167 93 162Z'
// Filled hexagon speech bubble with the banner's long tail, redrawn by hand until the vector artwork exists.
const PLATE = 'M256 68 420 162Q428 167 428 177V331Q428 341 419 346L300 416 278 498Q274 510 266 501L232 428 94 351Q84 345 84 334V177Q84 167 93 162Z'
const EYES = 'M158 226Q215 228 239 286Q184 285 158 226ZM354 226Q297 228 273 286Q328 285 354 226Z'
// Mark (viewBox 80 64 352 382) placed as the "o" of the wordmark.
const MARK_TRANSFORM = 'translate(123 -4) scale(0.3)'
const FRAME_MS = 70
const ARC_COUNT = 5
// The lightning runs just outside the emblem's edge, so it reads on a white mark too.
const AURA_TRANSFORM = 'translate(256 255) scale(1.1) translate(-256 -255)'

/** Jagged polyline from a point on the outline, pushed outwards from the mark's centre. */
export function arcPoints(x: number, y: number, cx: number, cy: number, length: number, random: () => number): string {
  const angle = Math.atan2(y - cy, x - cx) + (random() - 0.5) * 1.2
  const steps = 4 + Math.floor(random() * 3)
  const points = [`${x.toFixed(1)},${y.toFixed(1)}`]
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * length
    const jitter = (random() - 0.5) * length * 0.45
    points.push(`${(x + Math.cos(angle) * t - Math.sin(angle) * jitter).toFixed(1)},${(y + Math.sin(angle) * t + Math.cos(angle) * jitter).toFixed(1)}`)
  }
  return points.join(' ')
}

export function ElectricLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const turbulence = useRef<SVGFETurbulenceElement>(null)
  const outline = useRef<SVGPathElement>(null)
  const arcs = useRef<SVGGElement>(null)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const path = outline.current
    const group = arcs.current
    if (!path || !group || typeof path.getTotalLength !== 'function') return
    const total = path.getTotalLength()
    const lines = Array.from(group.children) as SVGPolylineElement[]
    let frame = 0
    let last = 0
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick)
      if (time - last < FRAME_MS) return
      last = time
      turbulence.current?.setAttribute('seed', String(Math.floor(Math.random() * 1000)))
      for (const line of lines) {
        // Each arc lives a few frames; most frames only some of them are lit.
        if (Math.random() < 0.4) { line.setAttribute('opacity', '0'); continue }
        const point = path.getPointAtLength(Math.random() * total)
        line.setAttribute('points', arcPoints(point.x, point.y, 256, 255, 60 + Math.random() * 110, Math.random))
        line.setAttribute('opacity', (0.45 + Math.random() * 0.55).toFixed(2))
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <svg className={`electric-logo ${className ?? ''}`} viewBox="-8 -6 536 162" role="img" aria-label="adOmnia">
      <defs>
        <filter id={`${id}-bolt`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence ref={turbulence} type="turbulence" baseFrequency="0.035 0.08" numOctaves="2" seed="1" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="12" xChannelSelector="R" yChannelSelector="G" result="bolt" />
          <feGaussianBlur in="bolt" stdDeviation="3.2" result="halo" />
          <feMerge><feMergeNode in="halo" /><feMergeNode in="halo" /><feMergeNode in="bolt" /></feMerge>
        </filter>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      {/* Soft halo behind the ink. */}
      <g className="electric-logo-halo" filter={`url(#${id}-glow)`}>
        <text x="0" y="112" textLength="140" lengthAdjust="spacingAndGlyphs">ad</text>
        <path transform={MARK_TRANSFORM} d={MARK} />
        <text x="258" y="112" textLength="262" lengthAdjust="spacingAndGlyphs">mnia</text>
      </g>
      <g className="electric-logo-ink">
        <text x="0" y="112" textLength="140" lengthAdjust="spacingAndGlyphs">ad</text>
        <path transform={MARK_TRANSFORM} d={PLATE} className="electric-logo-plate" />
        <path transform={MARK_TRANSFORM} d={EYES} className="electric-logo-eyes" />
        <text x="258" y="112" textLength="262" lengthAdjust="spacingAndGlyphs">mnia</text>
      </g>
      {/* Living lightning: displaced outline of the mark plus arcs that leap off its edges. */}
      <g transform={MARK_TRANSFORM} className="electric-logo-bolt" filter={`url(#${id}-bolt)`}>
        <g transform={AURA_TRANSFORM}>
        <path ref={outline} d={PLATE} />
        <g ref={arcs}>{Array.from({ length: ARC_COUNT }, (_, index) => <polyline key={index} points="0,0" opacity="0" />)}</g>
        </g>
      </g>
    </svg>
  )
}

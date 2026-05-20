import { useEffect, useRef } from 'react'

export function LightPillarBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let w = 0
    let h = 0

    const pillars = Array.from({ length: 18 }, () => ({
      x: Math.random(),
      width: 1 + Math.random() * 3,
      speed: 0.2 + Math.random() * 0.6,
      hue: 260 + Math.random() * 40,
      alpha: 0.04 + Math.random() * 0.08,
      phase: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 0.02,
    }))

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)

      for (const p of pillars) {
        const time = t * 0.001 * p.speed
        const sway = Math.sin(time + p.phase) * 20
        const x = p.x * w + sway
        const gradient = ctx.createLinearGradient(x, 0, x, h)
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.5 + p.phase)
        const alpha = p.alpha * (0.6 + 0.4 * pulse)

        gradient.addColorStop(0, `hsla(${p.hue}, 80%, 65%, 0)`)
        gradient.addColorStop(0.15, `hsla(${p.hue}, 80%, 65%, ${alpha})`)
        gradient.addColorStop(0.5, `hsla(${p.hue}, 90%, 60%, ${alpha * 1.5})`)
        gradient.addColorStop(0.85, `hsla(${p.hue}, 80%, 65%, ${alpha})`)
        gradient.addColorStop(1, `hsla(${p.hue}, 80%, 65%, 0)`)

        ctx.beginPath()
        ctx.rect(x - p.width / 2, 0, p.width, h)
        ctx.fillStyle = gradient
        ctx.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    resize()
    animId = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0"
      style={{ width: '100%', height: '100%' }}
    />
  )
}

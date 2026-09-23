export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, color: string | CanvasGradient) {
  ctx.fillStyle = color
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill()
}

export function line(ctx: CanvasRenderingContext2D, points: number[], color: string, width = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(points[0], points[1])
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
  ctx.stroke()
}

export function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, size = 12) {
  ctx.fillStyle = color; ctx.font = `600 ${size}px monospace`; ctx.fillText(value, x, y)
}

export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent')
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}


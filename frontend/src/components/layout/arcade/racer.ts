import type { DotGame } from './types'

export interface Racer {
  cols: number; rows: number; lane: number; position: number
  objects: { lane: number; y: number; energy: boolean }[]
  elapsed: number; spawn: number; score: number; over: boolean
}

export const racerGame: DotGame<Racer> = {
  id: 'racer', title: 'Glyph Racer', help: 'Left/Right: change lane · collect + · P: pause', realtime: true,
  init: (cols, rows) => ({ cols, rows, lane: 1, position: 1, objects: [], elapsed: 0, spawn: 0.8, score: 0, over: false }),
  press(s, key) {
    if (s.over) return s
    return { ...s, lane: Math.max(0, Math.min(2, s.lane + (key === 'left' ? -1 : key === 'right' ? 1 : 0))) }
  },
  update(s, dt) {
    if (s.over) return s
    const elapsed = s.elapsed + dt, speed = Math.min(13, 5 + elapsed * 0.08)
    const position = s.position + Math.max(-dt * 12, Math.min(dt * 12, s.lane - s.position))
    const carY = s.rows - 3
    let score = s.score, over = false
    const objects: Racer['objects'] = []
    for (const item of s.objects) {
      const y = item.y + speed * dt
      if (Math.abs(item.lane - position) < 0.38 && item.y <= carY + 1 && y >= carY - 1) {
        if (item.energy) { score += 10; continue }
        over = true
      }
      if (y < s.rows + 2) objects.push({ ...item, y })
      else if (!item.energy) score += 1
    }
    let spawn = s.spawn - dt
    if (spawn <= 0 && !over) {
      // One hazard per row always leaves two lanes open. A pickup uses another lane.
      const lane = Math.floor(Math.random() * 3)
      objects.push({ lane, y: -1, energy: false })
      if (Math.random() < 0.55) objects.push({ lane: (lane + 1 + Math.floor(Math.random() * 2)) % 3, y: -1, energy: true })
      spawn = Math.max(0.8, 1.6 - elapsed * 0.007)
    }
    return { ...s, position, objects, elapsed, spawn, score, over }
  },
  draw(s, paint) {
    const width = Math.min(s.cols - 2, 18), left = (s.cols - width) / 2
    const x = (lane: number) => left + width * (lane + 0.5) / 3
    for (let y = 0; y < s.rows; y++) {
      paint.dot(left, y, 'soft', 0.45); paint.dot(left + width, y, 'soft', 0.45)
      if ((y + Math.floor(s.elapsed * 8)) % 4 === 0) for (const lane of [1, 2]) paint.dot(left + width * lane / 3, y, 'soft', 0.4)
    }
    for (const item of s.objects) {
      const cx = x(item.lane)
      if (item.energy) {
        paint.dot(cx, item.y, 'accent', 0.7)
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) paint.dot(cx + dx * 0.7, item.y + dy * 0.7, 'accent', 0.45)
      } else for (const [dx,dy] of [[-1,-0.7],[0,-0.7],[1,-0.7],[-1,0.7],[0,0.7],[1,0.7]]) paint.dot(cx+dx,item.y+dy,'ink',0.75)
    }
    const cx = x(s.position), cy = s.rows - 3
    for (const [dx,dy] of [[0,-1.5],[-0.8,-0.5],[0.8,-0.5],[-0.8,0.5],[0.8,0.5],[0,1.2]]) paint.dot(cx+dx,cy+dy,'accent',0.8)
  },
  status: s => ({ score: s.score, over: s.over, message: 'Game over' }),
}

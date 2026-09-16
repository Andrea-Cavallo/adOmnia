export type Rect = { x: number; y: number; w: number; h: number }
export type Platform = Rect & { floating?: boolean }
export type Bug = Rect & { left: number; right: number; direction: number; alive: boolean; phase: number }
export type Bit = { id: number; x: number; y: number; secret?: boolean }

export const WORLD_WIDTH = 3220
export const CHECKPOINT_X = 1090
export const HOTFIX = { x: 2635, y: 397, w: 30, h: 34 }
export const EXIT_X = 3100

// Main-route jumps stay below 100 px high / 110 px wide. The upper branch is
// optional; missing it always drops the player back onto the main route.
export const PLATFORMS: Platform[] = [
  { x: 0, y: 460, w: 410, h: 100 },
  { x: 505, y: 460, w: 390, h: 100 },
  { x: 990, y: 460, w: 450, h: 100 },
  { x: 1525, y: 460, w: 515, h: 100 },
  { x: 2140, y: 460, w: 1080, h: 100 },
  { x: 370, y: 380, w: 120, h: 22, floating: true },
  { x: 855, y: 375, w: 135, h: 22, floating: true },
  { x: 1390, y: 376, w: 135, h: 22, floating: true },
  { x: 1650, y: 365, w: 128, h: 22, floating: true },
  { x: 1835, y: 275, w: 155, h: 22, floating: true },
  { x: 2055, y: 310, w: 135, h: 22, floating: true },
  { x: 2330, y: 370, w: 125, h: 22, floating: true },
]

export const SPIKES: Rect[] = [{ x: 1280, y: 440, w: 64, h: 20 }, { x: 2410, y: 440, w: 60, h: 20 }]

export function createBugs(): Bug[] {
  return [
    { x: 650, y: 426, w: 38, h: 34, left: 565, right: 808, direction: 1, alive: true, phase: 0 },
    { x: 1750, y: 426, w: 38, h: 34, left: 1595, right: 1940, direction: -1, alive: true, phase: 1.4 },
    { x: 2835, y: 426, w: 38, h: 34, left: 2750, right: 2940, direction: 1, alive: true, phase: 2.8 },
  ]
}

const BIT_ROWS = [
  { x: 175, y: 413, count: 4, step: 38 },
  { x: 395, y: 340, count: 3, step: 32 },
  { x: 665, y: 345, count: 3, step: 33 },
  { x: 890, y: 333, count: 3, step: 32 },
  { x: 1185, y: 403, count: 2, step: 35 },
  { x: 1414, y: 337, count: 3, step: 32 },
  { x: 1680, y: 324, count: 3, step: 32 },
  { x: 1860, y: 232, count: 4, step: 32, secret: true },
  { x: 2080, y: 270, count: 3, step: 32, secret: true },
  { x: 2210, y: 412, count: 3, step: 34 },
  { x: 2355, y: 329, count: 3, step: 32 },
  { x: 2900, y: 360, count: 3, step: 33 },
]

export const BITS: Bit[] = BIT_ROWS.flatMap((row) => Array.from({ length: row.count }, (_, i) => ({
  id: 0, x: row.x + row.step * i, y: row.y - Math.sin(i / Math.max(1, row.count - 1) * Math.PI) * 10, secret: row.secret,
}))).map((bit, id) => ({ ...bit, id }))

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

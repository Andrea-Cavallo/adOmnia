import type { PowerPickup } from './powers'

export type Rect = { x: number; y: number; w: number; h: number }
export type Platform = Rect & { floating?: boolean; travel?: number; unstable?: boolean; originX?: number; crumble?: number }
export type Bug = Rect & { left: number; right: number; direction: number; alive: boolean; phase: number; retry?: boolean }
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


export type Firewall = Rect & { phase: number }
export type Level = {
  name: string; platforms: Platform[]; spikes: Rect[]; bits: Bit[]; bugs: Bug[]; firewalls: Firewall[]; springs: Rect[]; powers: PowerPickup[]
}
const gateway: Platform[] = [
  { x: 0, y: 460, w: 600, h: 100 }, { x: 715, y: 460, w: 285, h: 100 },
  { x: 1040, y: 460, w: 360, h: 100 }, { x: 1525, y: 460, w: 375, h: 100 },
  { x: 2020, y: 460, w: 1200, h: 100 },
  { x: 380, y: 385, w: 125, h: 22, floating: true, travel: 50 },
  { x: 866, y: 370, w: 135, h: 22, floating: true, travel: 42 },
  { x: 1380, y: 376, w: 135, h: 22, floating: true, travel: 48 },
  { x: 1670, y: 365, w: 130, h: 22, floating: true },
  { x: 1850, y: 275, w: 155, h: 22, floating: true, travel: 30 },
  { x: 2030, y: 355, w: 150, h: 22, floating: true, travel: 40 },
]
export const LEVELS: Level[] = [
  { name: 'Localhost',
    // git revert first so R is learned early; sudo rewards the secret branch.
    powers: [{ kind: 'revert', x: 200, y: 420 }, { kind: 'breakpoint', x: 1457, y: 345 }, { kind: 'sudo', x: 2175, y: 280 }, { kind: 'gc', x: 2440, y: 380 }],
    springs: [{ x: 300, y: 448, w: 44, h: 14 }], platforms: PLATFORMS, spikes: SPIKES, bits: BITS, bugs: createBugs(), firewalls: [] },
  { name: 'API Gateway',
    powers: [{ kind: 'revert', x: 120, y: 420 }, { kind: 'breakpoint', x: 1100, y: 420 }, { kind: 'sudo', x: 1580, y: 420 }, { kind: 'gc', x: 2600, y: 420 }],
    springs: [{ x: 710, y: 448, w: 44, h: 14 }, { x: 1695, y: 353, w: 44, h: 14 }], platforms: gateway, spikes: [], bits: BITS.map(b => ({ ...b, id: b.id + 100 })),
    bugs: createBugs().map((b, i) => ({ ...b, retry: true, ...(i === 0 ? { x: 370, left: 180, right: 520 } : i === 1 ? { x: 1730, left: 1600, right: 1840 } : {}) })),
    firewalls: [{ x: 1210, y: 365, w: 25, h: 95, phase: 0 }, { x: 2280, y: 365, w: 25, h: 95, phase: 1.7 }] },
  { name: 'Production',
    powers: [{ kind: 'revert', x: 100, y: 420 }, { kind: 'gc', x: 520, y: 420 }, { kind: 'breakpoint', x: 1420, y: 420 }, { kind: 'sudo', x: 2420, y: 420 }],
    springs: [{ x: 1875, y: 263, w: 44, h: 14 }], platforms: [...PLATFORMS.filter(p => p.floating && p.x < 2140).map(p => ({ ...p, unstable: true })),
      { x: 0, y: 460, w: 570, h: 100 }, { x: 650, y: 460, w: 620, h: 100 },
      { x: 1370, y: 460, w: 390, h: 100 }, { x: 1840, y: 460, w: 340, h: 100 },
      { x: 2260, y: 460, w: 960, h: 100 }], spikes: [{ x: 1050, y: 440, w: 64, h: 20 }],
    bits: BITS.map(b => ({ ...b, id: b.id + 200 })), bugs: createBugs().slice(0, 2).map((b, i) => ({ ...b, ...(i === 0 ? { x: 820, left: 700, right: 980 } : { x: 1970, left: 1880, right: 2100 }) })), firewalls: [{ x: 1590, y: 365, w: 25, h: 95, phase: 0.5 }] },
]
// Reward trails follow the launch trajectory; they teach the shortcut by sight.
for (const [levelIndex, level] of LEVELS.entries()) {
  for (const [springIndex, spring] of level.springs.entries()) {
    for (let i = 0; i < 6; i++) {
      const t = 0.1 + i * 0.085
      level.bits = [...level.bits, { id: 1000 + levelIndex * 100 + springIndex * 10 + i,
        x: spring.x + 15 + 310 * t, y: Math.max(55, spring.y - 24 - 850 * t + 950 * t * t), secret: spring.y < 400 }]
    }
  }
}
// Every cycle has a visible warning before it can damage the player.
export function firewallPhase(time: number, offset: number): 'off' | 'warning' | 'active' {
  const t = (time + offset) % 4.8
  return t < 2.4 ? 'off' : t < 3.2 ? 'warning' : 'active'
}
export type Boss = { health: number; clock: number; hit: boolean; waves: Rect[] }
export function createBoss(): Boss { return { health: 3, clock: 0, hit: false, waves: [] } }
export const BOSS_BODY = { x: 2820, y: 378, w: 90, h: 82 }

import type { PowerPickup } from './powers'

export type Rect = { x: number; y: number; w: number; h: number }
export type Platform = Rect & { floating?: boolean; travel?: number; unstable?: boolean; originX?: number; crumble?: number; deleted?: boolean
  /** Arena slab the Monolith can switch offline, and the arena ceiling. */
  arena?: boolean; ceiling?: boolean; verticalTravel?: number; originY?: number; pulse?: number; skin?: 'key' | 'ide' | 'book' | 'phone' | 'usb' | 'popup' | 'rack' | 'packet' | 'pod' | 'window' | 'xml' | 'floppy' | 'toolbar' | 'button' | 'progress' }
/** Magnetic grapple anchor: a0 latches on, swings and launches. */
export type Anchor = { x: number; y: number }
/** The DELETE wave chase: `lead` px behind the player when it wakes up. */
export type Purge = { start: number; end: number; speed: number; lead: number }
/** `chaser` charges when a0 is close, `turret` returns fire from a fixed post. */
export type BugKind = 'patrol' | 'chaser' | 'turret' | 'flyer' | 'leak' | 'race' | 'deadlock' | 'timeout' | 'zombie' | 'null' | 'clone'
export type Bug = Rect & { left: number; right: number; direction: number; alive: boolean; phase: number; retry?: boolean; hover?: boolean; homeY?: number
  dive?: number; targetX?: number; targetY?: number; homeX?: number; maxHp?: number; wake?: number; summoned?: boolean; kind?: BugKind; hp?: number; alert?: number; fuse?: number }
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


/** Seconds between turret shots; the renderer draws the charge from it. */
export const TURRET_CYCLE = 1.85
export type Firewall = Rect & { phase: number }
export type Level = {
  name: string; width?: number; exitX?: number; hotfix?: Rect; platforms: Platform[]; spikes: Rect[]; bits: Bit[]; bugs: Bug[]; firewalls: Firewall[]; springs: Rect[]; powers: PowerPickup[]
  anchors: Anchor[]; purge?: Purge; fans?: Rect[]; slowZone?: Rect; lessons?: { x: number; end: number; command: BossCommand }[]
}
// Anchors sit above every main-route gap: the grapple is always an option,
// never the only one. Heights keep the swing arc clear of the floor at 460.
const ANCHORS: Anchor[][] = [
  [{ x: 455, y: 252 }, { x: 940, y: 238 }, { x: 1482, y: 244 }, { x: 1772, y: 196 }, { x: 2092, y: 214 }, { x: 2600, y: 228 }],
  [{ x: 660, y: 246 }, { x: 1018, y: 232 }, { x: 1462, y: 236 }, { x: 1958, y: 212 }, { x: 2404, y: 240 }],
  [{ x: 608, y: 250 }, { x: 900, y: 222 }, { x: 1150, y: 238 }, { x: 1320, y: 206 }, { x: 1560, y: 232 },
   { x: 1800, y: 200 }, { x: 2020, y: 226 }, { x: 2222, y: 206 }, { x: 2420, y: 236 }],
]
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
    springs: [{ x: 300, y: 448, w: 44, h: 14 }], platforms: PLATFORMS, spikes: SPIKES, bits: BITS, bugs: createBugs(), firewalls: [], anchors: ANCHORS[0] },
  { name: 'API Gateway',
    powers: [{ kind: 'revert', x: 120, y: 420 }, { kind: 'breakpoint', x: 1100, y: 420 }, { kind: 'sudo', x: 1580, y: 420 }, { kind: 'gc', x: 2600, y: 420 }],
    springs: [{ x: 710, y: 448, w: 44, h: 14 }, { x: 1695, y: 353, w: 44, h: 14 }], platforms: gateway, spikes: [], bits: BITS.map(b => ({ ...b, id: b.id + 100 })),
    bugs: createBugs().map((b, i) => ({ ...b, retry: true, ...(i === 0 ? { x: 370, left: 180, right: 520 } : i === 1 ? { x: 1730, left: 1600, right: 1840 } : {}) })),
    firewalls: [{ x: 1210, y: 365, w: 25, h: 95, phase: 0 }, { x: 2280, y: 365, w: 25, h: 95, phase: 1.7 }], anchors: ANCHORS[1] },
  { name: 'Production',
    powers: [{ kind: 'revert', x: 100, y: 420 }, { kind: 'gc', x: 520, y: 420 }, { kind: 'breakpoint', x: 1420, y: 420 }, { kind: 'sudo', x: 2420, y: 420 }],
    springs: [{ x: 1875, y: 263, w: 44, h: 14 }], platforms: [...PLATFORMS.filter(p => p.floating && p.x < 2140).map(p => ({ ...p, unstable: true })),
      { x: 0, y: 460, w: 570, h: 100 }, { x: 650, y: 460, w: 620, h: 100 },
      { x: 1370, y: 460, w: 390, h: 100 }, { x: 1840, y: 460, w: 340, h: 100 },
      { x: 2260, y: 460, w: 960, h: 100 },
      // Escape ramps for the DELETE chase: always a higher line to take.
      { x: 1180, y: 330, w: 150, h: 20, floating: true }, { x: 1470, y: 300, w: 140, h: 20, floating: true },
      { x: 1960, y: 320, w: 145, h: 20, floating: true }, { x: 2210, y: 290, w: 140, h: 20, floating: true },
      // Boss arena: a ceiling for `reverse gravity`, three slabs for `stop platforms`.
      { x: 2430, y: 104, w: 790, h: 26, ceiling: true },
      // Launch pads for the core. None may sit above it: the hit is a fall.
      { x: 2500, y: 330, w: 118, h: 20, floating: true, arena: true },
      { x: 2680, y: 286, w: 118, h: 20, floating: true, arena: true },
      { x: 2944, y: 318, w: 112, h: 20, floating: true, arena: true }],
    spikes: [{ x: 1050, y: 440, w: 64, h: 20 }],
    bits: BITS.map(b => ({ ...b, id: b.id + 200 })), bugs: createBugs().slice(0, 2).map((b, i) => ({ ...b, ...(i === 0 ? { x: 820, left: 700, right: 980 } : { x: 1970, left: 1880, right: 2100 }) })), firewalls: [{ x: 1590, y: 365, w: 25, h: 95, phase: 0.5 }], anchors: ANCHORS[2],
    // ~1.8 km of floor deleted behind you; the run ends at the checkpoint.
    purge: { start: 640, end: 2460, speed: 176, lead: 430 } },
]
// Short encounters invite a stomp -> air dash -> stomp chain. Hover bugs are
// optional stepping stones; the main path below stays open.
for (const [level, encounters] of [
  [[735, 426], [2230, 345], [2350, 300]],
  [[460, 426], [2180, 355], [2320, 315]],
  [[900, 426], [2050, 330], [2160, 280]],
].entries()) {
  for (const [index, [x, y]] of encounters.entries()) {
    LEVELS[level].bugs.push({ x, y, w: 38, h: 34, left: x, right: x, direction: 1,
      alive: true, phase: index * 1.4, hover: y < 400, homeY: y })
  }
}
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
/** The Monolith announces a command, then rewrites one rule of the arena. */
export type BossCommand = 'gravity' | 'clones' | 'offline'
export const BOSS_COMMANDS: BossCommand[] = ['gravity', 'offline', 'clones']
export const BOSS_HEALTH = 6
export const GRAVITY_SAFE_X = 2680
export const COMMAND_SECONDS = 5
/** Seconds the command is readable on screen before it takes effect. */
export const BOSS_ANNOUNCE = 3
export const ARENA_X = 2430
/** A SOAP envelope thrown by a fist: it arcs across the arena and stings. */
export type Envelope = Rect & { vx: number; vy: number; spin: number; kind?: 'soap' | 'xml' | 'error' | 'debris'; warning?: number }
export type Boss = { health: number; clock: number; hit: boolean; envelopes: Envelope[]
  command: BossCommand | null; announce: number; applied: boolean; remaining: number; cooldown: number; sequence: number; phase: number; started: boolean; modules: number[]; debrisClock: number
  /** Which fist threw last, and how much recoil is left to draw. */
  arm: number; recoil: number }
export function createBoss(): Boss {
  return { health: BOSS_HEALTH, clock: 0, hit: false, envelopes: [], command: null, announce: 0, applied: false, remaining: 0, cooldown: 0, sequence: 0, phase: 0, started: false, modules: [3, 3, 3], debrisClock: 0, arm: 0, recoil: 0 }
}
/** The stompable core: the rack base. The tower above it is drawing only. */
export const BOSS_BODY = { x: 2820, y: 378, w: 90, h: 82 }
export const BOSS_TOWER = { x: 2786, y: 150, w: 158, h: 310 }
export const BOSS_FISTS = [{ x: BOSS_TOWER.x - 66, y: 254 }, { x: BOSS_TOWER.x + BOSS_TOWER.w + 66, y: 238 }]
export const ENVELOPE_SPEED = 252
export const ENVELOPE_GRAVITY = 430

// Reactive enemies. Chasers stay inside a band of solid floor so they never
// walk into a pit; turrets telegraph every shot before it can hurt anyone.
const HUNTERS: [number, number, BugKind, number][][] = [
  [[1150, 426, 'chaser', 1], [2560, 426, 'turret', 2]],
  [[860, 426, 'chaser', 2], [1700, 426, 'turret', 2], [2500, 426, 'chaser', 1]],
  [[900, 426, 'chaser', 2], [1500, 426, 'turret', 2], [2000, 426, 'chaser', 2]],
]
for (const [level, hunters] of HUNTERS.entries()) {
  for (const [index, [x, y, kind, hp]] of hunters.entries()) {
    const roam = kind === 'chaser' ? 250 : 0
    LEVELS[level].bugs.push({ x, y, w: 38, h: 34, left: x - roam, right: x + roam, direction: -1,
      alive: true, phase: index * 0.9, kind, hp, alert: 0, fuse: 0 })
  }
}

// Localhost's second half: an aerial shortcut above three readable encounters.
// Own arrays keep the shared Gateway/Production geometry unchanged.
const localhost = LEVELS[0]
localhost.width = 4820
localhost.exitX = 4700
localhost.hotfix = { ...HOTFIX, x: 4590 }
localhost.platforms = [...localhost.platforms,
  { x: 3315, y: 460, w: 465, h: 100 },
  { x: 3880, y: 460, w: 390, h: 100 },
  { x: 4370, y: 460, w: 450, h: 100 },
  { x: 3155, y: 375, w: 155, h: 22, floating: true },
  { x: 3430, y: 365, w: 145, h: 22, floating: true },
  { x: 3635, y: 280, w: 155, h: 22, floating: true },
  { x: 3770, y: 370, w: 125, h: 22, floating: true },
  { x: 4050, y: 355, w: 145, h: 22, floating: true },
  { x: 4240, y: 375, w: 145, h: 22, floating: true },
]
localhost.anchors = [...localhost.anchors, { x: 3265, y: 235 }, { x: 3610, y: 190 }, { x: 3830, y: 235 }, { x: 4320, y: 235 }]
localhost.powers = [...localhost.powers, { kind: 'revert', x: 3070, y: 420 }, { kind: 'breakpoint', x: 3675, y: 245 }]
for (const [index, [x, y, kind]] of ([
  [3020, 426, 'patrol'], [3460, 426, 'chaser'], [3650, 246, 'patrol'],
  [3970, 426, 'patrol'], [4120, 426, 'turret'], [4280, 320, 'patrol'], [4420, 426, 'chaser'],
] as const).entries()) {
  localhost.bugs.push({ x, y, w: 38, h: 34, left: x - (y < 400 ? 0 : 55), right: x + (y < 400 ? 0 : 65),
    direction: -1, alive: true, phase: index, kind, hp: 1, hover: y < 400, homeY: y })
}
for (const [row, [x, y]] of [[3190, 335], [3460, 325], [3660, 238], [3910, 410], [4080, 315], [4280, 335], [4470, 375]].entries()) {
  for (let i = 0; i < 3; i++) localhost.bits.push({ id: 2000 + row * 3 + i, x: x + i * 30, y, secret: row === 2 })
}

export function levelWidth(level: number) { return LEVELS[level].width ?? WORLD_WIDTH }
export function levelExit(level: number) { return LEVELS[level].exitX ?? EXIT_X }
export function levelHotfix(level: number) { return LEVELS[level].hotfix ?? HOTFIX }


/** Readable weak points: shoot from the floor or jump from either launch slab. */
export const BOSS_MODULES = [
  { x: 2760, y: 292, w: 32, h: 30, label: 'CORE' },
  { x: 2954, y: 326, w: 32, h: 30, label: 'SESSION' },
  { x: 2760, y: 408, w: 32, h: 30, label: 'SOAP' },
]
export function bossPhase(health: number) { return health > 4 ? 0 : health > 2 ? 1 : 2 }
export function platformOffline(platform: Platform, time: number) {
  return platform.pulse !== undefined && (time + platform.pulse) % 6 > 4.5
}

// One campaign vocabulary: precision -> moving infrastructure -> rule overrides.
LEVELS[0].name = 'Buggy Dev Desk'
LEVELS[1].name = 'Production Datacenter'
LEVELS[2].name = 'Legacy Dimension'
const deskSkins = ['key', 'ide', 'book', 'phone', 'usb', 'popup'] as const
const legacySkins = ['window', 'xml', 'floppy', 'toolbar', 'button', 'progress'] as const
for (const [stage, map] of LEVELS.entries()) {
  map.platforms = map.platforms.map((p, index) => ({ ...p,
    skin: stage === 0 ? deskSkins[index % deskSkins.length] : stage === 1 ? (p.floating ? index % 2 ? 'packet' : 'pod' : 'rack') : legacySkins[index % legacySkins.length],
    ...(stage === 0 && p.floating && index % 6 === 4 ? { travel: 24 } : {}),
    ...(stage === 0 && p.floating && index % 6 === 5 ? { pulse: 1.5 } : {}),
    ...(stage === 0 && p.floating && p.x > 800 && p.x < 2400 ? { unstable: true } : {}),
  }))
  // Existing airborne stepping stones become actual flying enemies.
  map.bugs = map.bugs.map(b => b.hover ? { ...b, kind: 'flyer', homeX: b.x, left: b.x - 70, right: b.x + 70, dive: 0, fuse: 1.4, hp: 1 } : b)
}
// A keyboard bridge falls key by key; the safe floor below teaches before punishing.
for (let i = 0; i < 7; i++) LEVELS[0].platforms.push({ x: 2660 + i * 65, y: 350, w: 57, h: 24, floating: true, unstable: true, skin: 'key' })
LEVELS[0].bugs.push({ x: 4390, y: 402, w: 56, h: 58, left: 4380, right: 4520, direction: -1, alive: true, phase: 0, kind: 'null', hp: 5, maxHp: 5, fuse: 0 })
LEVELS[0].bugs[1].kind = 'zombie'; LEVELS[0].bugs[1].hp = 2
LEVELS[0].bugs[6].kind = 'zombie'; LEVELS[0].bugs[6].hp = 2
// Lift shafts and fan columns alter routes without stealing player input.
LEVELS[1].fans = [{ x: 750, y: 210, w: 100, h: 250 }, { x: 2040, y: 180, w: 100, h: 280 }]
LEVELS[1].slowZone = { x: 1120, y: 0, w: 300, h: 540 }
LEVELS[1].platforms.push({ x: 1060, y: 320, w: 130, h: 22, floating: true, verticalTravel: 75, skin: 'rack' },
  { x: 2200, y: 325, w: 130, h: 22, floating: true, verticalTravel: 65, skin: 'rack' },
  { x: 2440, y: 320, w: 140, h: 22, floating: true, pulse: 0, skin: 'pod' })
LEVELS[1].purge = { start: 1550, end: 2460, speed: 205, lead: 500 }
LEVELS[2].purge = undefined
LEVELS[2].lessons = [{ x: 650, end: 1180, command: 'gravity' }, { x: 1330, end: 1720, command: 'offline' }, { x: 1840, end: 2180, command: 'clones' }]
LEVELS[2].platforms.push({ x: 620, y: 104, w: 650, h: 26, ceiling: true, skin: 'toolbar' })
for (const platform of LEVELS[2].platforms) if (platform.floating && platform.x >= 1330 && platform.x < 1720) platform.pulse = 0
// Hand-authored encounters: each silhouette has its own attack vocabulary.
const extra: [number, number, BugKind][][] = [
  [[1010, 245, 'flyer'], [1980, 190, 'flyer'], [2870, 230, 'timeout'], [3400, 200, 'flyer'], [3960, 230, 'timeout']],
  [[540, 235, 'flyer'], [880, 426, 'leak'], [1280, 250, 'timeout'], [1590, 426, 'race'], [1810, 426, 'deadlock'], [2180, 210, 'flyer'], [2630, 426, 'leak'], [2800, 230, 'timeout']],
  [[380, 235, 'timeout'], [850, 250, 'flyer'], [1410, 426, 'deadlock'], [1660, 245, 'timeout'], [2070, 230, 'flyer'], [2300, 426, 'race']],
]
for (const [stage, entries] of extra.entries()) for (const [i, [x, y, kind]] of entries.entries()) {
  const flying = kind === 'flyer' || kind === 'timeout'
  const hp = kind === 'deadlock' ? 3 : kind === 'leak' ? 2 : 1
  LEVELS[stage].bugs.push({ x, y, w: 38, h: 34, left: x - 70, right: x + 70, homeX: x, homeY: y,
    direction: -1, alive: true, phase: i * 0.7, kind, hp, maxHp: hp, fuse: 1 + i * 0.23, hover: flying, dive: 0 })
}
// Every ground enemy stays on its actual floor (including old chasers).
for (const map of LEVELS) for (const bug of map.bugs) {
  if (bug.hover) continue
  const floor = map.platforms.find(p => !p.floating && !p.ceiling && bug.x >= p.x && bug.x + bug.w <= p.x + p.w && Math.abs(p.y - bug.y - bug.h) < 2)
  if (floor) { bug.left = Math.max(bug.left, floor.x + 8); bug.right = Math.min(bug.right, floor.x + floor.w - bug.w - 8) }
}

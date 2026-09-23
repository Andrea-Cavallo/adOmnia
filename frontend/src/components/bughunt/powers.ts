// Developer power-ups. Pure state helpers; the game loop in prototype.ts applies them.
export type PowerKind = 'revert' | 'breakpoint' | 'sudo' | 'gc' | 'shuriken'
/** Code Blaster is a0's default; picking up JSON Shuriken swaps in a limited stack. */
export type Weapon = 'blaster' | 'shuriken'
export const SHURIKEN_AMMO = 14
/** Bugs one shuriken passes through before it breaks. */
export const SHURIKEN_PIERCE = 3
export type PowerPickup = { kind: PowerKind; x: number; y: number }

export const SUDO_SECONDS = 6
export const BREAKPOINT_SECONDS = 5
export const REVERT_MAX_CHARGES = 3
/** 3 s of history at the fixed 60 Hz step. */
export const REVERT_FRAMES = 180
/** Frames replayed per step: 3 s of history rewinds in 0.75 s. */
export const REWIND_SPEED = 4
export const GC_RADIUS = 640
export const GC_SPEED = 1500

export type PlayerFrame = { x: number; y: number; vx: number; vy: number; facing: number }

export type PowerState = {
  sudo: number
  breakpoint: number
  revertCharges: number
  /** `${level}:${index}` of pickups already taken this run. */
  picked: Set<string>
  history: PlayerFrame[]
  rewind: PlayerFrame[] | null
  gc: { x: number; y: number; r: number } | null
  /** JSON Shuriken left; 0 means the Code Blaster is back in hand. Kept across levels and falls. */
  shuriken: number
}

export function createPowerState(): PowerState {
  return { sudo: 0, breakpoint: 0, revertCharges: 0, picked: new Set(), history: [], rewind: null, gc: null, shuriken: 0 }
}

/** Timed effects end and history is dropped: rewinding must never lead back into a pit. */
export function clearActivePowers(state: PowerState) {
  state.sudo = 0
  state.breakpoint = 0
  state.history = []
  state.rewind = null
  state.gc = null
}

export function recordFrame(state: PowerState, frame: PlayerFrame) {
  state.history.push(frame)
  if (state.history.length > REVERT_FRAMES) state.history.shift()
}

export const pickupKey = (level: number, index: number) => `${level}:${index}`

export const PICKUP_SIZE = 30
